-- =====================================================
-- REVIEWS SYSTEM SCHEMA MIGRATION
-- =====================================================
-- Migration Version: 2.1
-- Purpose: Align reviews table with Reviews System Implementation directive
-- Date: October 16, 2025
-- Implementer: Leaf Session - Reviews Backend Implementation
-- =====================================================

-- This migration updates the existing reviews table to match the requirements
-- specified in the Reviews System Backend Implementation Directive v1.0.
-- The migration is designed to be backward compatible and can be rolled back.

BEGIN;

-- =====================================================
-- STEP 1: Add missing columns required by directive
-- =====================================================

-- Add is_deleted column for soft deletion pattern
-- This allows reviews to be hidden from public queries while preserving data
-- for potential restoration or auditing purposes
ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

-- Add content column as the new standard name for review text
-- The directive specifies 'content' as the column name, but current schema uses 'text'
-- We'll add content column and migrate data from text column
ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS content TEXT;

-- =====================================================
-- STEP 2: Migrate existing data
-- =====================================================

-- Copy existing text data to new content column
-- This ensures no data loss during migration
UPDATE reviews 
SET content = text 
WHERE content IS NULL AND text IS NOT NULL;

-- For reviews that have no text, set a default message
-- This handles edge cases in existing data
UPDATE reviews 
SET content = 'No content provided' 
WHERE content IS NULL OR content = '';

-- =====================================================
-- STEP 3: Add constraints to content column
-- =====================================================

-- Make content column NOT NULL after migration
ALTER TABLE reviews 
ALTER COLUMN content SET NOT NULL;

-- Add length constraint: minimum 20 characters, maximum 1000 characters
-- This enforces quality standards for reviews as specified in directive
ALTER TABLE reviews 
ADD CONSTRAINT check_content_length 
CHECK (length(content) >= 20 AND length(content) <= 1000);

-- =====================================================
-- STEP 4: Update existing constraints
-- =====================================================

-- Drop the old UNIQUE constraint and recreate it to exclude deleted reviews
-- This allows the same user to review the same establishment again after deleting previous review
-- However, only one active (non-deleted) review per user per establishment is allowed
ALTER TABLE reviews 
DROP CONSTRAINT IF EXISTS reviews_user_id_establishment_id_key;

-- Create partial unique index that only applies to non-deleted reviews
-- This is more efficient than a unique constraint and allows deleted reviews to exist
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_user_establishment_active 
ON reviews(user_id, establishment_id) 
WHERE is_deleted = false;

-- =====================================================
-- STEP 5: Add or verify indexes for performance
-- =====================================================

-- Index on establishment_id for filtering reviews by establishment
-- This is the most common query pattern: "get all reviews for this restaurant"
CREATE INDEX IF NOT EXISTS idx_reviews_establishment 
ON reviews(establishment_id) 
WHERE is_deleted = false;

-- Index on user_id for filtering reviews by author
-- Used for user profile pages showing all reviews written by a specific user
CREATE INDEX IF NOT EXISTS idx_reviews_user 
ON reviews(user_id) 
WHERE is_deleted = false;

-- Index on created_at for temporal sorting
-- Most queries want newest reviews first, this index makes that efficient
CREATE INDEX IF NOT EXISTS idx_reviews_created_at 
ON reviews(created_at DESC) 
WHERE is_deleted = false;

-- Index on rating for rating-based sorting
-- Supports "highest rated first" and "lowest rated first" sort orders
CREATE INDEX IF NOT EXISTS idx_reviews_rating 
ON reviews(rating DESC) 
WHERE is_deleted = false;

-- Composite index for establishment reviews with common sort patterns
-- Optimizes the frequent query: get establishment reviews sorted by date
CREATE INDEX IF NOT EXISTS idx_reviews_establishment_created 
ON reviews(establishment_id, created_at DESC) 
WHERE is_deleted = false;

-- =====================================================
-- STEP 6: Verify or add aggregate columns to establishments table
-- =====================================================

-- These columns store pre-calculated review statistics for each establishment
-- They are updated synchronously whenever a review is created, updated, or deleted

-- Add average_rating column if it doesn't exist
-- Stores the average rating across all non-deleted reviews for the establishment
ALTER TABLE establishments 
ADD COLUMN IF NOT EXISTS average_rating DECIMAL(3,2);

-- Add review_count column if it doesn't exist
-- Stores the total count of non-deleted reviews for the establishment
ALTER TABLE establishments 
ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0;

-- =====================================================
-- STEP 7: Create or replace aggregate update function
-- =====================================================

-- This function recalculates and updates the aggregate statistics for an establishment
-- It's called manually from application code after review operations
-- The directive specifies synchronous updates for MVP simplicity

