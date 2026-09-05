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
import { UPLOADS_ROOT } from './middleware/upload.js';
import * as ocrJobPoller from './services/ocr/ocrJobPoller.js';
import { JOB_DURATION_BOUND_MS as OCR_JOB_DURATION_BOUND_MS } from './services/ocr/ocrService.js';
import { resolveShutdownBudget } from './config/shutdown.js';

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
 * Graceful-shutdown budget — resolved once, from Railway's drain period when
 * it is set (config/shutdown.js). startServer() logs it together with the
 * misalignments it reports; gracefulShutdown() arms its force-exit timer with it.
 */
const shutdownBudget = resolveShutdownBudget(process.env, {
  jobBoundMs: OCR_JOB_DURATION_BOUND_MS,
});

/**
 * Trust exactly ONE reverse-proxy hop (Railway's edge terminates TLS and
 * forwards X-Forwarded-For). Without this, req.ip is the proxy address and
 * every per-IP rate limit collapses into a single shared bucket (OSB-G1).
 *
 * MUST stay the integer 1, never `true`: `true` trusts the entire
 * client-supplied X-Forwarded-For chain, letting an attacker mint unlimited
 * per-IP buckets by spoofing the header. Revisit the hop count only if
 * another trusted proxy layer is ever added in front of the app.
 */
app.set('trust proxy', 1);

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
  origin (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }
    // Always allow localhost (Flutter Web dev server uses random ports)
    if (origin.match(/^https?:\/\/localhost(:\d+)?$/)) {
      return callback(null, true);
    }
    // Check additional allowed origins from env var
    if (process.env.CORS_ORIGIN) {
      const allowed = process.env.CORS_ORIGIN.split(',').map(s => s.trim());
      if (allowed.includes(origin)) {
        return callback(null, true);
      }
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
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
 * Serve uploaded files (avatars, images) as static assets.
 */
app.use('/uploads', express.static(UPLOADS_ROOT));

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
 *
 * Order (Coordinator decision 2026-09-05, option «б» — align the windows):
 *   1. Arm the force-exit timer with the budget from config/shutdown.js. On
 *      Railway that is the drain period minus a margin, so the timer fires
 *      before the platform's SIGKILL, never after it.
 *   2. Stop the OCR poller at once, in parallel with server.close(): the
 *      poller does not need the HTTP server, and stop() waits for the job in
 *      flight (up to ocrService.JOB_DURATION_BOUND_MS) — it must not queue
 *      behind a slow request that is still draining.
 *   3. Once the HTTP connections are gone and the poller has stopped, close
 *      the pool and Redis, then exit.
 * A job that outlives the budget dies with the process as a 'processing'
 * row; ocrJobPoller's stale sweep settles it about an hour later.
 */
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received, starting graceful shutdown`, {
    budgetMs: shutdownBudget.timeoutMs,
  });

  // Force exit if graceful shutdown outlives the budget
  setTimeout(() => {
    logger.error('Graceful shutdown timeout, forcing exit', {
      budgetMs: shutdownBudget.timeoutMs,
    });
    process.exit(1);
  }, shutdownBudget.timeoutMs);

  // Stop OCR poller now — waits for the in-flight job and stale sweep. Errors
  // are logged inside stop(); this catch only keeps the await below safe.
  const pollerStopped = ocrJobPoller.stop().catch((error) => {
    logger.error('OCR poller stop failed during shutdown', { error: error.message });
  });

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed, closing external connections');

    try {
      // The poller must be idle before the pool goes away
      await pollerStopped;

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

    // Shutdown budget vs. the platform drain and the OCR job bound — the only
    // place the misalignment surfaces without telemetry (config/shutdown.js)
    logger.info('Graceful shutdown budget resolved', {
      timeoutMs: shutdownBudget.timeoutMs,
      source: shutdownBudget.source,
      drainingMs: shutdownBudget.drainingMs,
      onRailway: shutdownBudget.onRailway,
      ocrJobBoundMs: OCR_JOB_DURATION_BOUND_MS,
    });
    for (const warning of shutdownBudget.warnings) {
      logger.warn(`Graceful shutdown budget: ${warning}`);
    }

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

    // Start OCR background poller (processes pending menu OCR jobs)
    ocrJobPoller.start();

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
