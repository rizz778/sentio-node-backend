import express from "express";
import {
  createSession,
  getSessions,
  getSessionMessages,
  addMessage,
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
router.post("/sessions/:sessionId/messages", addMessage); // Add message to session

// Route error handler
router.use(errorHandler);

export default router;
