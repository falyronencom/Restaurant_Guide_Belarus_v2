-- =====================================================
-- Rollback Migration 008: Revert price_range to VARCHAR(3)
-- =====================================================
-- WARNING: This rollback will FAIL if any establishments
-- have price_range = '$$$$' (4 characters).
--
-- Before rolling back:
-- 1. Check if any establishments use $$$$:
--    SELECT COUNT(*) FROM establishments WHERE price_range = '$$$$';
-- 2. If count > 0, either:
--    a) Update those to $$$ before rollback, OR
--    b) Do not rollback (keep VARCHAR(4))
-- =====================================================

BEGIN;

-- =====================================================
-- Step 1: Verify no $$$$ values exist
-- =====================================================

DO $$
DECLARE
    luxury_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO luxury_count
    FROM establishments
    WHERE price_range = '$$$$';

    IF luxury_count > 0 THEN
        RAISE EXCEPTION 'Cannot rollback: % establishments have price_range = $$$$. Update them first.', luxury_count;
    ELSE
        RAISE NOTICE 'No establishments using $$$$, safe to rollback';
    END IF;
END $$;

-- =====================================================
-- Step 2: Drop new CHECK constraint
-- =====================================================

DO $$
BEGIN
    ALTER TABLE establishments
    DROP CONSTRAINT IF EXISTS check_price_range_valid;

    RAISE NOTICE 'Dropped check_price_range_valid constraint';
END $$;

-- =====================================================
-- Step 3: Revert column type to VARCHAR(3)
-- =====================================================

DO $$
BEGIN
    ALTER TABLE establishments
    ALTER COLUMN price_range TYPE VARCHAR(3);

    RAISE NOTICE 'Reverted price_range column type to VARCHAR(3)';
END $$;

-- =====================================================
-- Step 4: Restore original CHECK constraint
-- =====================================================

DO $$
BEGIN
    ALTER TABLE establishments
    ADD CONSTRAINT establishments_price_range_check
    CHECK (price_range IN ('$', '$$', '$$$'));

    RAISE NOTICE 'Restored original CHECK constraint (3 values only)';
END $$;

-- =====================================================
-- Step 5: Validation
-- =====================================================

SELECT
    column_name,
    data_type,
    character_maximum_length
FROM information_schema.columns
WHERE table_name = 'establishments'
AND column_name = 'price_range';

COMMIT;

-- =====================================================
-- Rollback Complete
-- =====================================================
-- price_range column reverted to VARCHAR(3)
-- CHECK constraint allows only: '$', '$$', '$$$'
-- =====================================================
