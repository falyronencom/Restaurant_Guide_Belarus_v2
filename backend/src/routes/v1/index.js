/**
 * API Version 1 Router
 * 
 * This file serves as the central routing hub for all v1 API endpoints.
 * It imports and mounts specialized route modules, creating a clean
 * namespace organization for the API.
 * 
 * Architecture note: This pattern keeps server.js clean and delegates
 * route organization to version-specific files. As business logic endpoints
 * are implemented in specialized Leaf sessions, they are imported and
 * mounted here. This provides clear API structure and makes it easy to
 * understand all available endpoints at a glance.
 * 
 * Version 1 API includes:
 * - Health checks for monitoring and debugging
 * - Authentication (register, login, refresh, logout)
 * - Search and discovery (geospatial queries, filtering)
 * - Reviews (create, read, update, delete reviews)
 * - Favorites (bookmark establishments for later viewing)
 * 
 * Future route modules will be added here as features are implemented:
 * - Establishments (search, details, management)
 * - Users (profile, settings)
 * - Admin (moderation, analytics)
 */

import express from 'express';
import { healthCheck } from '../../controllers/healthController.js';
import authRoutes from './authRoutes.js';
import searchRoutes from './searchRoutes.js';
import reviewRoutes from './reviewRoutes.js';
import favoriteRoutes from './favoriteRoutes.js';

const router = express.Router();

/**
 * GET /api/v1/health
 * 
 * Health check endpoint for monitoring system status.
 * 
 * This endpoint verifies that:
 * - The application server is running
 * - Database connection is healthy
 * - Redis connection is healthy
 * - System memory is within acceptable limits
 * 
 * Load balancers and monitoring systems use this endpoint to determine
 * if the service instance should receive traffic. A 200 status means the
 * instance is healthy and can handle requests. A 503 status means there's
 * a problem and traffic should be routed elsewhere.
 * 
 * No authentication required - this needs to work even when the system
 * is having authentication issues so operators can diagnose problems.
 */
router.get('/health', healthCheck);

/**
 * /api/v1/auth/*
 * 
 * Authentication and user management endpoints.
 * 
 * Provides complete authentication functionality:
 * - POST /auth/register - Create new user account
 * - POST /auth/login - Authenticate with credentials
 * - POST /auth/refresh - Get new token pair with refresh token
 * - POST /auth/logout - Invalidate refresh token
 * - GET /auth/me - Get current authenticated user info
 * 
 * All auth endpoints except /me are public (no authentication required).
 * This is necessary because users need to authenticate before they can
 * access protected endpoints. The /me endpoint requires authentication
 * to return user profile information.
 * 
 * Implementation note: Authentication was implemented by a specialized Leaf
 * session focused on security and user management. The implementation includes
 * JWT tokens with strict refresh token rotation, Belarus-specific phone number
 * validation, and comprehensive rate limiting to prevent brute force attacks.
 */
router.use('/auth', authRoutes);

/**
 * /api/v1/search/*
 * 
 * Search and Discovery endpoints.
 * 
 * Provides establishment search functionality:
 * - GET /search/health - Search system health check
 * - GET /search/establishments - List view search (radius-based)
 * - GET /search/map - Map view search (bounds-based)
 * 
 * Search endpoints support geospatial queries using PostGIS, enabling
 * location-based discovery with filtering by categories, cuisines, price
 * range, and ratings. The system uses intelligent ranking that combines
 * distance, rating, and review count for optimal results.
 * 
 * Implementation note: Search was implemented by a specialized Leaf session
 * focused on geospatial queries and performance optimization. The implementation
 * leverages PostGIS for efficient geographic queries and includes proper indexing
 * for fast results even with large establishment datasets.
 */
router.use('/search', searchRoutes);

