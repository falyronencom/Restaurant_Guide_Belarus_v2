/**
 * Authentication Service
 * 
 * This service encapsulates all business logic for user authentication operations.
 * It handles user creation, credential verification, token generation, and token
 * lifecycle management. By separating business logic from HTTP concerns, we make
 * the code testable and maintainable.
 * 
 * Security considerations:
 * - Passwords are hashed using Argon2id with specific parameters for GPU resistance
 * - Constant-time operations prevent timing attacks
 * - Refresh tokens use strict rotation to prevent reuse attacks
 * - All database operations use parameterized queries for SQL injection protection
 */

import argon2 from 'argon2';
import { pool } from '../config/database.js';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt.js';
import logger from '../utils/logger.js';
import { randomUUID } from 'crypto';

/**
 * Argon2id Parameters
 * 
 * These specific parameters were chosen by the architectural coordinator to balance
 * security against GPU attacks with acceptable performance for user login latency.
 * 
 * memory: 16MB (16 * 1024 = 16384 KB) - Makes GPU attacks expensive
 * time: 3 iterations - Computational cost
 * parallelism: 1 - Single thread (suitable for web server context)
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 16384, // 16MB in KB
  timeCost: 3,
  parallelism: 1
};

/**
 * Creates a new user account
 * 
 * This function handles the complete user registration flow including password
 * hashing, database insertion, and automatic login via token generation.
 * 
 * @param {Object} userData - User registration data
 * @param {string} userData.email - User's email (optional if phone provided)
 * @param {string} userData.phone - User's phone (optional if email provided)
 * @param {string} userData.password - Plain text password to be hashed
 * @param {string} userData.name - User's display name
 * @param {string} userData.authMethod - Authentication method: 'email', 'phone', 'google', 'yandex'
 * @returns {Promise<Object>} Created user object (without password hash)
 * @throws {Error} If database operation fails
 */
export async function createUser(userData) {
  const { email, phone, password, name, authMethod } = userData;
  
  try {
    // Hash the password using Argon2id with our security parameters
    // This operation is intentionally slow (around 50-100ms) to resist brute force
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    
    // Generate a unique ID for the user
    const userId = randomUUID();
    
    // Insert user into database with parameterized query for SQL injection protection
    // All new users start with 'user' role; elevated privileges granted separately
    const query = `
      INSERT INTO users (
        id, email, phone, password_hash, name, role, auth_method, 
        email_verified, phone_verified, is_active, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, email, phone, name, role, auth_method, created_at
    `;
    
    const values = [
      userId,
      email ? email.toLowerCase().trim() : null, // Normalize email for consistency
      phone ? phone.trim() : null,
      passwordHash,
      name.trim(),
      'user', // Default role for new registrations
      authMethod,
      false, // Email verification will be handled in future enhancement
      false, // Phone verification will be handled in future enhancement
      true,  // New accounts are active by default
      new Date(),
      new Date()
    ];
    
    const result = await pool.query(query, values);
    const user = result.rows[0];
    
    logger.info('User created successfully', { 
      userId: user.id, 
      authMethod,
      // Never log sensitive data like passwords or hashes
    });
    
    return user;
    
  } catch (error) {
    // Check if error is due to unique constraint violation (duplicate email/phone)
    if (error.code === '23505') { // PostgreSQL unique violation code
      if (error.constraint === 'users_email_key') {
        throw new Error('EMAIL_ALREADY_EXISTS');
      }
      if (error.constraint === 'users_phone_key') {
        throw new Error('PHONE_ALREADY_EXISTS');
      }
    }
    
    logger.error('Failed to create user', { error: error.message });
    throw error;
  }
}

/**
 * Verifies user credentials and returns user object if valid
 * 
 * This function implements constant-time verification to prevent timing attacks
 * that could reveal whether an email/phone exists in the system. Even when a
 * user doesn't exist, we still perform a hash verification against a dummy hash
 * to maintain consistent response times.
 * 
 * @param {Object} credentials - Login credentials
 * @param {string} credentials.email - User's email (optional if phone provided)
 * @param {string} credentials.phone - User's phone (optional if email provided)
 * @param {string} credentials.password - Plain text password to verify
 * @returns {Promise<Object|null>} User object if credentials valid, null otherwise
 */