CREATE OR REPLACE FUNCTION update_establishment_review_aggregates(establishment_uuid UUID)
RETURNS void AS $$
BEGIN
  UPDATE establishments
  SET 
    average_rating = (
      SELECT AVG(rating)::DECIMAL(3,2)
      FROM reviews
      WHERE establishment_id = establishment_uuid
      AND is_deleted = false
    ),
    review_count = (
      SELECT COUNT(*)
      FROM reviews
      WHERE establishment_id = establishment_uuid
      AND is_deleted = false
    ),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = establishment_uuid;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the function's purpose
COMMENT ON FUNCTION update_establishment_review_aggregates IS 
'Recalculates and updates average_rating and review_count for a specific establishment based on non-deleted reviews. Called synchronously by application code after review create/update/delete operations.';

-- =====================================================
-- STEP 8: Recalculate aggregates for all existing establishments
-- =====================================================

-- Update all establishments with current aggregate statistics
-- This ensures consistency between existing review data and aggregate columns
UPDATE establishments e
SET 
  average_rating = (
    SELECT AVG(rating)::DECIMAL(3,2)
    FROM reviews r
    WHERE r.establishment_id = e.id
    AND r.is_deleted = false
  ),
  review_count = (
    SELECT COUNT(*)
    FROM reviews r
    WHERE r.establishment_id = e.id
    AND r.is_deleted = false
  );

-- =====================================================
-- STEP 9: Add helpful database comments
-- =====================================================

COMMENT ON COLUMN reviews.content IS 
'Review text content. Must be between 20 and 1000 characters. This is the users detailed feedback about their dining experience.';

COMMENT ON COLUMN reviews.is_deleted IS 
'Soft deletion flag. When true, review is hidden from public queries but preserved in database for potential restoration or auditing. Deleted reviews do not count toward establishment aggregates.';

COMMENT ON COLUMN reviews.text IS 
'DEPRECATED: Legacy column from schema v2.0. Use content column instead. Kept for backward compatibility during migration period.';

COMMENT ON INDEX idx_reviews_user_establishment_active IS 
'Ensures one active (non-deleted) review per user per establishment. Deleted reviews are excluded from uniqueness constraint.';

COMMIT;

-- =====================================================
-- VALIDATION QUERIES
-- =====================================================

-- After running this migration, execute these queries to verify success:

-- 1. Verify content column exists and has correct constraints
-- SELECT column_name, data_type, is_nullable, character_maximum_length
-- FROM information_schema.columns
-- WHERE table_name = 'reviews' AND column_name = 'content';

-- 2. Verify is_deleted column exists
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'reviews' AND column_name = 'is_deleted';

-- 3. Check that all reviews have content with proper length
-- SELECT COUNT(*) as total_reviews,
--        COUNT(*) FILTER (WHERE length(content) >= 20 AND length(content) <= 1000) as valid_content_length,
--        COUNT(*) FILTER (WHERE length(content) < 20) as too_short,
--        COUNT(*) FILTER (WHERE length(content) > 1000) as too_long
-- FROM reviews;

-- 4. Verify indexes were created
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'reviews'
-- ORDER BY indexname;

-- 5. Verify aggregate columns exist in establishments
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'establishments' AND column_name IN ('average_rating', 'review_count');

-- 6. Verify aggregates are calculated correctly (spot check)
-- SELECT e.id, e.name, e.review_count, e.average_rating,
--        COUNT(r.id) as actual_review_count,
--        AVG(r.rating)::DECIMAL(3,2) as actual_avg_rating
-- FROM establishments e
-- LEFT JOIN reviews r ON r.establishment_id = e.id AND r.is_deleted = false
-- GROUP BY e.id, e.name, e.review_count, e.average_rating
-- HAVING e.review_count != COUNT(r.id) OR e.average_rating != AVG(r.rating)::DECIMAL(3,2)
-- LIMIT 10;

-- =====================================================
-- ROLLBACK SCRIPT
-- =====================================================

-- If this migration needs to be rolled back, execute the following:

/*
BEGIN;

-- Remove new indexes
DROP INDEX IF EXISTS idx_reviews_user_establishment_active;
DROP INDEX IF EXISTS idx_reviews_establishment;
DROP INDEX IF EXISTS idx_reviews_user;
DROP INDEX IF EXISTS idx_reviews_created_at;
DROP INDEX IF EXISTS idx_reviews_rating;
DROP INDEX IF EXISTS idx_reviews_establishment_created;

-- Restore original unique constraint
ALTER TABLE reviews 
ADD CONSTRAINT reviews_user_id_establishment_id_key 
UNIQUE (user_id, establishment_id);

-- Remove new columns (this will lose data in content column if text was empty)
ALTER TABLE reviews DROP COLUMN IF EXISTS is_deleted;
ALTER TABLE reviews DROP COLUMN IF EXISTS content;

-- Remove aggregate function
DROP FUNCTION IF EXISTS update_establishment_review_aggregates(UUID);

-- Remove aggregate columns from establishments (this will lose calculated data)
ALTER TABLE establishments DROP COLUMN IF EXISTS average_rating;
ALTER TABLE establishments DROP COLUMN IF EXISTS review_count;

COMMIT;
*/

