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
    new Date(),
    new Date()
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
    id: user.id,
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
    id: user.id,
    email: user.email,
    phone: user.phone,
    role: user.role
  });
}

/**
 * Store refresh token in database (or Redis in production)
 * For tests, we'll use a simple database table
 *
 * @param {string} userId - User ID
 * @param {string} refreshToken - Refresh token
 */
export async function storeRefreshToken(userId, refreshToken) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

  const query = `
    INSERT INTO refresh_tokens (user_id, token, expires_at, created_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id) DO UPDATE
    SET token = $2, expires_at = $3, created_at = $4
  `;

  await pool.query(query, [userId, refreshToken, expiresAt, new Date()]);
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

export default {
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
  createStandardTestUsers
};
