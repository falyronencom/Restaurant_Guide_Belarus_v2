-- =====================================================
-- Migration 002: Enable PostGIS Extension
-- =====================================================
-- Purpose: Enable PostGIS extension for geospatial functionality
-- 
-- What is PostGIS?
-- PostGIS extends PostgreSQL with support for geographic objects, allowing
-- location-based queries like "find all restaurants within 1km of this point".
-- It provides industry-standard functions for distance calculations on a
-- spherical Earth, which is critical for accurate geolocation search.
--
-- Why we need it:
-- The Search and Discovery System requires PostGIS geography types and
-- spatial functions (ST_Distance, ST_DWithin) for accurate proximity searches.
-- Without PostGIS, we cannot perform efficient location-based queries or
-- calculate distances correctly accounting for Earth's curvature.
--
-- Prerequisites:
-- - PostgreSQL 15+ with PostGIS support
-- - Recommended Docker image: postgis/postgis:15-3.3
-- - Database user must have CREATE EXTENSION privilege
--
-- If this migration fails with "extension not available" error, your
-- PostgreSQL installation does not include PostGIS. Please refer to
-- MIGRATION_GUIDE.md for instructions on switching to a PostGIS-enabled
-- Docker image.
-- =====================================================

BEGIN;

-- Check if PostGIS is available before attempting to create extension
DO $$
DECLARE
    postgis_available BOOLEAN;
BEGIN
    -- Query pg_available_extensions to see if PostGIS is installable
    SELECT EXISTS (
        SELECT 1 
        FROM pg_available_extensions 
        WHERE name = 'postgis'
    ) INTO postgis_available;
    
    IF NOT postgis_available THEN
        RAISE EXCEPTION 'PostGIS extension is not available in this PostgreSQL installation. 
        
        Current PostgreSQL version: %
        
        To fix this issue:
        1. Refer to MIGRATION_GUIDE.md section "Switching to PostGIS Docker Image"
        2. Update docker-compose.yml to use postgis/postgis:15-3.3 image
        3. Restart your Docker containers
        4. Re-run this migration
        
        Without PostGIS, the Search and Discovery System cannot function.
        ', version();
    END IF;
    
    RAISE NOTICE 'PostGIS extension is available. Proceeding with installation...';
END $$;

-- Create PostGIS extension if it doesn't already exist
-- This operation is idempotent - safe to run multiple times
CREATE EXTENSION IF NOT EXISTS postgis;

-- Verify PostGIS was installed successfully
DO $$
DECLARE
    postgis_version TEXT;
BEGIN
    SELECT extversion INTO postgis_version
    FROM pg_extension
    WHERE extname = 'postgis';
    
    IF postgis_version IS NULL THEN
        RAISE EXCEPTION 'PostGIS extension creation failed. Please check PostgreSQL logs.';
    END IF;
    
    RAISE NOTICE 'PostGIS extension successfully enabled. Version: %', postgis_version;
END $$;

-- Display installed PostGIS version for logging purposes
-- This helps with troubleshooting if spatial functions behave unexpectedly
SELECT PostGIS_Version() AS postgis_version,
       PostGIS_Full_Version() AS full_version;

COMMIT;

-- =====================================================
-- Post-Migration Verification
-- =====================================================
-- After running this migration, verify PostGIS is working:
--
-- SELECT PostGIS_Version();
-- Should return version string like "3.3 USE_GEOS=1 USE_PROJ=1..."
--
-- SELECT ST_Distance(
--   ST_MakePoint(27.561831, 53.902496)::geography,
--   ST_MakePoint(27.571831, 53.912496)::geography
-- );
-- Should return approximate distance in meters (~1400)
-- =====================================================

