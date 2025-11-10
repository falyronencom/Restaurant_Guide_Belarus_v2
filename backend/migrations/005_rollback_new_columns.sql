-- =====================================================
-- Rollback 005: Remove New Columns
-- =====================================================
-- Purpose: Remove columns added in migration 005
--
-- Columns to remove:
-- - average_check_byn
-- - is_24_hours
-- - primary_image_url
--
-- WARNING: This rollback is DESTRUCTIVE. All data in these columns will be
-- permanently deleted. Only use this rollback if:
-- - Migration 005 failed and needs to be re-run
-- - Schema changes were incorrect and need to be revised
-- - Rolling back entire migration sequence
--
-- In production, consider backing up data from these columns before rollback.
-- =====================================================

BEGIN;

-- Drop check constraint first (depends on average_check_byn column)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'establishments' 
        AND constraint_name = 'check_average_check_positive'
    ) THEN
        ALTER TABLE establishments
        DROP CONSTRAINT check_average_check_positive;
        
        RAISE NOTICE 'Dropped constraint check_average_check_positive';
    END IF;
END $$;

-- Drop average_check_byn column
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'establishments' 
        AND column_name = 'average_check_byn'
    ) THEN
        ALTER TABLE establishments
        DROP COLUMN average_check_byn;
        
        RAISE NOTICE 'Dropped column average_check_byn';
        RAISE WARNING 'Average check data has been permanently deleted';
    END IF;
END $$;

-- Drop is_24_hours column
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'establishments' 
        AND column_name = 'is_24_hours'
    ) THEN
        ALTER TABLE establishments
        DROP COLUMN is_24_hours;
        
        RAISE NOTICE 'Dropped column is_24_hours';
        RAISE WARNING '24-hour establishment flags have been permanently deleted';
    END IF;
END $$;

-- Drop primary_image_url column
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'establishments' 
        AND column_name = 'primary_image_url'
    ) THEN
        ALTER TABLE establishments
        DROP COLUMN primary_image_url;
        
        RAISE NOTICE 'Dropped column primary_image_url';
        RAISE WARNING 'Primary image URL data has been permanently deleted';
        RAISE NOTICE 'Original images still exist in establishment_media table if applicable';
    END IF;
END $$;

-- Verify columns were dropped
SELECT column_name 
FROM information_schema.columns
WHERE table_name = 'establishments'
AND column_name IN ('average_check_byn', 'is_24_hours', 'primary_image_url');

COMMIT;

RAISE NOTICE 'Rollback 005 complete. New columns removed.';
RAISE NOTICE 'To restore columns, re-run migration 005_add_new_columns.sql';
RAISE WARNING 'Data in removed columns is permanently lost and cannot be restored by re-running migration';

