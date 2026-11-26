import mongoose from "mongoose";
import Episode from "../models/Episode.js";
import User from "../models/User.js";

/**
 * Computes cosine similarity between two float vectors.
 */
function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecB.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(vecA.length, vecB.length);

  for (let i = 0; i < len; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Resolves a raw user id (Google UID or string) to a valid MongoDB ObjectId.
 */
async function resolveUserId(rawId) {
  if (!rawId) return null;
  if (mongoose.Types.ObjectId.isValid(rawId)) {
    return new mongoose.Types.ObjectId(rawId);
  }
  const user = await User.findOne({ googleId: String(rawId) }).select("_id");
  return user ? user._id : null;
}

/**
 * POST /api/episodes
 * Creates and stores a new structured episodic memory with vector embedding.
 */
export const createEpisode = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.body.userId;
    const userId = await resolveUserId(rawUserId);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Valid user identity is required" });
    }

    const {
      sessionId,
      eventType = "general",
      eventSummary,
      dominantEmotions = [],
      peakDistressScore = 0,
      peopleMentioned = [],
      copingAttempted = "",
      resolutionStatus = "unresolved",
      embedding = [],
      timestamp,
    } = req.body;

    if (!eventSummary || typeof eventSummary !== "string" || !eventSummary.trim()) {
      return res.status(400).json({ success: false, message: "eventSummary is required" });
    }

    let sessionObjectId = null;
    if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
      sessionObjectId = new mongoose.Types.ObjectId(sessionId);
    }

    const episode = new Episode({
      user: userId,
      session: sessionObjectId,
      eventType,
      eventSummary: eventSummary.trim(),
      dominantEmotions: Array.isArray(dominantEmotions) ? dominantEmotions : [],
      peakDistressScore: typeof peakDistressScore === "number" ? Math.max(0, Math.min(10, peakDistressScore)) : 0,
      peopleMentioned: Array.isArray(peopleMentioned) ? peopleMentioned : [],
      copingAttempted: typeof copingAttempted === "string" ? copingAttempted.trim() : "",
      resolutionStatus: ["unresolved", "resolved", "ongoing"].includes(resolutionStatus)
        ? resolutionStatus
        : "unresolved",
      embedding: Array.isArray(embedding) ? embedding : [],
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });

    await episode.save();

    console.log(
      `[EpisodeController] 💾 Saved episodic memory for user ${userId} (${episode.eventType}): "${episode.eventSummary.slice(0, 50)}..."`
    );

    return res.status(201).json({
      success: true,
      message: "Episode created successfully",
      episode,
    });
  } catch (error) {
    console.error("[EpisodeController] Error creating episode:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

/**
 * GET /api/episodes
 * Retrieves episodic memories for the authenticated user with optional status filter.
 * Query params:
 *   status: "unresolved" | "resolved" | "ongoing" | "all" (default: "all")
 *   limit: integer (default: 5, max: 50)
 */
export const getUserEpisodes = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.query.userId;
    const userId = await resolveUserId(rawUserId);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Valid user identity is required" });
    }

    const { status, limit = 5 } = req.query;
    const maxLimit = Math.min(Math.max(1, parseInt(limit, 10) || 5), 50);

    const query = { user: userId };
    if (status && status !== "all" && ["unresolved", "resolved", "ongoing"].includes(status)) {
      query.resolutionStatus = status;
    }

    const episodes = await Episode.find(query)
      .select("-embedding") // Exclude bulky raw embedding array from list responses
      .sort({ timestamp: -1 })
      .limit(maxLimit)
      .lean();

    return res.status(200).json({
      success: true,
      count: episodes.length,
      episodes,
    });
  } catch (error) {
    console.error("[EpisodeController] Error fetching episodes:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

/**
 * POST /api/episodes/search
 * Searches a user's episodic memories by vector similarity against a query vector.
 * Prioritizes native MongoDB Atlas $vectorSearch; gracefully falls back to in-memory
 * cosine similarity if the Atlas Vector Search index is unavailable or running locally.
 * Request body:
 *   queryVector: Array<number> (768-dim float vector)
 *   limit: integer (default: 3)
 */
export const searchEpisodes = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.body.userId;
    const userId = await resolveUserId(rawUserId);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Valid user identity is required" });
    }

    const { queryVector, limit = 3 } = req.body;
    const maxResults = Math.min(Math.max(1, parseInt(limit, 10) || 3), 10);

    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      return res.status(400).json({ success: false, message: "queryVector array is required" });
    }
    

    // 1. Try native MongoDB Atlas $vectorSearch aggregation stage first
    try {
      const atlasMatches = await Episode.aggregate([
        {
          $vectorSearch: {
            index: "episode_vector_index",
            path: "embedding",
            queryVector: queryVector,
            numCandidates: Math.max(50, maxResults * 10),
            limit: maxResults,
            filter: { user: userId },
          },
        },
        {
          $project: {
            embedding: 0,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ]);

      if (Array.isArray(atlasMatches) && atlasMatches.length > 0) {
        console.log(
          `[EpisodeController] 🔍 Atlas $vectorSearch for user ${userId}: found ${atlasMatches.length} matches (top score: ${atlasMatches[0]?.score ?? 0})`
        );
        return res.status(200).json({
          success: true,
          count: atlasMatches.length,
          matches: atlasMatches,
          engine: "atlas_vector_search",
        });
      }
    } catch (atlasErr) {
      console.warn(
        `[EpisodeController] Atlas $vectorSearch unavailable (${atlasErr.message}). Falling back to in-memory cosine similarity.`
      );
    }

    // 2. Fallback: Query user's episodes and compute cosine similarity in-memory
    const userEpisodes = await Episode.find({
      user: userId,
      "embedding.0": { $exists: true },
    }).lean();

    if (!userEpisodes || userEpisodes.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        matches: [],
        engine: "in_memory_fallback",
      });
    }

    // Compute cosine similarity score for each episode
    const scored = userEpisodes.map((ep) => {
      const score = cosineSimilarity(queryVector, ep.embedding);
      const { embedding, ...cleaned } = ep;
      return {
        ...cleaned,
        score: Number(score.toFixed(4)),
      };
    });

    // Sort by similarity score descending
    scored.sort((a, b) => b.score - a.score);
    const topMatches = scored.slice(0, maxResults);

    console.log(
      `[EpisodeController] 🔍 In-memory cosine search for user ${userId}: found ${topMatches.length} matches (top score: ${topMatches[0]?.score ?? 0})`
    );

    return res.status(200).json({
      success: true,
      count: topMatches.length,
      matches: topMatches,
      engine: "in_memory_fallback",
    });
  } catch (error) {
    console.error("[EpisodeController] Error searching episodes:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

/**
 * PATCH /api/episodes/:episodeId
 * Updates an episode's therapeutic status (e.g. marking unresolved issues as resolved,
 * or updating coping strategies attempted).
 */
export const updateEpisode = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.body.userId;
    const userId = await resolveUserId(rawUserId);
    const { episodeId } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Valid user identity is required" });
    }

    if (!mongoose.Types.ObjectId.isValid(episodeId)) {
      return res.status(400).json({ success: false, message: "Invalid episode ID format" });
    }

    const { resolutionStatus, copingAttempted } = req.body;
    const updateData = {};

    if (resolutionStatus !== undefined) {
      if (!["unresolved", "resolved", "ongoing"].includes(resolutionStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid resolutionStatus. Must be 'unresolved', 'resolved', or 'ongoing'",
        });
      }
      updateData.resolutionStatus = resolutionStatus;
    }

    if (copingAttempted !== undefined && typeof copingAttempted === "string") {
      updateData.copingAttempted = copingAttempted.trim();
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided to update (allowed: resolutionStatus, copingAttempted)",
      });
    }

    const updated = await Episode.findOneAndUpdate(
      { _id: episodeId, user: userId },
      { $set: updateData },
      { new: true }
    ).select("-embedding");

    if (!updated) {
      return res.status(404).json({ success: false, message: "Episode not found or unauthorized" });
    }

    console.log(`[EpisodeController] ✏️ Updated episode ${episodeId} for user ${userId}:`, updateData);

    return res.status(200).json({
      success: true,
      message: "Episode updated successfully",
      episode: updated,
    });
  } catch (error) {
    console.error("[EpisodeController] Error updating episode:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};
