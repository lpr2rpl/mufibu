-- Migration 009: Reversal tracking and REVERSE audit action
--
-- Adds three columns to journal_entries that record when and by whom
-- an entry was reversed, and which new entry is the reversal.
-- Also adds the REVERSE value to the audit_action enum so reversals
-- have a dedicated audit record distinct from ordinary INSERTs.

-- Add REVERSE to the audit_action enum (IF NOT EXISTS because schema.sql
-- already includes it for fresh installs).
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'REVERSE';

-- Track reversal on the original entry.
-- reversed_at: when the reversal was created
-- reversed_by: who created the reversal
-- reversal_entry_id: FK to the new reversal journal entry
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES users(id);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversal_entry_id UUID REFERENCES journal_entries(id);
