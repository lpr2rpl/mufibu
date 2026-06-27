-- Migration 010: Partial index on journal_entries.reversed_at
--
-- A partial index covering only reversed entries keeps index size small
-- (the overwhelming majority of entries are never reversed) while making
-- queries that filter on reversed_at IS NOT NULL efficient.

CREATE INDEX IF NOT EXISTS idx_je_reversed
    ON journal_entries(reversed_at)
    WHERE reversed_at IS NOT NULL;
