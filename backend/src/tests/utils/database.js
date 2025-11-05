/**
 * Database Test Helpers
 *
 * Utilities for managing test database state:
 * - Clearing data between tests
 * - Seeding test data
 * - Transaction management
 */

import { pool } from '../../config/database.js';
import logger from '../../utils/logger.js';

/**
 * Clear all test data from database
 * Uses TRUNCATE CASCADE to remove all related data
 *
 * WARNING: This deletes ALL data. Only use in test environment!
 */
export async function clearAllData() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('clearAllData can only be called in test environment!');
  }

  try {
    // Disable triggers temporarily for faster truncation
    await pool.query('SET session_replication_role = replica;');

    // Truncate all tables in correct order (respecting foreign keys)
    await pool.query('TRUNCATE TABLE establishment_media CASCADE');
    await pool.query('TRUNCATE TABLE favorites CASCADE');
    await pool.query('TRUNCATE TABLE reviews CASCADE');
    await pool.query('TRUNCATE TABLE establishments CASCADE');
    await pool.query('TRUNCATE TABLE refresh_tokens CASCADE');
    await pool.query('TRUNCATE TABLE users CASCADE');

    // Re-enable triggers
    await pool.query('SET session_replication_role = DEFAULT;');

    logger.debug('All test data cleared');
  } catch (error) {
    logger.error('Error clearing test data:', error);
    throw error;
  }
}

/**
 * Clear users table only
 */
export async function clearUsers() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('clearUsers can only be called in test environment!');
  }
  await pool.query('TRUNCATE TABLE users CASCADE');
}

/**
 * Clear establishments table only
 */
export async function clearEstablishments() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('clearEstablishments can only be called in test environment!');
  }
  await pool.query('TRUNCATE TABLE establishments CASCADE');
}

/**
 * Clear reviews table only
 */
export async function clearReviews() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('clearReviews can only be called in test environment!');
  }
  await pool.query('TRUNCATE TABLE reviews CASCADE');
}

/**
 * Clear favorites table only
 */
export async function clearFavorites() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('clearFavorites can only be called in test environment!');
  }
  await pool.query('TRUNCATE TABLE favorites CASCADE');
}

/**
 * Clear media table only
 */
export async function clearMedia() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('clearMedia can only be called in test environment!');
  }
  await pool.query('TRUNCATE TABLE establishment_media CASCADE');
}

/**
 * Get database connection from pool
 * Useful for manual queries in tests
 *
 * @returns {Promise<Object>} Database client
 */
export async function getClient() {
  return await pool.query('SELECT NOW()');
}

/**
 * Execute raw SQL query (for test setup/assertions)
 *
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
export async function query(query, params = []) {
  return await pool.query(query, params);
}

/**
 * Count records in a table
 *
 * @param {string} tableName - Table name
 * @param {string} whereClause - Optional WHERE clause
 * @param {Array} params - Parameters for WHERE clause
 * @returns {Promise<number>} Record count
 */
export async function countRecords(tableName, whereClause = '', params = []) {
  const query = `SELECT COUNT(*) FROM ${tableName} ${whereClause}`;
  const result = await pool.query(query, params);
  return parseInt(result.rows[0].count);
}

/**
 * Check if record exists
 *
 * @param {string} tableName - Table name
 * @param {string} idColumn - ID column name
 * @param {string} idValue - ID value
 * @returns {Promise<boolean>} True if exists
 */
export async function recordExists(tableName, idColumn, idValue) {
  const result = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM ${tableName} WHERE ${idColumn} = $1)`,
    [idValue]
  );
  return result.rows[0].exists;
}

/**
 * Get all records from a table
 *
 * @param {string} tableName - Table name
 * @param {string} whereClause - Optional WHERE clause
 * @param {Array} params - Parameters for WHERE clause
 * @returns {Promise<Array>} Array of records
 */
export async function getAllRecords(tableName, whereClause = '', params = []) {
  const query = `SELECT * FROM ${tableName} ${whereClause}`;
  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Seed minimal test data
 * Creates a basic user, partner, and establishment for tests that need existing data
 *
 * @returns {Promise<Object>} { user, partner, establishment }
 */
export async function seedMinimalData() {
  const { createUserAndGetTokens } = await import('./auth.js');

  // Create test user
  const user = await createUserAndGetTokens({
    email: 'seed-user@test.com',
    phone: '+375297777777',
    password: 'Test123!@#',
    name: 'Seed User',
    role: 'user'
  });

  // Create test partner
  const partner = await createUserAndGetTokens({
    email: 'seed-partner@test.com',
    phone: '+375298888888',
    password: 'Partner123!@#',
    name: 'Seed Partner',
    role: 'partner'
  });

  // Create test establishment
  const establishmentQuery = `
    INSERT INTO establishments (
      id, partner_id, name, description, city, address, latitude, longitude,
      categories, cuisines, price_range, status, created_at, updated_at
    )
    VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
    )
    RETURNING *
  `;

  const establishmentValues = [
    partner.user.id,
    'Тестовый Ресторан',
    'Описание тестового ресторана',
    'Минск',
    'ул. Тестовая 1',
    53.9,
    27.5,
    ['Ресторан'],
    ['Европейская'],
    '$$',
    'active'
  ];

  const establishmentResult = await pool.query(establishmentQuery, establishmentValues);
  const establishment = establishmentResult.rows[0];

  return { user, partner, establishment };
}

/**
 * Check database connection
 *
 * @returns {Promise<boolean>} True if connected
 */
export async function checkConnection() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    logger.error('Database connection check failed:', error);
    return false;
  }
}

/**
 * Get database statistics
 *
 * @returns {Promise<Object>} Database statistics
 */
export async function getDatabaseStats() {
  const users = await countRecords('users');
  const establishments = await countRecords('establishments');
  const reviews = await countRecords('reviews');
  const favorites = await countRecords('favorites');
  const media = await countRecords('establishment_media');

  return {
    users,
    establishments,
    reviews,
    favorites,
    media,
    total: users + establishments + reviews + favorites + media
  };
}

/**
 * Reset database sequences (for predictable IDs in tests)
 */
export async function resetSequences() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetSequences can only be called in test environment!');
  }

  // Note: This project uses UUIDs, not sequences, so this is a no-op
  // Keeping for compatibility if sequences are added later
  logger.debug('Sequences reset (no-op for UUID-based tables)');
}

/**
 * Begin transaction (for tests that need rollback)
 *
 * @returns {Promise<Object>} Database client with transaction
 */
export async function beginTransaction() {
  const client = await pool.connect();
  await client.query('BEGIN');
  return client;
}

/**
 * Commit transaction
 *
 * @param {Object} client - Database client
 */
export async function commitTransaction(client) {
  await client.query('COMMIT');
  client.release();
}

/**
 * Rollback transaction
 *
 * @param {Object} client - Database client
 */
export async function rollbackTransaction(client) {
  await client.query('ROLLBACK');
  client.release();
}

export default {
  clearAllData,
  clearUsers,
  clearEstablishments,
  clearReviews,
  clearFavorites,
  clearMedia,
  getClient,
  query,
  countRecords,
  recordExists,
  getAllRecords,
  seedMinimalData,
  checkConnection,
  getDatabaseStats,
  resetSequences,
  beginTransaction,
  commitTransaction,
  rollbackTransaction
};
