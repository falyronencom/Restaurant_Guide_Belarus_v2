/**
 * Authentication System Integration Tests
 *
 * Tests all authentication endpoints and security features:
 * - User registration (email/phone)
 * - Login (email/phone)
 * - Token refresh with rotation
 * - Logout
 * - JWT validation
 * - Rate limiting
 * - Belarus-specific phone validation
 */

import request from 'supertest';
import { clearAllData } from '../utils/database.js';
import { createTestUser, getUserByEmail, getUserByPhone } from '../utils/auth.js';
import { testUsers, invalidUsers, edgeCaseUsers } from '../fixtures/users.js';
import jwt from 'jsonwebtoken';

// Import app without starting server
// We'll need to create this export in server.js
let app;

// Setup and teardown
beforeAll(async () => {
  // TODO: Import app from server.js
  // For now, we'll skip this and note it as a requirement
  console.log('⚠️  Need to export app from server.js for testing');
});

beforeEach(async () => {
  // Clear database before each test for isolation
  await clearAllData();
});

afterAll(async () => {
  // Final cleanup
  await clearAllData();
});

describe('Auth System - User Registration', () => {
  describe('POST /api/v1/auth/register - Email Registration', () => {
    test('should register new user with email successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(testUsers.regularUser)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('tokens');

      // Verify user data
      const { user } = response.body.data;
      expect(user.email).toBe(testUsers.regularUser.email.toLowerCase());
      expect(user.name).toBe(testUsers.regularUser.name);
      expect(user.role).toBe('user');
      expect(user).not.toHaveProperty('password_hash'); // Security: no password in response

      // Verify tokens
      const { tokens } = response.body.data;
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(typeof tokens.accessToken).toBe('string');
      expect(tokens.accessToken.length).toBeGreaterThan(20);
    });

    test('should register partner user with correct role', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(testUsers.partner)
        .expect(201);

      expect(response.body.data.user.role).toBe('partner');
      expect(response.body.data.user.email).toBe(testUsers.partner.email.toLowerCase());
    });

    test('should normalize email to lowercase', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(edgeCaseUsers.mixedCaseEmail)
        .expect(201);

      expect(response.body.data.user.email).toBe('test@example.com'); // lowercase
    });

    test('should reject duplicate email', async () => {
      // Register first time
      await request(app)
        .post('/api/v1/auth/register')
        .send(testUsers.regularUser)
        .expect(201);

      // Try to register again with same email
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(testUsers.regularUser)
        .expect(409);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('DUPLICATE_EMAIL');
    });

    test('should reject invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(invalidUsers.invalidEmail)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toContainEqual(
        expect.objectContaining({ path: 'email' })
      );
    });

    test('should reject weak password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(invalidUsers.weakPassword)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toContainEqual(
        expect.objectContaining({ path: 'password' })
      );
    });

    test('should reject missing required fields', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@test.com' }) // Missing password, name
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should hash password with Argon2', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send(testUsers.regularUser)
        .expect(201);

      // Verify password is hashed in database
      const user = await getUserByEmail(testUsers.regularUser.email);
      expect(user.password_hash).toBeDefined();
      expect(user.password_hash).not.toBe(testUsers.regularUser.password);
      expect(user.password_hash).toMatch(/^\$argon2id\$/); // Argon2id hash format
    });
  });

  describe('POST /api/v1/auth/register - Phone Registration', () => {
    test('should register user with Belarus phone number', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(testUsers.phoneOnlyUser)
        .expect(201);

      expect(response.body.data.user.phone).toBe(testUsers.phoneOnlyUser.phone);
      expect(response.body.data.user.email).toBeNull();
    });

    test('should accept MTS operator (+37529)', async () => {
      const userData = {
        ...testUsers.phoneOnlyUser,
        phone: '+375291234567'
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.data.user.phone).toBe('+375291234567');
    });

    test('should accept MTC operator (+37533)', async () => {
      const userData = {
        ...testUsers.phoneOnlyUser,
        phone: '+375331234567'
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.data.user.phone).toBe('+375331234567');
    });

    test('should accept Velcom operator (+37544)', async () => {
      const userData = {
        ...testUsers.phoneOnlyUser,
        phone: '+375441234567'
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.data.user.phone).toBe('+375441234567');
    });

    test('should reject non-Belarus phone number (Russia)', async () => {
      const userData = {
        ...testUsers.phoneOnlyUser,
        phone: '+79001234567' // Russian number
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toContainEqual(
        expect.objectContaining({ path: 'phone' })
      );
    });

    test('should reject non-Belarus phone number (USA)', async () => {
      const userData = {
        ...testUsers.phoneOnlyUser,
        phone: '+11234567890' // USA number
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject duplicate phone number', async () => {
      // Register first time
      await request(app)
        .post('/api/v1/auth/register')
        .send(testUsers.phoneOnlyUser)
        .expect(201);

      // Try again with same phone
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(testUsers.phoneOnlyUser)
        .expect(409);

      expect(response.body.error.code).toBe('DUPLICATE_PHONE');
    });

    test('should reject registration without email or phone', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(invalidUsers.noContactMethod)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/register - Edge Cases', () => {
    test('should handle very long name', async () => {
      const userData = {
        ...testUsers.regularUser,
        email: 'longname@test.com',
        name: 'А'.repeat(255)
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.data.user.name).toBe('А'.repeat(255));
    });

    test('should handle name with special characters', async () => {
      const userData = {
        ...testUsers.regularUser,
        email: 'special@test.com',
        name: "Мария-Анна О'Брайен-Иванова"
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.data.user.name).toBe("Мария-Анна О'Брайен-Иванова");
    });

    test('should trim whitespace from fields', async () => {
      const userData = {
        ...testUsers.regularUser,
        email: '  spaces@test.com  ',
        name: '  Spaced Name  ',
        phone: '  +375291234567  '
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.data.user.email).toBe('spaces@test.com');
      expect(response.body.data.user.name).toBe('Spaced Name');
    });
  });
});

