import mongoose from 'mongoose';
import User from '../models/User.js';
import { getCache, setCache } from '../config/redis.js';

/**
 * Downstream User Identity Middleware
 * ===================================
 * Node backend operates as an internal downstream microservice.
 * Upstream Gateway authenticates the client and injects trusted identity headers.
 * Resolves both raw MongoDB ObjectIds and Google UIDs to valid MongoDB user references.
 */

export const downstreamAuth = async (req, res, next) => {
  try {
    const rawUserId =
      req.headers['x-user-id'] ||
      req.headers['x-user-uid'] ||
      req.query.userId ||
      req.body.userId ||
      (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
        ? extractUserIdFromToken(req.headers.authorization.split(' ')[1])
        : null);

    if (!rawUserId) {
      console.warn(`[DownstreamAuth] ⚠️ [${req.id || '-'}] Unauthorized request to ${req.originalUrl || req.url}: missing x-user-id`);
      return res.status(401).json({
        message: 'Unauthorized: Downstream request requires x-user-id header or userId parameter',
      });
    }

    let resolvedObjectId = null;

    // Check if rawUserId is already a valid MongoDB ObjectId
    if (mongoose.Types.ObjectId.isValid(rawUserId)) {
      resolvedObjectId = new mongoose.Types.ObjectId(rawUserId);
    } else {
      // Resolve Google UID to MongoDB ObjectId using Redis cache or DB lookup
      const cachedMongoId = await getCache(`sentio:user:${rawUserId}:mongoid`);
      if (cachedMongoId && mongoose.Types.ObjectId.isValid(cachedMongoId)) {
        resolvedObjectId = new mongoose.Types.ObjectId(cachedMongoId);
      } else {
        const userEmail = (req.headers['x-user-email'] || '').toLowerCase().trim();
        const query = userEmail
          ? { $or: [{ googleId: String(rawUserId) }, { email: userEmail }] }
          : { googleId: String(rawUserId) };
        const dbUser = await User.findOne(query);
        if (dbUser) {
          resolvedObjectId = dbUser._id;
          if (!dbUser.googleId && rawUserId) {
            dbUser.googleId = String(rawUserId);
            await dbUser.save();
          }
          await setCache(`sentio:user:${rawUserId}:mongoid`, dbUser._id.toString(), 604800);
        } else {
          // User not found — sync may not have completed yet.
          // Return 404 so the client knows to trigger /auth/google sync first.
          console.warn(`[DownstreamAuth] User with googleId ${rawUserId} (email: ${userEmail}) not found in DB — sync may be pending`);
          return res.status(404).json({
            success: false,
            message: 'User account not found. Please sign in again.',
            code: 'USER_NOT_SYNCED',
          });
        }
      }
    }

    req.user = {
      _id: resolvedObjectId || rawUserId,
      id: (resolvedObjectId || rawUserId).toString(),
      uid: rawUserId,
      email: req.headers['x-user-email'] || '',
    };

    next();
  } catch (error) {
    console.error('[DownstreamAuth] Error resolving identity:', error);
    next(error);
  }
};

function extractUserIdFromToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      return payload.id || payload.userId || payload.sub || payload.uid || null;
    }
  } catch (e) {
    // If token parsing fails, ignore and return null
  }
  return null;
}

export default downstreamAuth;
