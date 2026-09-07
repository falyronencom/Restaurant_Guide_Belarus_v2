/* eslint comma-dangle: 0 */
/* eslint quote-props: 0 */
/**
 * Authentication Test Helpers
 *
 * Utilities for creating test users, generating tokens,
 * and managing authentication in tests.
 */

import { pool } from '../../config/database.js';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt.js';
import argon2 from 'argon2';
import { randomUUID } from 'crypto';

/**
 * UTC wall clock for a `timestamp without time zone` column.
 * UTC-стенка для колонки `timestamp without time zone`.
 *
 * Every time column in the schema is naive and holds UTC: production writes
 * `NOW()` on a UTC database, and `analyticsService.startOfUtcDay` builds every
 * window and bucket on that contract. A JS `Date` bound directly breaks it:
 * node-pg serialises a Date as LOCAL time with an offset
 * (`2026-09-07T00:57:00.000+03:00`), Postgres drops the offset when casting to
 * a naive timestamp, and the row keeps the process wall clock — Minsk time on
 * the gate (`TZ=Europe/Minsk`). Between 00:00 and 03:00 Minsk such a row
 * carries tomorrow's UTC date and falls off the timeline axis: admin-analytics
 * «timeline carries the users it counted», gate run 34062250741.
 *
 * `toISOString()` renders the UTC fields; the trailing `Z` is ignored by the
 * same naive cast, leaving exactly UTC. This is a full instant, so
 * `toISOString()` is right here — the ban on it concerns date-only strings
 * built from local calendar components (bookingService tests).
 *
 * Guarded by tests/integration/fixtures-naive-utc.test.js.
 *
 * @param {Date} [date=new Date()] - Instant to store
 * @returns {string} ISO-8601 UTC string for a naive timestamp parameter
 */
export function utcTimestamp(date = new Date()) {
  return date.toISOString();
}

/**
 * Argon2 options (matching production settings)
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 16384,
  timeCost: 3,
  parallelism: 1
};

/**
 * Create a test user in the database
 *
 * @param {Object} userData - User data
 * @returns {Promise<Object>} Created user object with tokens
 */
export async function createTestUser(userData) {
  const {
    email,
    phone,
    password,
    name,
    role = 'user',
    authMethod = 'email'
  } = userData;

  // Hash password
  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

  // Generate user ID
  const userId = randomUUID();

  // Insert user
  const query = `
    INSERT INTO users (
      id, email, phone, password_hash, name, role, auth_method,
      email_verified, phone_verified, is_active, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id, email, phone, name, role, auth_method, created_at
  `;

  // `created_at` comes back through node-pg's local parse of a naive value, as
  // every read does; compare it in SQL, never against `Date.now()`.
  const values = [
    userId,
    email ? email.toLowerCase().trim() : null,
    phone ? phone.trim() : null,
    passwordHash,
    name.trim(),
    role,
    authMethod,
    false,
    false,
    true,
    utcTimestamp(),
    utcTimestamp()
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Create a test user and generate JWT tokens
 *
 * @param {Object} userData - User data
 * @returns {Promise<Object>} { user, accessToken, refreshToken }
 */
export async function createUserAndGetTokens(userData) {
  const user = await createTestUser(userData);

  // Generate tokens
  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    phone: user.phone,
    role: user.role
  });

  const refreshToken = generateRefreshToken();

  // Store refresh token in database
  await storeRefreshToken(user.id, refreshToken);

  return {
    user,
    accessToken,
    refreshToken
  };
}

/**
 * Generate a test access token for a user
 *
 * @param {Object} user - User object with id, email, phone, role
 * @returns {string} JWT access token
 */
export function generateTestAccessToken(user) {
  return generateAccessToken({
    userId: user.id,
    email: user.email,
    phone: user.phone,
    role: user.role
  });
}

/**
 * Store refresh token in database (or Redis in production)
 * For tests, we'll use a simple database table
 *
 * NOTE: Test helper uses simplified logic - deletes old tokens before inserting new one
 * Production code allows multiple active tokens per user for token rotation
 *
 * @param {string} userId - User ID
 * @param {string} refreshToken - Refresh token
 */
export async function storeRefreshToken(userId, refreshToken) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

  // For tests, keep only one token per user (simplifies test logic)
  // Delete any existing tokens for this user first
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);

  // Insert new token (matching production schema with used_at column from migration 001)
  const query = `
    INSERT INTO refresh_tokens (user_id, token, expires_at, created_at, used_at)
    VALUES ($1, $2, $3, $4, $5)
  `;

  await pool.query(query, [
    userId, refreshToken, utcTimestamp(expiresAt), utcTimestamp(), null
  ]);
}

/**
 * Create multiple test users at once
 *
 * @param {Array<Object>} usersData - Array of user data objects
 * @returns {Promise<Array<Object>>} Array of created users with tokens
 */
