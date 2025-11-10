/**
 * Seed script for Restaurant Guide Belarus v2.0
 * Creates 30 strategically distributed test establishments in Minsk
 * 
 * Geographic Distribution Strategy:
 * - Near distance (<500m from center): 5 establishments
 * - Walking distance (500m-1km): 7 establishments
 * - Short ride (1-3km): 9 establishments
 * - Medium distance (3-5km): 6 establishments
 * - Far radius (5-10km): 3 establishments
 * 
 * Subscription Tier Distribution:
 * - Free: 15 establishments (50%)
 * - Basic: 8 establishments (27%)
 * - Premium: 4 establishments (13%)
 * - Featured: 3 establishments (10%)
 * 
 * This distribution enables comprehensive testing of:
 * - Radius-based search queries
 * - Multi-factor ranking algorithm
 * - Filter combinations
 * - Pagination across different result set sizes
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config();

const { Pool } = pg;

// Minsk city center coordinates (Independence Square area)
const MINSK_CENTER = {
  latitude: 53.902496,
  longitude: 27.561831
};

// Database connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

/**
 * Calculate approximate coordinates at given distance and bearing from center
 * Uses simple flat-earth approximation (acceptable for Minsk area distances <10km)
 * 
 * @param {number} distanceKm - Distance in kilometers
 * @param {number} bearingDeg - Bearing in degrees (0=North, 90=East, 180=South, 270=West)
 * @returns {object} Coordinates {latitude, longitude}
 */
function calculateCoordinates(distanceKm, bearingDeg) {
  const R = 6371; // Earth's radius in km
  const lat1 = MINSK_CENTER.latitude * Math.PI / 180;
  const lon1 = MINSK_CENTER.longitude * Math.PI / 180;
  const bearing = bearingDeg * Math.PI / 180;
  
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceKm / R) +
    Math.cos(lat1) * Math.sin(distanceKm / R) * Math.cos(bearing)
  );
  
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(distanceKm / R) * Math.cos(lat1),
    Math.cos(distanceKm / R) - Math.sin(lat1) * Math.sin(lat2)
  );
  
  return {
    latitude: parseFloat((lat2 * 180 / Math.PI).toFixed(6)),
    longitude: parseFloat((lon2 * 180 / Math.PI).toFixed(6))
  };
}

/**
 * 30 strategically distributed test establishments
 * Each establishment includes all required fields for post-migration schema
 */
