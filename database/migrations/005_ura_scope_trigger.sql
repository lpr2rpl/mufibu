-- =============================================================================
-- Migration 005: Enforce role scope / tenant_id consistency
-- =============================================================================
-- This migration is IDEMPOTENT (safe to run multiple times).
--
-- The original schema declared this invariant as a CHECK constraint with a
-- subquery into the roles table.  PostgreSQL rejects subqueries in CHECK
-- constraints ("cannot use subquery in check constraint"), so that constraint
-- never took effect: setup.sh applies schema.sql with errors suppressed and the
-- tables are actually created by SQLAlchemy create_all, which does not declare
-- it.  This migration enforces the rule with a BEFORE INSERT/UPDATE trigger so
-- it holds on databases that were bootstrapped either way.
--
--   tenant-scoped roles  -> tenant_id must be NOT NULL
--   global-scoped roles  -> tenant_id must be NULL
--
-- The roles catalog is world-readable (its RLS SELECT policy is USING (true)),
-- so the trigger's lookup is unaffected by row-level security.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION check_ura_scope_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_scope role_scope;
BEGIN
    SELECT scope INTO v_scope FROM roles WHERE id = NEW.role_id;
    IF v_scope IS NULL THEN
        RAISE EXCEPTION 'role_id % does not exist', NEW.role_id;
    END IF;
    IF v_scope = 'tenant' AND NEW.tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant-scoped role requires a tenant_id';
    END IF;
    IF v_scope = 'global' AND NEW.tenant_id IS NOT NULL THEN
        RAISE EXCEPTION 'global-scoped role must not have a tenant_id';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ura_scope_tenant ON user_role_assignments;

CREATE TRIGGER trg_ura_scope_tenant
    BEFORE INSERT OR UPDATE ON user_role_assignments
    FOR EACH ROW EXECUTE FUNCTION check_ura_scope_tenant();

COMMIT;
