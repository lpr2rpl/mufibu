-- Separate approval notes from the entry's own notes to preserve structure.
-- Previously approve_entry appended a text prefix to entry.notes, conflating
-- approval metadata with the entry description and making audit queries harder.

ALTER TABLE journal_entries ADD COLUMN approval_notes TEXT;
