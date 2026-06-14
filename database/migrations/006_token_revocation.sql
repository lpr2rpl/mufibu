-- =============================================================================
-- Migration 006: Token revocation watermark
-- =============================================================================
-- This migration is IDEMPOTENT (safe to run multiple times).
--
-- Adds a per-user revocation watermark.  JWTs are stateless; to revoke them
-- without a per-token store, the backend stamps each token with an iat
-- (issued-at) claim and rejects any token whose iat precedes the user's
-- tokens_valid_after value.  Bumping it to NOW() invalidates all of that user's
-- outstanding access and refresh tokens at once.
--
-- Used by logout, account deactivation/soft-delete, and the PowerAdmin
-- force-logout endpoint.  The column lives on users, so the existing users RLS
-- update policy (self or PowerAdmin) governs who may revoke whose tokens.
-- =============================================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_valid_after TIMESTAMPTZ;

COMMIT;
