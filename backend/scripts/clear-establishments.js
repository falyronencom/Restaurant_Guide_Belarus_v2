/**
 * Clear Establishments Script
 * 
 * Utility script to remove all establishments from the database.
 * Useful for cleaning up test data or resetting the database state.
 * 
 * Usage: npm run clear-data
 * or: node scripts/clear-establishments.js
 * 
 * Safety: Prompts for confirmation before deleting unless --force flag used
 */

import pkg from 'pg';
import readline from 'readline';
import dotenv from 'dotenv';

const { Pool } = pkg;

// Load environment variables
dotenv.config();

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

/**
 * Prompt user for confirmation
 * Returns a promise that resolves to true if user confirms, false otherwise
 */
function promptConfirmation(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Get current establishment count
 */
async function getEstablishmentCount() {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM establishments');
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('❌ Error getting count:', error.message);
    return 0;
  }
}

/**
 * Clear all establishments from database
 */
async function clearEstablishments() {
  try {
    const result = await pool.query('DELETE FROM establishments');
    return result.rowCount;
  } catch (error) {
    console.error('❌ Error clearing establishments:', error.message);
    throw error;
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('   🗑️  Clear Establishments - Database Cleanup');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');

    // Get current count
    const currentCount = await getEstablishmentCount();
    console.log(`📊 Current establishments in database: ${currentCount}\n`);

    if (currentCount === 0) {
      console.log('ℹ️  Database is already empty. Nothing to clear.');
      await pool.end();
      return;
    }

    // Check for --force flag
    const forceMode = process.argv.includes('--force') || process.argv.includes('-f');

    if (!forceMode) {
      // Prompt for confirmation
      const confirmed = await promptConfirmation(
        `⚠️  This will DELETE all ${currentCount} establishments. Are you sure?`
      );

      if (!confirmed) {
        console.log('\n❌ Operation cancelled by user.');
        await pool.end();
        return;
      }
    }

    console.log('\n🗑️  Clearing establishments...');

    // Perform deletion
    const deletedCount = await clearEstablishments();

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`✅ Successfully deleted ${deletedCount} establishments`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('\n✨ Database is now empty and ready for new data.\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}

export { clearEstablishments };

