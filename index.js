import express from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cors from 'cors';
import connectDB from './config/db.js';
import './config/redis.js';
import errorHandler from './middlewares/errorHandler.js';
import requestLogger from './middlewares/logger.js';
import authRouter from './routes/authRouter.js';
import chatRouter from './routes/chatRouter.js';
import profileRouter from './routes/profileRouter.js';
import episodeRouter from './routes/episodeRouter.js';

// Load environment variables
dotenv.config();

// Initialize server
const app = express();

// Connect MongoDB
connectDB();

// Enable CORS
app.use(cors());

// Global structured HTTP request logger
app.use(requestLogger);

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'sentio-node-backend',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Sentio Node.js Backend (Downstream Storage Engine) is active',
  });
});

// Downstream Business Routes
app.use('/internal/users', authRouter); // For Gateway internal user creation/sync
app.use('/api/auth', authRouter);       // For proxied auth sync requests
app.use('/api/chat', chatRouter);
app.use('/api/profile', profileRouter);
app.use('/api/episodes', episodeRouter);

// Global Error Handler
app.use(errorHandler);

// Start Server (Port 5000 for Node backend; Gateway runs on 4000, FastAPI on 8000)
const PORT = process.env.PORT || 5000;

mongoose.connection.once('open', () => {
  console.log('[MongoDB] Connected successfully');
  app.listen(PORT, () => {
    console.log(`🚀 Node Backend running on PORT ${PORT}`);
  });
});

export default app;
