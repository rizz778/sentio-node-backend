import Chat from '../models/Chat.js';
import mongoose from 'mongoose';
import { encryptMessage, decryptMessage } from '../config/encrypt.js';
import { getCache, setCache, delCache, redisClient } from '../config/redis.js';

/**
 * Creates a new chat session.
 * Invalidates the cached session list in Redis.
 */
export const createSession = async (req, res) => {
  try {
    const userId = req.user._id;
    let { sessionName } = req.body;

    // If sessionName is missing, empty, or generic "Chat 1" when user already has chats, auto-number it
    if (!sessionName || typeof sessionName !== 'string' || !sessionName.trim() || sessionName.trim() === "Chat 1") {
      const existingCount = await Chat.countDocuments({ user: userId });
      sessionName = `Chat ${existingCount + 1}`;
    } else {
      sessionName = sessionName.trim();
    }

    const newSession = await Chat.create({
      user: userId,
      sessionName,
      messages: [],
    });

    // Invalidate user's session list cache in Redis (non-blocking)
    try {
      await delCache(`sentio:user:${userId}:sessions`);
    } catch (cacheErr) {
      console.warn("[ChatController] Cache invalidation skipped:", cacheErr.message);
    }

    return res.status(201).json({
      _id: newSession._id,
      sessionId: newSession._id,
      sessionName: newSession.sessionName,
      createdAt: newSession.createdAt,
    });
  } catch (error) {
    console.error("[ChatController] Error creating session:", error);
    return res.status(500).json({ message: "Server Error", error: error.message });
  }
};

/**
 * Retrieves all chat sessions for the authenticated user.
 * Cache-aside with Redis (TTL: 5 minutes).
 * Auto-repairs duplicate default names (e.g. multiple "Chat 1"s) chronologically.
 */
export const getSessions = async (req, res) => {
  try {
    const userId = req.user._id;
    const cacheKey = `sentio:user:${userId}:sessions`;

    // 1. Check Redis cache
    const cachedSessions = await getCache(cacheKey);
    if (cachedSessions && Array.isArray(cachedSessions)) {
      const duplicateCount = cachedSessions.filter(
        (s) => s.sessionName === "Chat 1" || s.sessionName === "Session 1"
      ).length;
      // Only return from cache if it does not suffer from duplicate default names
      if (duplicateCount <= 1) {
        return res.status(200).json(cachedSessions);
      }
    }

    // 2. Query MongoDB in chronological order (oldest first) to repair numbering
    let sessions = await Chat.find({ user: userId })
      .select("sessionName createdAt")
      .sort({ createdAt: 1 })
      .lean();

    // Check if user has duplicate generic names like "Chat 1" or "Session 1"
    const duplicateCount = sessions.filter(
      (s) => s.sessionName === "Chat 1" || s.sessionName === "Session 1"
    ).length;

    if (duplicateCount > 1) {
      // Repair existing duplicate default names chronologically: Chat 1, Chat 2, Chat 3...
      let counter = 1;
      const updatedSessions = [];
      for (const s of sessions) {
        if (s.sessionName === "Chat 1" || s.sessionName === "Session 1") {
          const newName = `Chat ${counter}`;
          await Chat.findByIdAndUpdate(s._id, { sessionName: newName });
          updatedSessions.push({ ...s, sessionName: newName });
          counter++;
        } else {
          updatedSessions.push(s);
        }
      }
      sessions = updatedSessions;
      // Clear cache so updated names are stored
      await delCache(cacheKey);
    }

    // Sort descending by creation date (newest first) for UI display
    sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 3. Cache in Redis
    await setCache(cacheKey, sessions, 300);

    return res.status(200).json(sessions);
  } catch (error) {
    console.error("[ChatController] Error retrieving sessions:", error);
    return res.status(500).json({ message: "Server Error", error: error.message });
  }
};

/**
 * Deletes a chat session and clears related caches.
 */
export const deleteSession = async (req, res) => {
  try {
    const userId = req.user._id;
    const { sessionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Invalid session ID format" });
    }

    const deleted = await Chat.findOneAndDelete({ _id: sessionId, user: userId });
    if (!deleted) {
      return res.status(404).json({ message: "Chat session not found" });
    }

    // Clear caches
    await delCache(`sentio:user:${userId}:sessions`);
    await delCache(`sentio:session:${sessionId}:messages`);

    return res.status(200).json({ message: "Session deleted successfully", sessionId });
  } catch (error) {
    console.error("[ChatController] Error deleting session:", error);
    return res.status(500).json({ message: "Server Error", error: error.message });
  }
};

