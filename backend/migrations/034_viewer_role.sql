-- Migration 034: viewer role — read-only account for the admin panel
--
-- Coordinator decision 2026-09-08 (SDL CAT-C-2.11): the admin panel moves
-- from the operator's machine to a hosted Railway service and may be shown
-- to a third party (a prospective partner) by one of our own people. A full
-- admin account cannot be handed out for that — every button in the panel
-- acts on real partners — so the panel gets a second role that can read
-- everything and change nothing. The split lives in the API, not only in
-- the UI: adminRoutes.js keeps two access tiers and the login gate accepts
-- both roles (backend/src/config/panelRoles.js).
--
-- Deploy order is NOT load-bearing: code deployed before this migration keeps
-- working unchanged — `viewer` simply cannot be inserted until the CHECK is
-- widened (scripts/create-viewer.js fails on the constraint with a hint, no
-- runtime path is affected). Apply on Railway MANUALLY after merge (operator
-- action, runbook docs/deployment/railway_admin_web.md, script
-- backend/scripts/apply-migration-production.js); regenerate
-- production_schema.sql only after that — the snapshot mirrors production,
-- not the catalogue.
--
-- Idempotent (DROP CONSTRAINT IF EXISTS + ADD). The constraint name is the
-- one pg_dump shows for production (users_role_check); `role IN (...)` is
-- the same predicate pg_dump prints as `= ANY (ARRAY[...])`.
-- Rollback: 034_rollback_viewer_role.sql.

BEGIN;

-- Resolve unqualified table names regardless of inherited session search_path.
SET search_path TO public;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('user', 'partner', 'admin', 'viewer'));

COMMIT;
