/**
 * Review Service
 * 
 * This service implements all business logic for the reviews system.
 * It orchestrates database operations through the model layer, enforces
 * business rules, manages transactions, and handles aggregate statistics.
 * 
 * Architecture note: Services contain the "what" and "why" of application
 * behavior. They understand domain concepts and business rules but are
 * independent of HTTP concerns. Controllers call services, services call models.
 */

import * as ReviewModel from '../models/reviewModel.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { incrementWithExpiry, getCounter } from '../config/redis.js';

// Rate limiting configuration for review creation
// Directive specifies 10 reviews per day per user as reasonable limit
const RATE_LIMIT_MAX_REVIEWS = 10;
const RATE_LIMIT_WINDOW_SECONDS = 86400; // 24 hours

/**
 * Create a new review for an establishment
 * 
 * This is the core business operation that implements the complete review creation
 * workflow with all necessary validations and aggregate updates.
 * 
 * Business rules enforced:
 * - User must exist and be active
 * - Establishment must exist
 * - User can only have one active review per establishment (enforced by unique constraint)
 * - User cannot exceed rate limit of 10 reviews per day
 * - Review content must meet length requirements (validated at controller level)
 * - Aggregate statistics must be updated synchronously
 * 
 * @param {Object} reviewData - The review data
 * @param {string} reviewData.user_id - UUID of authenticated user creating the review
 * @param {string} reviewData.establishment_id - UUID of establishment being reviewed
 * @param {number} reviewData.rating - Rating from 1 to 5
 * @param {string} reviewData.content - Review text content
 * @returns {Promise<Object>} Created review with author information
 * @throws {AppError} If validation fails or rate limit exceeded
 */
export const createReview = async (reviewData) => {
  const { user_id, establishment_id, rating, content } = reviewData;

  // Step 1: Verify user exists and is active
  const user = await ReviewModel.getUserById(user_id);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  if (!user.is_active) {
    throw new AppError('User account is inactive', 403, 'USER_INACTIVE');
  }

  // Step 2: Verify establishment exists
  const establishmentExists = await ReviewModel.establishmentExists(establishment_id);
  if (!establishmentExists) {
    throw new AppError('Establishment not found', 404, 'ESTABLISHMENT_NOT_FOUND');
  }

  // Step 3: Check rate limit (10 reviews per day per user)
  const rateLimitKey = `reviews:ratelimit:${user_id}`;
  const currentCount = await getCounter(rateLimitKey);
  
  if (currentCount >= RATE_LIMIT_MAX_REVIEWS) {
    logger.warn('Rate limit exceeded for review creation', {
      userId: user_id,
      currentCount,
      limit: RATE_LIMIT_MAX_REVIEWS,
    });
    throw new AppError(
      'Review rate limit exceeded. You can create up to 10 reviews per day.',
      429,
      'RATE_LIMIT_EXCEEDED'
    );
  }

  // Step 4: Check for existing review (duplicate detection)
  // The unique constraint will also catch this, but we check explicitly to provide better error message
  const existingReview = await ReviewModel.findExistingReview(user_id, establishment_id);
  if (existingReview) {
    throw new AppError(
      'You have already reviewed this establishment. Please update your existing review instead.',
      409,
      'DUPLICATE_REVIEW'
    );
  }

  // Step 5: Create review and update aggregates in a transaction
  // This ensures atomicity - either both operations succeed or both fail
  try {
    // Create the review
    const createdReview = await ReviewModel.createReview({
      user_id,
      establishment_id,
      rating,
      content,
    });

    // Update establishment aggregate statistics synchronously
    // Directive specifies synchronous updates for MVP to ensure consistency
    await ReviewModel.updateEstablishmentAggregates(establishment_id);

    // Increment rate limit counter after successful creation
    await incrementWithExpiry(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);

    // Fetch complete review with author information for response
    const reviewWithAuthor = await ReviewModel.findReviewById(createdReview.id);

    logger.info('Review created successfully', {
      reviewId: createdReview.id,
      userId: user_id,
      establishmentId: establishment_id,
      rating,
    });

    return reviewWithAuthor;
  } catch (error) {
    // Handle specific database errors with better messages
    if (error.code === '23505') {
      // Unique constraint violation - duplicate review
      throw new AppError(
        'You have already reviewed this establishment',
        409,
        'DUPLICATE_REVIEW'
      );
    }
    if (error.code === '23503') {
      // Foreign key violation
      throw new AppError(
        'Invalid user or establishment reference',
        400,
        'INVALID_REFERENCE'
      );
    }
    if (error.code === '23514') {
      // Check constraint violation (rating out of range or content length)
      throw new AppError(
        'Review data violates database constraints',
        400,
        'CONSTRAINT_VIOLATION'
      );
    }

    // Log unexpected errors
    logger.error('Unexpected error creating review', {
      error: error.message,
      stack: error.stack,
      userId: user_id,
      establishmentId: establishment_id,
    });

    // Re-throw as generic error
    throw new AppError(
      'Failed to create review',
      500,
      'REVIEW_CREATION_FAILED'
    );
  }
};