/**
 * /api/v1/reviews/*
 * 
 * Review management endpoints.
 * 
 * Provides complete review functionality:
 * - POST /reviews - Create new review (authenticated)
 * - GET /reviews/quota - Check daily review quota (authenticated)
 * - GET /reviews/:id - Get specific review (public)
 * - PUT /reviews/:id - Update review (authenticated, author only)
 * - DELETE /reviews/:id - Delete review (authenticated, author only)
 * 
 * Reviews are public information that help users make dining decisions.
 * Anyone can read reviews, but only authenticated users can create them,
 * and users can only modify or delete their own reviews.
 * 
 * Implementation note: Reviews were implemented by a specialized Leaf session
 * focused on user-generated content. The implementation includes rate limiting
 * (10 reviews per day per user), duplicate prevention (one review per user per
 * establishment), aggregate statistics caching, and comprehensive validation.
 */
router.use('/reviews', reviewRoutes);

/**
 * /api/v1/favorites/*
 * 
 * Favorites bookmarking endpoints.
 * 
 * Provides complete favorites functionality:
 * - POST /favorites - Add establishment to favorites (authenticated)
 * - DELETE /favorites/:establishmentId - Remove from favorites (authenticated)
 * - GET /favorites - Get all user favorites with pagination (authenticated)
 * - GET /favorites/check/:establishmentId - Check if establishment is favorited (authenticated)
 * - POST /favorites/check-batch - Batch check favorite status (authenticated)
 * - GET /favorites/stats - Get favorites statistics (authenticated)
 * 
 * All favorites endpoints require authentication because favorites are user-specific
 * personal data. Each user maintains their own independent favorites collection.
 * 
 * The favorites system implements idempotent operations - adding an already-favorited
 * establishment or removing a non-existent favorite succeeds without error. This
 * provides better UX for scenarios like double-clicks or network retries.
 * 
 * Implementation note: Favorites were implemented by a specialized Leaf session
 * following the architectural patterns established by Authentication and Reviews.
 * The implementation leverages the existing favorites table in the database schema,
 * includes rich establishment details in responses to minimize additional API calls,
 * and follows the same pagination pattern as Reviews for consistency.
 */
router.use('/favorites', favoriteRoutes);

/**
 * Placeholder for future route modules
 * 
 * As additional features are implemented in specialized Leaf sessions,
 * they will be imported and mounted here. Planned future modules include:
 * 
 * import establishmentRoutes from './establishmentRoutes.js';
 * router.use('/establishments', establishmentRoutes);
 * - Search establishments with filters and geolocation
 * - Get establishment details with reviews and media
 * - Manage establishments (partners only)
 * 
 * import userRoutes from './userRoutes.js';
 * router.use('/users', userRoutes);
 * - Get user profiles and review history
 * - Update user settings and preferences
 * - Upload profile photos
 * 
 * import adminRoutes from './adminRoutes.js';
 * router.use('/admin', adminRoutes);
 * - Content moderation dashboard
 * - User management and suspension
 * - Analytics and reporting
 * 
 * This modular approach keeps the codebase organized as it grows. Each feature
 * domain has its own route module, making it easy to understand what endpoints
 * are available and where to find their implementations.
 */

/**
 * API versioning strategy
 * 
 * Version 1 endpoints are mounted at /api/v1. When breaking changes are needed
 * in the future, we can create a v2 router with updated implementations while
 * keeping v1 endpoints operational for existing clients.
 * 
 * This gradual migration approach prevents "flag day" upgrades where all clients
 * must update simultaneously. Old mobile app versions can continue using v1 while
 * new versions adopt v2, allowing a smooth transition period.
 * 
 * Version bumps should be rare because they fragment the API surface. Most changes
 * can be handled through:
 * - Adding new optional fields to existing endpoints (backward compatible)
 * - Creating new endpoints alongside existing ones (parallel evolution)
 * - Deprecation periods with warnings before removing functionality
 * 
 * Only true breaking changes (changing required field names, removing endpoints,
 * changing response structures) warrant a new API version.
 */

export default router;
