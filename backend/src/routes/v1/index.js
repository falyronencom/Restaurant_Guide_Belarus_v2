import express from 'express';
import { healthCheck } from '../../controllers/healthController.js';
import authRoutes from './authRoutes.js';
import searchRoutes from './searchRoutes.js';
import reviewRoutes from './reviewRoutes.js';

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
 * Search and Discovery routes - /api/v1/search/*
 * 
 * Handles establishment search with geospatial queries and intelligent ranking.
 * Implemented in searchRoutes.js with PostGIS integration.
 * 
 * Endpoints:
 * - GET /api/v1/search/health - Search system health check
 * - GET /api/v1/search/establishments - List view search (radius-based)
 * - GET /api/v1/search/map - Map view search (bounds-based)
 */
router.use('/search', searchRoutes);

/**
 * Review Management routes - /api/v1/reviews/*
 * 
 * Handles user-generated reviews with CRUD operations, rate limiting, and aggregation.
 * Implemented in reviewRoutes.js with soft deletion and author verification.
 * 
 * Endpoints:
 * - POST /api/v1/reviews - Create a review (authenticated)
 * - GET /api/v1/reviews/quota - Check review quota (authenticated)
 * - GET /api/v1/reviews/:id - Get specific review (public)
 * - PUT /api/v1/reviews/:id - Update review (authenticated, author only)
 * - DELETE /api/v1/reviews/:id - Delete review (authenticated, author only)
 */
router.use('/reviews', reviewRoutes);

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