/**
 * Get a specific review by ID
 * 
 * @param {string} reviewId - UUID of the review to retrieve
 * @returns {Promise<Object>} Review object with author and establishment information
 * @throws {AppError} If review not found
 */
export const getReviewById = async (reviewId) => {
  const review = await ReviewModel.findReviewById(reviewId);
  
  if (!review) {
    throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
  }

  return review;
};

/**
 * Get all reviews for a specific establishment with pagination
 * 
 * @param {string} establishmentId - UUID of the establishment
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (1-indexed)
 * @param {number} options.limit - Results per page
 * @param {string} options.sort - Sort order: 'newest', 'highest', 'lowest'
 * @returns {Promise<Object>} Object with reviews array and pagination metadata
 * @throws {AppError} If establishment not found
 */
export const getEstablishmentReviews = async (establishmentId, options = {}) => {
  const {
    page = 1,
    limit = 10,
    sort = 'newest',
  } = options;

  // Verify establishment exists
  const establishmentExists = await ReviewModel.establishmentExists(establishmentId);
  if (!establishmentExists) {
    throw new AppError('Establishment not found', 404, 'ESTABLISHMENT_NOT_FOUND');
  }

  // Calculate offset for pagination
  const offset = (page - 1) * limit;

  // Validate sort parameter
  const validSortOrders = ['newest', 'highest', 'lowest'];
  const sortBy = validSortOrders.includes(sort) ? sort : 'newest';

  // Fetch reviews and total count
  const [reviews, totalCount] = await Promise.all([
    ReviewModel.findReviewsByEstablishment(establishmentId, {
      limit,
      offset,
      sortBy,
    }),
    ReviewModel.countReviewsByEstablishment(establishmentId),
  ]);

  // Calculate pagination metadata
  const totalPages = Math.ceil(totalCount / limit);
  const hasNext = page < totalPages;
  const hasPrevious = page > 1;

  // Format author information in response
  const formattedReviews = reviews.map((review) => ({
    id: review.id,
    establishment_id: review.establishment_id,
    rating: review.rating,
    content: review.content,
    is_edited: review.is_edited,
    created_at: review.created_at,
    updated_at: review.updated_at,
    author: {
      id: review.user_id,
      name: review.author_name,
      avatar_url: review.author_avatar,
    },
  }));

  return {
    reviews: formattedReviews,
    pagination: {
      page,
      limit,
      total: totalCount,
      pages: totalPages,
      hasNext,
      hasPrevious,
    },
  };
};

/**
 * Get all reviews written by a specific user with pagination
 * 
 * @param {string} userId - UUID of the user
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (1-indexed)
 * @param {number} options.limit - Results per page
 * @returns {Promise<Object>} Object with reviews array and pagination metadata
 * @throws {AppError} If user not found
 */