/**
 * Retrieves all messages for a session.
 * Cache-aside with Redis (TTL: 1 hour).
 */
export const getSessionMessages = async (req, res) => {
  const { sessionId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    return res.status(400).json({ message: "Invalid session ID format" });
  }

  try {
    const cacheKey = `sentio:session:${sessionId}:messages`;

    // 1. Check Redis cache
    const cachedSession = await getCache(cacheKey);
    if (cachedSession) {
      return res.status(200).json(cachedSession);
    }

    // 2. Query MongoDB
    const session = await Chat.findById(sessionId).lean();

    if (!session) {
      return res.status(404).json({ message: "Chat session not found" });
    }

    // 3. Decrypt messages preserving MongoDB insertion order (the exact conversation flow)
    const rawMessages = session.messages || [];
    const decryptedMessages = rawMessages
      .map((msg) => {
        let decryptedText = msg.text;
        try {
          if (msg.iv && msg.authTag) {
            decryptedText = decryptMessage(msg.text, msg.iv, msg.authTag);
          }
        } catch (decErr) {
          console.warn("[ChatController] Decrypt failed for message:", decErr.message);
          decryptedText = "";
        }
        return {
          _id: msg._id,
          sender: msg.sender,
          text: decryptedText,
          emotion: msg.emotion || "unknown",
          distressScore: msg.distressScore || 0,
          timestamp: msg.timestamp,
        };
      })
      .filter((msg) => msg.text && msg.text.trim() !== "");

    const decryptedSession = {
      _id: session._id,
      sessionName: session.sessionName,
      createdAt: session.createdAt,
      messages: decryptedMessages,
    };

    // 4. Cache in Redis for 2 minutes only — messages grow during a session
    await setCache(cacheKey, decryptedSession, 120);

    return res.status(200).json(decryptedSession);
  } catch (error) {
    console.error("[ChatController] Error retrieving session messages:", error);
    return res.status(500).json({
      message: "Failed to retrieve messages",
      error: error.message,
    });
  }
};

/**
 * Appends a message to a session.
 * Encrypts and persists in MongoDB, and updates Redis caches.
 */
export const addMessage = async (req, res) => {
  const { sessionId } = req.params;
  const { sender, text, timestamp, emotion, distressScore } = req.body;

  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    return res.status(400).json({ message: "Invalid session ID format" });
  }

  if (!sender || typeof sender !== 'string') {
    return res.status(400).json({ message: "Valid sender is required" });
  }

  if (!text || typeof text !== 'string' || text.trim() === "") {
    return res.status(400).json({ message: "Message text cannot be empty" });
  }

  try {
    // Encrypt text before storing in MongoDB
    const encryptionData = encryptMessage(text.trim());
    const messageData = {
      sender,
      ...encryptionData,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    };

    if (emotion) {
      messageData.emotion = emotion;
    }

    if (typeof distressScore === 'number' && distressScore >= 0 && distressScore <= 10) {
      messageData.distressScore = distressScore;
    }

    // Persist to MongoDB
    const session = await Chat.findByIdAndUpdate(
      sessionId,
      { $push: { messages: messageData } },
      { new: true, runValidators: true }
    );

    if (!session) {
      return res.status(404).json({ message: "Chat session not found" });
    }

    // Invalidate full session cache in Redis
    const cacheKey = `sentio:session:${sessionId}:messages`;
    await delCache(cacheKey);

    // Sync to Redis 5-message sliding window shared with FastAPI
    if (redisClient && redisClient.status === 'ready') {
      try {
        const slidingKey = `sentio:session:${sessionId}:recent_messages`;
        const slidingEntry = JSON.stringify({
          sender,
          text: text.trim(),
          emotion: emotion || "unknown",
          distressScore: distressScore || 0,
          timestamp: messageData.timestamp,
        });
        await redisClient.rpush(slidingKey, slidingEntry);
        await redisClient.ltrim(slidingKey, -5, -1);
      } catch (redisErr) {
        console.warn("[ChatController] Sliding window update error:", redisErr.message);
      }
    }

    const addedMsg = session.messages[session.messages.length - 1];
    return res.status(201).json({
      message: "Message added successfully",
      messageId: addedMsg ? addedMsg._id : null,
    });
  } catch (error) {
    console.error("[ChatController] Error adding message:", error);
    return res.status(500).json({
      message: "Failed to add message",
      error: error.message,
    });
  }
};
