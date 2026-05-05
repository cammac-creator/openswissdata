-- Migration 002 — events
--
-- Polyvalent event log powering the /admin dashboard. One row per business
-- event: API requests, custom front-end CTA clicks, conversion micro-steps.
--
-- Why a single table (and not 5 specialised ones): for a solo founder pre-
-- launch the surface is tiny, the read patterns are mostly "count by type
-- over a window". A single (kind, name, ts) shape covers that with one
-- index. We can split later if cardinality explodes.
--
-- Identifying data is hashed (IP+UA → SHA256, salted by SESSION_SECRET) so
-- we never persist raw IPs — keeps us nLPD/RGPD-clean and consistent with
-- the privacy promise on /legal/privacy.
--
-- Mirrored at the bottom of src/db/schema.sql (no migration runner yet —
-- getDb() exec()s schema.sql on every boot).
--
-- kind:
--   'api_request' = backend route hit (path, status, duration_ms)
--   'custom'      = front-end event (name, meta_json)
--   'conversion'  = checkout opened / completed / abandoned
--
-- Indexes are tailored for the dashboard reads: rolling counts by kind+ts,
-- top-paths by ts, top-countries by ts.

-- customer_id is a soft-link (NO foreign key) so:
--   1) deleting a customer does not require cascading event-log writes,
--   2) tracking is best-effort and never violates a constraint on edge cases
--      (session pointing at deleted customer, test DB juggling, etc.).
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('api_request', 'custom', 'conversion')),
  name TEXT,                        -- route path, custom event name, conversion step
  status INTEGER,                   -- HTTP status for api_request
  duration_ms INTEGER,              -- for api_request
  customer_id INTEGER,              -- if authenticated (soft link to customers.id)
  visitor_hash TEXT,                -- SHA256(ip+ua+SESSION_SECRET) — daily-rotated salt
  country TEXT,                     -- ISO-2 from CF-IPCountry / Railway header
  referer TEXT,                     -- origin only (no full URL → no PII leak)
  ua_class TEXT,                    -- 'desktop' | 'mobile' | 'bot' | 'other'
  meta_json TEXT,                   -- arbitrary JSON for custom events
  ts INTEGER NOT NULL               -- ms timestamp
);

CREATE INDEX IF NOT EXISTS idx_events_kind_ts ON events(kind, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_name_ts ON events(name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_customer ON events(customer_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_country_ts ON events(country, ts DESC);