describe('Auth System - User Login', () => {
  beforeEach(async () => {
    // Create test user before each login test
    await createTestUser(testUsers.regularUser);
  });

  describe('POST /api/v1/auth/login - Email Login', () => {
    test('should login with valid email and password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUsers.regularUser.email,
          password: testUsers.regularUser.password
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('tokens');

      const { tokens } = response.body.data;
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
    });

    test('should reject invalid password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUsers.regularUser.email,
          password: 'WrongPassword123'
        })
        .expect(401);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('should reject non-existent email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'Test123!@#'
        })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('should be case-insensitive for email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUsers.regularUser.email.toUpperCase(),
          password: testUsers.regularUser.password
        })
        .expect(200);

      expect(response.body.data.user.email).toBe(testUsers.regularUser.email.toLowerCase());
    });
  });

  describe('POST /api/v1/auth/login - Phone Login', () => {
    beforeEach(async () => {
      await createTestUser(testUsers.phoneOnlyUser);
    });

    test('should login with valid phone and password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          phone: testUsers.phoneOnlyUser.phone,
          password: testUsers.phoneOnlyUser.password
        })
        .expect(200);

      expect(response.body.data.user.phone).toBe(testUsers.phoneOnlyUser.phone);
      expect(response.body.data.tokens).toBeDefined();
    });

    test('should reject invalid password for phone login', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          phone: testUsers.phoneOnlyUser.phone,
          password: 'WrongPassword'
        })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('POST /api/v1/auth/login - JWT Tokens', () => {
    test('should generate valid JWT access token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUsers.regularUser.email,
          password: testUsers.regularUser.password
        })
        .expect(200);

      const { accessToken } = response.body.data.tokens;

      // Verify JWT structure
      const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
      expect(decoded.id).toBeDefined();
      expect(decoded.email).toBe(testUsers.regularUser.email.toLowerCase());
      expect(decoded.role).toBe('user');
      expect(decoded.exp).toBeDefined(); // Expiration time
      expect(decoded.iat).toBeDefined(); // Issued at time
    });

    test('access token should expire in 15 minutes', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUsers.regularUser.email,
          password: testUsers.regularUser.password
        })
        .expect(200);

      const { accessToken } = response.body.data.tokens;
      const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);

      const expirationTime = decoded.exp - decoded.iat;
      expect(expirationTime).toBe(15 * 60); // 15 minutes in seconds
    });

    test('should generate cryptographically secure refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUsers.regularUser.email,
          password: testUsers.regularUser.password
        })
        .expect(200);

      const { refreshToken } = response.body.data.tokens;

      expect(refreshToken).toBeDefined();
      expect(typeof refreshToken).toBe('string');
      expect(refreshToken.length).toBeGreaterThanOrEqual(32); // At least 32 bytes hex
    });
  });
});

// TODO: More test suites to add:
// - Token Refresh with Rotation
// - Logout (Token Invalidation)
// - Rate Limiting
// - Authentication Middleware
// - Authorization (Role-based)
// - Concurrent Login Scenarios
// - Security Edge Cases

describe('Auth System - Token Refresh', () => {
  test.todo('should refresh access token with valid refresh token');
  test.todo('should rotate refresh token (old token invalidated)');
  test.todo('should reject expired refresh token');
  test.todo('should reject used refresh token (replay attack prevention)');
  test.todo('should reject invalid refresh token');
});

describe('Auth System - Logout', () => {
  test.todo('should invalidate refresh token on logout');
  test.todo('should still allow access with valid access token after logout');
  test.todo('should reject refresh token after logout');
});

describe('Auth System - Rate Limiting', () => {
  test.todo('should allow up to 5 failed login attempts');
  test.todo('should rate limit after 5 failed attempts');
  test.todo('should provide Retry-After header when rate limited');
  test.todo('should reset rate limit after timeout');
});

describe('Auth System - Authentication Middleware', () => {
  test.todo('should authenticate valid JWT token');
  test.todo('should reject missing Authorization header');
  test.todo('should reject malformed Authorization header');
  test.todo('should reject expired JWT token');
  test.todo('should reject tampered JWT token');
});

describe('Auth System - Authorization', () => {
  test.todo('should allow user role access to user endpoints');
  test.todo('should allow partner role access to partner endpoints');
  test.todo('should allow admin role access to admin endpoints');
  test.todo('should reject user role accessing partner endpoints');
  test.todo('should reject partner role accessing admin endpoints');
});
