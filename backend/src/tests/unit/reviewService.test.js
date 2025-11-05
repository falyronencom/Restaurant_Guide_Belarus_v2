/**
 * Unit Tests: reviewService.js
 *
 * Tests review business logic in isolation using mocked dependencies.
 * These tests verify:
 * - Review creation with validation
 * - Rate limiting enforcement
 * - Duplicate review detection
 * - Aggregate statistics updates
 * - Ownership verification
 */

import { jest } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('../../models/reviewModel.js', () => ({
  getUserById: jest.fn(),
  establishmentExists: jest.fn(),
  findExistingReview: jest.fn(),
  createReview: jest.fn(),
  updateEstablishmentAggregates: jest.fn(),
  findReviewById: jest.fn(),
  updateReview: jest.fn(),
  softDeleteReview: jest.fn(),
  getReviewsByEstablishment: jest.fn(),
  countReviewsByEstablishment: jest.fn(),
}));

jest.unstable_mockModule('../../config/redis.js', () => ({
  incrementWithExpiry: jest.fn(),
  getCounter: jest.fn(),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Import after mocking
const ReviewModel = await import('../../models/reviewModel.js');
const { incrementWithExpiry, getCounter } = await import('../../config/redis.js');
const logger = (await import('../../utils/logger.js')).default;

const {
  createReview,
  updateReview,
  deleteReview,
  getReviewsByEstablishment,
} = await import('../../services/reviewService.js');

import { createMockUser, createMockReview, createMockEstablishment } from '../mocks/helpers.js';
import { AppError } from '../../middleware/errorHandler.js';

describe('reviewService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createReview', () => {
    const validReviewData = {
      user_id: 'user-123',
      establishment_id: 'estab-123',
      rating: 5,
      content: 'Great place! Excellent food and service.',
    };

    const mockUser = createMockUser({ id: 'user-123', is_active: true });
    const mockReview = createMockReview(validReviewData);

    beforeEach(() => {
      // Setup default mocks for successful creation
      ReviewModel.getUserById.mockResolvedValue(mockUser);
      ReviewModel.establishmentExists.mockResolvedValue(true);
      ReviewModel.findExistingReview.mockResolvedValue(null);
      ReviewModel.createReview.mockResolvedValue(mockReview);
      ReviewModel.updateEstablishmentAggregates.mockResolvedValue(undefined);
      ReviewModel.findReviewById.mockResolvedValue(mockReview);
      getCounter.mockResolvedValue(0);
      incrementWithExpiry.mockResolvedValue(undefined);
    });

    test('should create review with valid data', async () => {
      const result = await createReview(validReviewData);

      expect(result).toEqual(mockReview);

      // Verify user validation
      expect(ReviewModel.getUserById).toHaveBeenCalledWith('user-123');

      // Verify establishment validation
      expect(ReviewModel.establishmentExists).toHaveBeenCalledWith('estab-123');

      // Verify rate limit check
      expect(getCounter).toHaveBeenCalledWith('reviews:ratelimit:user-123');

      // Verify duplicate check
      expect(ReviewModel.findExistingReview).toHaveBeenCalledWith('user-123', 'estab-123');

      // Verify review creation
      expect(ReviewModel.createReview).toHaveBeenCalledWith(validReviewData);

      // Verify aggregates updated
      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalledWith('estab-123');

      // Verify rate limit incremented
      expect(incrementWithExpiry).toHaveBeenCalledWith('reviews:ratelimit:user-123', 86400);

      expect(logger.info).toHaveBeenCalledWith(
        'Review created successfully',
        expect.objectContaining({ userId: 'user-123' })
      );
    });

    test('should throw error if user not found', async () => {
      ReviewModel.getUserById.mockResolvedValue(null);

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
      });

      // Should not proceed to create review
      expect(ReviewModel.createReview).not.toHaveBeenCalled();
    });

    test('should throw error if user is inactive', async () => {
      ReviewModel.getUserById.mockResolvedValue({
        ...mockUser,
        is_active: false,
      });

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 403,
        code: 'USER_INACTIVE',
      });

      expect(ReviewModel.createReview).not.toHaveBeenCalled();
    });

    test('should throw error if establishment not found', async () => {
      ReviewModel.establishmentExists.mockResolvedValue(false);

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 404,
        code: 'ESTABLISHMENT_NOT_FOUND',
      });

      expect(ReviewModel.createReview).not.toHaveBeenCalled();
    });

    test('should enforce rate limit of 10 reviews per day', async () => {
      getCounter.mockResolvedValue(10); // Already at limit

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'Rate limit exceeded for review creation',
        expect.objectContaining({ currentCount: 10, limit: 10 })
      );

      expect(ReviewModel.createReview).not.toHaveBeenCalled();
    });

    test('should allow review when under rate limit', async () => {
      getCounter.mockResolvedValue(9); // Just under limit

      await expect(createReview(validReviewData)).resolves.toBeDefined();

      expect(ReviewModel.createReview).toHaveBeenCalled();
    });

    test('should detect duplicate review', async () => {
      ReviewModel.findExistingReview.mockResolvedValue(mockReview);

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_REVIEW',
      });

      expect(ReviewModel.createReview).not.toHaveBeenCalled();
    });

    test('should handle database unique constraint violation', async () => {
      const error = new Error('Duplicate key');
      error.code = '23505';
      ReviewModel.createReview.mockRejectedValue(error);

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_REVIEW',
      });
    });

    test('should handle foreign key violation', async () => {
      const error = new Error('Foreign key violation');
      error.code = '23503';
      ReviewModel.createReview.mockRejectedValue(error);

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_REFERENCE',
      });
    });

    test('should handle check constraint violation', async () => {
      const error = new Error('Check constraint violation');
      error.code = '23514';
      ReviewModel.createReview.mockRejectedValue(error);

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 400,
        code: 'CONSTRAINT_VIOLATION',
      });
    });

    test('should update establishment aggregates synchronously', async () => {
      const result = await createReview(validReviewData);

      // Verify aggregates updated before completion
      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalledWith('estab-123');
      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalledBefore(
        ReviewModel.findReviewById
      );
    });

    test('should increment rate limit counter after successful creation', async () => {
      await createReview(validReviewData);

      expect(incrementWithExpiry).toHaveBeenCalledWith(
        'reviews:ratelimit:user-123',
        86400 // 24 hours
      );
    });

    test('should fetch complete review with author information', async () => {
      const reviewWithAuthor = {
        ...mockReview,
        author_name: 'Test User',
        author_email: 'user@test.com',
      };

      ReviewModel.findReviewById.mockResolvedValue(reviewWithAuthor);

      const result = await createReview(validReviewData);

      expect(result).toEqual(reviewWithAuthor);
      expect(ReviewModel.findReviewById).toHaveBeenCalledWith(mockReview.id);
    });
  });

  describe('updateReview', () => {
    const reviewId = 'review-123';
    const userId = 'user-123';
    const updates = {
      rating: 4,
      content: 'Updated review content',
    };

    const mockReview = createMockReview({
      id: reviewId,
      user_id: userId,
      rating: 5,
      content: 'Original content',
    });

    beforeEach(() => {
      ReviewModel.findReviewById.mockResolvedValue(mockReview);
      ReviewModel.updateReview.mockResolvedValue({ ...mockReview, ...updates });
      ReviewModel.updateEstablishmentAggregates.mockResolvedValue(undefined);
    });

    test('should update review when user owns it', async () => {
      const result = await updateReview(reviewId, userId, updates);

      expect(result).toMatchObject(updates);
      expect(ReviewModel.updateReview).toHaveBeenCalledWith(reviewId, updates);

      // Verify aggregates updated
      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalledWith(
        mockReview.establishment_id
      );
    });

    test('should throw error when review not found', async () => {
      ReviewModel.findReviewById.mockResolvedValue(null);

      await expect(updateReview(reviewId, userId, updates)).rejects.toMatchObject({
        statusCode: 404,
        code: 'REVIEW_NOT_FOUND',
      });

      expect(ReviewModel.updateReview).not.toHaveBeenCalled();
    });

    test('should throw error when user does not own review', async () => {
      await expect(updateReview(reviewId, 'different-user', updates)).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
      });

      expect(ReviewModel.updateReview).not.toHaveBeenCalled();
    });

    test('should update aggregates when rating changes', async () => {
      await updateReview(reviewId, userId, { rating: 3 });

      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalled();
    });
  });

  describe('deleteReview', () => {
    const reviewId = 'review-123';
    const userId = 'user-123';
    const mockReview = createMockReview({ id: reviewId, user_id: userId });

    beforeEach(() => {
      ReviewModel.findReviewById.mockResolvedValue(mockReview);
      ReviewModel.softDeleteReview.mockResolvedValue(undefined);
      ReviewModel.updateEstablishmentAggregates.mockResolvedValue(undefined);
    });

    test('should soft delete review when user owns it', async () => {
      await deleteReview(reviewId, userId);

      expect(ReviewModel.softDeleteReview).toHaveBeenCalledWith(reviewId);

      // Verify aggregates updated after deletion
      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalledWith(
        mockReview.establishment_id
      );
    });

    test('should throw error when user does not own review', async () => {
      await expect(deleteReview(reviewId, 'different-user')).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
      });

      expect(ReviewModel.softDeleteReview).not.toHaveBeenCalled();
    });
  });

  describe('getReviewsByEstablishment', () => {
    const establishmentId = 'estab-123';

    test('should fetch reviews with pagination', async () => {
      const mockReviews = [createMockReview(), createMockReview()];

      ReviewModel.getReviewsByEstablishment.mockResolvedValue(mockReviews);
      ReviewModel.countReviewsByEstablishment.mockResolvedValue(15);

      const result = await getReviewsByEstablishment(establishmentId, {
        page: 1,
        limit: 10,
      });

      expect(result.reviews).toEqual(mockReviews);
      expect(result.meta).toEqual({
        total: 15,
        page: 1,
        limit: 10,
        pages: 2,
      });
    });

    test('should enforce maximum limit', async () => {
      ReviewModel.getReviewsByEstablishment.mockResolvedValue([]);
      ReviewModel.countReviewsByEstablishment.mockResolvedValue(0);

      await getReviewsByEstablishment(establishmentId, { limit: 200 });

      expect(ReviewModel.getReviewsByEstablishment).toHaveBeenCalledWith(
        establishmentId,
        expect.objectContaining({ limit: 50 }) // Capped at 50
      );
    });
  });
});