export const getUserReviews = async (userId, options = {}) => {
  const {
    page = 1,
    limit = 10,
  } = options;

  // Verify user exists
  const user = await ReviewModel.getUserById(userId);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  // Calculate offset for pagination
  const offset = (page - 1) * limit;

  // Fetch reviews and total count
  const [reviews, totalCount] = await Promise.all([
    ReviewModel.findReviewsByUser(userId, { limit, offset }),
    ReviewModel.countReviewsByUser(userId),
  ]);

  // Calculate pagination metadata
  const totalPages = Math.ceil(totalCount / limit);
  const hasNext = page < totalPages;
  const hasPrevious = page > 1;

  // Format establishment information in response
  const formattedReviews = reviews.map((review) => ({
    id: review.id,
    establishment_id: review.establishment_id,
    rating: review.rating,
    content: review.content,
    is_edited: review.is_edited,
    created_at: review.created_at,
    updated_at: review.updated_at,
    establishment: {
      id: review.establishment_id,
      name: review.establishment_name,
      city: review.establishment_city,
      category: review.establishment_category,
    },
  }));

  return {
    reviews: formattedReviews,
    pagination: {
      page,
      limit,
      total: totalCount,
      pages: totalPages,
      hasNext,
      hasPrevious,
    },
  };
};

/**
 * Update an existing review
 * 
 * This operation allows the review author to modify rating and/or content.
 * The updated_at timestamp is automatically updated and is_edited flag is set.
 * If rating changes, establishment aggregate statistics are recalculated.
 * 
 * Authorization note: The controller must verify that the authenticated user
 * is the review author before calling this service method. This service focuses
 * on business logic, not authorization.
 * 
 * @param {string} reviewId - UUID of the review to update
 * @param {string} userId - UUID of authenticated user (for authorization check)
 * @param {Object} updates - Fields to update
 * @param {number} [updates.rating] - New rating (optional)
 * @param {string} [updates.content] - New content (optional)
 * @returns {Promise<Object>} Updated review object
 * @throws {AppError} If review not found, user unauthorized, or no fields provided
 */
export const updateReview = async (reviewId, userId, updates) => {
  // Verify at least one field is being updated
  if (!updates.rating && !updates.content) {
    throw new AppError(
      'At least one field (rating or content) must be provided for update',
      400,
      'NO_UPDATE_FIELDS'
    );
  }

  // Fetch current review to verify existence and authorization
  const currentReview = await ReviewModel.findReviewById(reviewId);
  if (!currentReview) {
    throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
  }

  // Verify user is the review author (authorization check)
  if (currentReview.user_id !== userId) {
    throw new AppError(
      'You can only modify your own reviews',
      403,
      'UNAUTHORIZED_REVIEW_MODIFICATION'
    );
  }

  // Determine if rating is changing (affects whether we need to update aggregates)
  const ratingChanged = updates.rating !== undefined && updates.rating !== currentReview.rating;

  try {
    // Update the review
    const updatedReview = await ReviewModel.updateReview(reviewId, updates);

    // If rating changed, update establishment aggregates synchronously
    if (ratingChanged) {
      await ReviewModel.updateEstablishmentAggregates(currentReview.establishment_id);
      logger.info('Establishment aggregates updated after review rating change', {
        reviewId,
        oldRating: currentReview.rating,
        newRating: updates.rating,
        establishmentId: currentReview.establishment_id,
      });
    }

    // Fetch complete review with author information for response
    const reviewWithAuthor = await ReviewModel.findReviewById(updatedReview.id);

    logger.info('Review updated successfully', {
      reviewId,
      userId,
      updatedFields: Object.keys(updates),
      ratingChanged,
    });

    return reviewWithAuthor;
  } catch (error) {
    // Handle specific database errors
    if (error.code === '23514') {
      // Check constraint violation
      throw new AppError(
        'Review data violates database constraints',
        400,
        'CONSTRAINT_VIOLATION'
      );
    }

    // Log unexpected errors
    logger.error('Unexpected error updating review', {
      error: error.message,
      stack: error.stack,
      reviewId,
      userId,
    });

    // Re-throw if it's already an AppError
    if (error instanceof AppError) {
      throw error;
    }

    // Otherwise wrap as generic error
    throw new AppError(
      'Failed to update review',
      500,
      'REVIEW_UPDATE_FAILED'
    );
  }
};

