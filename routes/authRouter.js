import express from 'express';
import { syncUserHandler } from '../controllers/authController.js';

const router = express.Router();

/**
 * POST /sync (or /internal/users/sync)
 * Syncs user upon Gateway authentication:
 * - Creates user in MongoDB if not already present
 * - Creates an initial Chat session for new users
 * - Caches the googleId -> mongoId mapping in Redis
 */

// Routes
router.post('/sync', syncUserHandler);

export default router;
