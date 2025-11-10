-- =====================================================
-- Rollback 004: Revert Category Column Transformations
-- =====================================================
-- Purpose: Revert column renames and transformations from migration 004
--
-- Actions performed:
-- - Rename cuisine_type back to cuisines
-- - Rename operating_hours back to working_hours
-- - Drop category column (singular)
-- - Drop features column
--
-- IMPORTANT LIMITATION - LOSSY ROLLBACK:
-- The original migration converted categories array to single category.
-- This rollback CANNOT restore the original categories array because
-- that information was lost during the forward migration.
--
-- Similarly, features was extracted from attributes JSONB. The original
-- attributes structure cannot be fully reconstructed from the features array.
--
-- What happens to data:
-- - Old categories and attributes columns still exist (were not dropped)
--   so their original data is preserved
-- - New category and features columns will be dropped with their data
-- - Partners may need to re-enter category and feature data if migration
--   is re-run after this rollback
--
-- This is acceptable for development environment but would be problematic
-- in production with real user data.
-- =====================================================

BEGIN;

-- =====================================================
-- Step 1: Rename cuisine_type back to cuisines
-- =====================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'establishments' AND column_name = 'cuisine_type'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'establishments' AND column_name = 'cuisines'
    ) THEN
        ALTER TABLE establishments
        RENAME COLUMN cuisine_type TO cuisines;
        
        RAISE NOTICE 'Renamed cuisine_type back to cuisines';
    ELSE
        RAISE NOTICE 'Column rename cuisine_type->cuisines not needed or already done';
    END IF;
END $$;

-- =====================================================
-- Step 2: Rename operating_hours back to working_hours
-- =====================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'establishments' AND column_name = 'operating_hours'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'establishments' AND column_name = 'working_hours'
    ) THEN
        ALTER TABLE establishments
        RENAME COLUMN operating_hours TO working_hours;
        
        RAISE NOTICE 'Renamed operating_hours back to working_hours';
    ELSE
        RAISE NOTICE 'Column rename operating_hours->working_hours not needed or already done';
    END IF;
END $$;

-- =====================================================
-- Step 3: Drop category column (singular)
-- =====================================================

DO $$
DECLARE
    records_with_category INTEGER;
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'establishments' 
        AND column_name = 'category'
    ) THEN
        -- Count how many establishments have category data
        SELECT COUNT(*) INTO records_with_category
        FROM establishments
        WHERE category IS NOT NULL;
        
        -- Drop the column
        ALTER TABLE establishments
        DROP COLUMN category;
        
        RAISE NOTICE 'Dropped category column';
        
        IF records_with_category > 0 THEN
            RAISE WARNING 'Category data for % establishments has been permanently deleted', records_with_category;
            RAISE NOTICE 'Original categories array column still exists with original data';
            RAISE NOTICE 'If migration 004 is re-run, category will be recreated from categories array';
        END IF;
    ELSE
        RAISE NOTICE 'Category column does not exist, skipping drop';
    END IF;
END $$;

-- =====================================================
-- Step 4: Drop features column
-- =====================================================

DO $$
DECLARE
    records_with_features INTEGER;
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'establishments' 
        AND column_name = 'features'
    ) THEN
        -- Count how many establishments have features data
        SELECT COUNT(*) INTO records_with_features
        FROM establishments
        WHERE features IS NOT NULL AND array_length(features, 1) > 0;
        
        -- Drop the column
        ALTER TABLE establishments
        DROP COLUMN features;
        
        RAISE NOTICE 'Dropped features column';
        
        IF records_with_features > 0 THEN
            RAISE WARNING 'Features data for % establishments has been permanently deleted', records_with_features;
            RAISE NOTICE 'Original attributes JSONB column still exists with original data';
            RAISE NOTICE 'If migration 004 is re-run, features will be recreated from attributes';
        END IF;
    ELSE
        RAISE NOTICE 'Features column does not exist, skipping drop';
    END IF;
END $$;

-- =====================================================
-- Verification
-- =====================================================

-- Verify old column names restored and new columns removed
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'establishments'
AND column_name IN ('category', 'categories', 'cuisines', 'cuisine_type', 
                    'working_hours', 'operating_hours', 'attributes', 'features')
ORDER BY column_name;

COMMIT;

RAISE NOTICE 'Rollback 004 complete. Category transformations reverted.';
RAISE NOTICE 'Schema restored to pre-migration 004 state.';
RAISE WARNING 'Data in category and features columns is permanently lost.';
RAISE NOTICE 'Original categories and attributes columns preserved with their data.';
RAISE NOTICE 'To reapply transformations, re-run migration 004_rename_category_columns.sql';

