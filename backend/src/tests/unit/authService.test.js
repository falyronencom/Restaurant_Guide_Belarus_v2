/**
 * Unit Tests: authService.js
 *
 * Tests authentication business logic in isolation using mocked dependencies.
 * These tests verify:
 * - User registration flow
 * - Credential verification (constant-time)
 * - Token generation and management
 * - Token refresh with strict rotation
 * - Security measures (token reuse detection)
 */

import { jest } from '@jest/globals';

// Mock dependencies BEFORE importing service
jest.unstable_mockModule('../config/database.js', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.unstable_mockModule('argon2', () => ({
  default: {
    hash: jest.fn(),
    verify: jest.fn(),
    argon2id: 0,
  },
}));

jest.unstable_mockModule('../utils/jwt.js', () => ({
  generateAccessToken: jest.fn(),
  generateRefreshToken: jest.fn(),
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Import after mocking
const { pool } = await import('../config/database.js');
const argon2 = (await import('argon2')).default;
const { generateAccessToken, generateRefreshToken } = await import('../utils/jwt.js');
const logger = (await import('../utils/logger.js')).default;

const {
  createUser,
  verifyCredentials,
  generateTokenPair,
  refreshAccessToken,
  invalidateRefreshToken,
  invalidateAllUserTokens,
  findUserById,
} = await import('../../services/authService.js');

import {
  createMockUser,
  createMockRefreshToken,
} from '../mocks/helpers.js';

describe('authService', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    test('should create new user with hashed password', async () => {
      const userData = {
        email: 'newuser@test.com',
        phone: '+375291234567',
        password: 'SecurePassword123!',
        name: 'Test User',
        authMethod: 'email',
      };

      const mockUser = createMockUser({
        email: 'newuser@test.com',
        phone: '+375291234567',
        name: 'Test User',
      });

      // Mock argon2 hash
      argon2.hash.mockResolvedValue('hashed_password_123');

      // Mock database insert
      pool.query.mockResolvedValue({
        rows: [mockUser],
        rowCount: 1,
      });

      const result = await createUser(userData);

      // Verify password was hashed
      expect(argon2.hash).toHaveBeenCalledWith(
        userData.password,
        expect.objectContaining({
          type: argon2.argon2id,
          memoryCost: 16384,
          timeCost: 3,
          parallelism: 1,
        })
      );

      // Verify database insert
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.arrayContaining([
          expect.any(String), // userId (UUID)
          'newuser@test.com',
          '+375291234567',
          'hashed_password_123',
          'Test User',
          'user', // Default role
          'email',
          false, // email_verified
          false, // phone_verified
          true,  // is_active
          expect.any(Date),
          expect.any(Date),
        ])
      );

      expect(result).toEqual(mockUser);
      expect(logger.info).toHaveBeenCalledWith(
        'User created successfully',
        expect.objectContaining({ userId: mockUser.id })
      );
    });

    test('should normalize email to lowercase', async () => {
      const userData = {
        email: 'UPPERCASE@TEST.COM',
        password: 'SecurePassword123!',
        name: 'Test User',
        authMethod: 'email',
      };

      argon2.hash.mockResolvedValue('hashed_password');
      pool.query.mockResolvedValue({
        rows: [createMockUser({ email: 'uppercase@test.com' })],
        rowCount: 1,
      });

      await createUser(userData);

      // Verify email was lowercased in query
      const queryArgs = pool.query.mock.calls[0][1];
      expect(queryArgs[1]).toBe('uppercase@test.com');
    });

    test('should throw EMAIL_ALREADY_EXISTS on duplicate email', async () => {
      const userData = {
        email: 'existing@test.com',
        password: 'Password123!',
        name: 'Test User',
        authMethod: 'email',
      };

      argon2.hash.mockResolvedValue('hashed_password');

      // Mock PostgreSQL unique violation error
      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'users_email_key';
      pool.query.mockRejectedValue(error);

      await expect(createUser(userData)).rejects.toThrow('EMAIL_ALREADY_EXISTS');
      expect(logger.error).toHaveBeenCalled();
    });

    test('should throw PHONE_ALREADY_EXISTS on duplicate phone', async () => {
      const userData = {
        phone: '+375291234567',
        password: 'Password123!',
        name: 'Test User',
        authMethod: 'phone',
      };

      argon2.hash.mockResolvedValue('hashed_password');

      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'users_phone_key';
      pool.query.mockRejectedValue(error);

      await expect(createUser(userData)).rejects.toThrow('PHONE_ALREADY_EXISTS');
    });

    test('should handle database errors gracefully', async () => {
      const userData = {
        email: 'test@test.com',
        password: 'Password123!',
        name: 'Test User',
        authMethod: 'email',
      };

      argon2.hash.mockResolvedValue('hashed_password');
      pool.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(createUser(userData)).rejects.toThrow('Database connection failed');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('verifyCredentials', () => {
    test('should verify valid email and password', async () => {
      const credentials = {
        email: 'user@test.com',
        password: 'CorrectPassword123!',
      };

      const mockUser = createMockUser({
        email: 'user@test.com',
        password_hash: 'hashed_password',
      });

      // Mock user lookup
      pool.query.mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      });

      // Mock password verification (success)
      argon2.verify.mockResolvedValue(true);

      // Mock last login update
      pool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      const result = await verifyCredentials(credentials);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockUser.id);
      expect(result.password_hash).toBeUndefined(); // Should be removed

      // Verify password was checked
      expect(argon2.verify).toHaveBeenCalledWith(
        'hashed_password',
        'CorrectPassword123!'
      );

      // Verify last_login_at was updated
      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE users SET last_login_at'),
        expect.arrayContaining([expect.any(Date), mockUser.id])
      );

      expect(logger.info).toHaveBeenCalledWith(
        'User login successful',
        expect.objectContaining({ userId: mockUser.id })
      );
    });

    test('should verify valid phone and password', async () => {
      const credentials = {
        phone: '+375291234567',
        password: 'CorrectPassword123!',
      };

      const mockUser = createMockUser({
        phone: '+375291234567',
        password_hash: 'hashed_password',
      });

      pool.query.mockResolvedValueOnce({ rows: [mockUser] });
      argon2.verify.mockResolvedValue(true);
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await verifyCredentials(credentials);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockUser.id);
    });

    test('should return null for wrong password (constant-time)', async () => {
      const credentials = {
        email: 'user@test.com',
        password: 'WrongPassword123!',
      };

      const mockUser = createMockUser({
        email: 'user@test.com',
        password_hash: 'hashed_password',
      });

      pool.query.mockResolvedValue({ rows: [mockUser] });
      argon2.verify.mockResolvedValue(false); // Password mismatch

      const result = await verifyCredentials(credentials);

      expect(result).toBeNull();
      expect(argon2.verify).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Login attempt failed',
        expect.objectContaining({ reason: 'invalid_password' })
      );
    });

    test('should return null for non-existent user (constant-time)', async () => {
      const credentials = {
        email: 'nonexistent@test.com',
        password: 'Password123!',
      };

      pool.query.mockResolvedValue({ rows: [] });
      argon2.verify.mockResolvedValue(false); // Dummy verification

      const result = await verifyCredentials(credentials);

      expect(result).toBeNull();

      // CRITICAL: Verify dummy hash was checked (constant-time protection)
      expect(argon2.verify).toHaveBeenCalledWith(
        expect.stringContaining('$argon2id'),
        'Password123!'
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'Login attempt failed',
        expect.objectContaining({ reason: 'user_not_found' })
      );
    });

    test('should normalize email to lowercase for lookup', async () => {
      const credentials = {
        email: 'UPPERCASE@TEST.COM',
        password: 'Password123!',
      };

      pool.query.mockResolvedValue({ rows: [] });
      argon2.verify.mockResolvedValue(false);

      await verifyCredentials(credentials);

      const queryArgs = pool.query.mock.calls[0][1];
      expect(queryArgs[0]).toBe('uppercase@test.com');
    });
  });

  describe('generateTokenPair', () => {
    test('should generate access and refresh tokens', async () => {
      const user = createMockUser({
        id: 'user-123',
        email: 'user@test.com',
        role: 'user',
      });

      generateAccessToken.mockReturnValue('access_token_abc');
      generateRefreshToken.mockReturnValue('refresh_token_xyz');

      pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await generateTokenPair(user);

      expect(result).toEqual({
        accessToken: 'access_token_abc',
        refreshToken: 'refresh_token_xyz',
        expiresIn: 900,
      });

      // Verify access token was generated with user data
      expect(generateAccessToken).toHaveBeenCalledWith({
        userId: user.id,
        role: user.role,
        email: user.email,
      });

      // Verify refresh token was stored in database
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO refresh_tokens'),
        expect.arrayContaining([
          expect.any(String), // tokenId (UUID)
          user.id,
          'refresh_token_xyz',
          expect.any(Date), // expires_at (30 days)
          expect.any(Date), // created_at
          null, // used_at
        ])
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Token pair generated',
        expect.objectContaining({ userId: user.id })
      );
    });

    test('should handle database errors when storing token', async () => {
      const user = createMockUser();

      generateAccessToken.mockReturnValue('access_token');
      generateRefreshToken.mockReturnValue('refresh_token');
      pool.query.mockRejectedValue(new Error('Database error'));

      await expect(generateTokenPair(user)).rejects.toThrow('Database error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('refreshAccessToken', () => {
    test('should refresh token successfully with valid refresh token', async () => {
      const refreshToken = 'valid_refresh_token';
      const mockUser = createMockUser({
        id: 'user-123',
        email: 'user@test.com',
        role: 'user',
      });

      const mockTokenData = {
        id: 'token-123',
        user_id: mockUser.id,
        token: refreshToken,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        used_at: null,
        ...mockUser,
        is_active: true,
      };

      // Mock token lookup
      pool.query.mockResolvedValueOnce({
        rows: [mockTokenData],
        rowCount: 1,
      });

      // Mock marking token as used
      pool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      // Mock new token insertion
      pool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      generateAccessToken.mockReturnValue('new_access_token');
      generateRefreshToken.mockReturnValue('new_refresh_token');

      const result = await refreshAccessToken(refreshToken);

      expect(result.accessToken).toBe('new_access_token');
      expect(result.refreshToken).toBe('new_refresh_token');
      expect(result.user).toBeDefined();
      expect(result.user.id).toBe(mockUser.id);

      // Verify old token was marked as used
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens SET used_at'),
        expect.arrayContaining([expect.any(Date), 'token-123'])
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Access token refreshed successfully',
        expect.objectContaining({ userId: mockUser.id })
      );
    });

    test('should throw INVALID_REFRESH_TOKEN if token not found', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(refreshAccessToken('invalid_token')).rejects.toThrow(
        'INVALID_REFRESH_TOKEN'
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'Refresh token not found',
        expect.any(Object)
      );
    });

    test('should throw REFRESH_TOKEN_EXPIRED if token expired', async () => {
      const expiredTokenData = {
        id: 'token-123',
        user_id: 'user-123',
        expires_at: new Date(Date.now() - 1000), // Expired 1 second ago
        used_at: null,
        is_active: true,
      };

      pool.query.mockResolvedValue({
        rows: [expiredTokenData],
        rowCount: 1,
      });

      await expect(refreshAccessToken('expired_token')).rejects.toThrow(
        'REFRESH_TOKEN_EXPIRED'
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'Expired refresh token used',
        expect.objectContaining({ userId: 'user-123' })
      );
    });

    test('should detect token reuse and invalidate all user tokens (SECURITY)', async () => {
      const reusedTokenData = {
        id: 'token-123',
        user_id: 'user-123',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        used_at: new Date(Date.now() - 60000), // Used 1 minute ago
        is_active: true,
      };

      // Mock token lookup
      pool.query.mockResolvedValueOnce({
        rows: [reusedTokenData],
        rowCount: 1,
      });

      // Mock invalidating all tokens
      pool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 3, // 3 tokens invalidated
      });

      await expect(refreshAccessToken('reused_token')).rejects.toThrow(
        'REFRESH_TOKEN_REUSE_DETECTED'
      );

      // Verify security alert logged
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('SECURITY ALERT'),
        expect.objectContaining({ userId: 'user-123' })
      );

      // Verify all user tokens were invalidated
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens SET used_at'),
        expect.arrayContaining([expect.any(Date), 'user-123'])
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'All refresh tokens invalidated for user',
        expect.objectContaining({ userId: 'user-123', tokenCount: 3 })
      );
    });

    test('should throw USER_ACCOUNT_INACTIVE if account disabled', async () => {
      const inactiveUserData = {
        id: 'token-123',
        user_id: 'user-123',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        used_at: null,
        is_active: false, // Account disabled
      };

      pool.query.mockResolvedValue({
        rows: [inactiveUserData],
        rowCount: 1,
      });

      await expect(refreshAccessToken('token')).rejects.toThrow(
        'USER_ACCOUNT_INACTIVE'
      );
    });
  });

  describe('invalidateRefreshToken', () => {
    test('should invalidate refresh token successfully', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await invalidateRefreshToken('token_to_invalidate');

      expect(result).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens SET used_at'),
        expect.arrayContaining([expect.any(Date), 'token_to_invalidate'])
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Refresh token invalidated',
        expect.any(Object)
      );
    });

    test('should return false if token already invalidated', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await invalidateRefreshToken('already_used_token');

      expect(result).toBe(false);
    });
  });

  describe('invalidateAllUserTokens', () => {
    test('should invalidate all user tokens', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 5 });

      const result = await invalidateAllUserTokens('user-123');

      expect(result).toBe(5);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens SET used_at'),
        expect.arrayContaining([expect.any(Date), 'user-123'])
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'All refresh tokens invalidated for user',
        expect.objectContaining({ userId: 'user-123', tokenCount: 5 })
      );
    });

    test('should return 0 if no tokens to invalidate', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await invalidateAllUserTokens('user-123');

      expect(result).toBe(0);
    });
  });

  describe('findUserById', () => {
    test('should find user by ID', async () => {
      const mockUser = createMockUser({ id: 'user-123' });

      pool.query.mockResolvedValue({
        rows: [mockUser],
        rowCount: 1,
      });

      const result = await findUserById('user-123');

      expect(result).toEqual(mockUser);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, email, phone'),
        ['user-123']
      );
    });

    test('should return null if user not found', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await findUserById('nonexistent-user');

      expect(result).toBeNull();
    });

    test('should only return active users', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await findUserById('inactive-user');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('is_active = true'),
        expect.any(Array)
      );
    });
  });
});
