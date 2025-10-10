import express from 'express';
import { healthCheck } from '../../controllers/healthController.js';
import authRoutes from './authRoutes.js';

const router = express.Router();

/**
 * API Version 1 Routes
 * 
 * This file serves as the central hub for all v1 API endpoints. As the application
 * grows, additional route modules will be imported and mounted here.
 * 
 * Route organization pattern:
 * /api/v1/health       - Health check (no authentication required)
 * /api/v1/auth         - Authentication endpoints (registration, login, refresh)
 * /api/v1/users        - User management endpoints
 * /api/v1/establishments - Restaurant/establishment endpoints
 * /api/v1/reviews      - Review management endpoints
 * /api/v1/favorites    - User favorites endpoints
 * 
 * Each route module will be created in separate files and imported here as they
 * are implemented in future Leaf sessions. This structure keeps the codebase
 * organized and maintainable as it scales.
 */

/**
 * Health check endpoint - GET /api/v1/health
 * 
 * This is a public endpoint that requires no authentication. It's used by:
 * - Load balancers to verify the server is responding
 * - Monitoring tools to track uptime and dependency health
 * - DevOps teams for troubleshooting production issues
 * 
 * Response always includes database and Redis health status plus system metrics.
 */
router.get('/health', healthCheck);

/**
 * Authentication routes - /api/v1/auth/*
 * 
 * Handles user authentication, registration, login, token refresh, and logout.
 * Implemented in authRoutes.js with comprehensive security measures.
 */
router.use('/auth', authRoutes);

/**
 * Placeholder for future route modules.
 * 
 * As business logic endpoints are implemented in specialized Leaf sessions,
 * they will be imported and mounted here. For example:
 * 
 * import authRoutes from './auth.js';
 * import establishmentRoutes from './establishments.js';
 * import reviewRoutes from './reviews.js';
 * 
 * router.use('/auth', authRoutes);
 * router.use('/establishments', establishmentRoutes);
 * router.use('/reviews', reviewRoutes);
 * 
 * This keeps server.js clean and delegates route organization to this file.
 */

export default router;
