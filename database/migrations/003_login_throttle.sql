-- =============================================================================
-- Migration 003: Login brute-force throttling
-- =============================================================================
-- This migration is IDEMPOTENT (safe to run multiple times).
--
-- Adds per-user login throttle state so repeated failed logins lock an account
-- for a configurable window.  State lives on the users table (rather than in
-- process memory) so the lockout is consistent across all Gunicorn workers and
-- survives restarts.
--
--   failed_login_count    consecutive failed attempts since the last success
--   locked_until          NULL, or the timestamp until which login is blocked
--   last_failed_login_at  timestamp of the most recent failed attempt
--
-- ALTER TABLE ... ADD COLUMN is DDL and is not affected by the row-level
-- security policies enabled in migration 002.
-- =============================================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until         TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMPTZ;

COMMIT;
