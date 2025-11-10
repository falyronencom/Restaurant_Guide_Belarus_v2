/**
 * Count Establishments Script
 * 
 * Utility script to display statistics about establishments in the database.
 * Shows counts by category, cuisine, price range, subscription tier, and more.
 * 
 * Usage: npm run count
 * or: node scripts/count-establishments.js
 * 
 * Optional flags:
 * --detailed : Show more detailed statistics
 */

import pkg from 'pg';
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
 * Get total count of establishments
 */
async function getTotalCount() {
  const result = await pool.query('SELECT COUNT(*) FROM establishments');
  return parseInt(result.rows[0].count);
}

/**
 * Get count by category
 */
async function getCountByCategory() {
  const result = await pool.query(`
    SELECT category, COUNT(*) as count 
    FROM establishments 
    GROUP BY category 
    ORDER BY count DESC
  `);
  return result.rows;
}

/**
 * Get count by subscription tier
 */
async function getCountByTier() {
  const result = await pool.query(`
    SELECT subscription_tier, COUNT(*) as count 
    FROM establishments 
    GROUP BY subscription_tier 
    ORDER BY 
      CASE subscription_tier
        WHEN 'premium' THEN 1
        WHEN 'standard' THEN 2
        WHEN 'basic' THEN 3
        WHEN 'free' THEN 4
      END
  `);
  return result.rows;
}

/**
 * Get count by price range
 */
async function getCountByPrice() {
  const result = await pool.query(`
    SELECT price_range, COUNT(*) as count 
    FROM establishments 
    GROUP BY price_range 
    ORDER BY price_range
  `);
  return result.rows;
}

/**
 * Get rating distribution
 */
async function getRatingDistribution() {
  const result = await pool.query(`
    SELECT 
      CASE 
        WHEN average_rating >= 4.5 THEN '⭐⭐⭐⭐⭐ Excellent (4.5+)'
        WHEN average_rating >= 4.0 THEN '⭐⭐⭐⭐ Very Good (4.0-4.4)'
        WHEN average_rating >= 3.5 THEN '⭐⭐⭐ Good (3.5-3.9)'
        ELSE '⭐⭐ Fair (<3.5)'
      END as rating_range,
      COUNT(*) as count
    FROM establishments
    GROUP BY rating_range
    ORDER BY MIN(average_rating) DESC
  `);
  return result.rows;
}

/**
 * Get establishments with most reviews
 */
async function getTopReviewed(limit = 5) {
  const result = await pool.query(`
    SELECT name, category, review_count, average_rating
    FROM establishments
    ORDER BY review_count DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

/**
 * Get establishments with highest ratings
 */
async function getTopRated(limit = 5) {
  const result = await pool.query(`
    SELECT name, category, average_rating, review_count
    FROM establishments
    WHERE review_count >= 10
    ORDER BY average_rating DESC, review_count DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

/**
 * Get count of establishments with specific features
 */
async function getFeatureStats() {
  const result = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE features @> '["wifi"]') as has_wifi,
      COUNT(*) FILTER (WHERE features @> '["delivery"]') as has_delivery,
      COUNT(*) FILTER (WHERE features @> '["parking"]') as has_parking,
      COUNT(*) FILTER (WHERE features @> '["terrace"]') as has_terrace,
      COUNT(*) FILTER (WHERE features @> '["kids_zone"]') as has_kids_zone,
      COUNT(*) FILTER (WHERE features @> '["pet_friendly"]') as has_pet_friendly,
      COUNT(*) FILTER (WHERE is_24_hours = true) as is_24_hours
    FROM establishments
  `);
  return result.rows[0];
}

/**
 * Get geographic distribution
 */
async function getGeographicStats() {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total,
      AVG(ST_Y(location::geometry)) as avg_latitude,
      AVG(ST_X(location::geometry)) as avg_longitude,
      MIN(ST_Y(location::geometry)) as min_latitude,
      MAX(ST_Y(location::geometry)) as max_latitude,
      MIN(ST_X(location::geometry)) as min_longitude,
      MAX(ST_X(location::geometry)) as max_longitude
    FROM establishments
  `);
  return result.rows[0];
}

/**
 * Main execution function
 */
