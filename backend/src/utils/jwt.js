import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import dotenv from 'dotenv';
import logger from './logger.js';

// Load environment variables
// In test environment, .env.test is loaded by Jest setup
// In other environments, load .env
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '30d';

/**
 * Validates that JWT_SECRET is properly configured.
 * In production, JWT_SECRET must be at least 32 characters for adequate security.
 * This validation happens at startup to fail fast if misconfigured.
 *
 * In test environment, this validation is more lenient as environment variables
 * are loaded by Jest setup files.
 */
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'test') {
    // In test environment, log warning but allow continuation
    // Jest setup will load .env.test before tests actually run
    console.warn('⚠️  JWT_SECRET not yet loaded (will be loaded by Jest setup)');
  } else {
    // In production/development, this is a fatal error
    logger.error('JWT_SECRET must be at least 32 characters long. Configure in .env file.');
    process.exit(1);
  }
}

/**
 * Generates an access token with short expiration time.
 * Access tokens are used for API authentication and are validated without database access.
 * 
 * Architecture decision: 15 minute expiry balances security and user experience.
 * Short expiry limits the damage window if a token is compromised, while refresh
 * tokens allow seamless session continuation.
 * 
 * @param {Object} payload - User data to encode in token
 * @param {string} payload.userId - User's unique identifier
 * @param {string} payload.email - User's email address
 * @param {string} payload.role - User's role (user, partner, admin)
 * @returns {string} Signed JWT access token
 */
export const generateAccessToken = (payload) => {
  const tokenPayload = {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    type: 'access',
  };

  return jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRY,
    issuer: 'restaurant-guide-belarus',
    audience: 'restaurant-guide-api',
  });
};

/**
 * Generates a cryptographically secure refresh token.
 * 
 * CRITICAL SECURITY: Refresh tokens are single-use with strict rotation.
 * When a refresh token is used, it must be immediately invalidated and replaced.
 * This prevents token reuse attacks where stolen tokens could be used alongside
 * legitimate sessions for extended periods.
 * 
 * Implementation note: This generates the token string only. The calling code
 * must store this in the database with user_id and expiration timestamp.
 * 
 * @returns {string} Cryptographically random 64-character hex string
 */
export const generateRefreshToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Verifies and decodes an access token.
 * 
 * This validation happens without database access for performance. The JWT signature
 * ensures the token hasn't been tampered with, and we trust the embedded claims.
 * 
 * @param {string} token - JWT access token to verify
 * @returns {Object} Decoded token payload with userId, email, role
 * @throws {Error} If token is invalid, expired, or malformed
 */
export const verifyAccessToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'restaurant-guide-belarus',
      audience: 'restaurant-guide-api',
    });

    // Ensure this is an access token, not a refresh token somehow misused
    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    logger.warn('Access token verification failed', { error: error.message });
    throw error;
  }
};

/**
 * Extracts token from Authorization header.
 * Supports the standard "Bearer <token>" format.
 * 
 * @param {string} authHeader - Value of Authorization header
 * @returns {string|null} Token string or null if header is malformed
 */
export const extractTokenFromHeader = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7); // Remove "Bearer " prefix
};

/**
 * Calculates expiration timestamp for refresh tokens.
 * Used when storing refresh tokens in database.
 * 
 * @returns {Date} Expiration date 30 days from now
 */
export const getRefreshTokenExpiry = () => {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);
  return expiry;
};
