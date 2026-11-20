import UserProfile from "../models/UserProfile.js";
import { cloudinary } from "../config/cloudinary.js";
import Chat from '../models/Chat.js';
import { getCache, setCache, delCache } from '../config/redis.js';

/**
 * Save or update user profile.
 * Updates MongoDB and the Redis profile cache.
 */
export const saveUserProfile = async (req, res) => {
  try {
    const userId = req.params.userId || req.user.id || req.user._id;
    const userData = req.body;

    let userProfile = await UserProfile.findOne({ userId });

    if (userProfile) {
      userProfile = await UserProfile.findOneAndUpdate({ userId }, userData, { new: true });
    } else {
      userProfile = new UserProfile({ userId, ...userData });
      await userProfile.save();
    }

    // Update Redis cache (TTL: 24 hours)
    const cacheKey = `sentio:profile:${userId}`;
    await setCache(cacheKey, userProfile, 86400);

    return res.status(200).json({ success: true, userProfile });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation Error",
        errors: error.errors,
      });
    }
    console.error("[UserController] Error saving profile:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

/**
 * Retrieve user profile.
 * Supports both /api/profile and /api/profile/:userId.
 * Cache-aside with Redis (TTL: 24 hours).
 */
export const getUserProfile = async (req, res) => {
  try {
    const userId = req.params.userId || req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    const cacheKey = `sentio:profile:${userId}`;

    // 1. Check Redis cache
    const cachedProfile = await getCache(cacheKey);
    if (cachedProfile) {
      return res.status(200).json(cachedProfile);
    }

    // 2. Query MongoDB
    const userProfile = await UserProfile.findOne({ userId }).lean();

    if (!userProfile) {
      return res.status(404).json({ success: false, message: "Profile not found" });
    }

    // 3. Cache in Redis
    await setCache(cacheKey, userProfile, 86400);

    return res.status(200).json(userProfile);
  } catch (error) {
    console.error("[UserController] Error getting profile:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

/**
 * Upload profile picture to Cloudinary and update Redis cache.
 */
export const uploadProfilePicture = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User ID required" });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No image file provided" });
    }

    const profilePictureData = {
      url: req.file.path,
      publicId: req.file.filename,
    };

    const userProfile = await UserProfile.findOneAndUpdate(
      { userId },
      { profilePicture: profilePictureData },
      { new: true, upsert: true }
    );

    // Invalidate/refresh Redis profile cache
    await setCache(`sentio:profile:${userId}`, userProfile, 86400);

    return res.status(200).json({
      success: true,
      message: "Profile picture uploaded successfully",
      profilePicture: userProfile.profilePicture,
    });
  } catch (error) {
    console.error("[UserController] Error uploading profile picture:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

/**
 * Delete profile picture from Cloudinary and update Redis cache.
 */
export const deleteProfilePicture = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    const userProfile = await UserProfile.findOne({ userId });

    if (!userProfile) {
      return res.status(404).json({ success: false, message: "Profile not found" });
    }

    if (userProfile.profilePicture && userProfile.profilePicture.publicId) {
      await cloudinary.uploader.destroy(userProfile.profilePicture.publicId);
      userProfile.profilePicture = { url: null, publicId: null };
      await userProfile.save();
    }

    // Refresh Redis profile cache
    await setCache(`sentio:profile:${userId}`, userProfile, 86400);

    return res.status(200).json({
      success: true,
      message: "Profile picture deleted successfully",
    });
  } catch (error) {
    console.error("[UserController] Error deleting profile picture:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

/**
 * Get user emotion analytics from historical sessions.
 */
export const getUserEmotionAnalytics = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    const userSessions = await Chat.find({ user: userId }).lean();

    if (!userSessions || userSessions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No chat sessions found for this user",
      });
    }

    let totalDistressScore = 0;
    let totalUserMessages = 0;
    const emotionCounts = {
      happy: 0,
      sad: 0,
      angry: 0,
      fear: 0,
      surprise: 0,
      disgust: 0,
      neutral: 0,
      unknown: 0,
    };

    const distressTrend = [];
    const emotionTrend = [];

    for (const session of userSessions) {
      const userMessages = (session.messages || []).filter((msg) => msg.sender === 'user');

      for (const message of userMessages) {
        totalUserMessages++;

        if (message.emotion) {
          emotionCounts[message.emotion] = (emotionCounts[message.emotion] || 0) + 1;

          emotionTrend.push({
            timestamp: message.timestamp,
            emotion: message.emotion,
            sessionId: session._id,
            sessionName: session.sessionName,
          });
        }

        if (typeof message.distressScore === 'number') {
          totalDistressScore += message.distressScore;

          distressTrend.push({
            timestamp: message.timestamp,
            score: message.distressScore,
            sessionId: session._id,
          });
        }
      }
    }

    const averageDistressScore =
      totalUserMessages > 0 ? (totalDistressScore / totalUserMessages).toFixed(2) : 0;

    return res.status(200).json({
      success: true,
      analytics: {
        totalSessions: userSessions.length,
        totalUserMessages,
        averageDistressScore,
        emotionDistribution: emotionCounts,
        distressTrend,
        emotionTrend,
      },
    });
  } catch (error) {
    console.error("[UserController] Error calculating emotion analytics:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};
