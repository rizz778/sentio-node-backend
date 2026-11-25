import express from "express";
import {
  createSession,
  getSessions,
  getSessionMessages,
  addMessage,
  deleteSession,
  updateSessionSummary,
} from "../controllers/chatController.js";
import downstreamAuth from "../middlewares/authMiddleware.js";
import errorHandler from "../middlewares/errorHandler.js";

const router = express.Router();

// Extract trusted identity from headers
router.use(downstreamAuth);

// Routes
router.post("/sessions", createSession); // Create a new session
router.get("/sessions", getSessions); // Get all sessions for user
router.get("/sessions/:sessionId", getSessionMessages); // Get messages for a session
router.patch("/sessions/:sessionId/summary", updateSessionSummary); // Update rolling conversation summary
router.post("/sessions/:sessionId/messages", addMessage); // Add message to session
router.delete("/sessions/:sessionId", deleteSession); // Delete a session

// Route error handler
router.use(errorHandler);

export default router;
