-- =============================================================================
-- Migration 002: Row-Level Security + Officer role
-- =============================================================================
-- This migration is IDEMPOTENT (safe to run multiple times).
--
-- Overview
-- --------
-- 1. Adds the "Officer" tenant-scoped role (read-only, assigned per-tenant by
--    PowerAdmin - unlike Auditor which is global/unrestricted).
-- 2. Enables and forces Row-Level Security on all application tables.
-- 3. Creates helper functions that read PostgreSQL session variables injected
--    by the backend at the start of each transaction.
-- 4. Defines RLS policies for every table and every DML operation.
--
-- Session variables set by the backend (via set_config(..., is_local => true))
-- ---------------------------------------------------------------------------
--   app.user_id             UUID of the authenticated user (empty = anonymous)
--   app.readable_tenant_ids Comma-separated tenant UUIDs with read access
--                           (Reader, Writer, PowerUser, Approver, Officer)
--   app.writable_tenant_ids Comma-separated tenant UUIDs with write access
--                           (Writer, PowerUser)
--   app.admin_tenant_ids    Comma-separated tenant UUIDs with admin access
--                           (Admin role - can manage role assignments, read
--                            accounts, but NOT journal entries)
--   app.is_auditor          'true' if the user holds the global Auditor role
--   app.is_power_admin      'true' if the user holds the global PowerAdmin role
--   app.bypass_rls          'true' for internal seed/migration operations only
--
-- FORCE ROW LEVEL SECURITY ensures even the table owner (mufibu) is subject
-- to policies, preventing privilege escalation through the application DB user.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Officer role
-- ---------------------------------------------------------------------------
INSERT INTO roles (name, scope, description)
VALUES (
    'Officer',
    'tenant',
    'Read-only access to all data for assigned tenants; assigned per-tenant by PowerAdmin'
)
ON CONFLICT (name) DO UPDATE
    SET description = EXCLUDED.description;

-- ---------------------------------------------------------------------------
-- 2. Helper functions  (SECURITY DEFINER so they bypass RLS on referenced
--    tables and avoid infinite recursion in policy expressions)
-- ---------------------------------------------------------------------------

