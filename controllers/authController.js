import User from '../models/User.js';
import Chat from '../models/Chat.js';
import { getCache, setCache } from '../config/redis.js';

export const syncUserHandler = async (req, res) => {
  try {
    const { uid, email, name, picture } = req.body;
    const userId = uid || req.headers['x-user-id'];
    const userEmail = email || req.headers['x-user-email'];

    if (!userId || !userEmail) {
      return res.status(400).json({
        success: false,
        message: 'Google UID and email are required to sync user in MongoDB',
      });
    }

    // 1. Check if user already exists by googleId or email
    let user = await User.findOne({
      $or: [{ googleId: userId }, { email: userEmail }],
    });

    let isNewUser = false;
    let initialSessionId = null;

    if (!user) {
      // 2. Create new user in MongoDB (Google-authenticated only).
      // Use findOneAndUpdate with upsert so concurrent requests or stale indexes
      // never cause a duplicate-key crash — the operation is idempotent.
      user = await User.findOneAndUpdate(
        { googleId: userId },
        {
          $setOnInsert: {
            googleId: userId,
            email: userEmail,
            name: name || userEmail.split('@')[0],
            username: name || userEmail.split('@')[0],
            avatar: picture || '',
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      isNewUser = true;

      // 3. Create initial Chat session for the new user
      const initialSession = new Chat({
        user: user._id,
        sessionName: 'Session 1',
        messages: [],
      });
      await initialSession.save();
      initialSessionId = initialSession._id;

      console.log(`[UserSync] ✨ [${req.id || '-'}] New user created: ${user.email} (MongoDB ID: ${user._id})`);
    } else {
      // Update googleId or avatar if updated on Google's end
      let modified = false;
      if (!user.googleId) {
        user.googleId = userId;
        modified = true;
      }
      if (picture && user.avatar !== picture) {
        user.avatar = picture;
        modified = true;
      }
      if (name && (!user.name || user.name === user.email.split('@')[0])) {
        user.name = name;
        user.username = name;
        modified = true;
      }
      if (modified) {
        await user.save();
      }
    }

    // 4. Cache mappings in Redis for downstream lookups (TTL: 7 days)
    if (userId) {
      await setCache(`sentio:user:${userId}:mongoid`, user._id.toString(), 604800);
    }
    await setCache(`sentio:user:${user._id}:info`, user, 604800);

    return res.status(isNewUser ? 201 : 200).json({
      success: true,
      isNewUser,
      user: {
        id: user._id,
        _id: user._id,
        uid: user.googleId || userId,
        name: user.name,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        tokens: user.tokens,
      },
      initialSessionId,
    });
  } catch (error) {
    console.error('[UserSync] Error syncing user:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync user with MongoDB',
      error: error.message,
    });
  }
};
