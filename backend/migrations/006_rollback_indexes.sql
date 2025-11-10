-- =====================================================
-- Rollback 006: Drop Performance Indexes
-- =====================================================
-- Purpose: Remove indexes created in migration 006
--
-- This rollback is safe and non-destructive. Dropping indexes does not
-- delete any data, only removes index structures used for query optimization.
-- After rollback, queries will still work but may be slower.
--
-- Use this rollback if:
-- - Index creation failed partway through
-- - Need to rebuild indexes with different parameters
-- - Troubleshooting query performance issues
-- =====================================================

BEGIN;

-- Drop indexes in reverse order of creation
-- Using IF EXISTS makes this script idempotent

DROP INDEX IF EXISTS idx_establishments_city_category_rating;
RAISE NOTICE 'Dropped composite index idx_establishments_city_category_rating';

DROP INDEX IF EXISTS idx_establishments_city;
RAISE NOTICE 'Dropped index idx_establishments_city';

DROP INDEX IF EXISTS idx_establishments_features;
RAISE NOTICE 'Dropped GIN index idx_establishments_features';

DROP INDEX IF EXISTS idx_establishments_rating;
RAISE NOTICE 'Dropped index idx_establishments_rating';

DROP INDEX IF EXISTS idx_establishments_subscription_tier;
RAISE NOTICE 'Dropped index idx_establishments_subscription_tier';

DROP INDEX IF EXISTS idx_establishments_price_range;
RAISE NOTICE 'Dropped index idx_establishments_price_range';

DROP INDEX IF EXISTS idx_establishments_cuisine_type;
RAISE NOTICE 'Dropped GIN index idx_establishments_cuisine_type';

DROP INDEX IF EXISTS idx_establishments_category;
RAISE NOTICE 'Dropped index idx_establishments_category';

DROP INDEX IF EXISTS idx_establishments_location;
RAISE NOTICE 'Dropped critical spatial GIST index idx_establishments_location';
RAISE WARNING 'Search queries will be significantly slower without spatial index';

-- Verify all indexes were dropped
SELECT COUNT(*) AS remaining_custom_indexes
FROM pg_indexes
WHERE tablename = 'establishments'
AND indexname LIKE 'idx_establishments_%';

COMMIT;

RAISE NOTICE 'Rollback 006 complete. All performance indexes removed.';
RAISE NOTICE 'To restore indexes, re-run migration 006_create_indexes.sql';

