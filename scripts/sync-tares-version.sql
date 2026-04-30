-- Re-sync TARES version 2026.04.30.1
-- Applies to production Railway DB to fix the desync where versions table
-- still pointed to the 5-row fixture (2026.04.22) while the real 7511-row
-- ZIP (tares-2026.04.30.1.zip, 14.99 MB) was already produced and signed.
--
-- WHEN TO RUN: before the launch (Thursday 7 May 2026), so the first
-- paying customer downloads the actual dataset, not the fixture.
--
-- HOW TO RUN ON PRODUCTION (Railway CLI):
--   railway run -- sqlite3 /app/data/openswissdata.sqlite < scripts/sync-tares-version.sql
--
-- Or via SSH on the Railway shell:
--   sqlite3 /app/data/openswissdata.sqlite < scripts/sync-tares-version.sql
--
-- IDEMPOTENT: uses INSERT OR IGNORE so safe to re-run.

BEGIN TRANSACTION;

-- Insert the new version row (idempotent via UNIQUE constraint)
INSERT OR IGNORE INTO versions (
  dataset_id,
  version,
  r2_key,
  sha256,
  size_bytes,
  changelog,
  released_at
) VALUES (
  'tares',
  '2026.04.30.1',
  'datasets/tares/tares-2026.04.30.1.zip',
  '20ca61606f0c2999693dee50ee7952a05734fe6365dc68c9a5ee141f53637e2a',
  14990216,
  'TARES 2026-04-30 release: 7511 HS8 codes, 24 MB embeddings FR (Xenova/paraphrase-multilingual-mpnet-base-v2), Ed25519 signed manifest, RFC-3161 timestamped via freetsa.org. Fixes the production desync where the fixture (5 rows) was still being served as the current version.',
  CAST(strftime('%s', 'now') AS INTEGER)
);

-- Bump the current_version pointer
UPDATE datasets
SET current_version = '2026.04.30.1'
WHERE id = 'tares' AND current_version != '2026.04.30.1';

-- Sanity check (will print the new state)
SELECT 'AFTER SYNC:' AS status;
SELECT id, current_version FROM datasets WHERE id = 'tares';
SELECT dataset_id, version, size_bytes, substr(sha256, 1, 16) AS sha
FROM versions
WHERE dataset_id = 'tares'
ORDER BY released_at DESC;

COMMIT;
