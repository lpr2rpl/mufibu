-- Enforce that journal entries reference active (non-deactivated) accounts.
-- The service layer already checks this for new entries, but this trigger
-- provides defense-in-depth: it fires on INSERT and on UPDATE when either
-- account column changes, so a direct DB write or future service path cannot
-- bypass the constraint.

CREATE OR REPLACE FUNCTION check_je_accounts_active()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    -- Skip the check on UPDATE unless the account columns themselves changed.
    IF TG_OP = 'UPDATE'
       AND NEW.main_account_id   = OLD.main_account_id
       AND NEW.contra_account_id = OLD.contra_account_id
    THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM accounts
        WHERE id = NEW.main_account_id
          AND is_active
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION
            'main_account_id references an inactive or deleted account';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM accounts
        WHERE id = NEW.contra_account_id
          AND is_active
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION
            'contra_account_id references an inactive or deleted account';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_je_accounts_active
    BEFORE INSERT OR UPDATE ON journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION check_je_accounts_active();

-- Enforce that a parent account belongs to the same tenant as its child.
-- parent_account_id is only set at account creation (AccountUpdate has no
-- parent_account_id field), but the trigger covers UPDATE too for safety.

CREATE OR REPLACE FUNCTION check_account_parent_tenant()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    IF NEW.parent_account_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM accounts
        WHERE id          = NEW.parent_account_id
          AND tenant_id   = NEW.tenant_id
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION
            'parent_account_id must belong to the same tenant';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_account_parent_tenant
    BEFORE INSERT OR UPDATE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION check_account_parent_tenant();
