import argon2 from 'argon2';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres_dev_password',
});

async function createTestPartner() {
  try {
    console.log('Creating test partner account...');
    
    // Generate password hash
    const password = 'test123';
    const passwordHash = await argon2.hash(password);
    console.log(`Password hash generated: ${passwordHash.substring(0, 30)}...`);
    
    // Delete existing test partner if exists
    await pool.query('DELETE FROM users WHERE email = $1', ['partner@test.com']);
    
    // Create new test partner
    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash, name, role, auth_method, email_verified, created_at, updated_at) 
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW()) 
       RETURNING id, email, role`,
      ['partner@test.com', passwordHash, 'Test Partner', 'partner', 'email', true]
    );
    
    console.log('✅ Test partner created successfully!');
    console.log(`   Email: ${result.rows[0].email}`);
    console.log(`   Role: ${result.rows[0].role}`);
    console.log(`   Password: ${password}`);
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating test partner:', error.message);
    await pool.end();
    process.exit(1);
  }
}

createTestPartner();

