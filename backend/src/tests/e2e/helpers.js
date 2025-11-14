/**
 * End-to-End Journey Tests
 *
 * These tests simulate complete user journeys through the application,
 * testing the integration between multiple systems and verifying that
 * real-world scenarios work correctly from start to finish.
 *
 * E2E tests differ from integration tests:
 * - Integration tests focus on single system functionality
 * - E2E tests simulate complete user workflows across multiple systems
 * - E2E tests verify the system works as users would actually use it
 *
 * Test Structure:
 * Each journey test follows a realistic user scenario:
 * 1. User performs action A
 * 2. System responds with expected result
 * 3. User performs action B using data from step 1
 * 4. System responds correctly
 * 5. ... continue through complete workflow
 *
 * These tests help catch:
 * - Integration bugs between systems
 * - Workflow logic errors
 * - State management issues
 * - Real-world usage problems
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';

/**
 * E2E Test Helpers
 */

/**
 * Create user and get authentication tokens
 *
 * IMPORTANT: For E2E tests, this helper supports setting custom roles (partner, admin)
 * by directly updating the database after registration. This is necessary because
 * the public registration API always creates users with 'user' role for security.
 *
 * In production, roles are elevated through separate admin processes, but for E2E
 * tests we need the ability to test partner and admin journeys.
 */
export async function registerUser(userData) {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send(userData);

  // If registration succeeded and a custom role was requested
  if (response.status === 201 && userData.role && userData.role !== 'user') {
    const userId = response.body.data?.user?.id;

    if (userId) {
      // Update role directly in database (test environment only)
      await query(
        'UPDATE users SET role = $1 WHERE id = $2',
        [userData.role, userId]
      );

      // Re-login to get fresh tokens with correct role
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: userData.email || null,
          phone: userData.phone || null,
          password: userData.password
        });

      // Return login response but preserve 201 status from registration
      return {
        user: loginResponse.body.data?.user,
        accessToken: loginResponse.body.data?.accessToken,
        refreshToken: loginResponse.body.data?.refreshToken,
        response: {
          ...loginResponse,
          status: 201  // Preserve registration status for test expectations
        }
      };
    }
  }

  return {
    user: response.body.data?.user,
    accessToken: response.body.data?.accessToken,
    refreshToken: response.body.data?.refreshToken,
    response
  };
}

/**
 * Login existing user
 */
export async function loginUser(credentials) {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send(credentials);

  return {
    user: response.body.data?.user,
    accessToken: response.body.data?.accessToken,
    refreshToken: response.body.data?.refreshToken,
    response
  };
}

/**
 * Create establishment as partner
 */
export async function createEstablishment(token, establishmentData) {
  const response = await request(app)
    .post('/api/v1/partner/establishments')
    .set('Authorization', `Bearer ${token}`)
    .send(establishmentData);

  // E2E Helper creates establishment via POST /api/v1/partner/establishments
  // Expected response structure: {success: true, data: {establishment: {...}}}
  return {
    establishment: response.body.data.establishment,
    response
  };
}

/**
 * Search for establishments
 */
export async function searchEstablishments(params) {
  const response = await request(app)
    .get('/api/v1/search/establishments')
    .query(params);

  return {
    establishments: response.body.data.establishments,
    pagination: response.body.data.pagination,
    response
  };
}

/**
 * Add establishment to favorites
 */
export async function addToFavorites(token, establishmentId) {
  const response = await request(app)
    .post('/api/v1/favorites')
    .set('Authorization', `Bearer ${token}`)
    .send({ establishmentId });

  return {
    favorite: response.body.data.favorite,
    response
  };
}

/**
 * Create review for establishment
 */
export async function createReview(token, reviewData) {
  const response = await request(app)
    .post('/api/v1/reviews')
    .set('Authorization', `Bearer ${token}`)
    .send(reviewData);

  return {
    review: response.body.data.review,
    response
  };
}

/**
 * Get user's favorites
 */
export async function getUserFavorites(token, params = {}) {
  const response = await request(app)
    .get('/api/v1/favorites')
    .set('Authorization', `Bearer ${token}`)
    .query(params);

  return {
    favorites: response.body.data.favorites,
    pagination: response.body.data.pagination,
    response
  };
}

/**
 * Clean database before each E2E test
 */
export async function cleanDatabase() {
  await clearAllData();
}

// Export app for tests
export { app };
