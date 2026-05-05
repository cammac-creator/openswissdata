CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  price_chf INTEGER NOT NULL,
  stripe_price_id TEXT NOT NULL,
  stripe_updates_price_id TEXT,
  current_version TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  version TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  changelog TEXT,
  released_at INTEGER NOT NULL,
  FOREIGN KEY (dataset_id) REFERENCES datasets(id),
  UNIQUE (dataset_id, version)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  stripe_session_id TEXT UNIQUE NOT NULL,
  stripe_payment_intent TEXT,
  amount_chf INTEGER NOT NULL,
  items_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  dataset_id TEXT NOT NULL,
  order_id INTEGER NOT NULL,
  updates_until INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  UNIQUE (customer_id, dataset_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS download_tokens (
  token TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  dataset_id TEXT NOT NULL,
  version TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(id)
);

CREATE INDEX IF NOT EXISTS idx_entitlements_customer ON entitlements(customer_id);
CREATE INDEX IF NOT EXISTS idx_versions_dataset ON versions(dataset_id, released_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

-- =====================================================================
-- MCP OAuth 2.1 (Phase 2 V2 / B.1)
-- =====================================================================
--
-- mcp_clients         : OAuth clients (one per developer / licence holder)
-- mcp_oauth_codes     : short-lived authorization codes (PKCE)
-- mcp_tokens          : issued access + refresh tokens (HMAC-SHA256 hashed)
-- mcp_usage           : per-client per-day/month usage counters
--
-- Tiers: 'free' (100/day), 'standard' (1k/month), 'pro' (10k/month),
--        'standalone' (5k/month, 49 CHF/mo subscription)

CREATE TABLE IF NOT EXISTS mcp_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT UNIQUE NOT NULL,
  client_secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'standard', 'pro', 'standalone')),
  scopes TEXT NOT NULL DEFAULT '',           -- space-separated allowed scopes
  customer_id INTEGER,                       -- optional link to /api/account customer
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_clients_email ON mcp_clients(email);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256' CHECK (code_challenge_method IN ('S256', 'plain')),
  scope TEXT NOT NULL DEFAULT '',
  state TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_codes_client ON mcp_oauth_codes(client_id);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  access_token_hash TEXT UNIQUE NOT NULL,
  refresh_token_hash TEXT UNIQUE,
  scope TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_client ON mcp_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_access ON mcp_tokens(access_token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_refresh ON mcp_tokens(refresh_token_hash) WHERE revoked_at IS NULL;

-- One row per client. Day/month buckets stored as ISO strings ("YYYY-MM-DD",
-- "YYYY-MM") so the UPSERT can reset counters when the bucket changes.
CREATE TABLE IF NOT EXISTS mcp_usage (
  client_id TEXT PRIMARY KEY,
  day_bucket TEXT NOT NULL,
  day_count INTEGER NOT NULL DEFAULT 0,
  month_bucket TEXT NOT NULL,
  month_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  last_reset INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- =====================================================================
-- Dataset snapshots (Phase 2 V2 / B.3)
-- =====================================================================
-- Mirrored from src/db/migrations/001_dataset_snapshots.sql so that
-- getDb() (which exec()s schema.sql at every boot) creates the table
-- without a migration runner. Powers MCP history tools (tariff_changelog,
-- entity_history). One row per dataset × version × entity_key × field.

CREATE TABLE IF NOT EXISTS dataset_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  version TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT,
  recorded_at INTEGER NOT NULL,
  UNIQUE(dataset_id, version, entity_key, field)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
  ON dataset_snapshots(dataset_id, entity_key, field, recorded_at);

-- =====================================================================
-- Events log (Phase 3 / dashboard analytics)
-- =====================================================================
-- Mirrored from src/db/migrations/002_events.sql. Powers the /admin
-- dashboard: per-route latency, top countries, conversion funnel,
-- custom front-end CTA tracking. See migration file for the full
-- design rationale.

-- customer_id is a soft-link (no FK constraint) — see 002_events.sql for why.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('api_request', 'custom', 'conversion')),
  name TEXT,
  status INTEGER,
  duration_ms INTEGER,
  customer_id INTEGER,
  visitor_hash TEXT,
  country TEXT,
  referer TEXT,
  ua_class TEXT,
  meta_json TEXT,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_kind_ts ON events(kind, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_name_ts ON events(name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_customer ON events(customer_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_country_ts ON events(country, ts DESC);
