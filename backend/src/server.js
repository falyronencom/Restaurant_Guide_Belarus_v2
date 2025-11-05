import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import logger from './utils/logger.js';
import { testConnection, closePool } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import routes from './routes/index.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// Load environment variables from .env file
dotenv.config();

/**
 * Initialize Express application with production-ready configuration.
 * ...existing code...
 */
const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Security middleware (helmet) - MUST be first.
 * ...existing code...
 */
app.use(helmet());

/**
 * CORS (Cross-Origin Resource Sharing) middleware.
 * ...existing code...
 */
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: process.env.CORS_CREDENTIALS === 'true',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
};
app.use(cors(corsOptions));

/**
 * HTTP request logging middleware.
 * ...existing code...
 */
const morganFormat = NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(
  morgan(morganFormat, {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  }),
);

/**
 * Request parsing middleware.
 * ...existing code...
 */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * Request correlation ID middleware.
 * ...existing code...
 */
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
});

/**
 * Global rate limiting middleware.
 * ...existing code...
 */
app.use(rateLimiter);

/**
 * Mount API routes under /api prefix.
 * ...existing code...
 */
app.use('/api', routes);

/**
 * 404 Not Found handler for undefined routes.
 * ...existing code...
 */
app.use(notFoundHandler);

/**
 * Centralized error handling middleware.
 * ...existing code...
 */
app.use(errorHandler);

/**
 * Graceful shutdown handler.
 * ...existing code...
 */
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received, starting graceful shutdown`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed, closing external connections');

    try {
      // Close database connection pool
      await closePool();

      // Disconnect from Redis
      await disconnectRedis();

      logger.info('Graceful shutdown completed successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown', {
        error: error.message,
        stack: error.stack,
      });
      process.exit(1);
    }
  });

  // Force exit if graceful shutdown takes too long (30 seconds)
  setTimeout(() => {
    logger.error('Graceful shutdown timeout, forcing exit');
    process.exit(1);
  }, 30000);
};

/**
 * Application startup sequence.
 * ...existing code...
 */
const startServer = async () => {
  try {
    logger.info('Starting Restaurant Guide Belarus Backend API', {
      nodeEnv: NODE_ENV,
      port: PORT,
      nodeVersion: process.version,
    });

    // Test database connection
    logger.info('Testing database connection...');
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database. Exiting.');
      process.exit(1);
    }

    // Connect to Redis
    logger.info('Connecting to Redis...');
    const redisConnected = await connectRedis();
    if (!redisConnected) {
      logger.error('Failed to connect to Redis. Exiting.');
      process.exit(1);
    }

    // Start HTTP server
    server.listen(PORT, () => {
      logger.info(`Server listening on port ${PORT}`, {
        environment: NODE_ENV,
        apiEndpoint: `http://localhost:${PORT}/api`,
        healthCheck: `http://localhost:${PORT}/api/v1/health`,
      });
    });

    // Register graceful shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', {
        error: error.message,
        stack: error.stack,
      });
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection', {
        reason,
        promise,
      });
      gracefulShutdown('UNHANDLED_REJECTION');
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
};

// Create HTTP server instance (needed for graceful shutdown)
let server;

// Only start server if not in test environment
// In tests, app is imported without starting the server
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(0); // Listen on port 0 temporarily
  server.close(); // Close it immediately

  // Start the application
  startServer();
} else {
  // In test environment, create a mock server reference
  server = { close: () => {}, listen: () => {} };
}

export default app;
