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
import { resolveRefreshReuseGraceSeconds } from '../config/auth.js';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt.js';
import logger from '../utils/logger.js';
import { randomUUID, randomBytes, createHash } from 'crypto';
import {
  createCode as createVerificationCode,
  findActiveCodeForUser,
  countRecentSends,
  invalidateActiveCodesForUser,
  incrementAttempts,
  markAsUsed,
} from '../models/emailVerificationModel.js';
import {
  createToken as createResetToken,
  findValidByTokenHash as findValidResetToken,
  countRecentRequests as countRecentResetRequests,
  invalidateActiveTokensForUser as invalidateActiveResetTokens,
  markAsUsed as markResetTokenUsed,
} from '../models/passwordResetModel.js';
import { sendVerificationCodeEmail, sendPasswordResetEmail } from './emailService.js';

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
  parallelism: 1,
};

/**
 * Access token lifetime reported to clients, in seconds.
 *
 * Mirrors JWT_ACCESS_EXPIRY ('4h' by default, utils/jwt.js) — the JWT carries
 * its own exp, this number only tells the client when to come back. Shared by
 * the two paths that mint an access token (generateTokenPair and a replay
 * inside the reuse grace window) so they cannot drift apart.
 */
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 14400;

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
      new Date(),
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
             avatar_url, is_active, last_login_at, created_at
      FROM users
      WHERE (email = $1 OR phone = $2) AND is_active = true
    `;
    
    const values = [
      email ? email.toLowerCase().trim() : null,
      phone ? phone.trim() : null,
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
          [new Date(), user.id],
        );
        
        // Remove password_hash from returned object for security
        delete user.password_hash;
        
        logger.info('User login successful', { 
          userId: user.id,
          authMethod: user.auth_method, 
        });
        
        return user;
      }
    } else {
      // User not found, but still perform dummy hash verification
      // to maintain constant response time
      await argon2.verify(
        '$argon2id$v=19$m=16384,t=3,p=1$dummysaltdummysalt$dummyhashdummyhashdummyhashdummy',
        password,
      );
    }
    
    // Log failed login attempt for security monitoring
    logger.warn('Login attempt failed', { 
      email: email || 'not_provided',
      phone: phone || 'not_provided',
      reason: result.rows.length === 0 ? 'user_not_found' : 'invalid_password',
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
 * Access tokens are short-lived (4 hours, JWT_ACCESS_EXPIRY) JWT tokens that authenticate API requests.
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
      email: user.email || null,
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
      null, // used_at starts as null, set when token is used for refresh
    ];
    
    await pool.query(query, values);
    
    logger.info('Token pair generated', { 
      userId: user.id,
      tokenId, 
    });
    
    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
      // Row id of the refresh token just inserted. refreshAccessToken writes
      // it into the predecessor's replaced_by so a replay inside the grace
      // window can find this successor (config/auth.js). Callers that only
      // hand the pair to a client (login, verify, OAuth) ignore it.
      refreshTokenId: tokenId,
    };

  } catch (error) {
    logger.error('Failed to generate token pair', {
      userId: user.id,
      error: error.message, 
    });
    throw error;
  }
}

/**
 * Refreshes an access token using a valid refresh token
 *
 * This function implements STRICT TOKEN ROTATION for security:
 * 1. Validates that the refresh token exists and hasn't been used
 * 2. Claims the token atomically, recording its successor in replaced_by
 * 3. Generates a new token pair
 * 4. If an already-used token is presented, this indicates a security breach
 *    and ALL tokens for the user are invalidated — unless the replay lands
 *    inside the reuse grace window, where the same successor is handed back
 *    instead (handleReusedToken below; config/auth.js explains the window)
 *
 * @param {string} refreshToken - The refresh token to exchange
 * @returns {Promise<Object>} New token pair with user info
 * @throws {Error} If token is invalid, expired, or already used
 */
export async function refreshAccessToken(refreshToken) {
  try {
    // Look up the refresh token in database
    const query = `
      SELECT rt.id, rt.user_id, rt.token, rt.expires_at, rt.used_at, rt.replaced_by,
             u.id as user_id, u.email, u.phone, u.name, u.role, u.is_active
      FROM refresh_tokens rt
      JOIN users u ON rt.user_id = u.id
      WHERE rt.token = $1
    `;

    const result = await pool.query(query, [refreshToken]);

    if (result.rows.length === 0) {
      logger.warn('Refresh token not found', { token: `${refreshToken.substring(0, 10)  }...` });
      throw new Error('INVALID_REFRESH_TOKEN');
    }

    const tokenData = result.rows[0];

    // Check if token has expired
    if (new Date(tokenData.expires_at) < new Date()) {
      logger.warn('Expired refresh token used', {
        userId: tokenData.user_id,
        tokenId: tokenData.id,
      });
      throw new Error('REFRESH_TOKEN_EXPIRED');
    }

    // CRITICAL SECURITY CHECK: Detect token reuse
    // If used_at is not null, this token was already used for refresh. That is
    // either a stolen token racing the legitimate one, or the legitimate client
    // replaying a rotation whose answer it never received — handleReusedToken
    // separates the two by the grace window.
    if (tokenData.used_at !== null) {
      return await handleReusedToken(tokenData);
    }

    // Check if user account is still active
    if (!tokenData.is_active) {
      throw new Error('USER_ACCOUNT_INACTIVE');
    }

    // Generate new token pair for the user
    const user = {
      id: tokenData.user_id,
      email: tokenData.email,
      phone: tokenData.phone,
      name: tokenData.name,
      role: tokenData.role,
    };

    // The successor is created BEFORE the predecessor is claimed, so that one
    // statement can both burn the old row and name its replacement. The
    // reverse order would leave a window where used_at is set and replaced_by
    // is still null: a replay arriving in that window would find no successor
    // to hand back and would revoke every session the user has.
    const tokens = await generateTokenPair(user);

    // Atomic claim. `AND used_at IS NULL` is what makes two simultaneous
    // refreshes of the same token produce exactly one chain — the loser gets
    // rowCount 0 and takes the replay path instead of forking the chain.
    // used_at is written by NOW() rather than a JS Date because the column is
    // `timestamp without time zone` and the grace window is measured in SQL:
    // mixing the two clocks shifts the comparison by the process offset and
    // fails silently.
    const claim = await pool.query(
      `UPDATE refresh_tokens SET used_at = NOW(), replaced_by = $1
       WHERE id = $2 AND used_at IS NULL
       RETURNING id`,
      [tokens.refreshTokenId, tokenData.id],
    );

    if (claim.rowCount === 0) {
      // Lost the race: a concurrent request claimed this token first. Drop the
      // successor nobody will ever be handed, re-read the row — it now carries
      // the winner's used_at and replaced_by — and answer it like any other
      // replay, so the loser gets the winner's successor instead of a 403.
      await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [tokens.refreshTokenId]);

      const reread = await pool.query(query, [refreshToken]);

      if (reread.rows.length === 0) {
        throw new Error('INVALID_REFRESH_TOKEN');
      }

      // concurrentClaim: this request held a token the database called unused
      // one round trip ago, so it is racing, not replaying something stale.
      // Before the atomic claim both racers simply rotated and both got 200;
      // answering one of them with "all your sessions are revoked" would be a
      // regression introduced by the claim, and it must not depend on whether
      // the grace window happens to be switched on.
      return await handleReusedToken(reread.rows[0], { concurrentClaim: true });
    }

    logger.info('Access token refreshed successfully', {
      userId: user.id,
      oldTokenId: tokenData.id,
    });

    // Built field by field rather than spread: generateTokenPair also returns
    // the new row id, which is bookkeeping for the claim above and must not
    // reach a client. This shape is also exactly what the replay path returns.
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user,
    };

  } catch (error) {
    logger.error('Failed to refresh access token', { error: error.message });
    throw error;
  }
}

/**
 * Decides what an already-used refresh token means.
 *
 * Strict rotation has a single verdict for a replay — theft — and pays for it
 * with false alarms: when a rotation's answer is lost, the legitimate client
 * is left holding a token the database has already burned, and its next
 * attempt costs the user every session they have (config/auth.js).
 *
 * Inside the grace window the replay is answered with THE SAME successor the
 * first call produced: a new access token, the successor's own refresh token
 * string, no new row. The chain never branches, so the protection that makes
 * a second presentation detectable at all is preserved. Outside the window,
 * or when there is nothing to hand back, the original verdict stands.
 *
 * There is nothing to hand back when replaced_by is null — a token burned by
 * logout, or one rotated before this column was ever written. Reading the
 * column already in hand keeps those paths, and a disabled window, free of
 * any extra query.
 *
 * @param {Object} tokenData - Refresh-token row joined with its user
 * @param {Object} [options]
 * @param {boolean} [options.concurrentClaim=false] - Set by the caller that
 *   lost the atomic claim. Such a caller read the token as unused a round trip
 *   ago, so the row's age carries no information about it and the window's
 *   time bound is skipped — every other check still applies.
 * @returns {Promise<Object>} Same shape as a normal refresh, when forgiven
 * @throws {Error} REFRESH_TOKEN_REUSE_DETECTED otherwise
 */
async function handleReusedToken(tokenData, { concurrentClaim = false } = {}) {
  const { seconds: graceSeconds } = resolveRefreshReuseGraceSeconds(process.env);

  // An inactive account is never handed a fresh access token: it falls through
  // to the verdict below, exactly as it does today — the reuse check has
  // always run before the is_active check.
  if ((graceSeconds > 0 || concurrentClaim) && tokenData.replaced_by && tokenData.is_active) {
    // The window is compared entirely in SQL against the same clock that wrote
    // used_at. Both columns are `timestamp without time zone`, so a JS Date on
    // either side of this comparison would silently carry the process offset.
    //
    // BETWEEN, not a bare lower bound: used_at is still written by a JS Date on
    // the logout and revoke paths, and a JS Date reaches a naive column in the
    // process's local time — under TZ=Europe/Minsk that is three hours in the
    // future, which a one-sided `>=` would accept forever. Those rows carry no
    // successor today, so the gate above already excludes them; the upper bound
    // is what keeps that true if anything ever writes replaced_by elsewhere.
    //
    // The $3 escape is for the caller that lost the atomic claim. That caller
    // read this token as unused moments ago, so its replay is a concurrent
    // race rather than a stale presentation, and the age of the row says
    // nothing about it. Without the escape a disabled window would answer a
    // benign double refresh with "your account is under attack".
    const replay = await pool.query(
      `SELECT successor.id, successor.token, successor.used_at, successor.expires_at,
              EXTRACT(EPOCH FROM (NOW() - burned.used_at)) AS replay_age_seconds
       FROM refresh_tokens burned
       JOIN refresh_tokens successor
         ON successor.id = burned.replaced_by
        AND successor.user_id = burned.user_id
       WHERE burned.id = $1
         AND ($3 OR burned.used_at BETWEEN NOW() - make_interval(secs => $2) AND NOW())`,
      [tokenData.id, graceSeconds, concurrentClaim],
    );

    const successor = replay.rows[0];

    // The successor must still be the live end of the chain. Once it has been
    // used, the client demonstrably received it, and a replay of its
    // predecessor is no longer explained by a lost answer.
    if (successor
      && successor.used_at === null
      && new Date(successor.expires_at) > new Date()) {
      const user = {
        id: tokenData.user_id,
        email: tokenData.email,
        phone: tokenData.phone,
        name: tokenData.name,
        role: tokenData.role,
      };

      const accessToken = generateAccessToken({
        userId: user.id,
        role: user.role,
        email: user.email || null,
      });

      // info, not warn: this is the network behaving as networks do, not an
      // incident. The event name is what a log search greps for; the token
      // strings themselves never appear.
      logger.info('Refresh token replayed within grace window', {
        event: 'refresh_token_replayed_within_grace',
        userId: tokenData.user_id,
        tokenId: tokenData.id,
        successorTokenId: successor.id,
        // NUMERIC arrives from node-pg as a string.
        ageMs: Math.round(Number(successor.replay_age_seconds) * 1000),
        graceSeconds,
        // Distinguishes a lost answer from two requests racing each other —
        // the same log line otherwise, very different causes.
        concurrentClaim,
      });

      return {
        accessToken,
        refreshToken: successor.token,
        expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
        user,
      };
    }
  }

  logger.error('SECURITY ALERT: Refresh token reuse detected', {
    userId: tokenData.user_id,
    tokenId: tokenData.id,
    originalUseTime: tokenData.used_at,
  });

  // Invalidate ALL refresh tokens for this user as security measure
  await invalidateAllUserTokens(tokenData.user_id);

  throw new Error('REFRESH_TOKEN_REUSE_DETECTED');
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
      [new Date(), refreshToken],
    );
    
    const wasInvalidated = result.rowCount > 0;
    
    if (wasInvalidated) {
      logger.info('Refresh token invalidated', { 
        token: `${refreshToken.substring(0, 10)  }...`, 
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
      [new Date(), userId],
    );
    
    logger.warn('All refresh tokens invalidated for user', { 
      userId,
      tokenCount: result.rowCount, 
    });
    
    return result.rowCount;
    
  } catch (error) {
    logger.error('Failed to invalidate all user tokens', { 
      userId,
      error: error.message, 
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
      SELECT id, email, phone, name, role, auth_method, avatar_url,
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

/**
 * Updates user profile fields (name, avatar_url)
 *
 * @param {string} userId - The ID of the user to update
 * @param {Object} profileData - Fields to update
 * @param {string} [profileData.name] - New display name (max 100 chars)
 * @param {string} [profileData.avatarUrl] - New avatar URL (max 500 chars)
 * @returns {Promise<Object>} Updated user object
 * @throws {Error} If user not found or validation fails
 */
export async function updateUserProfile(userId, profileData) {
  const { name, avatarUrl } = profileData;

  // Build dynamic SET clause for only provided fields
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  if (name !== undefined) {
    if (!name || name.trim().length === 0) {
      throw new Error('NAME_EMPTY');
    }
    if (name.trim().length > 100) {
      throw new Error('NAME_TOO_LONG');
    }
    setClauses.push(`name = $${paramIndex++}`);
    values.push(name.trim());
  }

  if (avatarUrl !== undefined) {
    if (avatarUrl && avatarUrl.length > 500) {
      throw new Error('AVATAR_URL_TOO_LONG');
    }
    setClauses.push(`avatar_url = $${paramIndex++}`);
    values.push(avatarUrl || null);
  }

  // Always update updated_at
  setClauses.push(`updated_at = $${paramIndex++}`);
  values.push(new Date());

  // Add userId as last parameter
  values.push(userId);

  const query = `
    UPDATE users
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex} AND is_active = true
    RETURNING id, email, phone, name, role, auth_method, avatar_url,
              email_verified, phone_verified, created_at
  `;

  const result = await pool.query(query, values);

  if (result.rows.length === 0) {
    throw new Error('USER_NOT_FOUND');
  }

  logger.info('User profile updated', { userId, fields: Object.keys(profileData) });

  return result.rows[0];
}

/**
 * Upgrades a user's role from 'user' to 'partner'
 *
 * This function is called when a regular user creates their first establishment.
 * The upgrade happens automatically as part of the partner registration flow.
 *
 * @param {string} userId - The ID of the user to upgrade
 * @returns {Promise<Object>} Updated user object with new role
 * @throws {Error} If user not found or already a partner/admin
 */
/**
 * Authenticates a user via OAuth provider data.
 *
 * Three scenarios handled:
 * 1. Existing OAuth user (same provider + providerId) → login
 * 2. Email matches existing user + provider email verified → link account
 * 3. No match → create new user (password_hash = NULL)
 *
 * Security: unverified provider emails cannot claim existing accounts.
 *
 * @param {Object} providerData - Normalized data from oauthService
 * @param {string} providerData.providerId - External user ID from provider
 * @param {string} providerData.email - User's email from provider
 * @param {string} providerData.name - Display name from provider
 * @param {string} providerData.avatarUrl - Avatar URL from provider
 * @param {boolean} providerData.emailVerified - Whether provider verified email
 * @param {string} providerData.provider - 'google' or 'yandex'
 * @returns {Promise<Object>} { user, accessToken, refreshToken, expiresIn }
 */
export async function authenticateWithOAuth(providerData) {
  const { providerId, email, name, avatarUrl, emailVerified, provider } = providerData;

  try {
    // 1. Look up existing OAuth user by provider + providerId
    const oauthLookup = await pool.query(
      `SELECT id, email, phone, name, role, auth_method, avatar_url,
              oauth_provider_id, is_active, last_login_at, created_at
       FROM users
       WHERE auth_method = $1 AND oauth_provider_id = $2`,
      [provider, providerId],
    );

    if (oauthLookup.rows.length > 0) {
      const user = oauthLookup.rows[0];

      if (!user.is_active) {
        throw new Error('ACCOUNT_DEACTIVATED');
      }

      // Existing OAuth user — update last_login_at and return
      await pool.query(
        'UPDATE users SET last_login_at = $1 WHERE id = $2',
        [new Date(), user.id],
      );

      logger.info('OAuth login: existing user', { userId: user.id, provider });

      const tokens = await generateTokenPair(user);
      return {
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      };
    }

    // 2. Check if email exists in users table
    const emailLookup = await pool.query(
      `SELECT id, email, phone, name, role, auth_method, avatar_url,
              oauth_provider_id, is_active, last_login_at, created_at
       FROM users
       WHERE email = $1`,
      [email.toLowerCase().trim()],
    );

    if (emailLookup.rows.length > 0) {
      const existingUser = emailLookup.rows[0];

      if (!existingUser.is_active) {
        throw new Error('ACCOUNT_DEACTIVATED');
      }

      // 2a. Email exists + provider email verified → link account
      if (!emailVerified) {
        // 2b. Unverified email cannot claim existing account
        logger.warn('OAuth login: unverified email tried to claim existing account', {
          email,
          provider,
        });
        throw new Error('OAUTH_EMAIL_NOT_VERIFIED');
      }

      // Link: update auth_method, set oauth_provider_id, optionally update avatar
      const updateFields = [provider, providerId, new Date()];
      let avatarClause = '';
      if (!existingUser.avatar_url && avatarUrl) {
        avatarClause = ', avatar_url = $4';
        updateFields.push(avatarUrl);
      }

      const linkResult = await pool.query(
        `UPDATE users
         SET auth_method = $1, oauth_provider_id = $2,
             last_login_at = $3, email_verified = true${avatarClause}
         WHERE id = $${updateFields.length + 1}
         RETURNING id, email, phone, name, role, auth_method, avatar_url,
                   oauth_provider_id, is_active, last_login_at, created_at`,
        [...updateFields, existingUser.id],
      );

      const linkedUser = linkResult.rows[0];
      logger.info('OAuth login: linked existing account', {
        userId: linkedUser.id,
        provider,
        previousAuthMethod: existingUser.auth_method,
      });

      const tokens = await generateTokenPair(linkedUser);
      return {
        user: linkedUser,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      };
    }

    // 3. No match → create new user
    const userId = randomUUID();
    const createResult = await pool.query(
      `INSERT INTO users (
        id, email, password_hash, name, role, auth_method,
        oauth_provider_id, email_verified, phone_verified,
        is_active, avatar_url, last_login_at, created_at, updated_at
      )
      VALUES ($1, $2, NULL, $3, 'user', $4, $5, $6, false, true, $7, $8, $8, $8)
      RETURNING id, email, phone, name, role, auth_method, avatar_url,
                oauth_provider_id, is_active, last_login_at, created_at`,
      [
        userId,
        email.toLowerCase().trim(),
        name,
        provider,
        providerId,
        emailVerified,
        avatarUrl,
        new Date(),
      ],
    );

    const newUser = createResult.rows[0];
    logger.info('OAuth login: new user created', {
      userId: newUser.id,
      provider,
      email,
    });

    const tokens = await generateTokenPair(newUser);
    return {
      user: newUser,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };

  } catch (error) {
    // Re-throw known error codes
    if (['ACCOUNT_DEACTIVATED', 'OAUTH_EMAIL_NOT_VERIFIED'].includes(error.message)) {
      throw error;
    }
    // Handle unique constraint violations (race condition: concurrent OAuth signup)
    if (error.code === '23505') {
      logger.warn('OAuth signup race condition detected', { email, provider });
      throw new Error('OAUTH_ACCOUNT_CONFLICT');
    }
    logger.error('OAuth authentication failed', { error: error.message, provider });
    throw error;
  }
}

export async function upgradeUserToPartner(userId) {
  try {
    // First check current role
    const checkQuery = `
      SELECT id, role FROM users WHERE id = $1 AND is_active = true
    `;
    const checkResult = await pool.query(checkQuery, [userId]);

    if (checkResult.rows.length === 0) {
      throw new Error('USER_NOT_FOUND');
    }

    const currentRole = checkResult.rows[0].role;

    // Only upgrade if currently a 'user' role
    if (currentRole === 'partner' || currentRole === 'admin') {
      logger.debug('User already has elevated role, no upgrade needed', {
        userId,
        currentRole,
      });
      return checkResult.rows[0];
    }

    // Upgrade role to partner
    const updateQuery = `
      UPDATE users
      SET role = 'partner', updated_at = $1
      WHERE id = $2
      RETURNING id, email, phone, name, role, auth_method, created_at
    `;

    const result = await pool.query(updateQuery, [new Date(), userId]);

    logger.info('User upgraded to partner role', {
      userId,
      previousRole: currentRole,
      newRole: 'partner',
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Failed to upgrade user to partner', {
      userId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Generate a cryptographically random 6-digit numeric verification code.
 * Returns string with leading zeros preserved (e.g., "042193").
 */
function generateSixDigitCode() {
  // 4 random bytes interpreted as uint32 mod 10^6 — uniform distribution
  // bias is negligible (2^32 / 10^6 ≈ 4294.97, max bias < 0.0001%)
  const buf = randomBytes(4);
  const num = buf.readUInt32BE(0) % 1000000;
  return String(num).padStart(6, '0');
}

/**
 * Issue (or re-issue) an email verification code for a user.
 *
 * Flow:
 *   1. Validate user exists, is active, has email, not already verified.
 *   2. Enforce rate limit: max 5 sends per hour per user.
 *   3. Invalidate any prior active codes (only latest is valid).
 *   4. Generate fresh 6-digit code with TTL from EMAIL_VERIFICATION_EXPIRY_MINUTES.
 *   5. Persist code in email_verification_codes.
 *   6. Send email via Resend (degrades gracefully if not configured).
 *
 * @param {string} userId
 * @returns {Promise<{sent: boolean, expiresAt: Date}>}
 * @throws {Error} 'USER_NOT_FOUND' | 'EMAIL_ALREADY_VERIFIED' | 'NO_EMAIL' | 'RATE_LIMITED'
 */
export async function sendEmailVerificationCode(userId) {
  const userQuery = `
    SELECT id, email, name, email_verified
    FROM users
    WHERE id = $1 AND is_active = true
  `;
  const userResult = await pool.query(userQuery, [userId]);

  if (userResult.rows.length === 0) {
    throw new Error('USER_NOT_FOUND');
  }

  const user = userResult.rows[0];

  if (user.email_verified) {
    throw new Error('EMAIL_ALREADY_VERIFIED');
  }

  if (!user.email) {
    throw new Error('NO_EMAIL');
  }

  // Rate limit: max 5 sends in last hour
  const recentCount = await countRecentSends(userId, 60);
  if (recentCount >= 5) {
    logger.warn('Email verification send rate-limited', { userId, recentCount });
    throw new Error('RATE_LIMITED');
  }

  // Invalidate prior active codes — only the latest one is valid
  await invalidateActiveCodesForUser(userId);

  const code = generateSixDigitCode();
  const expiryMinutes = parseInt(process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES, 10) || 15;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  await createVerificationCode(userId, code, expiresAt);

  // Send email — failure here does not roll back code creation, user can resend
  const result = await sendVerificationCodeEmail(user.email, code, user.name);

  logger.info('Email verification code issued', {
    userId,
    expiresAt,
    sent: result.sent,
  });

  return { sent: result.sent, expiresAt };
}

/**
 * Verify a 6-digit email verification code submitted by the user.
 *
 * On success: marks code as used, sets users.email_verified=true, returns user.
 * On wrong code: increments attempts; after 5 failed attempts the code is
 * invalidated and TOO_MANY_ATTEMPTS is returned on subsequent calls.
 *
 * @param {string} userId
 * @param {string} code - 6-digit string
 * @returns {Promise<Object>} Updated user record
 * @throws {Error} 'INVALID_OR_EXPIRED_CODE' | 'TOO_MANY_ATTEMPTS' | 'INVALID_CODE' | 'USER_NOT_FOUND'
 */
export async function verifyEmailCode(userId, code) {
  const activeCode = await findActiveCodeForUser(userId);

  if (!activeCode) {
    throw new Error('INVALID_OR_EXPIRED_CODE');
  }

  if (activeCode.attempts >= 5) {
    await markAsUsed(activeCode.id);
    throw new Error('TOO_MANY_ATTEMPTS');
  }

  if (activeCode.code !== code) {
    const newAttempts = await incrementAttempts(activeCode.id);
    if (newAttempts >= 5) {
      await markAsUsed(activeCode.id);
    }
    throw new Error('INVALID_CODE');
  }

  // Code matches — finalize verification
  await markAsUsed(activeCode.id);

  const updateResult = await pool.query(
    `UPDATE users
     SET email_verified = true, updated_at = $1
     WHERE id = $2 AND is_active = true
     RETURNING id, email, phone, name, role, auth_method, avatar_url,
               email_verified, phone_verified, is_active, created_at`,
    [new Date(), userId],
  );

  if (updateResult.rows.length === 0) {
    throw new Error('USER_NOT_FOUND');
  }

  logger.info('Email verified successfully', { userId });

  return updateResult.rows[0];
}

/**
 * SHA-256 hex digest of a reset token. Tokens are stored hashed so a
 * database leak yields nothing usable; the raw token lives only in the
 * emailed link.
 */
function hashResetToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issue a password reset token for the account behind an email address.
 *
 * ENUMERATION-SAFE BY CONTRACT: this function never signals to the caller
 * whether the email exists. Unknown email, throttled user, and successful
 * issue all resolve (no throws for those cases) — the controller returns
 * the same generic 200 regardless. Do not add distinguishing throws here.
 *
 * Flow:
 *   1. Look up active user by email — silently resolve if absent.
 *   2. Per-user issue throttle: max 5 requests per hour (DB count), so an
 *      attacker cycling IPs still cannot bomb a victim's inbox.
 *   3. Invalidate prior active tokens (only the latest emailed link works).
 *   4. Generate 32-byte token, persist SHA-256 hash with TTL from
 *      PASSWORD_RESET_EXPIRY_MINUTES (default 30).
 *   5. Email the raw token as a deep link — FIRE-AND-FORGET (same pattern as
 *      the post-register verification send). Awaiting the Resend round-trip
 *      here would make registered-email responses measurably slower than
 *      unknown-email ones, reopening enumeration through timing.
 *
 * @param {string} email
 * @returns {Promise<void>}
 */
export async function createPasswordResetToken(email) {
  const userResult = await pool.query(
    `SELECT id, email, name
     FROM users
     WHERE email = $1 AND is_active = true`,
    [email.toLowerCase().trim()],
  );

  if (userResult.rows.length === 0) {
    logger.info('Password reset requested for unknown email');
    return;
  }

  const user = userResult.rows[0];

  const recentCount = await countRecentResetRequests(user.id, 60);
  if (recentCount >= 5) {
    logger.warn('Password reset issue throttled (per-user)', {
      userId: user.id,
      recentCount,
    });
    return;
  }

  // Only the latest emailed link is valid
  await invalidateActiveResetTokens(user.id);

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(rawToken);
  const expiryMinutes = parseInt(process.env.PASSWORD_RESET_EXPIRY_MINUTES, 10) || 30;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  await createResetToken(user.id, tokenHash, expiresAt);

  // Fire-and-forget (timing-channel defense, see flow note above). Send
  // failure does not roll back token creation — the user can re-request.
  sendPasswordResetEmail(user.email, rawToken, user.name).catch((err) => {
    logger.error('Failed to send password reset email', {
      userId: user.id,
      error: err.message,
    });
  });

  logger.info('Password reset token issued', {
    userId: user.id,
    expiresAt,
  });
}

/**
 * Consume a password reset token: set the new password and revoke all
 * active sessions.
 *
 * Order matters for safety:
 *   1. Claim the token FIRST (atomic UPDATE ... WHERE used_at IS NULL) —
 *      of two concurrent submissions exactly one proceeds, and a failure
 *      later leaves the token burned rather than replayable.
 *   2. Hash the new password with the same Argon2id parameters as register.
 *   3. Revoke every refresh token for the user (invalidateAllUserTokens) —
 *      a password reset must terminate whoever held the old credentials.
 *
 * @param {string} token - Raw token from the emailed link
 * @param {string} newPassword - Already validated against register rules
 * @returns {Promise<Object>} { id, email, name } of the updated user
 * @throws {Error} 'INVALID_OR_EXPIRED_TOKEN' | 'USER_NOT_FOUND'
 */
export async function consumePasswordResetToken(token, newPassword) {
  const tokenHash = hashResetToken(token);
  const resetToken = await findValidResetToken(tokenHash);

  if (!resetToken) {
    throw new Error('INVALID_OR_EXPIRED_TOKEN');
  }

  const claimed = await markResetTokenUsed(resetToken.id);
  if (!claimed) {
    // Lost a concurrent race for the same token
    throw new Error('INVALID_OR_EXPIRED_TOKEN');
  }

  const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);

  const updateResult = await pool.query(
    `UPDATE users
     SET password_hash = $1, updated_at = $2
     WHERE id = $3 AND is_active = true
     RETURNING id, email, name`,
    [passwordHash, new Date(), resetToken.user_id],
  );

  if (updateResult.rows.length === 0) {
    throw new Error('USER_NOT_FOUND');
  }

  // Force re-login everywhere: the reset link came from email ownership,
  // any session created with the old password is no longer trustworthy
  await invalidateAllUserTokens(resetToken.user_id);

  logger.info('Password reset completed', { userId: resetToken.user_id });

  return updateResult.rows[0];
}

