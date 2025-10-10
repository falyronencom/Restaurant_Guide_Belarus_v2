-- Migration: Add Token Rotation Columns to refresh_tokens
-- Date: 2025-10-10
-- Purpose: Implement strict refresh token rotation for security
--
-- This migration adds columns required for single-use refresh token rotation,
-- which prevents token reuse attacks. See AUTH_IMPLEMENTATION_NOTES.md for details.

-- Add used_at timestamp to track when token was consumed
ALTER TABLE refresh_tokens 
ADD COLUMN IF NOT EXISTS used_at TIMESTAMP;

-- Add replaced_by to track token replacement chain
ALTER TABLE refresh_tokens 
ADD COLUMN IF NOT EXISTS replaced_by UUID REFERENCES refresh_tokens(id);

-- Create index for efficient queries on used_at
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_used_at ON refresh_tokens(used_at);

-- Comment on columns for documentation
COMMENT ON COLUMN refresh_tokens.used_at IS 'Timestamp when this token was used for refresh. NULL means token is still valid. Non-NULL indicates token has been consumed and should not be accepted.';

COMMENT ON COLUMN refresh_tokens.replaced_by IS 'ID of the new refresh token that replaced this one during rotation. Useful for audit trail and debugging.';

