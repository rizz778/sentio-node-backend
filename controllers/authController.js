import mongoose from 'mongoose';
import User from '../models/User.js';
import Chat from '../models/Chat.js';
import { getCache, setCache } from '../config/redis.js';


export const syncUserHandler = async (req, res) => {
    try {
        const { uid, email, name, picture } = req.body;
        const userId = uid || req.headers['x-user-id'];
        const userEmail = email || req.headers['x-user-email'];

        if (!userEmail) {
            return res.status(400).json({
                success: false,
                message: 'Email is required to sync user in MongoDB',
            });
        }

        // 1. Check if user already exists by googleId or email
        const query = [];
        if (userId) query.push({ googleId: userId });
        query.push({ email: userEmail });

        let user = await User.findOne({ $or: query });
        let isNewUser = false;
        let initialSessionId = null;

        if (!user) {
            // 2. Create new user in MongoDB
            user = new User({
                googleId: userId,
                username: name || userEmail.split('@')[0],
                email: userEmail,
                avatar: picture || '',
            });
            await user.save();
            isNewUser = true;

            // 3. Create default chat session for the new user
            const initialSession = new Chat({
                user: user._id,
                sessionName: 'Session 1',
                messages: [],
            });
            await initialSession.save();
            initialSessionId = initialSession._id;

            console.log(`[UserSync] New user created: ${user.email} (MongoDB ID: ${user._id})`);
        } else {
            // Update googleId or avatar if changed
            let modified = false;
            if (userId && !user.googleId) {
                user.googleId = userId;
                modified = true;
            }
            if (picture && user.avatar !== picture) {
                user.avatar = picture;
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
