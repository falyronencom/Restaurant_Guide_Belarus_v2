-- =====================================================
-- Migration 006: Create Performance Indexes
-- =====================================================
-- Purpose: Create indexes to optimize Search and Discovery System queries
--
-- Indexes created:
-- 1. GIST spatial index on location (CRITICAL for search performance)
-- 2. B-tree indexes on frequently filtered columns
-- 3. GIN index on cuisine_type array for array containment queries
--
-- Why these specific indexes?
--
-- Spatial index (GIST):
-- The most critical index for the Search system. Without this, every proximity
-- query must scan all establishments and calculate distance to each one.
-- With spatial index, PostGIS can eliminate candidates using bounding box
-- before calculating precise distances. Turns O(n) operation into O(log n).
-- Enables sub-100ms query performance even with thousands of establishments.
--
-- B-tree indexes on filter columns:
-- Users filter by category, price_range, subscription_tier, rating. Each
-- filter needs an index to avoid full table scans. B-tree is PostgreSQL's
-- default index type, optimized for equality and range queries.
--
-- GIN index on cuisine_type:
-- Array containment queries (WHERE 'Italian' = ANY(cuisine_type)) need GIN
-- indexes for efficiency. Without GIN, PostgreSQL must examine every array
-- element in every row. GIN index pre-processes arrays for fast lookups.
--
-- Performance Impact:
-- Index creation can take several seconds on large tables. For production
-- databases with thousands of establishments, consider using CREATE INDEX
-- CONCURRENTLY to avoid blocking concurrent queries (trades speed for
-- non-blocking creation). For development with small datasets, standard
-- CREATE INDEX is fine.
-- =====================================================

BEGIN;

-- =====================================================
-- Critical: Spatial Index on Location
-- =====================================================

DO $$
BEGIN
    -- Check if spatial index already exists
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE tablename = 'establishments' 
        AND indexname = 'idx_establishments_location'
    ) THEN
        -- Create GIST (Generalized Search Tree) index on geography column
        -- This is THE critical index for geospatial search performance
        -- GIST indexes enable fast bounding box queries used by ST_DWithin
        CREATE INDEX idx_establishments_location 
        ON establishments USING GIST(location);
        
        RAISE NOTICE 'Created spatial GIST index on location column';
        RAISE NOTICE 'This index enables fast proximity searches (ST_DWithin queries)';
    ELSE
        RAISE NOTICE 'Spatial index idx_establishments_location already exists';
    END IF;
END $$;

-- =====================================================
-- B-tree Index on Category (Primary Classification)
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE tablename = 'establishments' 
        AND indexname = 'idx_establishments_category'
    ) THEN
        -- Users frequently filter by establishment type: restaurant, cafe, bar
        -- B-tree index enables fast equality lookups
        CREATE INDEX idx_establishments_category 
        ON establishments(category);
        
        RAISE NOTICE 'Created B-tree index on category column';
        RAISE NOTICE 'Optimizes: WHERE category = ''restaurant''';
    ELSE
        RAISE NOTICE 'Index idx_establishments_category already exists';
    END IF;
END $$;

-- =====================================================
-- GIN Index on Cuisine Type Array
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE tablename = 'establishments' 
        AND indexname = 'idx_establishments_cuisine_type'
    ) THEN
        -- GIN (Generalized Inverted Index) optimized for array containment
        -- Enables fast queries like: WHERE 'Italian' = ANY(cuisine_type)
        CREATE INDEX idx_establishments_cuisine_type 
        ON establishments USING GIN(cuisine_type);
        
        RAISE NOTICE 'Created GIN index on cuisine_type array column';
        RAISE NOTICE 'Optimizes: WHERE ''Italian'' = ANY(cuisine_type)';
    ELSE
        RAISE NOTICE 'Index idx_establishments_cuisine_type already exists';
    END IF;
END $$;

-- =====================================================
-- B-tree Index on Price Range
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE tablename = 'establishments' 
        AND indexname = 'idx_establishments_price_range'
    ) THEN
        -- Price filtering is common: show only budget options
        CREATE INDEX idx_establishments_price_range 
        ON establishments(price_range);
        
        RAISE NOTICE 'Created B-tree index on price_range column';
        RAISE NOTICE 'Optimizes: WHERE price_range = ''$''';
    ELSE
        RAISE NOTICE 'Index idx_establishments_price_range already exists';
    END IF;
END $$;

-- =====================================================
-- B-tree Index on Subscription Tier
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE tablename = 'establishments' 
        AND indexname = 'idx_establishments_subscription_tier'
    ) THEN
        -- Ranking algorithm uses subscription tier in calculations
        -- Index enables efficient access during ranking score computation
        CREATE INDEX idx_establishments_subscription_tier 
        ON establishments(subscription_tier);
        
        RAISE NOTICE 'Created B-tree index on subscription_tier column';
        RAISE NOTICE 'Optimizes ranking algorithm and subscription filtering';
    ELSE
        RAISE NOTICE 'Index idx_establishments_subscription_tier already exists';
    END IF;
