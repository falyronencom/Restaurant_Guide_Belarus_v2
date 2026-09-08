/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Authentication Integration Tests
 *
 * Tests POST /api/v1/admin/auth/login endpoint:
 * - Successful admin login returns tokens + correct role
 * - Non-admin users (user/partner) are rejected with 403
 * - Invalid credentials return 401
 * - Validation errors (missing fields) return 422
 *
 * Endpoint: POST /api/v1/admin/auth/login
 * Middleware chain: rateLimiter(5/min) → validateLogin → adminController.adminLogin
 *
 * NOTE: Rate limit (429) is intentionally not tested here.
 * The admin login limiter shares a Redis counter per IP per minute across
 * all test cases in this file. Testing 429 inline would cause preceding
 * tests to become rate-limited and fail. Rate limit behaviour is covered
 * by backend/src/tests/unit/rateLimiter.test.js.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import { ADMIN_CREDENTIALS, VIEWER_CREDENTIALS } from '../utils/adminTestHelpers.js';

beforeAll(async () => {
  // Create all roles needed for this file
  await createUserAndGetTokens(testUsers.admin);
  await createUserAndGetTokens(testUsers.viewer);
  await createUserAndGetTokens(testUsers.regularUser);
  await createUserAndGetTokens(testUsers.partner);
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// Successful login
// ============================================================================

describe('Admin Auth — Successful Login', () => {
  test('should return 200 with tokens on valid admin credentials', async () => {
    const response = await request(app)
      .post('/api/v1/admin/auth/login')
      .send(ADMIN_CREDENTIALS)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.refreshToken).toBeDefined();
    expect(response.body.data.tokenType).toBe('Bearer');
    expect(response.body.data.expiresIn).toBeDefined();
  });

  test('should return user object with admin role', async () => {
    const response = await request(app)
      .post('/api/v1/admin/auth/login')
      .send(ADMIN_CREDENTIALS)
      .expect(200);

    const user = response.body.data.user;
    expect(user).toBeDefined();
    expect(user.role).toBe('admin');
    expect(user.email).toBe(ADMIN_CREDENTIALS.email.toLowerCase());
    expect(user.id).toBeDefined();
    // Password hash must never be exposed
    expect(user.password).toBeUndefined();
    expect(user.password_hash).toBeUndefined();
  });

  test('returned accessToken should authenticate protected admin endpoint', async () => {
    const loginResponse = await request(app)
      .post('/api/v1/admin/auth/login')
      .send(ADMIN_CREDENTIALS)
      .expect(200);

    const token = loginResponse.body.data.accessToken;

    // Use the token on a protected admin route
    const protectedResponse = await request(app)
      .get('/api/v1/admin/establishments/pending')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(protectedResponse.body.success).toBe(true);
  });
});

// ============================================================================
// Role rejection — valid credentials, wrong role
// ============================================================================

describe('Admin Auth — Role Gate', () => {
  test('should return 403 ADMIN_ACCESS_REQUIRED for regular user', async () => {
    const response = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({
        email: testUsers.regularUser.email,
        password: testUsers.regularUser.password,
      })
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ADMIN_ACCESS_REQUIRED');
  });

  test('should return 403 ADMIN_ACCESS_REQUIRED for partner user', async () => {
    const response = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({
        email: testUsers.partner.email,
        password: testUsers.partner.password,
      })
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ADMIN_ACCESS_REQUIRED');
  });
});

// ============================================================================
// Viewer — the read-only panel role enters through the same door
// ============================================================================

describe('Admin Auth — Viewer role', () => {
  test('viewer logs in and receives tokens with role viewer', async () => {
    const response = await request(app)
      .post('/api/v1/admin/auth/login')
      .send(VIEWER_CREDENTIALS)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.role).toBe('viewer');
    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.refreshToken).toBeDefined();
  });

  test('viewer token opens a read endpoint of the panel', async () => {
    const login = await request(app)
      .post('/api/v1/admin/auth/login')
      .send(VIEWER_CREDENTIALS)
      .expect(200);

    const response = await request(app)
      .get('/api/v1/admin/establishments/pending')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
  });
});

// ============================================================================
// Invalid credentials
// ============================================================================

describe('Admin Auth — Invalid Credentials', () => {
  test('should return 401 INVALID_CREDENTIALS for wrong password', async () => {
    const response = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({
        email: ADMIN_CREDENTIALS.email,
        password: 'WrongPassword123!',
      })
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('should return 401 INVALID_CREDENTIALS for non-existent email', async () => {
    const response = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({
        email: 'ghost-admin@test.com',
        password: 'Admin123!@#',
      })
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

// ============================================================================
// Validation errors — missing / malformed fields
// ============================================================================

describe('Admin Auth — Validation', () => {
  test('should return 422 VALIDATION_ERROR when password is missing', async () => {
    const response = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: ADMIN_CREDENTIALS.email })
      .expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should return 422 VALIDATION_ERROR when both email and phone are missing', async () => {
    const response = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ password: ADMIN_CREDENTIALS.password })
      .expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should return 422 VALIDATION_ERROR for malformed email', async () => {
    const response = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({
        email: 'not-an-email',
        password: 'Admin123!@#',
      })
      .expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
