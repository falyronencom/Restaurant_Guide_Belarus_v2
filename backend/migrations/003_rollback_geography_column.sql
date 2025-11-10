-- =====================================================
-- Rollback 003: Remove Geography Location Column
-- =====================================================
-- Purpose: Remove the PostGIS geography column added in migration 003
--
-- What this rollback does:
-- - Drops the location GEOGRAPHY column
-- - Preserves original latitude and longitude columns (they were never dropped)
--
-- Data Loss Warning:
-- The location column will be dropped with all its geography point data.
-- However, since the location column was populated FROM latitude/longitude,
-- no unique data is lost - the original coordinates remain in their columns.
-- If migration 003 is re-run, the location column will be recreated from
-- the latitude/longitude columns with identical data.
--
-- This rollback is safe and the migration is reversible without data loss.
--
-- When to use this rollback:
-- - Migration 003 failed partway through
-- - Need to modify how geography points are created
-- - Rolling back entire migration sequence
-- - Troubleshooting PostGIS issues
-- =====================================================

BEGIN;

-- Check if location column exists before attempting to drop
DO $$
DECLARE
    location_exists BOOLEAN;
    record_count INTEGER;
BEGIN
    -- Check if location column exists
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'establishments' 
        AND column_name = 'location'
    ) INTO location_exists;
    
    IF location_exists THEN
        -- Count how many establishments have location data
        SELECT COUNT(*) INTO record_count
        FROM establishments
        WHERE location IS NOT NULL;
        
        RAISE NOTICE 'Found location column with % populated records', record_count;
        RAISE NOTICE 'Dropping location column...';
        
        -- Drop the location column
        ALTER TABLE establishments
        DROP COLUMN location;
        
        RAISE NOTICE 'Location column dropped successfully';
        RAISE NOTICE 'Original latitude and longitude columns preserved';
        
        IF record_count > 0 THEN
            RAISE NOTICE 'Geography point data deleted, but original coordinates remain in latitude/longitude columns';
            RAISE NOTICE 'Location column can be recreated by re-running migration 003';
        END IF;
    ELSE
        RAISE NOTICE 'Location column does not exist, rollback not needed';
    END IF;
END $$;

-- Verify original coordinate columns still exist
DO $$
DECLARE
    has_latitude BOOLEAN;
    has_longitude BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'establishments' AND column_name = 'latitude'
    ) INTO has_latitude;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'establishments' AND column_name = 'longitude'
    ) INTO has_longitude;
    
    IF has_latitude AND has_longitude THEN
        RAISE NOTICE 'Verified: latitude and longitude columns still exist';
        
        -- Show sample coordinates to confirm data preserved
        RAISE NOTICE 'Sample coordinates from preserved columns:';
        PERFORM name, latitude, longitude
        FROM establishments
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        LIMIT 3;
    ELSE
        RAISE WARNING 'Coordinate columns missing! This should not happen.';
        IF NOT has_latitude THEN
            RAISE WARNING 'latitude column not found';
        END IF;
        IF NOT has_longitude THEN
            RAISE WARNING 'longitude column not found';
        END IF;
    END IF;
END $$;

-- Display remaining columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'establishments'
AND column_name IN ('location', 'latitude', 'longitude')
ORDER BY column_name;

COMMIT;

RAISE NOTICE 'Rollback 003 complete. Geography location column removed.';
RAISE NOTICE 'Original coordinate data preserved in latitude/longitude columns.';
RAISE NOTICE 'To recreate location column, re-run migration 003_add_geography_column.sql';