END $$;

-- =====================================================
-- B-tree Index on Average Rating (Descending)
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE tablename = 'establishments' 
        AND indexname = 'idx_establishments_rating'
    ) THEN
        -- Users often want highest-rated establishments first
        -- DESC order optimizes: ORDER BY average_rating DESC
        CREATE INDEX idx_establishments_rating 
        ON establishments(average_rating DESC);
        
        RAISE NOTICE 'Created B-tree index on average_rating (descending)';
        RAISE NOTICE 'Optimizes: ORDER BY average_rating DESC';
    ELSE
        RAISE NOTICE 'Index idx_establishments_rating already exists';
    END IF;
END $$;

-- =====================================================
-- GIN Index on Features Array
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE tablename = 'establishments' 
        AND indexname = 'idx_establishments_features'
    ) THEN
        -- Users filter by features: wifi, parking, outdoor_seating
        -- GIN index optimizes array containment queries
        CREATE INDEX idx_establishments_features 
        ON establishments USING GIN(features);
        
        RAISE NOTICE 'Created GIN index on features array column';
        RAISE NOTICE 'Optimizes: WHERE ''wifi'' = ANY(features)';
    ELSE
        RAISE NOTICE 'Index idx_establishments_features already exists';
    END IF;
END $$;

-- =====================================================
-- B-tree Index on City
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE tablename = 'establishments' 
        AND indexname = 'idx_establishments_city'
    ) THEN
        -- City filtering is fundamental: show only Minsk establishments
        -- This index likely already exists from initial schema but we verify
        CREATE INDEX idx_establishments_city 
        ON establishments(city);
        
        RAISE NOTICE 'Created B-tree index on city column';
        RAISE NOTICE 'Optimizes: WHERE city = ''Минск''';
    ELSE
        RAISE NOTICE 'Index idx_establishments_city already exists';
    END IF;
END $$;

-- =====================================================
-- Composite Index for Common Query Pattern
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE tablename = 'establishments' 
        AND indexname = 'idx_establishments_city_category_rating'
    ) THEN
        -- Common query pattern: establishments in city X, category Y, ordered by rating
        -- Composite index can satisfy this query from index alone without table access
        CREATE INDEX idx_establishments_city_category_rating 
        ON establishments(city, category, average_rating DESC);
        
        RAISE NOTICE 'Created composite index on city + category + rating';
        RAISE NOTICE 'Optimizes: WHERE city = ''Минск'' AND category = ''restaurant'' ORDER BY average_rating DESC';
    ELSE
        RAISE NOTICE 'Index idx_establishments_city_category_rating already exists';
    END IF;
END $$;

-- =====================================================
-- Validation: List All Indexes on Establishments Table
-- =====================================================

SELECT 
    indexname AS index_name,
    indexdef AS index_definition
FROM pg_indexes
WHERE tablename = 'establishments'
ORDER BY indexname;

-- Display index sizes to monitor storage overhead
SELECT 
    schemaname,
    relname AS tablename,
    indexrelname AS indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE relname = 'establishments'
ORDER BY pg_relation_size(indexrelid) DESC;

COMMIT;

-- =====================================================
-- Post-Migration Performance Testing
-- =====================================================
-- After creating indexes, test query performance improvements:
--
-- 1. Test spatial index with EXPLAIN ANALYZE:
-- EXPLAIN ANALYZE
-- SELECT name, ST_Distance(location, ST_MakePoint(27.561831, 53.902496)::geography) AS dist
-- FROM establishments
-- WHERE ST_DWithin(location, ST_MakePoint(27.561831, 53.902496)::geography, 5000)
-- ORDER BY dist
-- LIMIT 20;
--
-- Look for "Index Scan using idx_establishments_location" in query plan.
-- Execution time should be under 100ms even with thousands of establishments.
--
-- 2. Test category index:
-- EXPLAIN ANALYZE
-- SELECT COUNT(*) FROM establishments WHERE category = 'restaurant';
--
-- Should show "Index Scan using idx_establishments_category"
--
-- 3. Test cuisine array index:
-- EXPLAIN ANALYZE
-- SELECT COUNT(*) FROM establishments WHERE 'Italian' = ANY(cuisine_type);
--
-- Should show "Bitmap Index Scan using idx_establishments_cuisine_type"
--
-- 4. Test composite index:
-- EXPLAIN ANALYZE
-- SELECT name, average_rating 
-- FROM establishments 
-- WHERE city = 'Минск' AND category = 'restaurant'
-- ORDER BY average_rating DESC
-- LIMIT 10;
--
-- Should show "Index Scan using idx_establishments_city_category_rating"
--
-- Performance Expectations:
-- - Simple queries: < 10ms
-- - Proximity searches (5km radius): < 100ms
-- - Complex multi-filter queries: < 200ms
-- - Full table scans should be eliminated for all indexed queries
-- =====================================================

