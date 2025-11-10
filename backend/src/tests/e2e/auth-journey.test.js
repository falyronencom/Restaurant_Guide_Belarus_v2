/**
 * E2E Journey Test: Authentication Complete Flow
 *
 * This test simulates complete authentication lifecycle:
 * 1. User registers new account
 * 2. User logs out
 * 3. User logs back in
 * 4. User refreshes access token
 * 5. User's session expires
 * 6. Security verification (failed attempts, validation)
 *
 * This journey verifies:
 * - Complete JWT authentication flow
 * - Token refresh mechanism
 * - Session management
 * - Security measures
 */

import request from 'supertest';
import {
  app,
  cleanDatabase,
  registerUser,
  loginUser
} from './helpers.js';

describe('E2E Journey: Authentication Complete Flow', () => {
  const userData = {
    email: 'authtest@journey.test',
    password: 'AuthTest123!@#',
    name: 'Тест Аутентификации',
    phone: '+375297777777'
  };

  beforeAll(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  describe('Complete Authentication Lifecycle', () => {
    let user;
    let originalAccessToken;
    let originalRefreshToken;

    test('STEP 1: User registers new account', async () => {
      const result = await registerUser(userData);
      user = result;

      originalAccessToken = result.accessToken;
      originalRefreshToken = result.refreshToken;

      // Verify registration successful
      expect(result.response.status).toBe(201);
      expect(result.user).toHaveProperty('id');
      expect(result.user.email).toBe(userData.email.toLowerCase());
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    test('STEP 2: User can access protected endpoint with token', async () => {
      // User tries to access their profile
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${originalAccessToken}`);

      // Verify access granted
      expect(response.status).toBe(200);
      expect(response.body.data.user.id).toBe(user.user.id);
      expect(response.body.data.user.email).toBe(userData.email.toLowerCase());
    });

    test('STEP 3: User logs out (invalidates refresh token)', async () => {
      // User clicks logout
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${originalAccessToken}`)
        .send({ refreshToken: originalRefreshToken });

      // Verify logout successful
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('STEP 4: User logs back in with credentials', async () => {
      // User enters credentials again
      const result = await loginUser({
        email: userData.email,
        password: userData.password
      });

      // Verify login successful with new tokens
      expect(result.response.status).toBe(200);
      expect(result.user.id).toBe(user.user.id);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();

      // New tokens should be different from original
      expect(result.accessToken).not.toBe(originalAccessToken);
      expect(result.refreshToken).not.toBe(originalRefreshToken);

      // Update for next tests
      user = result;
    });

    test('STEP 5: User refreshes access token', async () => {
      // Access token expires, user refreshes
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken });

      // Verify refresh successful
      expect(response.status).toBe(200);
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();

      // New tokens provided
      const newAccessToken = response.body.data.tokens.accessToken;
      expect(newAccessToken).not.toBe(user.accessToken);
    });

    test('STEP 6: User can login with phone instead of email', async () => {
      // User uses phone to login
      const result = await loginUser({
        phone: userData.phone,
        password: userData.password
      });

      // Verify login successful
      expect(result.response.status).toBe(200);
      expect(result.user.id).toBe(user.user.id);
      expect(result.accessToken).toBeDefined();
    });
  });

  describe('Authentication Security Verification', () => {
    test('Registration with weak password fails', async () => {
      const result = await registerUser({
        email: 'weakpass@test.com',
        password: '123', // Too weak
        name: 'Weak Password User',
        phone: '+375298888888'
      });

      // Should fail validation
      expect(result.response.status).toBe(422);
      expect(result.response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Registration with duplicate email fails', async () => {
      const result = await registerUser({
        ...userData,
        phone: '+375299999999' // Different phone
      });

      // Should fail with conflict
      expect(result.response.status).toBe(409);
      expect(result.response.body.error.code).toBe('DUPLICATE_EMAIL');
    });

    test('Registration with non-Belarus phone fails', async () => {
      const result = await registerUser({
        email: 'russia@test.com',
        password: 'ValidPassword123!@#',
        name: 'Russia User',
        phone: '+79001234567' // Russian number
      });

      // Should fail validation
      expect(result.response.status).toBe(422);
      expect(result.response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Login with wrong password fails', async () => {
      const result = await loginUser({
        email: userData.email,
        password: 'WrongPassword123!@#'
      });

      // Should fail with unauthorized
      expect(result.response.status).toBe(401);
      expect(result.response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('Login with non-existent email fails', async () => {
      const result = await loginUser({
        email: 'nonexistent@test.com',
        password: 'Password123!@#'
      });

      // Should fail with unauthorized
      expect(result.response.status).toBe(401);
      expect(result.response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('Access protected endpoint without token fails', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me');
      // No Authorization header

      // Should fail with unauthorized
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    test('Access protected endpoint with invalid token fails', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token-here');

      // Should fail with unauthorized
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    test('Refresh with invalid token fails', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-refresh-token' });

      // Should fail with unauthorized
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('Email and Phone Normalization', () => {
    test('Email is normalized to lowercase', async () => {
      const result = await registerUser({
        email: 'UPPERCASE@TEST.COM',
        password: 'Password123!@#',
        name: 'Uppercase Email',
        phone: '+375291000000'
      });

      // Email should be lowercased
      expect(result.response.status).toBe(201);
      expect(result.user.email).toBe('uppercase@test.com');
    });

    test('Phone number is normalized (spaces removed)', async () => {
      const result = await registerUser({
        email: 'phone-spaces@test.com',
        password: 'Password123!@#',
        name: 'Phone Spaces',
        phone: '+375 29 100 00 01' // With spaces
      });

      // Phone should be normalized
      expect(result.response.status).toBe(201);
      expect(result.user.phone).toBe('+375291000001');
    });

    test('Can login with email in different case', async () => {
      const result = await loginUser({
        email: 'AUTHTEST@JOURNEY.TEST', // Original was lowercase
        password: userData.password
      });

      // Should work (case-insensitive)
      expect(result.response.status).toBe(200);
      expect(result.user.email).toBe('authtest@journey.test');
    });
  });
});
