-- 003_mcp_business_tier.sql
--
-- Enables the 'business' tier (199 CHF/mo, 50k req/mo) on an EXISTING prod
-- database by widening the mcp_clients.tier CHECK constraint to include
-- 'business'. SQLite cannot ALTER a CHECK constraint, so the table is rebuilt.
--
-- The stripe_subscription_id COLUMN is NOT handled here: src/lib/db.ts adds it
-- idempotently at every boot (ensureColumn), so it already exists by the time
-- this runs. This migration's sole job is the CHECK widening — required ONLY
-- before selling the Business tier (Pro/standalone 'standalone' is already in
-- the original CHECK and needs no migration).
--
-- On a FRESH database, schema.sql already defines the widened CHECK, so this
-- migration is a NO-OP there.
--
-- ⚠️  RUN MANUALLY, UNDER SUPERVISION, ON PROD ONLY. This rebuilds mcp_clients.
--     Verify the row count first (SELECT COUNT(*) FROM mcp_clients) and back up
--     the DB. Safe because the table is near-empty in prod (test clients only).

PRAGMA foreign_keys=OFF;

BEGIN TRANSACTION;

-- 1. New table with the widened CHECK + the new column.
CREATE TABLE mcp_clients_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT UNIQUE NOT NULL,
  client_secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'standard', 'pro', 'standalone', 'business')),
  scopes TEXT NOT NULL DEFAULT '',
  customer_id INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  stripe_subscription_id TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- 2. Copy existing rows. stripe_subscription_id is preserved (it was already
--    added to the live table by src/lib/db.ts ensureColumn at boot, and a
--    paid 'standalone' client may already carry a non-NULL value — dropping it
--    would orphan that subscription from downgrade/upgrade).
INSERT INTO mcp_clients_new
  (id, client_id, client_secret_hash, name, email, tier, scopes, customer_id, created_at, revoked_at, stripe_subscription_id)
SELECT
  id, client_id, client_secret_hash, name, email, tier, scopes, customer_id, created_at, revoked_at, stripe_subscription_id
FROM mcp_clients;

-- 3. Swap.
DROP TABLE mcp_clients;
ALTER TABLE mcp_clients_new RENAME TO mcp_clients;

-- 4. Recreate indexes.
CREATE INDEX IF NOT EXISTS idx_mcp_clients_email ON mcp_clients(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_clients_subscription ON mcp_clients(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

COMMIT;

PRAGMA foreign_keys=ON;
