-- =====================================================
-- Migration 008: Fix price_range Column Length
-- =====================================================
-- Purpose: Extend price_range to support 4-dollar signs ($$$$)
--
-- Problem: Current schema has VARCHAR(3) which only supports
-- up to $$$ (3 characters). Test data and real-world scenarios
-- need support for $$$$ (4 characters) for luxury establishments.
--
-- Changes:
-- 1. Drop existing CHECK constraint on price_range
-- 2. Alter column type from VARCHAR(3) to VARCHAR(4)
-- 3. Add new CHECK constraint with '$$$$' included
--
-- Impact: Non-breaking change. Existing data remains valid.
-- No data transformation needed.
-- =====================================================

BEGIN;

-- =====================================================
-- Step 1: Drop existing CHECK constraint
-- =====================================================

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- Find the CHECK constraint on price_range
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'establishments'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%price_range%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE establishments DROP CONSTRAINT %I', constraint_name);
        RAISE NOTICE 'Dropped existing CHECK constraint: %', constraint_name;
    ELSE
        RAISE NOTICE 'No CHECK constraint found on price_range, skipping drop';
    END IF;
END $$;

-- =====================================================
-- Step 2: Alter column type to VARCHAR(4)
-- =====================================================

DO $$
BEGIN
    -- Alter price_range column from VARCHAR(3) to VARCHAR(4)
    ALTER TABLE establishments
    ALTER COLUMN price_range TYPE VARCHAR(4);

    RAISE NOTICE 'Altered price_range column type to VARCHAR(4)';
END $$;

-- =====================================================
-- Step 3: Add new CHECK constraint with $$$$ support
-- =====================================================

-- Note: Using direct ALTER instead of DO block to avoid $ escaping issues
ALTER TABLE establishments
ADD CONSTRAINT check_price_range_valid
CHECK (price_range IN ('$', '$$', '$$$', '$$$$'));

-- =====================================================
-- Step 4: Validation
-- =====================================================

-- Verify column type changed
SELECT
    column_name,
    data_type,
    character_maximum_length
FROM information_schema.columns
WHERE table_name = 'establishments'
AND column_name = 'price_range';

-- Verify constraint exists
SELECT
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'establishments'::regclass
AND contype = 'c'
AND conname = 'check_price_range_valid';

-- Show current price_range distribution
SELECT
    'Current price_range distribution' AS summary,
    price_range,
    COUNT(*) AS count
FROM establishments
GROUP BY price_range
ORDER BY price_range;

COMMIT;

-- =====================================================
-- Post-Migration Notes
-- =====================================================
-- After this migration:
--
-- 1. All existing data remains valid (no changes needed)
-- 2. New establishments can use $$$$ for luxury tier
-- 3. Tests using $$$$ will no longer fail with constraint error
-- 4. price_range column now accepts: '$', '$$', '$$$', '$$$$'
--
-- Rollback available: 008_rollback_price_range_length.sql
-- =====================================================