const establishments = [
  // ===== NEAR DISTANCE ZONE (<500m) - 5 establishments =====
  {
    name: 'Центральная кофейня',
    description: 'Уютное кафе в самом сердце Минска с отличным кофе и завтраками',
    category: 'cafe',
    cuisine_type: ['european', 'international'],
    ...calculateCoordinates(0.3, 45), // 300m northeast
    price_range: '$$',
    average_check_byn: 25.00,
    average_rating: 4.7,
    review_count: 156,
    subscription_tier: 'premium',
    is_24_hours: false,
    features: ['wifi', 'outdoor_seating', 'breakfast']
  },
  {
    name: 'Бистро у площади',
    description: 'Быстрое обслуживание и вкусная еда для деловых обедов',
    category: 'restaurant',
    cuisine_type: ['belarusian', 'european'],
    ...calculateCoordinates(0.4, 135), // 400m southeast
    price_range: '$',
    average_check_byn: 18.00,
    average_rating: 4.3,
    review_count: 89,
    subscription_tier: 'featured',
    is_24_hours: false,
    features: ['wifi', 'business_lunch', 'takeaway']
  },
  {
    name: 'Пивной дворик',
    description: 'Крафтовое пиво и снеки в центре города',
    category: 'bar',
    cuisine_type: ['european', 'snacks'],
    ...calculateCoordinates(0.35, 225), // 350m southwest
    price_range: '$$',
    average_check_byn: 30.00,
    average_rating: 4.5,
    review_count: 124,
    subscription_tier: 'basic',
    is_24_hours: false,
    features: ['outdoor_seating', 'live_music', 'smoking_area']
  },
  {
    name: 'Суши экспресс',
    description: 'Свежие роллы и быстрая доставка',
    category: 'restaurant',
    cuisine_type: ['japanese', 'asian'],
    ...calculateCoordinates(0.45, 315), // 450m northwest
    price_range: '$$',
    average_check_byn: 35.00,
    average_rating: 4.6,
    review_count: 201,
    subscription_tier: 'free',
    is_24_hours: false,
    features: ['delivery', 'takeaway', 'accepts_cards']
  },
  {
    name: 'Кондитерская мечта',
    description: 'Авторские десерты и свежая выпечка каждый день',
    category: 'bakery',
    cuisine_type: ['european', 'desserts'],
    ...calculateCoordinates(0.2, 90), // 200m east
    price_range: '$',
    average_check_byn: 12.00,
    average_rating: 4.8,
    review_count: 178,
    subscription_tier: 'free',
    is_24_hours: false,
    features: ['wifi', 'takeaway', 'outdoor_seating']
  },

  // ===== WALKING DISTANCE ZONE (500m-1km) - 7 establishments =====
  {
    name: 'Тратория итальяна',
    description: 'Аутентичная итальянская кухня от шеф-повара из Рима',
    category: 'restaurant',
    cuisine_type: ['italian', 'mediterranean'],
    ...calculateCoordinates(0.7, 30), // 700m northeast
    price_range: '$$$',
    average_check_byn: 55.00,
    average_rating: 4.9,
    review_count: 234,
    subscription_tier: 'featured',
    is_24_hours: false,
    features: ['wine_selection', 'parking', 'accepts_cards', 'reservation']
  },
  {
    name: 'Грузинский дворик',
    description: 'Хинкали, хачапури и домашнее вино в грузинских традициях',
    category: 'restaurant',
    cuisine_type: ['georgian', 'caucasian'],
    ...calculateCoordinates(0.85, 120), // 850m southeast
    price_range: '$$',
    average_check_byn: 40.00,
    average_rating: 4.7,
    review_count: 167,
    subscription_tier: 'premium',
    is_24_hours: false,
    features: ['outdoor_seating', 'wine_selection', 'live_music']
  },
  {
    name: 'Фастфуд сити',
    description: 'Быстрые бургеры и картошка фри для всей семьи',
    category: 'fast_food',
    cuisine_type: ['american', 'fast_food'],
    ...calculateCoordinates(0.6, 180), // 600m south
    price_range: '$',
    average_check_byn: 15.00,
    average_rating: 3.9,
    review_count: 412,
    subscription_tier: 'free',
    is_24_hours: false,
    features: ['delivery', 'takeaway', 'kids_menu', 'accepts_cards']
  },
  {
    name: 'Вегетарианский рай',
    description: 'Полностью растительное меню для здорового питания',
    category: 'restaurant',
    cuisine_type: ['vegetarian', 'healthy'],
    ...calculateCoordinates(0.9, 270), // 900m west
    price_range: '$$',
    average_check_byn: 28.00,
    average_rating: 4.6,
    review_count: 93,
    subscription_tier: 'basic',
    is_24_hours: false,
    features: ['wifi', 'outdoor_seating', 'vegan_options']
  },
  {
    name: 'Ночной бар',
    description: 'Коктейли и живая музыка до утра',
    category: 'bar',
    cuisine_type: ['international', 'cocktails'],
    ...calculateCoordinates(0.75, 0), // 750m north
    price_range: '$$',
    average_check_byn: 35.00,
    average_rating: 4.4,
    review_count: 156,
    subscription_tier: 'free',
    is_24_hours: true, // One of three 24-hour establishments
    features: ['live_music', 'dancing', 'smoking_area', 'accepts_cards']
  },
  {
    name: 'Пекарня свежести',
    description: 'Свежий хлеб и выпечка с 6 утра',
    category: 'bakery',
    cuisine_type: ['european', 'bakery'],
    ...calculateCoordinates(0.55, 60), // 550m northeast
    price_range: '$',
    average_check_byn: 10.00,
    average_rating: 4.5,
    review_count: 88,
    subscription_tier: 'free',
    is_24_hours: false,
    features: ['takeaway', 'early_opening', 'accepts_cards']
  },
  {
    name: 'Азиатская фьюжн',
    description: 'Современная азиатская кухня с авторскими интерпретациями',
    category: 'restaurant',
    cuisine_type: ['asian', 'fusion'],
    ...calculateCoordinates(0.8, 150), // 800m southeast
    price_range: '$$$',
    average_check_byn: 60.00,
    average_rating: 4.8,
    review_count: 142,
    subscription_tier: 'premium',
    is_24_hours: false,
    features: ['wifi', 'parking', 'accepts_cards', 'reservation']
  },

  // ===== SHORT RIDE ZONE (1-3km) - 9 establishments =====
  {
    name: 'Семейная столовая',
    description: 'Домашняя еда по доступным ценам для всей семьи',
    category: 'canteen',
    cuisine_type: ['belarusian', 'european'],
    ...calculateCoordinates(1.5, 45), // 1.5km northeast
    price_range: '$',
    average_check_byn: 12.00,
    average_rating: 4.2,
    review_count: 67,
    subscription_tier: 'free',
    is_24_hours: false,
    features: ['kids_menu', 'takeaway', 'accepts_cards']
  },
  {
    name: 'Пиццерия неаполь',
    description: 'Настоящая неаполитанская пицца в дровяной печи',
    category: 'pizzeria',
    cuisine_type: ['italian', 'pizza'],
    ...calculateCoordinates(2.0, 90), // 2km east
    price_range: '$$',
    average_check_byn: 32.00,
    average_rating: 4.6,
    review_count: 189,
    subscription_tier: 'basic',
    is_24_hours: false,
    features: ['delivery', 'outdoor_seating', 'accepts_cards']
  },
  {
    name: 'Стейк-хаус премиум',
    description: 'Лучшие стейки из мраморной говядины',
    category: 'restaurant',
    cuisine_type: ['steakhouse', 'american'],
    ...calculateCoordinates(1.8, 135), // 1.8km southeast
    price_range: '$$$',
    average_check_byn: 75.00,
    average_rating: 4.9,
    review_count: 201,
    subscription_tier: 'featured',
    is_24_hours: false,
    features: ['parking', 'wine_selection', 'reservation', 'valet_parking']
  },
  {
    name: 'Кафе на набережной',
    description: 'Романтичный вид на реку и европейская кухня',
    category: 'cafe',
    cuisine_type: ['european', 'international'],
    ...calculateCoordinates(2.5, 180), // 2.5km south
    price_range: '$$',
    average_check_byn: 30.00,
    average_rating: 4.5,
    review_count: 145,
    subscription_tier: 'basic',
    is_24_hours: false,
    features: ['outdoor_seating', 'river_view', 'wifi', 'accepts_cards']
  },
  {
    name: 'Бар у моста',
    description: 'Крафтовое пиво и бургеры в спортивном стиле',
    category: 'pub',
    cuisine_type: ['american', 'pub_food'],
    ...calculateCoordinates(1.2, 225), // 1.2km southwest
    price_range: '$$',
    average_check_byn: 28.00,
    average_rating: 4.3,
    review_count: 178,
    subscription_tier: 'free',
    is_24_hours: false,
    features: ['sports_tv', 'smoking_area', 'parking']
  },
  {
    name: 'Суши мастер',
    description: 'Широкий выбор роллов и японских блюд',
    category: 'restaurant',
    cuisine_type: ['japanese', 'asian'],
    ...calculateCoordinates(2.2, 270), // 2.2km west
    price_range: '$$',
    average_check_byn: 38.00,
    average_rating: 4.4,
    review_count: 223,
    subscription_tier: 'basic',
    is_24_hours: false,
    features: ['delivery', 'takeaway', 'wifi', 'accepts_cards']
  },
  {
    name: 'Белорусская корчма',
    description: 'Традиционная белорусская кухня в аутентичном интерьере',
    category: 'restaurant',
    cuisine_type: ['belarusian', 'traditional'],
    ...calculateCoordinates(1.7, 315), // 1.7km northwest
    price_range: '$$',
    average_check_byn: 35.00,
    average_rating: 4.7,
    review_count: 156,
    subscription_tier: 'premium',
    is_24_hours: false,
    features: ['live_music', 'parking', 'accepts_cards', 'folk_interior']
  },
  {
    name: 'Кофейня студентов',
    description: 'Доступный кофе и Wi-Fi для работы и учебы',
    category: 'cafe',
    cuisine_type: ['coffee', 'snacks'],
    ...calculateCoordinates(1.4, 0), // 1.4km north
    price_range: '$',
    average_check_byn: 8.00,
    average_rating: 4.1,
    review_count: 92,
    subscription_tier: 'free',
    is_24_hours: false,
    features: ['wifi', 'power_outlets', 'quiet_zone', 'accepts_cards']
  },
  {
    name: 'Индийский экспресс',
    description: 'Острая индийская кухня и тандыр',
    category: 'restaurant',
    cuisine_type: ['indian', 'asian'],
    ...calculateCoordinates(2.8, 60), // 2.8km northeast
    price_range: '$$',
    average_check_byn: 33.00,
    average_rating: 4.5,
    review_count: 112,
    subscription_tier: 'basic',
    is_24_hours: false,
    features: ['delivery', 'spicy_food', 'vegetarian_options', 'accepts_cards']
  },

  // ===== MEDIUM DISTANCE ZONE (3-5km) - 6 establishments =====
  {
    name: 'Ресторан у озера',
    description: 'Изысканная кухня с видом на водную гладь',
    category: 'restaurant',
    cuisine_type: ['european', 'international'],
    ...calculateCoordinates(4.0, 30), // 4km northeast
    price_range: '$$$',
    average_check_byn: 70.00,
    average_rating: 4.8,
    review_count: 167,
    subscription_tier: 'premium',
    is_24_hours: false,
    features: ['lake_view', 'parking', 'banquet_hall', 'reservation']
  },
  {
    name: 'Фастфуд на районе',
    description: 'Быстрое питание в спальном районе',
    category: 'fast_food',
    cuisine_type: ['american', 'fast_food'],
    ...calculateCoordinates(3.5, 120), // 3.5km southeast
    price_range: '$',
    average_check_byn: 14.00,
    average_rating: 3.7,
    review_count: 234,
    subscription_tier: 'free',
    is_24_hours: true, // Second 24-hour establishment
    features: ['delivery', 'drive_through', 'kids_menu', 'accepts_cards']
  },
  {
    name: 'Китайский дракон',
    description: 'Настоящая китайская кухня от шеф-повара из Пекина',
    category: 'restaurant',
    cuisine_type: ['chinese', 'asian'],
    ...calculateCoordinates(4.5, 180), // 4.5km south
    price_range: '$$',
    average_check_byn: 36.00,
    average_rating: 4.6,
    review_count: 145,
    subscription_tier: 'basic',
    is_24_hours: false,
    features: ['delivery', 'parking', 'banquet_hall', 'accepts_cards']
  },
  {
    name: 'Караоке-бар веселье',
    description: 'Караоке, бильярд и веселая атмосфера до утра',
    category: 'karaoke',
    cuisine_type: ['international', 'snacks'],
    ...calculateCoordinates(3.2, 240), // 3.2km southwest
    price_range: '$$',
    average_check_byn: 32.00,
    average_rating: 4.2,
    review_count: 198,
    subscription_tier: 'free',
    is_24_hours: false,
    features: ['karaoke', 'billiards', 'smoking_area', 'parking']
  },
  {
    name: 'Пекарня района',
    description: 'Свежая выпечка для местных жителей',
    category: 'bakery',
    cuisine_type: ['european', 'bakery'],
    ...calculateCoordinates(4.2, 300), // 4.2km northwest
    price_range: '$',
    average_check_byn: 9.00,
    average_rating: 4.3,
    review_count: 76,
    subscription_tier: 'free',
    is_24_hours: false,
    features: ['takeaway', 'early_opening', 'accepts_cards']
  },
  {
    name: 'Кафе домашнее',
    description: 'Уютное кафе с домашней атмосферой и заботой',
    category: 'cafe',
    cuisine_type: ['belarusian', 'home_cooking'],
    ...calculateCoordinates(3.8, 350), // 3.8km north
    price_range: '$',
    average_check_byn: 16.00,
    average_rating: 4.4,
    review_count: 89,
    subscription_tier: 'basic',
    is_24_hours: false,
    features: ['wifi', 'homestyle_cooking', 'accepts_cards']
  },

  // ===== FAR RADIUS ZONE (5-10km) - 3 establishments =====
  {
    name: 'Загородный ресторан',
    description: 'Ресторан на выезде с просторной террасой и барбекю',
    category: 'restaurant',
    cuisine_type: ['european', 'barbecue'],
    ...calculateCoordinates(7.5, 90), // 7.5km east
    price_range: '$$',
    average_check_byn: 42.00,
    average_rating: 4.5,
    review_count: 134,
    subscription_tier: 'basic',
    is_24_hours: false,
    features: ['outdoor_seating', 'parking', 'kids_playground', 'barbecue']
  },
  {
    name: 'Круглосуточная столовая',
    description: 'Всегда открыто для водителей и ночных работников',
    category: 'canteen',
    cuisine_type: ['belarusian', 'european'],
    ...calculateCoordinates(8.5, 210), // 8.5km southwest
    price_range: '$',
    average_check_byn: 13.00,
    average_rating: 3.8,
    review_count: 156,
    subscription_tier: 'free',
    is_24_hours: true, // Third 24-hour establishment
    features: ['parking', 'takeaway', 'accepts_cards']
  },
  {
    name: 'Боулинг-клуб страйк',
    description: 'Боулинг, бар и ресторан в одном месте',
    category: 'bowling',
    cuisine_type: ['american', 'snacks'],
    ...calculateCoordinates(6.0, 330), // 6km northwest
    price_range: '$$',
    average_check_byn: 38.00,
    average_rating: 4.4,
    review_count: 189,
    subscription_tier: 'free',
    is_24_hours: false,
    features: ['bowling', 'parking', 'kids_zone', 'accepts_cards', 'billiards']
  }
];

