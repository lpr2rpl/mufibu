-- =============================================================================
-- Multi-Tenant Financial Accounting System - Database Schema
-- =============================================================================
-- Conventions:
--   - All tables use UUID primary keys
--   - Soft deletes: deleted_at / deleted_by instead of physical DELETE
--   - Phase-based role assignments: valid_from / valid_until
--   - Full audit trail via audit_log table
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- ENUM types
-- ---------------------------------------------------------------------------
CREATE TYPE role_scope      AS ENUM ('tenant', 'global');
CREATE TYPE entry_status    AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'posted');
CREATE TYPE debit_credit    AS ENUM ('debit', 'credit');
CREATE TYPE account_type    AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE audit_action    AS ENUM (
    'INSERT', 'UPDATE', 'SOFT_DELETE', 'LOGIN', 'LOGOUT',
    'APPROVE', 'REJECT', 'ROLE_ASSIGN', 'ROLE_REVOKE',
    'TENANT_CREATE', 'PHASE_EXTEND'
);

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID,                       -- FK added below (circular ref)
    deleted_at  TIMESTAMPTZ,
    deleted_by  UUID
);

-- ---------------------------------------------------------------------------
-- Users  (global, not per-tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      VARCHAR(100) NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(255),
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    UUID        REFERENCES users(id),
    deleted_at    TIMESTAMPTZ,
    deleted_by    UUID        REFERENCES users(id),
    -- Login brute-force throttling state (see migration 003)
    failed_login_count   INTEGER     NOT NULL DEFAULT 0,
    locked_until         TIMESTAMPTZ,
    last_failed_login_at TIMESTAMPTZ
);

-- Now add tenant FK back-references
ALTER TABLE tenants
    ADD CONSTRAINT fk_tenants_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    ADD CONSTRAINT fk_tenants_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id);

-- ---------------------------------------------------------------------------
-- Role definitions  (static catalog)
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(50) NOT NULL UNIQUE,
    scope       role_scope  NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: predefined roles
INSERT INTO roles (name, scope, description) VALUES
    ('Reader',    'tenant', 'Read all bookings of the assigned tenant'),
    ('Writer',    'tenant', 'Reader + create bookings + modify own bookings'),
    ('PowerUser', 'tenant', 'Writer + modify all bookings of the tenant'),
    ('Approver',  'tenant', 'Approve bookings that require four-eyes principle; no other write access'),
    ('Admin',     'tenant', 'Manage user-role assignments for the tenant; no booking read/write'),
    ('Officer',   'tenant', 'Read-only access for assigned tenants; assigned per-tenant by PowerAdmin'),
    ('Auditor',   'global', 'Read all data across all tenants; no write access'),
    ('PowerAdmin','global', 'Create tenants and manage tenant Admins; no booking read/write');

-- ---------------------------------------------------------------------------
-- Phase-based user role assignments
-- ---------------------------------------------------------------------------
-- A user may hold one or more roles in phases (time-bounded intervals).
-- Phases may be extended (valid_until updated).
-- When a phase expires a new assignment record is created if the role is
-- to be continued; the old record is NOT modified (audit trail).
-- ---------------------------------------------------------------------------
CREATE TABLE user_role_assignments (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

    user_id     UUID        NOT NULL REFERENCES users(id),
    role_id     UUID        NOT NULL REFERENCES roles(id),

    -- NULL for global-scope roles (Auditor, PowerAdmin)
    tenant_id   UUID        REFERENCES tenants(id),

    valid_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,                        -- NULL = open-ended

    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,  -- explicit revocation flag

    assigned_by UUID        NOT NULL REFERENCES users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Extension tracking
    extended_by UUID        REFERENCES users(id),
    extended_at TIMESTAMPTZ,
    previous_valid_until TIMESTAMPTZ,               -- value before extension

    -- Revocation tracking
    revoked_by  UUID        REFERENCES users(id),
    revoked_at  TIMESTAMPTZ,
    revoke_reason TEXT,

    notes       TEXT,

    -- Soft delete
    deleted_at  TIMESTAMPTZ,
    deleted_by  UUID        REFERENCES users(id),

    -- Consistency between role scope and tenant_id (tenant-scoped roles must
    -- have a tenant_id; global roles must not) cannot be a CHECK constraint
    -- because it depends on another table (roles).  It is enforced by the
    -- trg_ura_scope_tenant trigger defined below.

    -- valid_until must be after valid_from when set
    CONSTRAINT chk_phase_dates CHECK (
        valid_until IS NULL OR valid_until > valid_from
    )
);

