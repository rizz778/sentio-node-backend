import express from "express";
import {
  createEpisode,
  getUserEpisodes,
  searchEpisodes,
  updateEpisode,
} from "../controllers/episodeController.js";
import downstreamAuth from "../middlewares/authMiddleware.js";
import errorHandler from "../middlewares/errorHandler.js";

const router = express.Router();

// Extract trusted identity from headers
router.use(downstreamAuth);

// Episodic memory endpoints
router.post("/", createEpisode);           // Store new structured episode
router.get("/", getUserEpisodes);          // Query episodes (supports ?status=unresolved&limit=5)
router.post("/search", searchEpisodes);    // Hybrid vector similarity search ($vectorSearch with cosine fallback)
router.patch("/:episodeId", updateEpisode);// Update resolution status and coping strategy

// Route error handler
router.use(errorHandler);

export default router;
