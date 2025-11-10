/**
 * Jest Global Teardown
 *
 * This file runs after all test suites complete.
 * It cleans up resources and closes connections.
 */

import { pool } from '../config/database.js';

/**
 * Global test teardown
 */
export default async function globalTeardown() {
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('\n🧹 Cleaning up test environment...\n');

  try {
    // Close database connection pool
    if (pool) {
      await pool.end();
      console.log('✅ Database connections closed');
    }

    // Note: Redis connections are closed individually in tests
    // Each test creates its own Redis client when needed

    console.log('✅ Test environment cleaned up\n');
  } catch (error) {
    console.error('❌ Error during teardown:', error.message);
  }

  console.log('═'.repeat(60));
  console.log('\n');
}