/**
 * Get or create a test partner user for establishments
 */
async function getOrCreatePartner() {
  const client = await pool.connect();
  try {
    // Check if test partner exists
    const result = await client.query(
      'SELECT id FROM users WHERE email = $1',
      ['test.partner@restaurantguide.by']
    );

    if (result.rows.length > 0) {
      console.log('Using existing test partner user');
      return result.rows[0].id;
    }

    // Create test partner if doesn't exist
    const insertResult = await client.query(`
      INSERT INTO users (
        email, name, role, auth_method, 
        email_verified, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [
      'test.partner@restaurantguide.by',
      'Test Partner',
      'partner',
      'email',
      true,
      true
    ]);

    console.log('Created new test partner user');
    return insertResult.rows[0].id;
  } finally {
    client.release();
  }
}

/**
 * Clear existing establishments (for development re-seeding)
 */
async function clearEstablishments() {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM establishments');
    console.log('Cleared existing establishments');
  } finally {
    client.release();
  }
}

/**
 * Insert establishment with PostGIS geography point
 */
async function insertEstablishment(establishment, partnerId) {
  const client = await pool.connect();
  try {
    // Build operating_hours JSON (simplified for test data)
    const operatingHours = establishment.is_24_hours ? {
      monday: '00:00-23:59',
      tuesday: '00:00-23:59',
      wednesday: '00:00-23:59',
      thursday: '00:00-23:59',
      friday: '00:00-23:59',
      saturday: '00:00-23:59',
      sunday: '00:00-23:59'
    } : {
      monday: '10:00-22:00',
      tuesday: '10:00-22:00',
      wednesday: '10:00-22:00',
      thursday: '10:00-22:00',
      friday: '10:00-23:00',
      saturday: '10:00-23:00',
      sunday: '10:00-22:00'
    };

    // Generate realistic primary_image_url (Cloudinary-style)
    const imageId = establishment.name.toLowerCase().replace(/\s+/g, '-');
    const primaryImageUrl = `https://res.cloudinary.com/restaurantguide/image/upload/v1/${imageId}-main.jpg`;

    const result = await client.query(`
      INSERT INTO establishments (
        partner_id,
        name,
        description,
        city,
        address,
        latitude,
        longitude,
        location,
        category,
        cuisine_type,
        price_range,
        average_check_byn,
        operating_hours,
        features,
        status,
        subscription_tier,
        average_rating,
        review_count,
        is_24_hours,
        primary_image_url
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
        $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
      )
      RETURNING id, name
    `, [
      partnerId,
      establishment.name,
      establishment.description,
      'Минск', // All test data in Minsk
      `ул. Тестовая, ${Math.floor(Math.random() * 100)}`, // Simplified address
      establishment.latitude,
      establishment.longitude,
      establishment.longitude, // For ST_MakePoint (longitude first!)
      establishment.latitude,  // Then latitude
      establishment.category,
      establishment.cuisine_type,
      establishment.price_range,
      establishment.average_check_byn,
      JSON.stringify(operatingHours),
      establishment.features,
      'active', // All test establishments are active
      establishment.subscription_tier,
      establishment.average_rating,
      establishment.review_count,
      establishment.is_24_hours,
      primaryImageUrl
    ]);

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Main seed function
 */
async function seed() {
  console.log('🌱 Starting establishments seed process...\n');

  try {
    // Test database connection
    const client = await pool.connect();
    console.log('✓ Database connection established');
    client.release();

    // Verify PostGIS is available
    const pgResult = await pool.query('SELECT PostGIS_Version() AS version');
    console.log(`✓ PostGIS available: ${pgResult.rows[0].version}\n`);

    // Get or create partner
    const partnerId = await getOrCreatePartner();
    console.log(`✓ Partner ID: ${partnerId}\n`);

    // Clear existing establishments
    await clearEstablishments();
    console.log('');

    // Insert all establishments
    console.log(`Inserting ${establishments.length} establishments...\n`);
    
    let successCount = 0;
    for (const establishment of establishments) {
      try {
        const result = await insertEstablishment(establishment, partnerId);
        console.log(`✓ Inserted: ${result.name}`);
        successCount++;
      } catch (error) {
        console.error(`✗ Failed to insert ${establishment.name}:`, error.message);
      }
    }

    console.log(`\n✅ Seed complete! ${successCount}/${establishments.length} establishments inserted\n`);

    // Display distribution statistics
    const stats = await pool.query(`
      SELECT 
        COUNT(*) AS total,
        COUNT(CASE WHEN subscription_tier = 'free' THEN 1 END) AS free_tier,
        COUNT(CASE WHEN subscription_tier = 'basic' THEN 1 END) AS basic_tier,
        COUNT(CASE WHEN subscription_tier = 'premium' THEN 1 END) AS premium_tier,
        COUNT(CASE WHEN subscription_tier = 'featured' THEN 1 END) AS featured_tier,
        COUNT(CASE WHEN is_24_hours = TRUE THEN 1 END) AS always_open,
        ROUND(AVG(average_rating)::numeric, 2) AS avg_rating,
        ROUND(AVG(average_check_byn)::numeric, 2) AS avg_check
      FROM establishments
    `);

    console.log('📊 Distribution Statistics:');
    console.log(`   Total establishments: ${stats.rows[0].total}`);
    console.log(`   Free tier: ${stats.rows[0].free_tier} (${Math.round(stats.rows[0].free_tier / stats.rows[0].total * 100)}%)`);
    console.log(`   Basic tier: ${stats.rows[0].basic_tier} (${Math.round(stats.rows[0].basic_tier / stats.rows[0].total * 100)}%)`);
    console.log(`   Premium tier: ${stats.rows[0].premium_tier} (${Math.round(stats.rows[0].premium_tier / stats.rows[0].total * 100)}%)`);
    console.log(`   Featured tier: ${stats.rows[0].featured_tier} (${Math.round(stats.rows[0].featured_tier / stats.rows[0].total * 100)}%)`);
    console.log(`   24-hour establishments: ${stats.rows[0].always_open}`);
    console.log(`   Average rating: ${stats.rows[0].avg_rating}`);
    console.log(`   Average check: ${stats.rows[0].avg_check} BYN\n`);

    // Test distance calculation
    console.log('🧪 Testing distance calculations from Minsk center:');
    const distanceTest = await pool.query(`
      SELECT 
        name,
        category,
        subscription_tier,
        ROUND(ST_Distance(
          location,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        )::numeric) AS distance_meters
      FROM establishments
      ORDER BY distance_meters
      LIMIT 5
    `, [MINSK_CENTER.longitude, MINSK_CENTER.latitude]);

    console.log('   Closest 5 establishments:');
    distanceTest.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.name} (${row.category}, ${row.subscription_tier}) - ${row.distance_meters}m`);
    });

    console.log('\n✨ Seed process completed successfully!');

  } catch (error) {
    console.error('\n❌ Seed process failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run seed if executed directly (works cross-platform)
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && process.argv[1].endsWith('seed-establishments.js');

if (isMainModule) {
  seed().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default seed;
