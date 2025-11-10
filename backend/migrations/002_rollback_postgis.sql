-- =====================================================
-- Rollback 002: Disable PostGIS Extension (OPTIONAL)
-- =====================================================
-- Purpose: Remove PostGIS extension from database
--
-- IMPORTANT WARNING:
-- This rollback is OPTIONAL and potentially DANGEROUS. Dropping the PostGIS
-- extension will fail if any database objects depend on PostGIS types or
-- functions. This includes:
-- - Tables with GEOGRAPHY or GEOMETRY columns (like establishments.location)
-- - Spatial indexes (GIST indexes on geographic columns)
-- - Any views, functions, or triggers using PostGIS functions
--
-- You should ONLY run this rollback if:
-- 1. You have already rolled back migrations 003-006 that use PostGIS
-- 2. You have verified no other database objects depend on PostGIS
-- 3. You want to completely remove PostGIS from the database
--
-- In most cases, it is safe to leave PostGIS extension enabled even if
-- not currently used. PostGIS does not consume significant resources when
-- idle and can be beneficial for future features.
--
-- Use Case:
-- This rollback is primarily for testing migration sequences or switching
-- to a different PostgreSQL Docker image that doesn't support PostGIS.
-- =====================================================

BEGIN;

-- Check for dependent objects before attempting to drop extension
DO $$
DECLARE
    dependent_count INTEGER;
    geography_columns TEXT;
BEGIN
    -- Check if any tables use GEOGRAPHY or GEOMETRY types
    SELECT string_agg(table_name || '.' || column_name, ', ')
    INTO geography_columns
    FROM information_schema.columns
    WHERE data_type IN ('USER-DEFINED')
    AND udt_name IN ('geography', 'geometry')
    LIMIT 10;
    
    IF geography_columns IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot drop PostGIS extension. The following columns depend on PostGIS types: %
        
        You must first:
        1. Roll back migration 003 to remove the location column
        2. Remove any other geographic columns or indexes
        3. Then retry this rollback
        
        Alternatively, you can CASCADE drop the extension (which will delete all dependent objects):
        DROP EXTENSION IF EXISTS postgis CASCADE;
        
        WARNING: CASCADE will delete ALL geographic data and indexes!
        ', geography_columns;
    END IF;
    
    RAISE NOTICE 'No PostGIS-dependent columns found. Safe to proceed with extension removal.';
END $$;

-- Attempt to drop PostGIS extension
DO $$
DECLARE
    postgis_installed BOOLEAN;
BEGIN
    -- Check if PostGIS is currently installed
    SELECT EXISTS (
        SELECT 1 
        FROM pg_extension 
        WHERE extname = 'postgis'
    ) INTO postgis_installed;
    
    IF postgis_installed THEN
        RAISE NOTICE 'PostGIS extension is currently installed. Attempting to remove...';
        
        -- Try to drop without CASCADE first (safer - will fail if dependencies exist)
        BEGIN
            DROP EXTENSION postgis;
            RAISE NOTICE 'PostGIS extension removed successfully';
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Failed to drop PostGIS extension: %', SQLERRM;
            RAISE NOTICE 'PostGIS has dependent objects that must be removed first';
            RAISE NOTICE 'To force removal (DESTRUCTIVE): DROP EXTENSION postgis CASCADE;';
            RAISE EXCEPTION 'PostGIS removal failed. See warnings above for details.';
        END;
    ELSE
        RAISE NOTICE 'PostGIS extension is not installed, rollback not needed';
    END IF;
END $$;

-- Verify PostGIS was removed
SELECT COUNT(*) AS postgis_extensions_remaining
FROM pg_extension
WHERE extname = 'postgis';

COMMIT;

RAISE NOTICE 'Rollback 002 complete. PostGIS extension removed (if it was installed).';
RAISE WARNING 'PostGIS spatial functions (ST_Distance, ST_DWithin, etc.) are no longer available.';
RAISE NOTICE 'To re-enable PostGIS, re-run migration 002_enable_postgis.sql';

-- =====================================================
-- Alternative: Forced Removal with CASCADE
-- =====================================================
-- If the above script fails due to dependent objects and you want to
-- force removal of PostGIS and all dependent objects, you can manually run:
--
-- BEGIN;
-- DROP EXTENSION IF EXISTS postgis CASCADE;
-- COMMIT;
--
-- WARNING: This will delete ALL geographic columns, spatial indexes,
-- and any other objects that depend on PostGIS. Use only if you are
-- certain you want to remove all spatial functionality from the database.
--
-- After CASCADE drop, you will need to:
-- 1. Re-create any tables that had geographic columns
-- 2. Re-import any data that was in those tables
-- 3. Re-create any indexes, views, or functions that used PostGIS
-- =====================================================