-- Returns TRUE when the current request may read data from the given tenant.
-- Covers: Auditor (global), bypass, and any role in readable_tenant_ids
-- (Reader / Writer / PowerUser / Approver / Officer).
CREATE OR REPLACE FUNCTION app_can_read_tenant(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
    SELECT
        coalesce(current_setting('app.bypass_rls',     true), 'false') = 'true'
        OR coalesce(current_setting('app.is_auditor',  true), 'false') = 'true'
        OR p_tenant_id::text = ANY(
               string_to_array(
                   coalesce(current_setting('app.readable_tenant_ids', true), ''),
                   ','
               )
           );
$$;

-- Returns TRUE when the current request may write to the given tenant.
-- Covers: Writer, PowerUser (and bypass).
CREATE OR REPLACE FUNCTION app_can_write_tenant(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
    SELECT
        coalesce(current_setting('app.bypass_rls',         true), 'false') = 'true'
        OR p_tenant_id::text = ANY(
               string_to_array(
                   coalesce(current_setting('app.writable_tenant_ids', true), ''),
                   ','
               )
           );
$$;

-- Returns TRUE when the current request has admin rights (role management)
-- for the given tenant.  Does NOT imply read/write access to bookings.
CREATE OR REPLACE FUNCTION app_can_admin_tenant(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
    SELECT
        coalesce(current_setting('app.bypass_rls',       true), 'false') = 'true'
        OR coalesce(current_setting('app.is_power_admin',true), 'false') = 'true'
        OR p_tenant_id::text = ANY(
               string_to_array(
                   coalesce(current_setting('app.admin_tenant_ids', true), ''),
                   ','
               )
           );
$$;

-- Returns TRUE when the current request has PowerAdmin or bypass privileges.
CREATE OR REPLACE FUNCTION app_is_power_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
    SELECT
        coalesce(current_setting('app.bypass_rls',       true), 'false') = 'true'
        OR coalesce(current_setting('app.is_power_admin',true), 'false') = 'true';
$$;

-- Returns the tenant_id of a journal entry WITHOUT triggering RLS on
-- journal_entries (avoids infinite recursion in journal_entry_lines policy).
CREATE OR REPLACE FUNCTION app_entry_tenant(p_entry_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
    SELECT tenant_id FROM journal_entries WHERE id = p_entry_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. Enable and FORCE Row-Level Security on all application tables
-- ---------------------------------------------------------------------------

ALTER TABLE roles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                  FORCE  ROW LEVEL SECURITY;

ALTER TABLE tenants                ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants                FORCE  ROW LEVEL SECURITY;

ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  FORCE  ROW LEVEL SECURITY;

ALTER TABLE user_role_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignments  FORCE  ROW LEVEL SECURITY;

ALTER TABLE accounts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts               FORCE  ROW LEVEL SECURITY;

ALTER TABLE journal_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries        FORCE  ROW LEVEL SECURITY;

ALTER TABLE journal_entry_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines    FORCE  ROW LEVEL SECURITY;

ALTER TABLE audit_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log              FORCE  ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. Drop any pre-existing policies (idempotency)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT policyname, tablename
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
              'roles', 'tenants', 'users', 'user_role_assignments',
              'accounts', 'journal_entries', 'journal_entry_lines', 'audit_log'
          )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. RLS Policies
-- ---------------------------------------------------------------------------

-- ---- ROLES (catalog: readable by all authenticated users) -----------------

CREATE POLICY rls_roles_select ON roles
    FOR SELECT USING (true);

CREATE POLICY rls_roles_insert ON roles
    FOR INSERT WITH CHECK (app_is_power_admin());

CREATE POLICY rls_roles_update ON roles
    FOR UPDATE USING (app_is_power_admin()) WITH CHECK (app_is_power_admin());

CREATE POLICY rls_roles_delete ON roles
    FOR DELETE USING (false);   -- never hard-delete catalog entries

-- ---- TENANTS ---------------------------------------------------------------
-- PowerAdmin / Auditor: all tenants
-- Others: only tenants they are a member of (any role)

CREATE POLICY rls_tenants_select ON tenants
    FOR SELECT USING (
        app_is_power_admin()
        OR coalesce(current_setting('app.is_auditor',    true), 'false') = 'true'
        OR id::text = ANY(
               string_to_array(
                   coalesce(current_setting('app.readable_tenant_ids', true), ''), ','
               )
           )
        OR id::text = ANY(
               string_to_array(
                   coalesce(current_setting('app.admin_tenant_ids', true), ''), ','
               )
           )
    );

CREATE POLICY rls_tenants_insert ON tenants
    FOR INSERT WITH CHECK (app_is_power_admin());

CREATE POLICY rls_tenants_update ON tenants
    FOR UPDATE
    USING     (app_is_power_admin())
    WITH CHECK(app_is_power_admin());

-- Enforce soft-delete: the application layer sets deleted_at instead of
-- issuing DELETE; this policy prevents accidental physical deletes.
CREATE POLICY rls_tenants_delete ON tenants
    FOR DELETE USING (false);

-- ---- USERS -----------------------------------------------------------------
-- PowerAdmin / Auditor: all users
-- Everyone else: only themselves (needed for profile, token refresh, etc.)

CREATE POLICY rls_users_select ON users
    FOR SELECT USING (
        app_is_power_admin()
        OR coalesce(current_setting('app.is_auditor',  true), 'false') = 'true'
        OR id::text = coalesce(current_setting('app.user_id', true), '')
    );

CREATE POLICY rls_users_insert ON users
    FOR INSERT WITH CHECK (app_is_power_admin());

CREATE POLICY rls_users_update ON users
    FOR UPDATE
    USING (
        app_is_power_admin()
        OR id::text = coalesce(current_setting('app.user_id', true), '')
    )
    WITH CHECK (
        app_is_power_admin()
        OR id::text = coalesce(current_setting('app.user_id', true), '')
    );

CREATE POLICY rls_users_delete ON users
    FOR DELETE USING (false);

-- ---- USER_ROLE_ASSIGNMENTS -------------------------------------------------
-- PowerAdmin / Auditor : all assignments
-- Admin                : assignments for their managed tenants
-- Everyone else        : only their own assignments

CREATE POLICY rls_ura_select ON user_role_assignments
    FOR SELECT USING (
        app_is_power_admin()
        OR coalesce(current_setting('app.is_auditor', true), 'false') = 'true'
        OR user_id::text = coalesce(current_setting('app.user_id', true), '')
        OR (
            tenant_id IS NOT NULL
            AND app_can_admin_tenant(tenant_id)
        )
    );

CREATE POLICY rls_ura_insert ON user_role_assignments
    FOR INSERT WITH CHECK (
        app_is_power_admin()
        OR (
            tenant_id IS NOT NULL
            AND app_can_admin_tenant(tenant_id)
        )
    );

CREATE POLICY rls_ura_update ON user_role_assignments
    FOR UPDATE
    USING (
        app_is_power_admin()
        OR (tenant_id IS NOT NULL AND app_can_admin_tenant(tenant_id))
    )
    WITH CHECK (
        app_is_power_admin()
        OR (tenant_id IS NOT NULL AND app_can_admin_tenant(tenant_id))
    );

CREATE POLICY rls_ura_delete ON user_role_assignments
    FOR DELETE USING (false);

-- ---- ACCOUNTS --------------------------------------------------------------
-- Reader-class roles + Officer + Auditor: read
-- Admin: read only (needed for account-selection in UI, no journal access)
-- Writable tenant roles (Writer/PowerUser) + PowerAdmin: write
--   (the app layer narrows account writes further to PowerUser + PowerAdmin)
-- Admin has NO account write access.

CREATE POLICY rls_accounts_select ON accounts
    FOR SELECT USING (
        app_can_read_tenant(tenant_id)          -- Reader/Writer/PowerUser/Approver/Officer/Auditor
        OR app_is_power_admin()
        OR app_can_admin_tenant(tenant_id)      -- Admin (role management UI needs account list)
    );

CREATE POLICY rls_accounts_insert ON accounts
    FOR INSERT WITH CHECK (
        app_can_write_tenant(tenant_id)
        OR app_is_power_admin()
    );

CREATE POLICY rls_accounts_update ON accounts
    FOR UPDATE
    USING     (app_can_write_tenant(tenant_id) OR app_is_power_admin())
    WITH CHECK(app_can_write_tenant(tenant_id) OR app_is_power_admin());

CREATE POLICY rls_accounts_delete ON accounts
    FOR DELETE USING (false);

-- ---- JOURNAL_ENTRIES -------------------------------------------------------
-- IMPORTANT: Admin and PowerAdmin are NOT in readable_tenant_ids, so they
-- cannot see journal entries.  Officer IS in readable_tenant_ids (for their
-- assigned tenants) and can read but not write.

CREATE POLICY rls_je_select ON journal_entries
    FOR SELECT USING (app_can_read_tenant(tenant_id));

CREATE POLICY rls_je_insert ON journal_entries
    FOR INSERT WITH CHECK (app_can_write_tenant(tenant_id));

CREATE POLICY rls_je_update ON journal_entries
    FOR UPDATE
    USING     (app_can_write_tenant(tenant_id))
    WITH CHECK(app_can_write_tenant(tenant_id));

CREATE POLICY rls_je_delete ON journal_entries
    FOR DELETE USING (false);

-- ---- JOURNAL_ENTRY_LINES ---------------------------------------------------
-- Governed by the parent entry's tenant via app_entry_tenant() (SECURITY
-- DEFINER function bypasses journal_entries RLS to avoid recursion).

CREATE POLICY rls_jel_select ON journal_entry_lines
    FOR SELECT USING (app_can_read_tenant(app_entry_tenant(journal_entry_id)));

CREATE POLICY rls_jel_insert ON journal_entry_lines
    FOR INSERT WITH CHECK (app_can_write_tenant(app_entry_tenant(journal_entry_id)));

CREATE POLICY rls_jel_update ON journal_entry_lines
    FOR UPDATE
    USING     (app_can_write_tenant(app_entry_tenant(journal_entry_id)))
    WITH CHECK(app_can_write_tenant(app_entry_tenant(journal_entry_id)));

CREATE POLICY rls_jel_delete ON journal_entry_lines
    FOR DELETE USING (false);

-- ---- AUDIT_LOG -------------------------------------------------------------
-- Auditor           : all entries (global read)
-- PowerAdmin        : all entries (needed for admin oversight)
-- Officer           : entries for their readable tenants (tenant_id column)
--                     plus global entries (tenant_id IS NULL, e.g. LOGIN)
-- Everyone else     : only their own entries (user_id match)
-- INSERT            : allowed for any authenticated user (the app writes these)

CREATE POLICY rls_audit_select ON audit_log
    FOR SELECT USING (
        coalesce(current_setting('app.bypass_rls',       true), 'false') = 'true'
        OR coalesce(current_setting('app.is_auditor',    true), 'false') = 'true'
        OR coalesce(current_setting('app.is_power_admin',true), 'false') = 'true'
        -- Officer sees entries scoped to their readable tenants
        OR (
            tenant_id IS NOT NULL
            AND app_can_read_tenant(tenant_id)
        )
        -- Users can always see their own audit trail
        OR user_id::text = coalesce(current_setting('app.user_id', true), '')
    );

CREATE POLICY rls_audit_insert ON audit_log
    FOR INSERT WITH CHECK (
        coalesce(current_setting('app.bypass_rls', true), 'false') = 'true'
        OR coalesce(current_setting('app.user_id', true), '') <> ''
    );

-- Audit rows are immutable by design (the application-level rules in the
-- original schema already prevent UPDATE/DELETE; RLS adds a second layer).
CREATE POLICY rls_audit_update ON audit_log FOR UPDATE USING (false);
CREATE POLICY rls_audit_delete ON audit_log FOR DELETE USING (false);

-- ---------------------------------------------------------------------------
-- Done
-- ---------------------------------------------------------------------------
COMMIT;
