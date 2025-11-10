-- =====================================================
-- Migration 005: Add New Required Columns
-- =====================================================
-- Purpose: Add columns required by Search and Discovery System
--
-- New columns added:
-- 1. average_check_byn - Typical meal cost in Belarusian rubles
-- 2. is_24_hours - Flag for 24-hour establishments
-- 3. primary_image_url - URL to main establishment image
--
-- Why these columns?
--
-- average_check_byn:
-- Users want to know approximate cost before visiting. Price range ($, $$, $$$)
-- gives general idea, but specific amount in local currency (BYN) is more
-- actionable. Enables filtering like "show restaurants under 30 BYN".
--
-- is_24_hours:
-- Belarus has growing number of 24-hour establishments, especially in Minsk.
-- Users searching late at night specifically want places currently open.
-- This flag enables instant filtering without parsing operating_hours JSON.
-- Performance optimization that also improves UX.
--
-- primary_image_url:
-- Search results need one image per establishment in list view. Rather than
-- joining to establishment_media table for every search query (expensive),
-- we denormalize by storing primary image URL directly. Classic database
-- optimization trading normalization for query performance.
-- =====================================================

BEGIN;

-- =====================================================
-- Step 1: Add average_check_byn column
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'establishments' 
        AND column_name = 'average_check_byn'
    ) THEN
        -- DECIMAL(10, 2) allows values up to 99,999,999.99
        -- More than sufficient for meal costs (realistic range: 10-100 BYN)
        -- Two decimal places for kopeks (subdivisions of rubles)
        ALTER TABLE establishments
        ADD COLUMN average_check_byn DECIMAL(10, 2),
        ADD CONSTRAINT check_average_check_positive 
            CHECK (average_check_byn IS NULL OR average_check_byn > 0);
        
        RAISE NOTICE 'Added average_check_byn column with positive value constraint';
    ELSE
        RAISE NOTICE 'Column average_check_byn already exists, skipping';
    END IF;
END $$;

-- Populate initial values based on price_range if possible
-- This provides reasonable defaults for existing establishments
DO $BODY$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE establishments
    SET average_check_byn = CASE price_range
        -- Budget establishments: 10-20 BYN average
        WHEN '$' THEN 15.00
        -- Moderate establishments: 25-40 BYN average  
        WHEN '$$' THEN 30.00
        -- Upscale establishments: 50-80 BYN average
        WHEN '$$$' THEN 65.00
        -- If no price_range, default to moderate
        ELSE 25.00
    END
    WHERE average_check_byn IS NULL;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    IF updated_count > 0 THEN
        RAISE NOTICE 'Set default average_check_byn for % establishments based on price_range', updated_count;
        RAISE NOTICE 'Partners should update with actual values for accuracy';
    END IF;
END $BODY$;

-- =====================================================
-- Step 2: Add is_24_hours column
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'establishments' 
        AND column_name = 'is_24_hours'
    ) THEN
        -- Boolean flag with default false
        -- Most establishments are not 24-hour, so false is reasonable default
        ALTER TABLE establishments
        ADD COLUMN is_24_hours BOOLEAN DEFAULT FALSE NOT NULL;
        
        RAISE NOTICE 'Added is_24_hours column with default FALSE';
    ELSE
        RAISE NOTICE 'Column is_24_hours already exists, skipping';
    END IF;
END $$;

-- Optional: Try to detect 24-hour establishments from operating_hours JSONB
-- This is best-effort - manual review recommended
DO $$
DECLARE
    detected_count INTEGER;
BEGIN
    -- Look for patterns in operating_hours that suggest 24-hour operation
    -- This is heuristic and may not catch all cases
    UPDATE establishments
    SET is_24_hours = TRUE
    WHERE is_24_hours = FALSE
    AND operating_hours IS NOT NULL
    AND (
        -- Check if operating_hours contains "24" or "00:00-23:59" patterns
        operating_hours::text ILIKE '%24%hour%'
        OR operating_hours::text ILIKE '%00:00%23:59%'
        OR operating_hours::text ILIKE '%круглосуточно%'
    );
    
    GET DIAGNOSTICS detected_count = ROW_COUNT;
    
    IF detected_count > 0 THEN
        RAISE NOTICE 'Detected % potentially 24-hour establishments from operating_hours', detected_count;
        RAISE NOTICE 'Please manually verify these establishments:';
        
        -- Display detected 24-hour establishments for review
        RAISE NOTICE '%', (
            SELECT string_agg(name, ', ')
            FROM establishments
            WHERE is_24_hours = TRUE
            LIMIT 10
        );
    END IF;
