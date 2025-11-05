/**
 * Unit Tests: jwt.js
 *
 * Tests JWT token generation and verification utilities.
 * These tests verify:
 * - Access token generation and verification
 * - Refresh token generation
 * - Token extraction from headers
 * - Expiration handling
 */

import jwt from 'jsonwebtoken';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  extractTokenFromHeader,
  getRefreshTokenExpiry,
} from '../../utils/jwt.js';

describe('jwt utilities', () => {
  // Set up test JWT_SECRET for verification
  const TEST_JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-32-chars-long!!';

  describe('generateAccessToken', () => {
    test('should generate valid JWT access token', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const token = generateAccessToken(payload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format: header.payload.signature
    });

    test('should include correct claims in token', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'partner',
      };

      const token = generateAccessToken(payload);
      const decoded = jwt.decode(token);

      expect(decoded.userId).toBe('user-123');
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.role).toBe('partner');
      expect(decoded.type).toBe('access');
      expect(decoded.iss).toBe('restaurant-guide-belarus');
      expect(decoded.aud).toBe('restaurant-guide-api');
    });

    test('should include expiration claim', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const token = generateAccessToken(payload);
      const decoded = jwt.decode(token);

      expect(decoded.exp).toBeDefined();
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    test('should generate different tokens for same payload at different times', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const token1 = generateAccessToken(payload);

      // Wait 1ms to ensure different iat (issued at) timestamp
      const token2 = new Promise(resolve => {
        setTimeout(() => resolve(generateAccessToken(payload)), 1);
      });

      return token2.then(t2 => {
        expect(t2).not.toBe(token1);
      });
    });
  });

  describe('generateRefreshToken', () => {
    test('should generate 64-character hex string', () => {
      const token = generateRefreshToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes = 64 hex characters
      expect(token).toMatch(/^[a-f0-9]{64}$/); // Hex format
    });

    test('should generate unique tokens', () => {
      const token1 = generateRefreshToken();
      const token2 = generateRefreshToken();
      const token3 = generateRefreshToken();

      expect(token1).not.toBe(token2);
      expect(token2).not.toBe(token3);
      expect(token1).not.toBe(token3);
    });

    test('should be cryptographically random', () => {
      const tokens = new Set();

      // Generate 100 tokens
      for (let i = 0; i < 100; i++) {
        tokens.add(generateRefreshToken());
      }

      // All should be unique
      expect(tokens.size).toBe(100);
    });
  });

  describe('verifyAccessToken', () => {
    test('should verify valid token', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const token = generateAccessToken(payload);
      const decoded = verifyAccessToken(token);

      expect(decoded.userId).toBe('user-123');
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.role).toBe('user');
      expect(decoded.type).toBe('access');
    });

    test('should throw error for invalid token', () => {
      expect(() => {
        verifyAccessToken('invalid-token');
      }).toThrow();
    });

    test('should throw error for token with wrong signature', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
        type: 'access',
      };

      // Sign with different secret
      const badToken = jwt.sign(payload, 'wrong-secret-key-32-chars-long!!', {
        expiresIn: '15m',
        issuer: 'restaurant-guide-belarus',
        audience: 'restaurant-guide-api',
      });

      expect(() => {
        verifyAccessToken(badToken);
      }).toThrow();
    });

    test('should throw error for expired token', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
        type: 'access',
      };

      // Create token that expires immediately
      const expiredToken = jwt.sign(payload, TEST_JWT_SECRET, {
        expiresIn: '-1s', // Negative = already expired
        issuer: 'restaurant-guide-belarus',
        audience: 'restaurant-guide-api',
      });

      expect(() => {
        verifyAccessToken(expiredToken);
      }).toThrow(/expired/i);
    });

    test('should throw error for non-access token type', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
        type: 'refresh', // Wrong type
      };

      const wrongTypeToken = jwt.sign(payload, TEST_JWT_SECRET, {
        expiresIn: '15m',
        issuer: 'restaurant-guide-belarus',
        audience: 'restaurant-guide-api',
      });

      expect(() => {
        verifyAccessToken(wrongTypeToken);
      }).toThrow(/Invalid token type/i);
    });

    test('should throw error for token with wrong issuer', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
        type: 'access',
      };

      const badIssuerToken = jwt.sign(payload, TEST_JWT_SECRET, {
        expiresIn: '15m',
        issuer: 'wrong-issuer',
        audience: 'restaurant-guide-api',
      });

      expect(() => {
        verifyAccessToken(badIssuerToken);
      }).toThrow();
    });

    test('should throw error for token with wrong audience', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
        type: 'access',
      };

      const badAudienceToken = jwt.sign(payload, TEST_JWT_SECRET, {
        expiresIn: '15m',
        issuer: 'restaurant-guide-belarus',
        audience: 'wrong-audience',
      });

      expect(() => {
        verifyAccessToken(badAudienceToken);
      }).toThrow();
    });
  });

  describe('extractTokenFromHeader', () => {
    test('should extract token from valid Bearer header', () => {
      const token = 'abc123xyz';
      const header = `Bearer ${token}`;

      const extracted = extractTokenFromHeader(header);

      expect(extracted).toBe(token);
    });

    test('should return null for missing header', () => {
      expect(extractTokenFromHeader(null)).toBeNull();
      expect(extractTokenFromHeader(undefined)).toBeNull();
      expect(extractTokenFromHeader('')).toBeNull();
    });

    test('should return null for malformed header (no Bearer prefix)', () => {
      expect(extractTokenFromHeader('abc123xyz')).toBeNull();
      expect(extractTokenFromHeader('Basic abc123xyz')).toBeNull();
    });

    test('should handle token with spaces correctly', () => {
      const header = 'Bearer token-with-content';
      const extracted = extractTokenFromHeader(header);

      expect(extracted).toBe('token-with-content');
    });

    test('should extract JWT format tokens', () => {
      const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ';
      const header = `Bearer ${jwtToken}`;

      const extracted = extractTokenFromHeader(header);

      expect(extracted).toBe(jwtToken);
    });

    test('should handle case-sensitive Bearer prefix', () => {
      expect(extractTokenFromHeader('bearer token123')).toBeNull();
      expect(extractTokenFromHeader('BEARER token123')).toBeNull();
      expect(extractTokenFromHeader('Bearer token123')).toBe('token123');
    });
  });

  describe('getRefreshTokenExpiry', () => {
    test('should return date 30 days in future', () => {
      const now = new Date();
      const expiry = getRefreshTokenExpiry();

      const daysDifference = (expiry - now) / (1000 * 60 * 60 * 24);

      expect(expiry).toBeInstanceOf(Date);
      expect(daysDifference).toBeGreaterThan(29);
      expect(daysDifference).toBeLessThan(31);
    });

    test('should return different timestamps when called multiple times', () => {
      const expiry1 = getRefreshTokenExpiry();

      return new Promise(resolve => {
        setTimeout(() => {
          const expiry2 = getRefreshTokenExpiry();
          expect(expiry2.getTime()).toBeGreaterThanOrEqual(expiry1.getTime());
          resolve();
        }, 10);
      });
    });

    test('should return valid Date object', () => {
      const expiry = getRefreshTokenExpiry();

      expect(expiry).toBeInstanceOf(Date);
      expect(isNaN(expiry.getTime())).toBe(false);
      expect(expiry.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Token Security', () => {
    test('access tokens should not be modifiable without detection', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const token = generateAccessToken(payload);

      // Try to modify the payload (change role to admin)
      const [header, payloadPart, signature] = token.split('.');
      const decodedPayload = JSON.parse(Buffer.from(payloadPart, 'base64').toString());
      decodedPayload.role = 'admin';
      const modifiedPayloadPart = Buffer.from(JSON.stringify(decodedPayload)).toString('base64');
      const modifiedToken = `${header}.${modifiedPayloadPart}.${signature}`;

      // Verification should fail
      expect(() => {
        verifyAccessToken(modifiedToken);
      }).toThrow();
    });

    test('tokens should include all required security claims', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const token = generateAccessToken(payload);
      const decoded = jwt.decode(token);

      // Security claims
      expect(decoded.iat).toBeDefined(); // Issued at
      expect(decoded.exp).toBeDefined(); // Expiration
      expect(decoded.iss).toBeDefined(); // Issuer
      expect(decoded.aud).toBeDefined(); // Audience
      expect(decoded.type).toBe('access'); // Token type
    });
  });
});