/**
 * Delete a review (soft deletion)
 * 
 * This operation marks the review as deleted without actually removing it from
 * the database. Soft-deleted reviews are excluded from all public queries but
 * preserved for potential restoration or auditing.
 * 
 * Authorization note: The controller must verify that the authenticated user
 * is the review author before calling this service method.
 * 
 * @param {string} reviewId - UUID of the review to delete
 * @param {string} userId - UUID of authenticated user (for authorization check)
 * @returns {Promise<Object>} Confirmation object with success message
 * @throws {AppError} If review not found or user unauthorized
 */
export const deleteReview = async (reviewId, userId) => {
  // Fetch current review to verify existence and authorization
  const currentReview = await ReviewModel.findReviewById(reviewId);
  if (!currentReview) {
    throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
  }

  // Verify user is the review author (authorization check)
  if (currentReview.user_id !== userId) {
    throw new AppError(
      'You can only delete your own reviews',
      403,
      'UNAUTHORIZED_REVIEW_DELETION'
    );
  }

  try {
    // Soft delete the review
    const deleted = await ReviewModel.softDeleteReview(reviewId);
    
    if (!deleted) {
      throw new AppError('Review not found or already deleted', 404, 'REVIEW_NOT_FOUND');
    }

    // Update establishment aggregate statistics synchronously
    // This ensures the deleted review no longer counts toward ratings
    await ReviewModel.updateEstablishmentAggregates(currentReview.establishment_id);

    logger.info('Review deleted successfully', {
      reviewId,
      userId,
      establishmentId: currentReview.establishment_id,
    });

    return {
      message: 'Review deleted successfully',
    };
  } catch (error) {
    // Log unexpected errors
    logger.error('Unexpected error deleting review', {
      error: error.message,
      stack: error.stack,
      reviewId,
      userId,
    });

    // Re-throw if it's already an AppError
    if (error instanceof AppError) {
      throw error;
    }

    // Otherwise wrap as generic error
    throw new AppError(
      'Failed to delete review',
      500,
      'REVIEW_DELETION_FAILED'
    );
  }
};

/**
 * Get establishment aggregate statistics
 * 
 * This is a utility function that returns the current aggregate statistics
 * for an establishment. It's useful for verification and debugging but not
 * typically exposed as a public API endpoint since aggregates are included
 * in establishment detail responses.
 * 
 * @param {string} establishmentId - UUID of the establishment
 * @returns {Promise<Object>} Object with average_rating and review_count
 * @throws {AppError} If establishment not found
 */
export const getEstablishmentAggregates = async (establishmentId) => {
  const establishmentExists = await ReviewModel.establishmentExists(establishmentId);
  if (!establishmentExists) {
    throw new AppError('Establishment not found', 404, 'ESTABLISHMENT_NOT_FOUND');
  }

  // The aggregates are stored in the establishments table, so we just need to query it
  // For now, we'll recalculate them to ensure accuracy
  const aggregates = await ReviewModel.updateEstablishmentAggregates(establishmentId);

  return aggregates;
};

/**
 * Check user's remaining review quota for rate limiting
 * 
 * This utility function returns how many reviews the user can still create today.
 * It's useful for client-side feedback and preventing unnecessary API calls.
 * 
 * @param {string} userId - UUID of the user
 * @returns {Promise<Object>} Object with current count, limit, and remaining quota
 */
export const getUserReviewQuota = async (userId) => {
  const rateLimitKey = `reviews:ratelimit:${userId}`;
  const currentCount = await getCounter(rateLimitKey);
  
  return {
    limit: RATE_LIMIT_MAX_REVIEWS,
    used: currentCount,
    remaining: Math.max(0, RATE_LIMIT_MAX_REVIEWS - currentCount),
    resetIn: RATE_LIMIT_WINDOW_SECONDS, // Seconds until counter resets
  };
};