END $$;

-- =====================================================
-- Step 3: Add primary_image_url column
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'establishments' 
        AND column_name = 'primary_image_url'
    ) THEN
        -- TEXT type to accommodate long URLs
        -- Nullable because not all establishments may have images initially
        ALTER TABLE establishments
        ADD COLUMN primary_image_url TEXT;
        
        RAISE NOTICE 'Added primary_image_url column';
    ELSE
        RAISE NOTICE 'Column primary_image_url already exists, skipping';
    END IF;
END $$;

-- Attempt to populate primary_image_url from establishment_media table
-- if it exists and has media records marked as primary
DO $$
DECLARE
    updated_count INTEGER;
    media_table_exists BOOLEAN;
BEGIN
    -- Check if establishment_media table exists
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_name = 'establishment_media'
    ) INTO media_table_exists;
    
    IF media_table_exists THEN
        -- Update establishments with their primary image from media table
        UPDATE establishments e
        SET primary_image_url = m.url
        FROM establishment_media m
        WHERE m.establishment_id = e.id
        AND m.is_primary = TRUE
        AND e.primary_image_url IS NULL;
        
        GET DIAGNOSTICS updated_count = ROW_COUNT;
        
        IF updated_count > 0 THEN
            RAISE NOTICE 'Populated primary_image_url for % establishments from establishment_media', updated_count;
        ELSE
            RAISE NOTICE 'No primary images found in establishment_media table';
        END IF;
    ELSE
        RAISE NOTICE 'establishment_media table does not exist, skipping image population';
    END IF;
END $$;

-- =====================================================
-- Step 4: Validation and statistics
-- =====================================================

SELECT 
    'Migration 005 Statistics' AS summary,
    COUNT(*) AS total_establishments,
    COUNT(average_check_byn) AS with_average_check,
    AVG(average_check_byn)::DECIMAL(10,2) AS avg_check_overall,
    MIN(average_check_byn)::DECIMAL(10,2) AS min_check,
    MAX(average_check_byn)::DECIMAL(10,2) AS max_check,
    COUNT(CASE WHEN is_24_hours = TRUE THEN 1 END) AS count_24_hour,
    COUNT(primary_image_url) AS with_primary_image
FROM establishments;

-- Show sample of new column values
SELECT 
    name,
    price_range,
    average_check_byn,
    is_24_hours,
    CASE 
        WHEN primary_image_url IS NOT NULL 
        THEN LEFT(primary_image_url, 50) || '...'
        ELSE NULL 
    END AS image_url_preview
FROM establishments
LIMIT 10;

COMMIT;

-- =====================================================
-- Post-Migration Actions
-- =====================================================
-- After this migration:
--
-- 1. Review average_check_byn values:
--    SELECT name, price_range, average_check_byn 
--    FROM establishments 
--    ORDER BY average_check_byn;
--    
--    Verify values are realistic for Belarus market.
--    Budget should be 10-20 BYN, moderate 20-40 BYN, upscale 40-80 BYN.
--
-- 2. Verify 24-hour establishments:
--    SELECT name, is_24_hours, operating_hours 
--    FROM establishments 
--    WHERE is_24_hours = TRUE;
--    
--    Confirm these are actually 24-hour establishments.
--
-- 3. Check image coverage:
--    SELECT 
--      COUNT(*) AS total,
--      COUNT(primary_image_url) AS with_image,
--      ROUND(100.0 * COUNT(primary_image_url) / COUNT(*), 2) AS coverage_percent
--    FROM establishments;
--    
--    Low coverage is expected if media hasn't been uploaded yet.
--    Partners should be encouraged to upload primary images.
-- =====================================================