async function main() {
  const detailedMode = process.argv.includes('--detailed') || process.argv.includes('-d');

  console.log('═══════════════════════════════════════════════════════');
  console.log('   📊 Establishment Statistics');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    // Test database connection
    await pool.query('SELECT 1');

    // Get total count
    const totalCount = await getTotalCount();
    console.log(`📈 Total Establishments: ${totalCount}\n`);

    if (totalCount === 0) {
      console.log('ℹ️  Database is empty. Run "npm run seed" to add test data.\n');
      await pool.end();
      return;
    }

    // Category distribution
    console.log('📂 By Category:');
    const categoryStats = await getCountByCategory();
    categoryStats.forEach(row => {
      const percentage = ((row.count / totalCount) * 100).toFixed(1);
      console.log(`   ${row.category.padEnd(20)} : ${row.count.toString().padStart(3)} (${percentage}%)`);
    });

    // Subscription tier distribution
    console.log('\n💎 By Subscription Tier:');
    const tierStats = await getCountByTier();
    tierStats.forEach(row => {
      const percentage = ((row.count / totalCount) * 100).toFixed(1);
      const emoji = {
        premium: '👑',
        standard: '⭐',
        basic: '✨',
        free: '📌'
      }[row.subscription_tier] || '•';
      console.log(`   ${emoji} ${row.subscription_tier.padEnd(15)} : ${row.count.toString().padStart(3)} (${percentage}%)`);
    });

    // Price range distribution
    console.log('\n💰 By Price Range:');
    const priceStats = await getCountByPrice();
    priceStats.forEach(row => {
      const percentage = ((row.count / totalCount) * 100).toFixed(1);
      console.log(`   ${row.price_range.padEnd(20)} : ${row.count.toString().padStart(3)} (${percentage}%)`);
    });

    // Rating distribution
    console.log('\n⭐ Rating Distribution:');
    const ratingStats = await getRatingDistribution();
    ratingStats.forEach(row => {
      const percentage = ((row.count / totalCount) * 100).toFixed(1);
      console.log(`   ${row.rating_range.padEnd(35)} : ${row.count.toString().padStart(3)} (${percentage}%)`);
    });

    if (detailedMode) {
      // Top reviewed establishments
      console.log('\n📝 Top 5 Most Reviewed:');
      const topReviewed = await getTopReviewed(5);
      topReviewed.forEach((row, index) => {
        console.log(`   ${index + 1}. ${row.name} (${row.category})`);
        console.log(`      ${row.review_count} reviews | ⭐ ${row.average_rating}`);
      });

      // Top rated establishments
      console.log('\n🌟 Top 5 Highest Rated (min 10 reviews):');
      const topRated = await getTopRated(5);
      topRated.forEach((row, index) => {
        console.log(`   ${index + 1}. ${row.name} (${row.category})`);
        console.log(`      ⭐ ${row.average_rating} | ${row.review_count} reviews`);
      });

      // Feature statistics
      console.log('\n🎯 Feature Availability:');
      const featureStats = await getFeatureStats();
      console.log(`   📶 WiFi           : ${featureStats.has_wifi}`);
      console.log(`   🚗 Parking        : ${featureStats.has_parking}`);
      console.log(`   🚚 Delivery       : ${featureStats.has_delivery}`);
      console.log(`   ☀️ Terrace        : ${featureStats.has_terrace}`);
      console.log(`   👶 Kids Zone      : ${featureStats.has_kids_zone}`);
      console.log(`   🐕 Pet Friendly   : ${featureStats.has_pet_friendly}`);
      console.log(`   🌙 24 Hours       : ${featureStats.is_24_hours}`);

      // Geographic statistics
      console.log('\n🗺️  Geographic Distribution:');
      const geoStats = await getGeographicStats();
      console.log(`   Center Point  : ${geoStats.avg_latitude.toFixed(4)}°N, ${geoStats.avg_longitude.toFixed(4)}°E`);
      console.log(`   Latitude Range: ${geoStats.min_latitude.toFixed(4)}° to ${geoStats.max_latitude.toFixed(4)}°`);
      console.log(`   Longitude Range: ${geoStats.min_longitude.toFixed(4)}° to ${geoStats.max_longitude.toFixed(4)}°`);
    }

    console.log('\n═══════════════════════════════════════════════════════');
    if (!detailedMode) {
      console.log('💡 Tip: Use --detailed flag for more statistics\n');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
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

export {
  getTotalCount,
  getCountByCategory,
  getCountByTier,
  getCountByPrice
};

