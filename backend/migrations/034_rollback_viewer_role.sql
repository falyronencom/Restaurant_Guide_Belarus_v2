-- Rollback for Migration 034: narrow users.role back to user/partner/admin
--
-- Postgres validates a new CHECK against existing rows, so this refuses to
-- run while any `viewer` account exists. Demote or delete those accounts
-- first with an explicit statement of your own, e.g.
--   UPDATE users SET role = 'user' WHERE role = 'viewer';
-- Deliberately not automated here: a rollback must not change accounts
-- silently. Idempotent via IF EXISTS — safe to re-run.

BEGIN;

SET search_path TO public;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('user', 'partner', 'admin'));

COMMIT;
