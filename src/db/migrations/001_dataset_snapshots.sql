-- Migration 001 — dataset_snapshots
--
-- Stores per-version snapshots of dataset entities. Each row captures
-- ONE field of ONE entity for ONE released version. Diffs across versions
-- power the MCP "history" tools (tariff_changelog, entity_history) — the
-- key differentiator vs scrapers which only see the *current* version of
-- xtares.admin.ch / finma.ch.
--
-- One row per (dataset_id × version × entity_key × field). The UNIQUE
-- constraint allows idempotent re-runs of the backfill script.
--
-- This DDL is also mirrored at the bottom of src/db/schema.sql so that
-- getDb() (which executes schema.sql on every boot) creates the table
-- automatically — there is no migration runner yet.

CREATE TABLE IF NOT EXISTS dataset_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,         -- 'tares' | 'classifications' | 'finma'
  version TEXT NOT NULL,            -- '2026.04.30' etc.
  entity_key TEXT NOT NULL,         -- HS8 code, NOGA code, FINMA UID...
  field TEXT NOT NULL,              -- 'duty_mfn_value', 'licence_type', etc.
  value TEXT,                       -- serialized value (JSON or raw)
  recorded_at INTEGER NOT NULL,     -- ms timestamp of release
  UNIQUE(dataset_id, version, entity_key, field)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
  ON dataset_snapshots(dataset_id, entity_key, field, recorded_at);
