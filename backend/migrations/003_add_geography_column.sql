-- =====================================================
-- Migration 003: Add Geography Location Column
-- =====================================================
-- Purpose: Add PostGIS geography column and populate from existing coordinates
--
-- What this migration does:
-- 1. Adds a new 'location' column with type GEOGRAPHY(Point, 4326)
-- 2. Populates the location column from existing latitude/longitude values
-- 3. Validates the migration succeeded
--
-- Why GEOGRAPHY(Point, 4326)?
-- - GEOGRAPHY (not GEOMETRY) uses spheroidal calculations accounting for
--   Earth's curvature, giving accuracy within centimeters
-- - Point is the geometry subtype representing a single coordinate
-- - 4326 is the SRID (Spatial Reference System Identifier) for WGS84,
--   the standard GPS coordinate system used worldwide
--
-- Why not drop latitude/longitude yet?
-- We keep the old columns temporarily during migration to enable safe
-- rollback. They will be dropped in a future migration after confirming
-- the location column works correctly.
--
-- Performance note:
-- This migration may take several seconds if many establishments exist,
-- as it must calculate geography points for each row. For production
-- databases with thousands of records, consider running during low-traffic
-- hours.
-- =====================================================

BEGIN;

-- =====================================================
-- Step 1: Add geography location column
-- =====================================================

DO $$
BEGIN
    -- Check if location column already exists (migration idempotency)
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'establishments' 
        AND column_name = 'location'
    ) THEN
        -- Add location column as nullable initially
        -- We'll populate it from existing data, then can make it NOT NULL later
        ALTER TABLE establishments
        ADD COLUMN location GEOGRAPHY(Point, 4326);
        
        RAISE NOTICE 'Added location column with type GEOGRAPHY(Point, 4326)';
    ELSE
        RAISE NOTICE 'Location column already exists, skipping creation';
    END IF;
END $$;

-- =====================================================
-- Step 2: Populate location from existing coordinates
-- =====================================================

DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    -- Update all rows that have latitude and longitude but no location
    -- ST_MakePoint creates a point from longitude (X) and latitude (Y)
    -- Note the order: longitude first, then latitude (follows mathematical convention)
    -- ST_SetSRID assigns the spatial reference system (4326 = WGS84)
    -- Cast to geography tells PostGIS to use spheroidal calculations
    
    UPDATE establishments
    SET location = ST_SetSRID(
        ST_MakePoint(longitude, latitude), 
        4326
    )::geography
    WHERE latitude IS NOT NULL 
      AND longitude IS NOT NULL
      AND location IS NULL;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    RAISE NOTICE 'Populated location column for % establishments', updated_count;
    
    -- Report any establishments without coordinates
    SELECT COUNT(*) INTO updated_count
    FROM establishments
    WHERE location IS NULL;
    
    IF updated_count > 0 THEN
        RAISE WARNING '% establishments still have NULL location (missing latitude/longitude)', updated_count;
        RAISE NOTICE 'These establishments will not appear in geospatial searches until coordinates are added';
    ELSE
        RAISE NOTICE 'All establishments have valid location data';
    END IF;
END $$;

-- =====================================================
-- Step 3: Validate migration results
-- =====================================================

-- Display statistics about the migration
SELECT 
    COUNT(*) AS total_establishments,
    COUNT(location) AS with_location,
    COUNT(*) - COUNT(location) AS without_location,
    COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL AND location IS NULL THEN 1 END) AS coord_without_location
FROM establishments;

-- Show sample of converted locations for verification
-- This helps confirm coordinates were converted correctly
SELECT 
    id,
    name,
    latitude,
    longitude,
    ST_Y(location::geometry) AS location_latitude,
    ST_X(location::geometry) AS location_longitude,
    ST_AsText(location::geometry) AS location_wkt
FROM establishments
WHERE location IS NOT NULL
LIMIT 5;

COMMIT;

-- =====================================================
-- Post-Migration Verification Queries
-- =====================================================
-- After running this migration, verify with these queries:
--
-- 1. Check all establishments have location:
-- SELECT COUNT(*) FROM establishments WHERE location IS NULL;
-- Should return 0 if all establishments had valid coordinates
--
-- 2. Test distance calculation from Minsk center:
-- SELECT 
--   name,
--   ST_Distance(
--     location,
--     ST_MakePoint(27.561831, 53.902496)::geography
--   ) / 1000.0 AS distance_km
-- FROM establishments
-- WHERE location IS NOT NULL
-- ORDER BY distance_km
-- LIMIT 10;
-- Should return establishments with distances in kilometers
--
-- 3. Verify coordinates match original values:
-- SELECT 
--   name,
--   latitude,
--   ST_Y(location::geometry) AS location_lat,
--   ABS(latitude - ST_Y(location::geometry)) AS lat_diff
-- FROM establishments
-- WHERE location IS NOT NULL
-- ORDER BY lat_diff DESC
-- LIMIT 5;
-- Differences should be near zero (floating point rounding only)
-- =====================================================

