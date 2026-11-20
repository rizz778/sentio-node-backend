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

// Profile routes (support both / and /:userId)
router.get('/', getUserProfile);
router.get('/:userId', getUserProfile);
router.post('/', saveUserProfile);
router.post('/:userId', saveUserProfile);
router.post('/upload-picture', upload.single('profilePicture'), uploadProfilePicture);
router.delete('/delete-picture', deleteProfilePicture);
router.get('/user/analytics', getUserEmotionAnalytics);

export default router;
