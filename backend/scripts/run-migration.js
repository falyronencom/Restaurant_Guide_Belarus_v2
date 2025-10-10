/**
 * Migration Runner Script
 * 
 * Executes SQL migration files against the database.
 * Usage: node scripts/run-migration.js <migration-file>
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;

// Load environment variables
dotenv.config();

// Get migration file from command line argument
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Usage: node scripts/run-migration.js <migration-file>');
  console.error('Example: node scripts/run-migration.js migrations/001_add_token_rotation_columns.sql');
  process.exit(1);
}

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function runMigration() {
  try {
    // Get current file directory
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const projectRoot = join(__dirname, '..');
    
    // Read migration file
    const migrationPath = join(projectRoot, migrationFile);
    console.log(`Reading migration file: ${migrationPath}`);
    const sql = readFileSync(migrationPath, 'utf8');
    
    // Connect to database
    const client = await pool.connect();
    console.log('Connected to database');
    
    // Execute migration
    console.log('Executing migration...\n');
    console.log(sql);
    console.log('\n---');
    
    await client.query(sql);
    
    console.log('✅ Migration executed successfully!');
    
    // Verify the changes
    const result = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'refresh_tokens' 
      ORDER BY ordinal_position
    `);
    
    console.log('\nCurrent refresh_tokens schema:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    client.release();
    await pool.end();
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runMigration();