CREATE INDEX idx_ura_user         ON user_role_assignments(user_id);
CREATE INDEX idx_ura_tenant       ON user_role_assignments(tenant_id);
CREATE INDEX idx_ura_role         ON user_role_assignments(role_id);
CREATE INDEX idx_ura_active_phase ON user_role_assignments(user_id, tenant_id, is_active, valid_from, valid_until);

-- Enforce scope/tenant consistency (replaces a CHECK that needed a subquery):
-- tenant-scoped roles must carry a tenant_id; global roles must not.
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

CREATE TRIGGER trg_ura_scope_tenant
    BEFORE INSERT OR UPDATE ON user_role_assignments
    FOR EACH ROW EXECUTE FUNCTION check_ura_scope_tenant();

-- ---------------------------------------------------------------------------
-- Chart of Accounts  (Kontenplan, per tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
    id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID         NOT NULL REFERENCES tenants(id),
    account_number    VARCHAR(20)  NOT NULL,
    name              VARCHAR(255) NOT NULL,
    account_type      account_type NOT NULL,
    parent_account_id UUID         REFERENCES accounts(id),
    description       TEXT,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by        UUID         NOT NULL REFERENCES users(id),
    modified_at       TIMESTAMPTZ,
    modified_by       UUID         REFERENCES users(id),
    deleted_at        TIMESTAMPTZ,
    deleted_by        UUID         REFERENCES users(id),

    UNIQUE (tenant_id, account_number)
);

CREATE INDEX idx_accounts_tenant ON accounts(tenant_id);
CREATE INDEX idx_accounts_number ON accounts(tenant_id, account_number);

-- ---------------------------------------------------------------------------
-- Journal Entries  (Buchungssaetze)
-- ---------------------------------------------------------------------------
-- Each entry represents a double-entry booking with:
--   main_account_id   (Hauptkonto)
--   contra_account_id (Gegenkonto)
-- Additional lines may exist in journal_entry_lines for complex postings.
-- ---------------------------------------------------------------------------
CREATE TABLE journal_entries (
    id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id          UUID         NOT NULL REFERENCES tenants(id),

    entry_number       VARCHAR(50)  NOT NULL,
    entry_date         DATE         NOT NULL,
    description        TEXT         NOT NULL,

    status             entry_status NOT NULL DEFAULT 'draft',
    requires_approval  BOOLEAN      NOT NULL DEFAULT FALSE,

    -- Primary double-entry accounts
    main_account_id    UUID         NOT NULL REFERENCES accounts(id),
    contra_account_id  UUID         NOT NULL REFERENCES accounts(id),
    amount             DECIMAL(15,2) NOT NULL CHECK (amount > 0),

    reference          VARCHAR(255),
    notes              TEXT,

    -- Creation
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by         UUID         NOT NULL REFERENCES users(id),

    -- Last modification
    modified_at        TIMESTAMPTZ,
    modified_by        UUID         REFERENCES users(id),

    -- Approval workflow
    submitted_at       TIMESTAMPTZ,
    submitted_by       UUID         REFERENCES users(id),
    approved_at        TIMESTAMPTZ,
    approved_by        UUID         REFERENCES users(id),
    rejected_at        TIMESTAMPTZ,
    rejected_by        UUID         REFERENCES users(id),
    rejection_reason   TEXT,

    -- Posting (final)
    posted_at          TIMESTAMPTZ,
    posted_by          UUID         REFERENCES users(id),

    -- Soft delete
    deleted_at         TIMESTAMPTZ,
    deleted_by         UUID         REFERENCES users(id),

    UNIQUE (tenant_id, entry_number),
    CONSTRAINT chk_accounts_same_tenant CHECK (
        -- Both accounts must belong to the same tenant (enforced via trigger below)
        main_account_id != contra_account_id
    )
);

CREATE INDEX idx_je_tenant ON journal_entries(tenant_id);
CREATE INDEX idx_je_date   ON journal_entries(tenant_id, entry_date);
CREATE INDEX idx_je_status ON journal_entries(tenant_id, status);
CREATE INDEX idx_je_created_by ON journal_entries(created_by);

