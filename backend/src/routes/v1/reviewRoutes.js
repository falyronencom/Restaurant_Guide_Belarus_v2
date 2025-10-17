/**
 * Review Routes
 * 
 * This module defines all review-related API endpoints, composing controllers,
 * validation middleware, and authentication middleware into complete request
 * handling pipelines.
 * 
 * Architecture note: Routes are declarative specifications of how requests flow
 * through middleware chains. They should be readable as documentation of the API
 * surface without containing any logic themselves.
 */

import express from 'express';
import * as ReviewController from '../../controllers/reviewController.js';
import * as ReviewValidation from '../../validators/reviewValidation.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/errorHandler.js';

const router = express.Router();

/**
 * Get user's review quota
 * 
 * GET /api/v1/reviews/quota
 * 
 * IMPORTANT: This route must be defined BEFORE the '/:id' route to prevent
 * 'quota' from being interpreted as a review ID. Route order matters in Express.
 * Routes are matched top-to-bottom, and the first match wins.
 * 
 * This utility endpoint returns how many reviews the user can still create today.
 * 
 * Protected: Yes (requires authentication to identify user)
 */
router.get(
  '/quota',
  authenticate,
  ReviewController.getReviewQuota
);

/**
 * Create a new review
 * 
 * POST /api/v1/reviews
 * 
 * Flow: Authentication → Validation → Controller → Service → Model → Database
 * 
 * The authenticate middleware verifies JWT token and attaches user data to req.user.
 * The validation middleware checks request body format and constraints.
 * The validate middleware converts validation errors to formatted responses.
 * The controller extracts data and calls service layer.
 * The service layer enforces business rules and coordinates operations.
 * 
 * Protected: Yes (requires authentication)
 * Rate Limited: Yes (10 reviews per day enforced in service layer)
 */
router.post(
  '/',
  authenticate,
  ReviewValidation.validateCreateReview,
  validate,
  ReviewController.createReview
);

/**
 * Get a specific review by ID
 * 
 * GET /api/v1/reviews/:id
 * 
 * Public endpoint - no authentication required. Reviews are public information
 * that help users make dining decisions.
 * 
 * Protected: No (public read access)
 */
router.get(
  '/:id',
  ReviewValidation.validateGetReview,
  validate,
  ReviewController.getReview
);

/**
 * Update an existing review
 * 
 * PUT /api/v1/reviews/:id
 * 
 * Flow: Authentication → Validation → Controller → Service → Authorization Check → Update
 * 
 * The service layer verifies the authenticated user is the review author before
 * allowing updates. This prevents users from modifying others' reviews.
 * 
 * Protected: Yes (requires authentication + author verification)
 */
router.put(
  '/:id',
  authenticate,
  ReviewValidation.validateUpdateReview,
  validate,
  ReviewController.updateReview
);

/**
 * Delete a review (soft deletion)
 * 
 * DELETE /api/v1/reviews/:id
 * 
 * Flow: Authentication → Validation → Controller → Service → Authorization Check → Delete
 * 
 * The service layer verifies the authenticated user is the review author before
 * allowing deletion. Deletion is soft - review is marked deleted but not removed.
 * 
 * Protected: Yes (requires authentication + author verification)
 */
router.delete(
  '/:id',
  authenticate,
  ReviewValidation.validateDeleteReview,
  validate,
  ReviewController.deleteReview
);

export default router;

/**
 * Additional routes that need to be mounted elsewhere
 * 
 * These routes are exported separately because they belong under different
 * base paths in the API structure:
 * 
 * - GET /api/v1/establishments/:id/reviews - mounted in establishments routes
 * - GET /api/v1/users/:id/reviews - mounted in users routes
 * 
 * We export the middleware chains so they can be registered in the appropriate routers.
 */

export const getEstablishmentReviews = [
  ReviewValidation.validateGetEstablishmentReviews,
  validate,
  ReviewController.getEstablishmentReviews,
];

export const getUserReviews = [
  ReviewValidation.validateGetUserReviews,
  validate,
  ReviewController.getUserReviews,
];

