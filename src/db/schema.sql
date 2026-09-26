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
  -- Buyer-facing language (fr/de/en), captured from the localized checkout page.
  -- Drives the language of transactional emails (credentials, magic-link).
  locale TEXT NOT NULL DEFAULT 'fr',
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
  refunded_chf INTEGER NOT NULL DEFAULT 0,
  dispute_status TEXT,
  financial_checked_at INTEGER,
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

-- Traces limitées du service : aucun jeton, lien signé, IP ou contenu de mail.
CREATE TABLE IF NOT EXISTS download_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  version TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  source TEXT NOT NULL CHECK(source IN ('account','email')),
  created_at INTEGER NOT NULL,
  authorized_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_download_activity_customer ON download_activity(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_download_activity_order ON download_activity(order_id,created_at);

CREATE TABLE IF NOT EXISTS download_tokens (
  token TEXT PRIMARY KEY,
  activity_id INTEGER REFERENCES download_activity(id) ON DELETE SET NULL,
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
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

-- Preuve reçue de Stripe, sans ajout rétroactif pour les anciennes commandes.
CREATE TABLE IF NOT EXISTS order_legal (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id),
  status TEXT NOT NULL CHECK(status IN ('accepted','unverified','legacy')),
  terms_version TEXT,
  locale TEXT CHECK(locale IN ('fr','de','en')),
  document_sha256 TEXT,
  event_id TEXT NOT NULL,
  event_created_at INTEGER,
  recorded_at INTEGER NOT NULL
);

-- Une livraison par fichier acheté. Aucun ancien achat n'est remis en file au démarrage.
CREATE TABLE IF NOT EXISTS order_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  locale TEXT NOT NULL DEFAULT 'fr',
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','sent','review','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER,
  first_attempt_at INTEGER,
  payload_json TEXT,
  download_token TEXT,
  provider_message_id TEXT,
  last_error TEXT,
  sent_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(order_id,dataset_id)
);
CREATE INDEX IF NOT EXISTS idx_order_deliveries_pending ON order_deliveries(state,next_attempt_at);

-- Registre privé : un dossier par livraison, sans recopier de mail ni de lien secret.
CREATE TABLE IF NOT EXISTS delivery_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL UNIQUE REFERENCES order_deliveries(id),
  state TEXT NOT NULL CHECK(state IN ('open','accepted','cancelled')),
  reason TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_checked_at INTEGER NOT NULL,
  closed_at INTEGER,
  observations INTEGER NOT NULL DEFAULT 1,
  last_attempts INTEGER NOT NULL,
  last_delivery_state TEXT NOT NULL,
  last_order_state TEXT NOT NULL,
  accepted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_delivery_incidents_state ON delivery_incidents(state,last_seen_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS delivery_incident_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES delivery_incidents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('opened','changed','reopened','accepted','cancelled','acceptance_uncertain')),
  reason TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  accepted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_delivery_incident_events ON delivery_incident_events(incident_id,id DESC);

CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
-- Historique des droits : rembourser un achat ne retire pas les autres achats.
CREATE TABLE IF NOT EXISTS order_grants (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  updates_until INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(order_id,dataset_id)
);
-- Le webhook ne conserve que les identifiants ; les réponses Stripe vont au bronze chiffré.
CREATE TABLE IF NOT EXISTS stripe_financial_events (
  id TEXT PRIMARY KEY, charge_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stripe_financial_jobs (
  charge_id TEXT PRIMARY KEY,
  payment_intent TEXT,
  livemode INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  checked_revision INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  checked_at INTEGER
);
CREATE TABLE IF NOT EXISTS stripe_charge_states (
  charge_id TEXT PRIMARY KEY,
  payment_intent TEXT NOT NULL,
  amount_chf INTEGER NOT NULL,
  refunded_chf INTEGER NOT NULL,
  dispute_status TEXT,
  livemode INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stripe_charge_intent ON stripe_charge_states(payment_intent);

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
--        'standalone' (5k/month, Pro 49 CHF/mo subscription),
--        'business' (50k/month, 199 CHF/mo subscription)

CREATE TABLE IF NOT EXISTS mcp_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT UNIQUE NOT NULL,
  client_secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'standard', 'pro', 'standalone', 'business')),
  scopes TEXT NOT NULL DEFAULT '',           -- space-separated allowed scopes
  customer_id INTEGER,                       -- optional link to /api/account customer
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  stripe_subscription_id TEXT,               -- Stripe subscription backing a paid tier (NULL for free/registered)
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_clients_email ON mcp_clients(email);
-- NOTE: the index on stripe_subscription_id is created in src/lib/db.ts AFTER an
-- idempotent ensureColumn(), because on a pre-existing DB the column is absent
-- here (CREATE TABLE IF NOT EXISTS won't add it) and a CREATE INDEX referencing
-- it would crash the boot. Do not move it back into schema.sql.

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
  origin TEXT NOT NULL DEFAULT 'legacy' CHECK (origin IN ('legacy','server','client')),
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_kind_ts ON events(kind, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_name_ts ON events(name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_customer ON events(customer_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_country_ts ON events(country, ts DESC);

-- Témoins opérationnels : uniquement dates, tailles et résultat de contrôle.
CREATE TABLE IF NOT EXISTS operation_checks (
  name TEXT PRIMARY KEY,
  checked_at INTEGER NOT NULL,
  details_json TEXT NOT NULL
);

-- Suivi privé : données commerciales, tâches et connexions chiffrées.
CREATE TABLE IF NOT EXISTS crm_profiles (
  customer_id INTEGER PRIMARY KEY REFERENCES customers(id),
  display_name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'nouveau',
  internal INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  body TEXT NOT NULL,
  author_id INTEGER NOT NULL REFERENCES customers(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_notes_customer ON crm_notes(customer_id, created_at DESC);
CREATE TABLE IF NOT EXISTS crm_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  title TEXT NOT NULL,
  due_on TEXT,
  done_at INTEGER,
  created_at INTEGER NOT NULL
);
-- Une action au plus par incident ; sa conservation reste indépendante du journal.
CREATE TABLE IF NOT EXISTS delivery_incident_tasks (
  incident_id INTEGER PRIMARY KEY REFERENCES delivery_incidents(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL UNIQUE REFERENCES crm_tasks(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES customers(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_connections (
  name TEXT PRIMARY KEY,
  secret_encrypted TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Préférence explicite distincte de l’ancienne valeur française par défaut.
CREATE TABLE IF NOT EXISTS crm_languages (
  customer_id INTEGER PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('manual','checkout')),
  updated_at INTEGER NOT NULL
);

-- Limites de connexion : identifiants HMAC, sans adresse IP ni email en clair.
CREATE TABLE IF NOT EXISTS auth_request_limits (
  scope TEXT NOT NULL CHECK(scope IN ('ip','email')),
  identity_key TEXT NOT NULL CHECK(length(identity_key)=64),
  budget_ms INTEGER NOT NULL CHECK(typeof(budget_ms)='integer' AND budget_ms >= 0),
  updated_at INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(scope,identity_key)
);
CREATE INDEX IF NOT EXISTS idx_auth_request_limits_expiry ON auth_request_limits(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_request_limits_scope_expiry ON auth_request_limits(scope,expires_at);
