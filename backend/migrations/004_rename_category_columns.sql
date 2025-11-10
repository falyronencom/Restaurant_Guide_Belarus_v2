-- =====================================================
-- Migration 004: Rename and Transform Category Columns
-- =====================================================
-- Purpose: Align category column names and types with Search system requirements
--
-- This is the most complex migration because it involves data transformation:
-- 1. Convert categories ARRAY to single category VARCHAR
-- 2. Rename cuisines to cuisine_type  
-- 3. Rename working_hours to operating_hours
-- 4. Transform attributes JSONB to features TEXT[]
--
-- Data Transformation Challenges:
-- - Categories array to single category: Some establishments may have multiple
--   categories. We take the first element as primary, with fallback to 'restaurant'.
-- - Attributes JSONB to features array: JSONB may contain structured data.
--   We extract keys that look like feature flags into a simple array.
--
-- Lossy Transformations:
-- The categories array to single category conversion is lossy if multiple
-- categories exist. The rollback script cannot perfectly restore the original
-- array. This is documented and acceptable for development phase.
-- =====================================================

BEGIN;

-- =====================================================
-- Step 1: Add new category column (singular)
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'establishments' 
        AND column_name = 'category'
    ) THEN
        -- Add category as VARCHAR(100) to store single primary category
        ALTER TABLE establishments
        ADD COLUMN category VARCHAR(100);
        
        RAISE NOTICE 'Added category column (singular)';
    ELSE
        RAISE NOTICE 'Category column already exists, skipping creation';
    END IF;
    
    -- Make old categories column nullable (we use new category column now)
    ALTER TABLE establishments 
    ALTER COLUMN categories DROP NOT NULL;
    
    RAISE NOTICE 'Made categories column nullable';
END $$;

-- =====================================================
-- Step 2: Populate category from categories array
-- =====================================================

DO $$
DECLARE
    updated_count INTEGER;
    multi_category_count INTEGER;
BEGIN
    -- Handle different scenarios for categories array
    -- Scenario A: categories array has one element - use it
    -- Scenario B: categories array has multiple elements - take first
    -- Scenario C: categories array is empty/null - default to 'restaurant'
    
    UPDATE establishments
    SET category = CASE
        -- If categories array has at least one element, take the first
        WHEN categories IS NOT NULL AND array_length(categories, 1) > 0 
        THEN categories[1]
        -- Otherwise default to 'restaurant' as most common type
        ELSE 'restaurant'
    END
    WHERE category IS NULL;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Populated category for % establishments', updated_count;
    
    -- Report how many establishments had multiple categories (lossy conversion)
    SELECT COUNT(*) INTO multi_category_count
    FROM establishments
    WHERE categories IS NOT NULL AND array_length(categories, 1) > 1;
    
    IF multi_category_count > 0 THEN
        RAISE WARNING '% establishments had multiple categories. Only the first was kept.', multi_category_count;
        RAISE NOTICE 'This is expected behavior. Review these establishments manually if needed:';
        
        -- Log the establishments with multiple categories for manual review
        RAISE NOTICE 'Establishments with multiple categories: %', (
            SELECT string_agg(name || ' (' || array_to_string(categories, ', ') || ')', '; ')
            FROM establishments
            WHERE categories IS NOT NULL AND array_length(categories, 1) > 1
        );
    END IF;
END $$;

-- =====================================================
-- Step 3: Rename cuisines to cuisine_type
-- =====================================================

DO $$
BEGIN
    -- Check if old column exists and new column doesn't
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'establishments' AND column_name = 'cuisines'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'establishments' AND column_name = 'cuisine_type'
    ) THEN
        ALTER TABLE establishments
        RENAME COLUMN cuisines TO cuisine_type;
        
        RAISE NOTICE 'Renamed cuisines column to cuisine_type';
    ELSE
        RAISE NOTICE 'Column rename cuisines->cuisine_type already completed or not needed';
    END IF;
END $$;

-- =====================================================
-- Step 4: Rename working_hours to operating_hours
-- =====================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'establishments' AND column_name = 'working_hours'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'establishments' AND column_name = 'operating_hours'
    ) THEN
        ALTER TABLE establishments
        RENAME COLUMN working_hours TO operating_hours;
        
        RAISE NOTICE 'Renamed working_hours column to operating_hours';
    ELSE
        RAISE NOTICE 'Column rename working_hours->operating_hours already completed or not needed';
    END IF;
END $$;

-- =====================================================
-- Step 5: Add features column and populate from attributes
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'establishments' 
        AND column_name = 'features'
    ) THEN
        -- Add features as TEXT array
        ALTER TABLE establishments
        ADD COLUMN features TEXT[] DEFAULT '{}';
        
        RAISE NOTICE 'Added features column as TEXT[]';
    ELSE
        RAISE NOTICE 'Features column already exists, skipping creation';
    END IF;
END $$;

DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    -- Transform attributes JSONB to features array
    -- Extract top-level keys from JSONB that look like feature flags
    -- Common attribute keys: wifi, parking, outdoor_seating, accepts_cards, etc.
    
    UPDATE establishments
    SET features = CASE
        -- If attributes is a JSONB object, extract its keys as feature array
        WHEN attributes IS NOT NULL AND jsonb_typeof(attributes) = 'object'
        THEN ARRAY(
            SELECT jsonb_object_keys(attributes)
        )
        -- Otherwise default to empty array
        ELSE '{}'::TEXT[]
    END
    WHERE features = '{}' OR features IS NULL;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Populated features from attributes for % establishments', updated_count;
    
    -- Display sample of extracted features
    RAISE NOTICE 'Sample features extracted: %', (
        SELECT string_agg(DISTINCT unnest, ', ')
        FROM (
            SELECT unnest(features)
            FROM establishments
            WHERE features IS NOT NULL AND array_length(features, 1) > 0
            LIMIT 20
        ) sub
    );
END $$;

-- =====================================================
-- Step 6: Validation and statistics
-- =====================================================

SELECT 
    'Migration 004 Statistics' AS summary,
    COUNT(*) AS total_establishments,
    COUNT(category) AS with_category,
    COUNT(cuisine_type) AS with_cuisine_type,
    COUNT(operating_hours) AS with_operating_hours,
    COUNT(CASE WHEN array_length(features, 1) > 0 THEN 1 END) AS with_features
FROM establishments;

-- Show sample of migrated data
SELECT 
    name,
    category,
    cuisine_type[1:2] AS sample_cuisines,
    array_length(features, 1) AS feature_count,
    features[1:3] AS sample_features
FROM establishments
WHERE category IS NOT NULL
LIMIT 5;

COMMIT;

-- =====================================================
-- Post-Migration Notes
-- =====================================================
-- Important considerations:
--
-- 1. Multiple categories: If establishments had multiple categories, only
--    the first was kept. Review establishments manually if this causes
--    incorrect categorization.
--
-- 2. Attributes transformation: The conversion from JSONB to TEXT array
--    extracts only top-level keys. Nested JSONB structures are not preserved.
--    If attributes contained complex data, manual review may be needed.
--
-- 3. Old columns still exist: categories and attributes columns are not
--    dropped yet. They can be dropped in a future migration after confirming
--    the new schema works correctly.
--
-- Verification queries:
--
-- SELECT DISTINCT category FROM establishments ORDER BY category;
-- Should show clean list of categories: restaurant, cafe, bar, etc.
--
-- SELECT name, categories, category 
-- FROM establishments 
-- WHERE array_length(categories, 1) > 1;
-- Shows establishments where category conversion was lossy
-- =====================================================

