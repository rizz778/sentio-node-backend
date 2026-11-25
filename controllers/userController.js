import mongoose from "mongoose";
import UserProfile from "../models/UserProfile.js";
import User from "../models/User.js";
import { cloudinary } from "../config/cloudinary.js";
import Chat from '../models/Chat.js';
import { getCache, setCache, delCache } from '../config/redis.js';

/**
 * Save or update user profile.
 * Updates MongoDB and the Redis profile cache.
 */
export const saveUserProfile = async (req, res) => {
  try {
    const rawUserId = req.params.userId || req.user?.id || req.user?._id;
    if (!rawUserId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    let resolvedId = null;
    if (mongoose.Types.ObjectId.isValid(rawUserId)) {
      resolvedId = new mongoose.Types.ObjectId(rawUserId);
    } else {
      const dbUser = await User.findOne({ googleId: rawUserId }).select('_id');
      if (dbUser) {
        resolvedId = dbUser._id;
      }
    }

    if (!resolvedId) {
      return res.status(404).json({ success: false, message: "User account not found to associate profile" });
    }

    // Strip immutable/metadata fields from body to prevent Mongoose modification errors
    const { _id, __v, createdAt, updatedAt, userId: _, ...cleanData } = req.body || {};

    let userProfile = await UserProfile.findOne({ userId: resolvedId });

    if (userProfile) {
      userProfile = await UserProfile.findOneAndUpdate(
        { userId: resolvedId },
        cleanData,
        { new: true, runValidators: true }
      );
    } else {
      userProfile = new UserProfile({ userId: resolvedId, ...cleanData });
      await userProfile.save();
    }

    // Update Redis cache with latest profile (both ObjectId and Google UID keys)
    try {
      const cacheKey = `sentio:profile:${resolvedId}`;
      await setCache(cacheKey, userProfile, 86400);
      if (rawUserId && rawUserId !== resolvedId.toString()) {
        await setCache(`sentio:profile:${rawUserId}`, userProfile, 86400);
      }
    } catch (cacheErr) {
      console.warn("[UserController] Redis profile cache skipped:", cacheErr.message);
    }

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
    const rawUserId = req.params.userId || req.user?.id || req.user?._id;
    if (!rawUserId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    // Resolve rawUserId to valid MongoDB ObjectId if it's a Google UID string
    let resolvedId = null;
    if (mongoose.Types.ObjectId.isValid(rawUserId)) {
      resolvedId = new mongoose.Types.ObjectId(rawUserId);
    } else {
      const dbUser = await User.findOne({ googleId: rawUserId }).select('_id');
      if (dbUser) {
        resolvedId = dbUser._id;
      }
    }

    if (!resolvedId) {
      // User hasn't synced or profile doesn't exist yet — return clean empty state
      return res.status(200).json({ success: true, userProfile: null });
    }

    const cacheKey = `sentio:profile:${resolvedId}`;

    // 1. Check Redis cache
    const cachedProfile = await getCache(cacheKey);
    if (cachedProfile) {
      return res.status(200).json(cachedProfile);
    }

    // 2. Query MongoDB
    const userProfile = await UserProfile.findOne({ userId: resolvedId }).lean();

    if (!userProfile) {
      return res.status(200).json({ success: true, userProfile: null });
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

    const emptyAnalytics = {
      totalSessions: 0,
      totalUserMessages: 0,
      averageDistressScore: 0,
      dominantEmotion: 'neutral',
      emotionCounts: {
        happy: 0,
        sad: 0,
        angry: 0,
        fear: 0,
        surprise: 0,
        disgust: 0,
        neutral: 0,
        unknown: 0,
      },
      emotionDistribution: {
        happy: 0,
        sad: 0,
        angry: 0,
        fear: 0,
        surprise: 0,
        disgust: 0,
        neutral: 0,
        unknown: 0,
      },
      emotionPercentages: {
        happy: 0,
        sad: 0,
        angry: 0,
        fear: 0,
        surprise: 0,
        disgust: 0,
        neutral: 0,
        unknown: 0,
      },
      sessionsByDistress: { high: [], medium: [], low: [] },
      sessionAnalytics: [],
      distressTrend: [],
      emotionTrend: [],
    };

    if (!userSessions || userSessions.length === 0) {
      return res.status(200).json({
        success: true,
        analytics: emptyAnalytics,
        data: emptyAnalytics,
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
    const sessionsByDistress = { high: [], medium: [], low: [] };
    const sessionAnalytics = [];

    for (const session of userSessions) {
      const userMessages = (session.messages || []).filter((msg) => msg.sender === 'user');
      let sessionDistressSum = 0;
      let sessionDistressCount = 0;

      for (const message of userMessages) {
        totalUserMessages++;

        if (message.emotion) {
          const em = message.emotion.toLowerCase();
          emotionCounts[em] = (emotionCounts[em] || 0) + 1;

          emotionTrend.push({
            timestamp: message.timestamp,
            emotion: em,
            sessionId: session._id,
            sessionName: session.sessionName || "Chat Session",
          });
        }

        if (typeof message.distressScore === 'number') {
          totalDistressScore += message.distressScore;
          sessionDistressSum += message.distressScore;
          sessionDistressCount++;

          distressTrend.push({
            timestamp: message.timestamp,
            score: message.distressScore,
            sessionId: session._id,
            sessionName: session.sessionName || "Chat Session",
          });
        }
      }

      const avgDistress = sessionDistressCount > 0
        ? Number((sessionDistressSum / sessionDistressCount).toFixed(1))
        : 0;

      const sessionItem = {
        sessionId: session._id,
        sessionName: session.sessionName || "Chat Session",
        avgDistress,
        averageDistress: avgDistress,
        messageCount: session.messages?.length || 0,
        createdAt: session.createdAt || session.updatedAt || new Date().toISOString(),
      };

      sessionAnalytics.push(sessionItem);

      if (avgDistress >= 7) {
        sessionsByDistress.high.push(sessionItem);
      } else if (avgDistress >= 4) {
        sessionsByDistress.medium.push(sessionItem);
      } else {
        sessionsByDistress.low.push(sessionItem);
      }
    }

    const totalEmotions = Object.values(emotionCounts).reduce((a, b) => a + b, 0);
    const emotionPercentages = {};
    for (const [k, v] of Object.entries(emotionCounts)) {
      emotionPercentages[k] = totalEmotions > 0 ? Math.round((v / totalEmotions) * 100) : 0;
    }

    const averageDistressScore =
      totalUserMessages > 0 ? Number((totalDistressScore / totalUserMessages).toFixed(2)) : 0;

    const dominantEmotion =
      Object.entries(emotionCounts)
        .filter(([em]) => em !== 'unknown')
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';

    const payload = {
      totalSessions: userSessions.length,
      totalUserMessages,
      averageDistressScore,
      dominantEmotion,
      emotionCounts,
      emotionDistribution: emotionCounts,
      emotionPercentages,
      sessionsByDistress,
      sessionAnalytics,
      distressTrend,
      emotionTrend,
    };

    return res.status(200).json({
      success: true,
      analytics: payload,
      data: payload,
    });
  } catch (error) {
    console.error("[UserController] Error calculating emotion analytics:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};