export async function createMultipleUsers(usersData) {
  const users = [];

  for (const userData of usersData) {
    const userWithTokens = await createUserAndGetTokens(userData);
    users.push(userWithTokens);
  }

  return users;
}

/**
 * Get user by email
 *
 * @param {string} email - User email
 * @returns {Promise<Object|null>} User object or null
 */
export async function getUserByEmail(email) {
  const query = 'SELECT * FROM users WHERE email = $1';
  const result = await pool.query(query, [email.toLowerCase()]);
  return result.rows[0] || null;
}

/**
 * Get user by phone
 *
 * @param {string} phone - User phone
 * @returns {Promise<Object|null>} User object or null
 */
export async function getUserByPhone(phone) {
  const query = 'SELECT * FROM users WHERE phone = $1';
  const result = await pool.query(query, [phone]);
  return result.rows[0] || null;
}

/**
 * Get user by ID
 *
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User object or null
 */
export async function getUserById(userId) {
  const query = 'SELECT * FROM users WHERE id = $1';
  const result = await pool.query(query, [userId]);
  return result.rows[0] || null;
}

/**
 * Delete test user (for cleanup)
 *
 * @param {string} userId - User ID
 */
export async function deleteTestUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

/**
 * Invalidate all tokens for a user (logout)
 *
 * @param {string} userId - User ID
 */
export async function invalidateUserTokens(userId) {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}

/**
 * Verify password matches hash
 *
 * @param {string} password - Plain password
 * @param {string} hash - Argon2 hash
 * @returns {Promise<boolean>} True if password matches
 */
export async function verifyPassword(password, hash) {
  return await argon2.verify(hash, password);
}

/**
 * Create authentication header for API requests
 *
 * @param {string} token - JWT access token
 * @returns {Object} Headers object with Authorization
 */
export function createAuthHeader(token) {
  return {
    'Authorization': `Bearer ${token}`
  };
}

/**
 * Create a standard set of test users (regular, partner, admin)
 *
 * @returns {Promise<Object>} { regular, partner, admin } with tokens
 */
export async function createStandardTestUsers() {
  const regular = await createUserAndGetTokens({
    email: 'test-user@test.com',
    phone: '+375291111111',
    password: 'Test123!@#',
    name: 'Test User',
    role: 'user'
  });

  const partner = await createUserAndGetTokens({
    email: 'test-partner@test.com',
    phone: '+375292222222',
    password: 'Partner123!@#',
    name: 'Test Partner',
    role: 'partner'
  });

  const admin = await createUserAndGetTokens({
    email: 'test-admin@test.com',
    phone: '+375293333333',
    password: 'Admin123!@#',
    name: 'Test Admin',
    role: 'admin'
  });

  return { regular, partner, admin };
}

/**
 * Create a partner user and get token (alias for media tests)
 * 
 * @returns {Promise<Object>} { partner, token }
 */
export async function createPartnerAndGetToken() {
  const partner = await createUserAndGetTokens({
    email: `partner-${Date.now()}@test.com`,
    phone: `+37529${Math.floor(1000000 + Math.random() * 9000000)}`,
    password: 'Partner123!@#',
    name: 'Test Partner',
    role: 'partner'
  });

  return {
    partner: partner.user,
    token: partner.accessToken
  };
}

/**
 * Create a test establishment
 * 
 * @param {string} partnerId - Partner user ID
 * @returns {Promise<Object>} Created establishment
 */
export async function createTestEstablishment(partnerId) {
  const establishmentId = randomUUID();
  const slug = `test-${establishmentId.slice(0, 8)}`;

  const query = `
    INSERT INTO establishments (
      id, partner_id, name, slug, description, city, address,
      latitude, longitude, categories, cuisines, price_range,
      working_hours, status, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *
  `;

  const workingHours = JSON.stringify({
    monday: { open: '10:00', close: '22:00' },
    tuesday: { open: '10:00', close: '22:00' },
    wednesday: { open: '10:00', close: '22:00' },
    thursday: { open: '10:00', close: '22:00' },
    friday: { open: '10:00', close: '23:00' },
    saturday: { open: '11:00', close: '23:00' },
    sunday: { open: '11:00', close: '22:00' }
  });

  const values = [
    establishmentId,
    partnerId,
    'Test Restaurant',
    slug,
    'Test Description',
    'Минск',
    'Test Address',
    53.9,
    27.5,
    ['Ресторан'],
    ['Европейская'],
    '$$',
    workingHours,
    'active',
    utcTimestamp(),
    utcTimestamp()
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

export default {
  utcTimestamp,
  createTestUser,
  createUserAndGetTokens,
  generateTestAccessToken,
  storeRefreshToken,
  createMultipleUsers,
  getUserByEmail,
  getUserByPhone,
  getUserById,
  deleteTestUser,
  invalidateUserTokens,
  verifyPassword,
  createAuthHeader,
  createStandardTestUsers,
  createPartnerAndGetToken,
  createTestEstablishment
};
