import express from "express";
import { upload } from '../config/cloudinary.js';
import {
  saveUserProfile,
  getUserProfile,
  uploadProfilePicture,
  deleteProfilePicture,
  getUserEmotionAnalytics,
} from "../controllers/userController.js";
import downstreamAuth from "../middlewares/authMiddleware.js";

const router = express.Router();

// Extract trusted identity from headers
router.use(downstreamAuth);

// ── Specific routes MUST come before parameterized /:userId ─────────────────
router.get('/emotion/user', getUserEmotionAnalytics);
router.get('/user/analytics', getUserEmotionAnalytics);
router.get('/analytics', getUserEmotionAnalytics);

router.post('/upload-picture', upload.single('profilePicture'), uploadProfilePicture);
router.delete('/delete-picture', deleteProfilePicture);

// ── Profile routes (support both / and /:userId) ─────────────────────────────
router.get('/', getUserProfile);
router.get('/:userId', getUserProfile);
router.post('/', saveUserProfile);
router.post('/:userId', saveUserProfile);

export default router;