export async function verifyCredentials(credentials) {
  const { email, phone, password } = credentials;
  
  try {
    // Find user by email or phone
    // We use a single query that checks both fields for efficiency
    const query = `
      SELECT id, email, phone, password_hash, name, role, auth_method, 
             is_active, last_login_at, created_at
      FROM users
      WHERE (email = $1 OR phone = $2) AND is_active = true
    `;
    
    const values = [
      email ? email.toLowerCase().trim() : null,
      phone ? phone.trim() : null
    ];
    
    const result = await pool.query(query, values);
    
    // Constant-time verification strategy:
    // Always perform hash verification even if user not found
    // This prevents timing attacks from revealing valid emails/phones
    let isValidPassword = false;
    
    if (result.rows.length > 0) {
      const user = result.rows[0];
      
      // Verify password against stored hash
      // argon2.verify is intentionally slow and takes constant time
      isValidPassword = await argon2.verify(user.password_hash, password);
      
      if (isValidPassword) {
        // Update last login timestamp
        await pool.query(
          'UPDATE users SET last_login_at = $1 WHERE id = $2',
          [new Date(), user.id]
        );
        
        // Remove password_hash from returned object for security
        delete user.password_hash;
        
        logger.info('User login successful', { 
          userId: user.id,
          authMethod: user.auth_method 
        });
        
        return user;
      }
    } else {
      // User not found, but still perform dummy hash verification
      // to maintain constant response time
      await argon2.verify(
        '$argon2id$v=19$m=16384,t=3,p=1$dummysaltdummysalt$dummyhashdummyhashdummyhashdummy',
        password
      );
    }
    
    // Log failed login attempt for security monitoring
    logger.warn('Login attempt failed', { 
      email: email || 'not_provided',
      phone: phone || 'not_provided',
      reason: result.rows.length === 0 ? 'user_not_found' : 'invalid_password'
    });
    
    return null;
    
  } catch (error) {
    logger.error('Error verifying credentials', { error: error.message });
    throw error;
  }
}

/**
 * Generates a new pair of access and refresh tokens for a user
 * 
 * Access tokens are short-lived (15 minutes) JWT tokens that authenticate API requests.
 * Refresh tokens are long-lived (30 days) and stored in database for validation.
 * 
 * The token pair allows secure, stateless authentication while maintaining the ability
 * to revoke access by invalidating refresh tokens in the database.
 * 
 * @param {Object} user - User object containing id and role
 * @returns {Promise<Object>} Object containing accessToken and refreshToken
 */
