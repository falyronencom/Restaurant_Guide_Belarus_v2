/**
 * Jest Global Setup
 *
 * This file runs before all test suites.
 * It sets up the test environment, loads test configuration,
 * and prepares the database.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from '../config/database.js';
import { createClient } from 'redis';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Global test setup
 */
export default async function globalSetup() {
  console.log('\n🚀 Setting up test environment...\n');

  // Load test environment variables
  const testEnvPath = join(__dirname, '../../.env.test');
  dotenv.config({ path: testEnvPath });

  // Verify we're in test environment
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Tests must run in NODE_ENV=test environment!');
  }

  // Verify test database name
  if (!process.env.DB_NAME || !process.env.DB_NAME.includes('test')) {
    throw new Error('Test database name must contain "test"! Current: ' + process.env.DB_NAME);
  }

  console.log('✅ Environment: test');
  console.log('✅ Database:', process.env.DB_NAME);
  console.log('✅ Redis DB:', process.env.REDIS_DB);

  // Check database connection
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', result.rows[0].now);
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw new Error('Cannot connect to test database. Make sure PostgreSQL is running and test database exists.');
  }

  // Check if tables exist
  try {
    const tablesQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `;
    const result = await pool.query(tablesQuery);
    const tableNames = result.rows.map(row => row.table_name);

    console.log('✅ Database tables found:', tableNames.length);

    const requiredTables = ['users', 'establishments', 'reviews', 'favorites'];
    const missingTables = requiredTables.filter(table => !tableNames.includes(table));

    if (missingTables.length > 0) {
      console.warn('⚠️  Missing tables:', missingTables.join(', '));
      console.warn('   Run migrations to create test database schema');
    }
  } catch (error) {
    console.error('❌ Error checking database tables:', error.message);
  }

  // Check Redis connection
  try {
    const redisClient = createClient({
      socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
      },
      database: parseInt(process.env.REDIS_DB || '1')
    });

    await redisClient.connect();
    await redisClient.ping();
    console.log('✅ Redis connected: DB', process.env.REDIS_DB);
    await redisClient.quit();
  } catch (error) {
    console.warn('⚠️  Redis connection failed:', error.message);
    console.warn('   Some tests may fail without Redis');
  }

  // Clear any existing test data
  try {
    console.log('\n🧹 Clearing existing test data...');

    await pool.query('SET session_replication_role = replica;');
    await pool.query('TRUNCATE TABLE establishment_media CASCADE');
    await pool.query('TRUNCATE TABLE favorites CASCADE');
    await pool.query('TRUNCATE TABLE reviews CASCADE');
    await pool.query('TRUNCATE TABLE establishments CASCADE');
    await pool.query('TRUNCATE TABLE refresh_tokens CASCADE');
    await pool.query('TRUNCATE TABLE users CASCADE');
    await pool.query('SET session_replication_role = DEFAULT;');

    console.log('✅ Test data cleared');
  } catch (error) {
    console.error('❌ Error clearing test data:', error.message);
    // Non-fatal, continue with tests
  }

  console.log('\n✅ Test environment ready!\n');
  console.log('═'.repeat(60));
  console.log('\n');
}

/**
 * Setup runs before each test file
 * (This is called by setupFilesAfterEnv in jest.config.js)
 */
beforeAll(async () => {
  // Silence logs during tests (unless debugging)
  if (process.env.LOG_LEVEL !== 'debug') {
    logger.transports.forEach(transport => {
      transport.silent = true;
    });
  }
});

/**
 * Cleanup after each test file
 */
afterAll(async () => {
  // Small delay to let async operations complete
  await new Promise(resolve => setTimeout(resolve, 100));
});
