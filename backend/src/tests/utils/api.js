/**
 * API Test Helpers
 *
 * Utilities for making HTTP requests in tests using supertest.
 * Provides convenient wrappers for common API patterns.
 */

import request from 'supertest';

/**
 * Create an API client for testing
 * In tests, we'll import the Express app directly without starting the server
 *
 * @param {Object} app - Express app instance
 * @returns {Object} API client
 */
export function createApiClient(app) {
  return request(app);
}

/**
 * Make authenticated GET request
 *
 * @param {Object} app - Express app
 * @param {string} path - API path
 * @param {string} token - JWT access token
 * @returns {Promise} Supertest response
 */
export async function authenticatedGet(app, path, token) {
  return await request(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json');
}

/**
 * Make authenticated POST request
 *
 * @param {Object} app - Express app
 * @param {string} path - API path
 * @param {string} token - JWT access token
 * @param {Object} data - Request body
 * @returns {Promise} Supertest response
 */
export async function authenticatedPost(app, path, token, data = {}) {
  return await request(app)
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json')
    .set('Content-Type', 'application/json')
    .send(data);
}

/**
 * Make authenticated PUT request
 *
 * @param {Object} app - Express app
 * @param {string} path - API path
 * @param {string} token - JWT access token
 * @param {Object} data - Request body
 * @returns {Promise} Supertest response
 */
export async function authenticatedPut(app, path, token, data = {}) {
  return await request(app)
    .put(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json')
    .set('Content-Type', 'application/json')
    .send(data);
}

/**
 * Make authenticated DELETE request
 *
 * @param {Object} app - Express app
 * @param {string} path - API path
 * @param {string} token - JWT access token
 * @returns {Promise} Supertest response
 */
export async function authenticatedDelete(app, path, token) {
  return await request(app)
    .delete(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json');
}

/**
 * Make unauthenticated GET request
 *
 * @param {Object} app - Express app
 * @param {string} path - API path
 * @returns {Promise} Supertest response
 */
export async function unauthenticatedGet(app, path) {
  return await request(app)
    .get(path)
    .set('Accept', 'application/json');
}

/**
 * Make unauthenticated POST request
 *
 * @param {Object} app - Express app
 * @param {string} path - API path
 * @param {Object} data - Request body
 * @returns {Promise} Supertest response
 */
export async function unauthenticatedPost(app, path, data = {}) {
  return await request(app)
    .post(path)
    .set('Accept', 'application/json')
    .set('Content-Type', 'application/json')
    .send(data);
}

/**
 * Expect successful response (2xx status)
 *
 * @param {Object} response - Supertest response
 * @param {number} expectedStatus - Expected status code (default 200)
 */
export function expectSuccess(response, expectedStatus = 200) {
  expect(response.status).toBe(expectedStatus);
  expect(response.body).toBeDefined();
}

/**
 * Expect error response with specific status and error code
 *
 * @param {Object} response - Supertest response
 * @param {number} expectedStatus - Expected HTTP status
 * @param {string} expectedErrorCode - Expected error code (optional)
 */
export function expectError(response, expectedStatus, expectedErrorCode = null) {
  expect(response.status).toBe(expectedStatus);
  expect(response.body.error).toBeDefined();

  if (expectedErrorCode) {
    expect(response.body.error.code).toBe(expectedErrorCode);
  }
}

/**
 * Expect validation error (422 status)
 *
 * @param {Object} response - Supertest response
 * @param {string} field - Field name that failed validation (optional)
 */
export function expectValidationError(response, field = null) {
  expect(response.status).toBe(422);
  expect(response.body.error).toBeDefined();
  expect(response.body.error.code).toBe('VALIDATION_ERROR');

  if (field) {
    expect(response.body.error.details).toBeDefined();
    const fieldError = response.body.error.details.find(d => d.path === field);
    expect(fieldError).toBeDefined();
  }
}

/**
 * Expect authentication error (401 status)
 *
 * @param {Object} response - Supertest response
 */
export function expectAuthError(response) {
  expect(response.status).toBe(401);
  expect(response.body.error).toBeDefined();
}

/**
 * Expect authorization error (403 status)
 *
 * @param {Object} response - Supertest response
 */
export function expectForbiddenError(response) {
  expect(response.status).toBe(403);
  expect(response.body.error).toBeDefined();
}

/**
 * Expect not found error (404 status)
 *
 * @param {Object} response - Supertest response
 */
export function expectNotFoundError(response) {
  expect(response.status).toBe(404);
  expect(response.body.error).toBeDefined();
}

/**
 * Expect conflict error (409 status)
 *
 * @param {Object} response - Supertest response
 */
export function expectConflictError(response) {
  expect(response.status).toBe(409);
  expect(response.body.error).toBeDefined();
}

/**
 * Expect rate limit error (429 status)
 *
 * @param {Object} response - Supertest response
 */
export function expectRateLimitError(response) {
  expect(response.status).toBe(429);
  expect(response.body.error).toBeDefined();
  expect(response.headers['retry-after']).toBeDefined();
}

/**
 * Extract data from successful response
 *
 * @param {Object} response - Supertest response
 * @returns {any} Response data
 */
export function extractData(response) {
  expectSuccess(response);
  return response.body.data || response.body;
}

/**
 * Login and get access token
 *
 * @param {Object} app - Express app
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<string>} Access token
 */
export async function loginAndGetToken(app, email, password) {
  const response = await unauthenticatedPost(app, '/api/v1/auth/login', {
    email,
    password
  });

  expectSuccess(response);
  expect(response.body.data.tokens.accessToken).toBeDefined();

  return response.body.data.tokens.accessToken;
}

/**
 * Register user and get access token
 *
 * @param {Object} app - Express app
 * @param {Object} userData - User registration data
 * @returns {Promise<string>} Access token
 */
export async function registerAndGetToken(app, userData) {
  const response = await unauthenticatedPost(app, '/api/v1/auth/register', userData);

  expectSuccess(response, 201);
  expect(response.body.data.tokens.accessToken).toBeDefined();

  return response.body.data.tokens.accessToken;
}

/**
 * Check if response has pagination metadata
 *
 * @param {Object} response - Supertest response
 */
export function expectPagination(response) {
  expectSuccess(response);
  expect(response.body.data.pagination).toBeDefined();
  expect(response.body.data.pagination).toMatchObject({
    page: expect.any(Number),
    limit: expect.any(Number),
    total: expect.any(Number),
    totalPages: expect.any(Number),
    hasNext: expect.any(Boolean),
    hasPrevious: expect.any(Boolean)
  });
}

/**
 * Check if response contains array of items
 *
 * @param {Object} response - Supertest response
 * @param {string} arrayKey - Key containing array (default 'data')
 * @param {number} minLength - Minimum expected array length (optional)
 */
export function expectArray(response, arrayKey = 'data', minLength = 0) {
  expectSuccess(response);

  const data = arrayKey === 'data' ? response.body.data : response.body[arrayKey];
  expect(Array.isArray(data)).toBe(true);

  if (minLength > 0) {
    expect(data.length).toBeGreaterThanOrEqual(minLength);
  }
}

/**
 * Wait for a condition to be true (for async operations)
 *
 * @param {Function} condition - Function that returns boolean
 * @param {number} timeout - Timeout in milliseconds
 * @param {number} interval - Check interval in milliseconds
 * @returns {Promise<boolean>} True if condition met
 */
export async function waitFor(condition, timeout = 5000, interval = 100) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  return false;
}

/**
 * Measure response time
 *
 * @param {Function} requestFunction - Function that makes the request
 * @returns {Promise<Object>} { response, duration }
 */
export async function measureResponseTime(requestFunction) {
  const startTime = Date.now();
  const response = await requestFunction();
  const duration = Date.now() - startTime;

  return { response, duration };
}

export default {
  createApiClient,
  authenticatedGet,
  authenticatedPost,
  authenticatedPut,
  authenticatedDelete,
  unauthenticatedGet,
  unauthenticatedPost,
  expectSuccess,
  expectError,
  expectValidationError,
  expectAuthError,
  expectForbiddenError,
  expectNotFoundError,
  expectConflictError,
  expectRateLimitError,
  extractData,
  loginAndGetToken,
  registerAndGetToken,
  expectPagination,
  expectArray,
  waitFor,
  measureResponseTime
};