export async function generateTokenPair(user) {
  try {
    // Generate short-lived access token with user identity
    // This token is stateless and validated using JWT signature only
    const accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
      email: user.email || null
    });
    
    // Generate long-lived refresh token
    // This is a random string stored in database for server-side validation
    const refreshToken = generateRefreshToken();
    
    // Store refresh token in database with metadata
    // This allows us to track token usage and implement rotation
    const tokenId = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now
    
    const query = `
      INSERT INTO refresh_tokens (
        id, user_id, token, expires_at, created_at, used_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    
    const values = [
      tokenId,
      user.id,
      refreshToken,
      expiresAt,
      new Date(),
      null // used_at starts as null, set when token is used for refresh
    ];
    
    await pool.query(query, values);
    
    logger.info('Token pair generated', { 
      userId: user.id,
      tokenId 
    });
    
    return {
      accessToken,
      refreshToken,
      expiresIn: 900 // 15 minutes in seconds
    };
    
  } catch (error) {
    logger.error('Failed to generate token pair', { 
      userId: user.id,
      error: error.message 
    });
    throw error;
  }
}

/**
 * Refreshes an access token using a valid refresh token
 * 
 * This function implements STRICT TOKEN ROTATION for security:
 * 1. Validates that the refresh token exists and hasn't been used
 * 2. Marks the old token as used immediately
 * 3. Generates a new token pair
 * 4. If an already-used token is presented, this indicates a security breach
 *    and ALL tokens for the user are invalidated
 * 
 * @param {string} refreshToken - The refresh token to exchange
 * @returns {Promise<Object>} New token pair with user info
 * @throws {Error} If token is invalid, expired, or already used
 */
export async function refreshAccessToken(refreshToken) {
  try {
    // Look up the refresh token in database
    const query = `
      SELECT rt.id, rt.user_id, rt.token, rt.expires_at, rt.used_at,
             u.id as user_id, u.email, u.phone, u.name, u.role, u.is_active
      FROM refresh_tokens rt
      JOIN users u ON rt.user_id = u.id
      WHERE rt.token = $1
    `;
    
    const result = await pool.query(query, [refreshToken]);
    
    if (result.rows.length === 0) {
      logger.warn('Refresh token not found', { token: refreshToken.substring(0, 10) + '...' });
      throw new Error('INVALID_REFRESH_TOKEN');
    }
    
    const tokenData = result.rows[0];
    
    // Check if token has expired
    if (new Date(tokenData.expires_at) < new Date()) {
      logger.warn('Expired refresh token used', { 
        userId: tokenData.user_id,
        tokenId: tokenData.id 
      });
      throw new Error('REFRESH_TOKEN_EXPIRED');
    }
    
    // CRITICAL SECURITY CHECK: Detect token reuse
    // If used_at is not null, this token was already used for refresh
    // This indicates a possible token theft scenario
    if (tokenData.used_at !== null) {
      logger.error('SECURITY ALERT: Refresh token reuse detected', {
        userId: tokenData.user_id,
        tokenId: tokenData.id,
        originalUseTime: tokenData.used_at
      });
      
      // Invalidate ALL refresh tokens for this user as security measure
      await invalidateAllUserTokens(tokenData.user_id);
      
      throw new Error('REFRESH_TOKEN_REUSE_DETECTED');
    }
    
    // Check if user account is still active
    if (!tokenData.is_active) {
      throw new Error('USER_ACCOUNT_INACTIVE');
    }
    
    // Mark the old token as used (atomic operation)
    await pool.query(
      'UPDATE refresh_tokens SET used_at = $1 WHERE id = $2',
      [new Date(), tokenData.id]
    );
    
    // Generate new token pair for the user
    const user = {
      id: tokenData.user_id,
      email: tokenData.email,
      phone: tokenData.phone,
      name: tokenData.name,
      role: tokenData.role
    };
    
    const tokens = await generateTokenPair(user);
    
    logger.info('Access token refreshed successfully', { 
      userId: user.id,
      oldTokenId: tokenData.id 
    });
    
    return {
      ...tokens,
      user
    };
    
  } catch (error) {
    logger.error('Failed to refresh access token', { error: error.message });
    throw error;
  }
}

/**
 * Invalidates a specific refresh token (used for logout)
 * 
 * @param {string} refreshToken - The token to invalidate
 * @returns {Promise<boolean>} True if token was invalidated
 */
export async function invalidateRefreshToken(refreshToken) {
  try {
    // Mark token as used to prevent further refresh operations
    const result = await pool.query(
      'UPDATE refresh_tokens SET used_at = $1 WHERE token = $2 AND used_at IS NULL',
      [new Date(), refreshToken]
    );
    
    const wasInvalidated = result.rowCount > 0;
    
    if (wasInvalidated) {
      logger.info('Refresh token invalidated', { 
        token: refreshToken.substring(0, 10) + '...' 
      });
    }
    
    return wasInvalidated;
    
  } catch (error) {
    logger.error('Failed to invalidate refresh token', { error: error.message });
    throw error;
  }
}

/**
 * Invalidates all refresh tokens for a user (security measure)
 * 
 * This is used when token reuse is detected, indicating a possible
 * security breach. By invalidating all tokens, we force complete
 * re-authentication of the user.
 * 
 * @param {string} userId - The user whose tokens should be invalidated
 * @returns {Promise<number>} Number of tokens invalidated
 */
export async function invalidateAllUserTokens(userId) {
  try {
    const result = await pool.query(
      'UPDATE refresh_tokens SET used_at = $1 WHERE user_id = $2 AND used_at IS NULL',
      [new Date(), userId]
    );
    
    logger.warn('All refresh tokens invalidated for user', { 
      userId,
      tokenCount: result.rowCount 
    });
    
    return result.rowCount;
    
  } catch (error) {
    logger.error('Failed to invalidate all user tokens', { 
      userId,
      error: error.message 
    });
    throw error;
  }
}

/**
 * Finds user by ID (utility function)
 * 
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User object if found
 */
export async function findUserById(userId) {
  try {
    const query = `
      SELECT id, email, phone, name, role, auth_method, 
             email_verified, phone_verified, is_active, created_at
      FROM users
      WHERE id = $1 AND is_active = true
    `;
    
    const result = await pool.query(query, [userId]);
    
    return result.rows.length > 0 ? result.rows[0] : null;
    
  } catch (error) {
    logger.error('Error finding user by ID', { error: error.message });
    throw error;
  }
}

