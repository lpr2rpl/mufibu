-- =============================================================================
-- Migration 004: Double-entry balance enforcement for split journal lines
-- =============================================================================
-- This migration is IDEMPOTENT (safe to run multiple times).
--
-- Defense-in-depth companion to the service-level check in
-- app/journal_workflow.py:lines_balance_error.  A DEFERRED constraint trigger
-- verifies, at COMMIT, that the active (non-deleted) lines of each journal
-- entry have equal total debits and credits.  Because it is DEFERRABLE
-- INITIALLY DEFERRED, lines may be inserted one row at a time within a
-- transaction and the balance is only checked once, after the last row.
--
-- Entries with no split lines are balanced by their header (a single amount
-- debited and credited across the main/contra accounts), so the trigger does
-- nothing for them (no rows -> trigger never fires).
--
-- SECURITY DEFINER + a fixed search_path mirror the helper functions in
-- migration 002.  The per-transaction RLS session variables remain in effect
-- while deferred triggers run at COMMIT, and any role permitted to write a
-- tenant's lines also has read access to them, so the SUM sees every line of
-- the entry.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION check_journal_lines_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_entry_id UUID := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
    v_debit    NUMERIC(15,2);
    v_credit   NUMERIC(15,2);
BEGIN
    SELECT
        COALESCE(SUM(amount) FILTER (WHERE debit_credit = 'debit'),  0),
        COALESCE(SUM(amount) FILTER (WHERE debit_credit = 'credit'), 0)
    INTO v_debit, v_credit
    FROM journal_entry_lines
    WHERE journal_entry_id = v_entry_id
      AND deleted_at IS NULL;

    IF v_debit <> v_credit THEN
        RAISE EXCEPTION
            'Journal entry % lines are unbalanced: debits % <> credits %',
            v_entry_id, v_debit, v_credit;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_jel_balanced ON journal_entry_lines;

CREATE CONSTRAINT TRIGGER trg_jel_balanced
    AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION check_journal_lines_balanced();

COMMIT;