-- ---------------------------------------------------------------------------
-- Journal Entry Lines  (for multi-line / split bookings)
-- ---------------------------------------------------------------------------
CREATE TABLE journal_entry_lines (
    id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_entry_id UUID         NOT NULL REFERENCES journal_entries(id),
    line_number      INTEGER      NOT NULL,
    account_id       UUID         NOT NULL REFERENCES accounts(id),
    debit_credit     debit_credit NOT NULL,
    amount           DECIMAL(15,2) NOT NULL CHECK (amount > 0),
    description      TEXT,
    deleted_at       TIMESTAMPTZ,
    deleted_by       UUID         REFERENCES users(id),

    UNIQUE (journal_entry_id, line_number)
);

CREATE INDEX idx_jel_entry ON journal_entry_lines(journal_entry_id);

-- ---------------------------------------------------------------------------
-- Audit Log  (append-only; no UPDATE or DELETE on this table)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    occurred_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    user_id     UUID         REFERENCES users(id),
    tenant_id   UUID         REFERENCES tenants(id),
    action      audit_action NOT NULL,
    table_name  VARCHAR(100),
    record_id   UUID,
    old_values  JSONB,
    new_values  JSONB,
    ip_address  INET,
    user_agent  TEXT,
    session_id  VARCHAR(255),
    notes       TEXT
);

CREATE INDEX idx_audit_time   ON audit_log(occurred_at);
CREATE INDEX idx_audit_user   ON audit_log(user_id);
CREATE INDEX idx_audit_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_action ON audit_log(action);

-- Prevent any modification of audit rows
CREATE RULE no_update_audit AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- Trigger: enforce same-tenant constraint on journal_entries
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_journal_entry_accounts_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT tenant_id FROM accounts WHERE id = NEW.main_account_id)
        != NEW.tenant_id THEN
        RAISE EXCEPTION 'main_account_id does not belong to tenant %', NEW.tenant_id;
    END IF;
    IF (SELECT tenant_id FROM accounts WHERE id = NEW.contra_account_id)
        != NEW.tenant_id THEN
        RAISE EXCEPTION 'contra_account_id does not belong to tenant %', NEW.tenant_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_je_account_tenant
    BEFORE INSERT OR UPDATE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION check_journal_entry_accounts_tenant();

-- ---------------------------------------------------------------------------
-- View: active role assignments (current time within phase, not revoked)
-- ---------------------------------------------------------------------------
CREATE VIEW v_active_role_assignments AS
SELECT
    ura.id,
    ura.user_id,
    u.username,
    u.full_name,
    ura.role_id,
    r.name  AS role_name,
    r.scope AS role_scope,
    ura.tenant_id,
    t.name  AS tenant_name,
    ura.valid_from,
    ura.valid_until,
    ura.assigned_by,
    ura.assigned_at
FROM user_role_assignments ura
JOIN users   u ON u.id = ura.user_id
JOIN roles   r ON r.id = ura.role_id
LEFT JOIN tenants t ON t.id = ura.tenant_id
WHERE ura.is_active    = TRUE
  AND ura.deleted_at   IS NULL
  AND ura.valid_from   <= NOW()
  AND (ura.valid_until IS NULL OR ura.valid_until > NOW());

-- ---------------------------------------------------------------------------
-- View: journal entry summary
-- ---------------------------------------------------------------------------
CREATE VIEW v_journal_summary AS
SELECT
    je.id,
    je.tenant_id,
    t.name          AS tenant_name,
    je.entry_number,
    je.entry_date,
    je.description,
    je.status,
    je.requires_approval,
    je.amount,
    ma.account_number AS main_account_number,
    ma.name           AS main_account_name,
    ca.account_number AS contra_account_number,
    ca.name           AS contra_account_name,
    uc.username       AS created_by_username,
    je.created_at,
    ua.username       AS approved_by_username,
    je.approved_at,
    je.deleted_at
FROM journal_entries je
JOIN tenants  t  ON t.id  = je.tenant_id
JOIN accounts ma ON ma.id = je.main_account_id
JOIN accounts ca ON ca.id = je.contra_account_id
JOIN users    uc ON uc.id = je.created_by
LEFT JOIN users ua ON ua.id = je.approved_by;
