import express, { Application } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

// Import routes
import playerRoutes from './routes/player.routes';
import teamRoutes from './routes/team.routes';
import matchRoutes from './routes/match.routes';
import foodRoutes from './routes/food.routes';
import committeeRoutes from './routes/committee.routes';
import awardRoutes from './routes/award.routes';
import liveUpdateRoutes from './routes/liveUpdate.routes';
import notificationRoutes from './routes/notification.routes';
import commentaryRoutes from './routes/commentary.routes';
import photoRoutes from './routes/photo.routes';
import pollRoutes from './routes/poll.routes';
import incidentRoutes from './routes/incident.routes';
import analyticsRoutes from './routes/analytics.routes';
import authRoutes from './routes/auth.routes';
import dashboardRoutes from './routes/dashboard.routes';
import budgetRoutes from './routes/budget.routes';
import tournamentRoutes from './routes/tournament.routes';

// Import WebSocket handlers
import { initializeWebSocket } from './websocket/socketHandlers';

// Import utilities
import { logger } from './utils/logger';
import { prisma } from './utils/prisma';
import { errorHandler } from './middleware/errorHandler';

// Load environment variables
dotenv.config();

// Create Express app
const app: Application = express();
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(helmet()); // Security headers
app.use(compression()); // Compress responses
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Rate limiting - increased for development (React Strict Mode double-invokes effects)
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000'), // 1000 requests per minute
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/food', foodRoutes);
app.use('/api/committee', committeeRoutes);
app.use('/api/awards', awardRoutes);
app.use('/api/live-updates', liveUpdateRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/commentary', commentaryRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/budget', budgetRoutes);
app.use('/api/tournaments', tournamentRoutes);

// Error handling
app.use(errorHandler);

// Initialize WebSocket
initializeWebSocket(io);

// Start server
const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  httpServer.close(async () => {
    logger.info('HTTP server closed');
    await prisma.$disconnect();
    process.exit(0);
  });
});

export { io };
