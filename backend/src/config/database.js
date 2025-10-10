import pg from 'pg';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const { Pool } = pg;

/**
 * PostgreSQL connection pool configuration.
 * 
 * Connection pooling is critical for performance under load. Creating a new
 * database connection for each request is expensive (100-200ms overhead).
 * A pool maintains persistent connections that are reused across requests.
 * 
 * Configuration rationale:
 * - min: 2 connections kept alive even during idle periods for instant availability
 * - max: 10 connections for development (production should use 20-50 based on server capacity)
 * - idleTimeoutMillis: 10 seconds - close idle connections to free resources
 * - connectionTimeoutMillis: 3 seconds - fail fast if database is unreachable
 * 
 * These defaults work well for development. Production deployments should tune based
 * on actual load patterns and database server capacity.
 */
const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  min: parseInt(process.env.DB_MIN_CONNECTIONS || '2', 10),
  max: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '10000', 10),
  connectionTimeoutMillis: 3000,
  // Enable SSL in production for encrypted connections
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
};

/**
 * Global connection pool instance.
 * This is the primary interface for executing database queries throughout the application.
 */
const pool = new Pool(poolConfig);

/**
 * Pool error handler for connection-level errors.
 * These are errors that occur outside of query execution, such as network failures
 * or database server crashes. Logging these helps diagnose infrastructure issues.
 */
pool.on('error', (err, client) => {
  logger.error('Unexpected error on idle database client', {
    error: err.message,
    stack: err.stack,
  });
});

/**
 * Pool connection event for monitoring.
 * Useful in development to verify that connection pooling is working correctly.
 */
pool.on('connect', () => {
  logger.debug('New database connection established in pool');
});

/**
 * Test database connectivity at startup.
 * This provides immediate feedback if database configuration is incorrect,
 * rather than failing on the first request. Fail-fast principle.
 * 
 * @returns {Promise<boolean>} True if connection successful
 */
export const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
    client.release();

    logger.info('Database connection successful', {
      timestamp: result.rows[0].current_time,
      version: result.rows[0].pg_version,
    });

    return true;
  } catch (error) {
    logger.error('Database connection failed', {
      error: error.message,
      host: poolConfig.host,
      database: poolConfig.database,
    });
    return false;
  }
};

/**
 * Gracefully close all database connections.
 * Called during application shutdown to ensure clean termination.
 * 
 * @returns {Promise<void>}
 */
export const closePool = async () => {
  try {
    await pool.end();
    logger.info('Database connection pool closed gracefully');
  } catch (error) {
    logger.error('Error closing database pool', { error: error.message });
  }
};

/**
 * Execute a parameterized query.
 * 
 * SECURITY CRITICAL: Always use parameterized queries to prevent SQL injection.
 * Never concatenate user input directly into SQL strings.
 * 
 * Correct:   await query('SELECT * FROM users WHERE email = $1', [userEmail])
 * Incorrect: await query(`SELECT * FROM users WHERE email = '${userEmail}'`)
 * 
 * @param {string} text - SQL query with $1, $2, etc. placeholders
 * @param {Array} params - Array of values to bind to placeholders
 * @returns {Promise<Object>} Query result with rows array
 */
export const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    // Log slow queries for performance monitoring (>100ms is concerning)
    if (duration > 100) {
      logger.warn('Slow query detected', {
        duration,
        query: text.substring(0, 100), // Log first 100 chars of query
        rowCount: result.rowCount,
      });
    }

    return result;
  } catch (error) {
    logger.error('Database query error', {
      error: error.message,
      query: text.substring(0, 100),
    });
    throw error;
  }
};

/**
 * Get a client from the pool for transaction management.
 * Use this when you need to execute multiple queries as an atomic unit.
 * 
 * Example usage:
 * ```
 * const client = await getClient();
 * try {
 *   await client.query('BEGIN');
 *   await client.query('UPDATE users SET ...');
 *   await client.query('INSERT INTO audit_log ...');
 *   await client.query('COMMIT');
 * } catch (error) {
 *   await client.query('ROLLBACK');
 *   throw error;
 * } finally {
 *   client.release();
 * }
 * ```
 * 
 * @returns {Promise<PoolClient>} Database client from pool
 */
export const getClient = async () => {
  return await pool.connect();
};

// Export pool as both named and default export for flexibility
export { pool };
export default pool;
