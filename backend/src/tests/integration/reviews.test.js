/**
 * Reviews System Integration Tests
 *
 * Tests comprehensive review functionality:
 * - Create review (authenticated, rating 1-5)
 * - Read reviews (public, pagination, sorting)
 * - Update review (author only)
 * - Delete review (soft deletion)
 * - One review per user per establishment (UNIQUE constraint)
 * - Daily quota enforcement (10 reviews/day via Redis)
 * - Establishment metrics update (average_rating, review_count)
 * - Partner responses
 * - Review ownership verification
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query, countRecords } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import { testReviews } from '../fixtures/reviews.js';

let userToken;
let user2Token;
let partnerToken;
let userId;
let user2Id;
let partnerId;
let establishmentId;

// Default working hours for test establishments
const defaultWorkingHours = JSON.stringify({
  monday: { open: '10:00', close: '22:00' },
  tuesday: { open: '10:00', close: '22:00' },
  wednesday: { open: '10:00', close: '22:00' },
  thursday: { open: '10:00', close: '22:00' },
  friday: { open: '10:00', close: '23:00' },
  saturday: { open: '11:00', close: '23:00' },
  sunday: { open: '11:00', close: '22:00' }
});

beforeAll(async () => {
  // Create test users
  const user = await createUserAndGetTokens(testUsers.regularUser);
  const user2 = await createUserAndGetTokens(testUsers.regularUser2);
  const partner = await createUserAndGetTokens(testUsers.partner);

  userToken = user.accessToken;
  user2Token = user2.accessToken;
  partnerToken = partner.accessToken;
  userId = user.user.id;
  user2Id = user2.user.id;
  partnerId = partner.user.id;
});

beforeEach(async () => {
  // Clear reviews and establishments
  await query('TRUNCATE TABLE reviews CASCADE');
  await query('TRUNCATE TABLE establishments CASCADE');

  // Create test establishment
  const defaultWorkingHours = JSON.stringify({
    monday: { open: '10:00', close: '22:00' },
    tuesday: { open: '10:00', close: '22:00' },
    wednesday: { open: '10:00', close: '22:00' },
    thursday: { open: '10:00', close: '22:00' },
    friday: { open: '10:00', close: '23:00' },
    saturday: { open: '11:00', close: '23:00' },
    sunday: { open: '11:00', close: '22:00' }
  });

  const result = await query(`
    INSERT INTO establishments (
      id, partner_id, name, description, city, address,
      latitude, longitude, categories, cuisines, status,
      average_rating, review_count, working_hours, price_range, created_at, updated_at
    )
    VALUES (
      gen_random_uuid(), $1, 'Test Restaurant', 'Great food',
      'Минск', 'Test Address', 53.9, 27.5,
      ARRAY['Ресторан'], ARRAY['Европейская'], 'active',
      NULL, 0, $2::jsonb, '$$', NOW(), NOW()
    )
    RETURNING id
  `, [partnerId, defaultWorkingHours]);

  establishmentId = result.rows[0].id;
});

afterAll(async () => {
  await clearAllData();
});

describe('Reviews System - Create Review', () => {
  test('should create review with valid data', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: testReviews[0].content
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.review).toBeDefined();

    const review = response.body.data.review;
    expect(review.rating).toBe(5);
    expect(review.content).toBe(testReviews[0].content);
    expect(review.user_id).toBe(userId);
    expect(review.establishment_id).toBe(establishmentId);
    expect(review.id).toBeDefined();
  });

  test('should accept ratings 1-5', async () => {
    for (let rating = 1; rating <= 5; rating++) {
      // Clear previous review
      await query('TRUNCATE TABLE reviews CASCADE');

      const response = await request(app)
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          establishmentId,
          rating,
          content: `Rating ${rating} review`
        })
        .expect(201);

      expect(response.body.data.review.rating).toBe(rating);
    }
  });

  test('should reject rating 0', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 0,
        content: 'Invalid rating'
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject rating 6', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 6,
        content: 'Invalid rating'
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject non-integer rating', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 3.5,
        content: 'Invalid rating'
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject missing content', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject empty content', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: ''
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject review without authentication', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .send({
        establishmentId,
        rating: 5,
        content: 'Test review'
      })
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  test('should reject review for non-existent establishment', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId: '00000000-0000-0000-0000-000000000000',
        rating: 5,
        content: 'Test review'
      })
      .expect(404);

    expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
  });

  test('should handle Russian/Belarusian text in content', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: testReviews[0].content // Contains Cyrillic
      })
      .expect(201);

    expect(response.body.data.review.content).toBe(testReviews[0].content);
  });
});

describe('Reviews System - One Review Per User Per Establishment', () => {
  test('should allow first review for establishment', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: 'First review'
      })
      .expect(201);

    expect(response.body.data.review).toBeDefined();
  });

  test('should reject second review from same user for same establishment', async () => {
    // Create first review
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: 'First review'
      })
      .expect(201);

    // Try to create second review
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 4,
        content: 'Second review (should fail)'
      })
      .expect(409);

    expect(response.body.error.code).toBe('DUPLICATE_REVIEW');
    expect(response.body.error.message).toContain('already reviewed');
  });

  test('should allow different users to review same establishment', async () => {
    // User 1 creates review
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: 'User 1 review'
      })
      .expect(201);

    // User 2 creates review (should succeed)
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        establishmentId,
        rating: 3,
        content: 'User 2 review'
      })
      .expect(201);

    expect(response.body.data.review.user_id).toBe(user2Id);
  });

  test('should allow same user to review different establishments', async () => {
    // Create second establishment
    const result = await query(`
      INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, average_rating, review_count, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Second Restaurant', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', NULL, 0, NOW(), NOW())
      RETURNING id
    `, [partnerId, defaultWorkingHours]);
    const establishment2Id = result.rows[0].id;

    // Review first establishment
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: 'Review for establishment 1'
      })
      .expect(201);

    // Review second establishment (should succeed)
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId: establishment2Id,
        rating: 4,
        content: 'Review for establishment 2'
      })
      .expect(201);

    expect(response.body.data.review).toBeDefined();
  });
});

describe('Reviews System - Establishment Metrics Update', () => {
  test('should initialize metrics on first review', async () => {
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentId,
        rating: 5,
        content: 'First review'
      })
      .expect(201);

    // Check establishment metrics
    const result = await query(
      'SELECT average_rating, review_count FROM establishments WHERE id = $1',
      [establishmentId]
    );

    expect(result.rows[0].average_rating).toBe(5.0);
    expect(result.rows[0].review_count).toBe(1);
  });

  test('should update average rating correctly (2 reviews)', async () => {
    // User 1: 5 stars
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId, rating: 5, content: 'Great!' })
      .expect(201);

    // User 2: 3 stars
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ establishmentId, rating: 3, content: 'OK' })
      .expect(201);

    // Check metrics: (5+3)/2 = 4.0
    const result = await query(
      'SELECT average_rating, review_count FROM establishments WHERE id = $1',
      [establishmentId]
    );

    expect(result.rows[0].average_rating).toBe(4.0);
    expect(result.rows[0].review_count).toBe(2);
  });

  test('should increment review count correctly', async () => {
    // Create 3 reviews from different users
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId, rating: 5, content: 'Review 1' })
      .expect(201);

    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ establishmentId, rating: 4, content: 'Review 2' })
      .expect(201);

    // Create third user for third review
    const user3 = await createUserAndGetTokens({
      ...testUsers.regularUser,
      email: 'user3@test.com',
      phone: '+375295555555'
    });

    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user3.accessToken}`)
      .send({ establishmentId, rating: 3, content: 'Review 3' })
      .expect(201);

    // Check count
    const result = await query(
      'SELECT review_count FROM establishments WHERE id = $1',
      [establishmentId]
    );

    expect(result.rows[0].review_count).toBe(3);
  });
});

describe('Reviews System - Read Reviews', () => {
  beforeEach(async () => {
    // Create test reviews
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId, rating: 5, content: 'Excellent!' });

    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ establishmentId, rating: 3, content: 'OK' });
  });

  test('should get review by ID (public)', async () => {
    const reviews = await query('SELECT id FROM reviews LIMIT 1');
    const reviewId = reviews.rows[0].id;

    const response = await request(app)
      .get(`/api/v1/reviews/${reviewId}`)
      .expect(200);

    expect(response.body.data.review).toBeDefined();
    expect(response.body.data.review.id).toBe(reviewId);
  });

  test('should list reviews for establishment', async () => {
    const response = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews`)
      .expect(200);

    expect(response.body.data.reviews).toHaveLength(2);
    expect(response.body.data.pagination).toBeDefined();
  });

  test('should paginate reviews', async () => {
    // Create more reviews
    for (let i = 0; i < 15; i++) {
      const user = await createUserAndGetTokens({
        ...testUsers.regularUser,
        email: `user${i}@test.com`,
        phone: `+37529${String(i).padStart(7, '0')}`
      });

      await request(app)
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ establishmentId, rating: 4, content: `Review ${i}` });
    }

    // Get page 1
    const page1 = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews?page=1&limit=10`)
      .expect(200);

    expect(page1.body.data.reviews).toHaveLength(10);
    expect(page1.body.data.pagination.hasNext).toBe(true);

    // Get page 2
    const page2 = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews?page=2&limit=10`)
      .expect(200);

    expect(page2.body.data.reviews.length).toBeGreaterThan(0);
  });

  test('should sort reviews by newest', async () => {
    const response = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews?sort=newest`)
      .expect(200);

    const reviews = response.body.data.reviews;
    // Verify descending order by created_at
    for (let i = 0; i < reviews.length - 1; i++) {
      expect(new Date(reviews[i].created_at) >= new Date(reviews[i + 1].created_at)).toBe(true);
    }
  });

  test('should sort reviews by highest rating', async () => {
    const response = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews?sort=highest`)
      .expect(200);

    const reviews = response.body.data.reviews;
    // Verify descending order by rating
    for (let i = 0; i < reviews.length - 1; i++) {
      expect(reviews[i].rating >= reviews[i + 1].rating).toBe(true);
    }
  });
});

describe('Reviews System - Update Review', () => {
  let reviewId;

  beforeEach(async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId, rating: 5, content: 'Original review' });

    reviewId = response.body.data.review.id;
  });

  test('should update own review', async () => {
    const response = await request(app)
      .put(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        rating: 4,
        content: 'Updated review'
      })
      .expect(200);

    expect(response.body.data.review.rating).toBe(4);
    expect(response.body.data.review.content).toBe('Updated review');
  });

  test('should reject updating other user review', async () => {
    const response = await request(app)
      .put(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        rating: 1,
        content: 'Trying to update others review'
      })
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  test('should recalculate metrics after update', async () => {
    // Create second review
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ establishmentId, rating: 3, content: 'Second review' });

    // Current avg: (5+3)/2 = 4.0

    // Update first review to 1
    await request(app)
      .put(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ rating: 1, content: 'Changed to 1 star' });

    // New avg should be: (1+3)/2 = 2.0
    const result = await query(
      'SELECT average_rating FROM establishments WHERE id = $1',
      [establishmentId]
    );

    expect(result.rows[0].average_rating).toBe(2.0);
  });
});

describe('Reviews System - Delete Review', () => {
  let reviewId;

  beforeEach(async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId, rating: 5, content: 'To be deleted' });

    reviewId = response.body.data.review.id;
  });

  test('should soft delete own review', async () => {
    await request(app)
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    // Verify review is marked as deleted
    const result = await query(
      'SELECT is_deleted FROM reviews WHERE id = $1',
      [reviewId]
    );

    expect(result.rows[0].is_deleted).toBe(true);
  });

  test('should not show deleted review in list', async () => {
    await request(app)
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const response = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews`)
      .expect(200);

    expect(response.body.data.reviews).toHaveLength(0);
  });

  test('should reject deleting other user review', async () => {
    const response = await request(app)
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  test('should update metrics after deletion', async () => {
    // Create second review
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ establishmentId, rating: 3, content: 'Second' });

    // Current: avg=4.0, count=2

    // Delete first review
    await request(app)
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    // Should be: avg=3.0, count=1
    const result = await query(
      'SELECT average_rating, review_count FROM establishments WHERE id = $1',
      [establishmentId]
    );

    expect(result.rows[0].average_rating).toBe(3.0);
    expect(result.rows[0].review_count).toBe(1);
  });
});

describe('Reviews System - Daily Quota', () => {
  test.todo('should allow 10 reviews in one day');
  test.todo('should reject 11th review (quota exceeded)');
  test.todo('should reset quota at midnight');
  test.todo('should track quota per user independently');
});

describe('Reviews System - Partner Responses', () => {
  test.todo('should allow partner to respond to review on their establishment');
  test.todo('should reject partner responding to review on other establishment');
  test.todo('should reject regular user adding partner response');
});
