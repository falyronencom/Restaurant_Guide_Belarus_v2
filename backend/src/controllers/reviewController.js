/**
 * Review Controller
 * 
 * This controller handles HTTP requests and responses for the reviews system.
 * It provides a thin layer between HTTP and business logic, extracting data
 * from requests, calling service methods, and formatting responses.
 * 
 * Architecture note: Controllers should be thin orchestration layers. They parse
 * requests, delegate to services, and format responses. Business logic lives in
 * the service layer, not here.
 */

import * as ReviewService from '../services/reviewService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Create a new review
 * 
 * POST /api/v1/reviews
 * 
 * This endpoint allows authenticated users to create reviews for establishments.
 * The user_id comes from the authenticated context (JWT token), not the request body.
 * This prevents users from impersonating other users by specifying different user_ids.
 * 
 * Request body requirements are enforced by validation middleware before this
 * controller executes. By the time we reach this code, we know the data is valid.
 * 
 * The service layer handles all business logic including rate limiting, duplicate
 * detection, establishment verification, and aggregate updates. The controller
 * simply extracts data and formats the response.
 */
export const createReview = asyncHandler(async (req, res) => {
  // Extract review data from request body
  const { establishment_id, rating, content } = req.body;

  // Get authenticated user ID from JWT token (set by authenticate middleware)
  // Never trust user_id from request body - always use authenticated context
  const user_id = req.user.userId;

  // Call service layer to create review with business logic
  const review = await ReviewService.createReview({
    user_id,
    establishment_id,
    rating,
    content,
  });

  // Log successful review creation for monitoring
  logger.info('Review created via API', {
    reviewId: review.id,
    userId: user_id,
    establishmentId: establishment_id,
    endpoint: 'POST /api/v1/reviews',
  });

  // Return 201 Created with the review object
  // The service layer already includes author information, so we can return it directly
  res.status(201).json({
    success: true,
    data: {
      review,
    },
  });
});

/**
 * Get a specific review by ID
 * 
 * GET /api/v1/reviews/:id
 * 
 * This is a public endpoint - no authentication required. Anyone can read reviews.
 * This is intentional because reviews are public information that helps users make
 * dining decisions. Only creation, update, and deletion require authentication.
 */
export const getReview = asyncHandler(async (req, res) => {
  // Extract review ID from URL path parameter
  const { id } = req.params;

  // Call service layer to fetch review
  // Service will throw 404 error if review not found, which asyncHandler catches
  const review = await ReviewService.getReviewById(id);

  // Return 200 OK with the review object
  res.status(200).json({
    success: true,
    data: {
      review,
    },
  });
});

/**
 * Get all reviews for a specific establishment
 * 
 * GET /api/v1/establishments/:id/reviews
 * 
 * This is a public endpoint supporting pagination and sorting. The most common
 * use case is displaying reviews on establishment detail pages.
 * 
 * Query parameters:
 * - page: Page number (default 1)
 * - limit: Results per page (default 10, max 50)
 * - sort: Sort order - 'newest', 'highest', 'lowest' (default 'newest')
 * 
 * The response includes both the reviews array and pagination metadata that clients
 * need to implement pagination UI (page numbers, next/previous buttons, etc).
 */
export const getEstablishmentReviews = asyncHandler(async (req, res) => {
  // Extract establishment ID from URL path parameter
  const { id } = req.params;

  // Extract query parameters with defaults
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Cap at 50
  const sort = req.query.sort || 'newest';

  // Validate page and limit are positive integers
  if (page < 1 || limit < 1) {
    return res.status(400).json({
      success: false,
      message: 'Page and limit must be positive integers',
    });
  }

  // Call service layer to fetch reviews with pagination
  const result = await ReviewService.getEstablishmentReviews(id, {
    page,
    limit,
    sort,
  });

  // Return 200 OK with reviews and pagination metadata
  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * Get all reviews written by a specific user
 * 
 * GET /api/v1/users/:id/reviews
 * 
 * This is a public endpoint that shows a user's review history. This is useful
 * for user profile pages where people can see all reviews someone has written.
 * 
 * Query parameters:
 * - page: Page number (default 1)
 * - limit: Results per page (default 10, max 50)
 * 
 * The response includes establishment information for each review so clients
 * can display restaurant names and locations without additional API calls.
 */
export const getUserReviews = asyncHandler(async (req, res) => {
  // Extract user ID from URL path parameter
  const { id } = req.params;

  // Extract query parameters with defaults
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Cap at 50

  // Validate page and limit are positive integers
  if (page < 1 || limit < 1) {
    return res.status(400).json({
      success: false,
      message: 'Page and limit must be positive integers',
    });
  }

  // Call service layer to fetch user's reviews with pagination
  const result = await ReviewService.getUserReviews(id, {
    page,
    limit,
  });

  // Return 200 OK with reviews and pagination metadata
  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * Update an existing review
 * 
 * PUT /api/v1/reviews/:id
 * 
 * This endpoint allows review authors to modify their reviews. Authentication is
 * required and the service layer enforces that only the author can update their review.
 * 
 * Users can update either rating, content, or both. The validation middleware ensures
 * at least one field is provided. The updated_at timestamp and is_edited flag are
 * automatically updated by the model layer.
 * 
 * If the rating changes, establishment aggregate statistics are recalculated
 * synchronously before returning the response.
 */
export const updateReview = asyncHandler(async (req, res) => {
  // Extract review ID from URL path parameter
  const { id } = req.params;

  // Extract update data from request body
  // Only rating and content can be updated - other fields are system-managed
  const { rating, content } = req.body;

  // Get authenticated user ID from JWT token
  const userId = req.user.userId;

  // Build updates object with only provided fields
  // This allows partial updates - user can update just rating or just content
  const updates = {};
  if (rating !== undefined) updates.rating = rating;
  if (content !== undefined) updates.content = content;

  // Call service layer to update review
  // Service enforces authorization (user must be review author)
  const review = await ReviewService.updateReview(id, userId, updates);

  // Log successful review update for monitoring
  logger.info('Review updated via API', {
    reviewId: id,
    userId,
    updatedFields: Object.keys(updates),
    endpoint: 'PUT /api/v1/reviews/:id',
  });

  // Return 200 OK with updated review object
  res.status(200).json({
    success: true,
    data: {
      review,
    },
  });
});

/**
 * Delete a review (soft deletion)
 * 
 * DELETE /api/v1/reviews/:id
 * 
 * This endpoint allows review authors to delete their reviews. Authentication is
 * required and the service layer enforces that only the author can delete their review.
 * 
 * Deletion is soft - the review is marked as deleted but not actually removed from
 * the database. This preserves data for potential restoration or auditing while
 * hiding the review from all public queries.
 * 
 * Establishment aggregate statistics are recalculated synchronously after deletion
 * to ensure the deleted review no longer counts toward ratings.
 */
export const deleteReview = asyncHandler(async (req, res) => {
  // Extract review ID from URL path parameter
  const { id } = req.params;

  // Get authenticated user ID from JWT token
  const userId = req.user.userId;

  // Call service layer to delete review
  // Service enforces authorization (user must be review author)
  const result = await ReviewService.deleteReview(id, userId);

  // Log successful review deletion for monitoring
  logger.info('Review deleted via API', {
    reviewId: id,
    userId,
    endpoint: 'DELETE /api/v1/reviews/:id',
  });

  // Return 200 OK with success message
  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * Get user's review quota information
 * 
 * GET /api/v1/reviews/quota
 * 
 * This utility endpoint returns how many reviews the authenticated user can still
 * create today. It helps clients provide proactive feedback like "You have 7 reviews
 * remaining today" rather than letting users discover the limit through failed attempts.
 * 
 * The quota resets after 24 hours (sliding window), tracked via Redis rate limiting.
 */
export const getReviewQuota = asyncHandler(async (req, res) => {
  // Get authenticated user ID from JWT token
  const userId = req.user.userId;

  // Call service layer to get quota information
  const quota = await ReviewService.getUserReviewQuota(userId);

  // Return 200 OK with quota information
  res.status(200).json({
    success: true,
    data: {
      quota,
    },
  });
});

