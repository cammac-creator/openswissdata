/**
 * Cleanup expired ephemeral rows.
 *
 * Without this, the SQLite file grows monotonically:
 *  - sessions:        Max-Age 30d cookies → rows survive 30d after creation
 *  - magic_links:     15-min TTL but never deleted on expiration
 *  - download_tokens: 48h TTL but never deleted on expiration
 *  - mcp_oauth_codes: short TTL, accumulate
 *  - request_log:     audit log, but only useful for ~30d
 *
 * Idempotent. Safe to run hourly. Logs counts deleted.
 *
 * USAGE:
 *   tsx scripts/cleanup-expired.ts
 *
 * Cron: every 6h is plenty.
 *   0 *\/6 * * *  tsx scripts/cleanup-expired.ts
 */

import { getDb } from "../src/lib/db.js";

const REQUEST_LOG_RETENTION_MS = 30 * 24 * 3600 * 1000;
// Analytics events: keep 180 days for year-over-year-ish window comparisons,
// drop older. Tunable; aligned with /legal/privacy retention claim.
const EVENTS_RETENTION_MS = 180 * 24 * 3600 * 1000;

function main() {
  const db = getDb();
  const now = Date.now();

  let total = 0;

  const tables: Array<{ name: string; sql: string; params: unknown[] }> = [
    {
      name: "magic_links",
      sql: "DELETE FROM magic_links WHERE expires_at < ?",
      params: [now],
    },
    {
      name: "sessions",
      sql: "DELETE FROM sessions WHERE expires_at < ?",
      params: [now],
    },
    {
      name: "download_tokens",
      sql: "DELETE FROM download_tokens WHERE expires_at < ?",
      params: [now],
    },
  ];

  for (const t of tables) {
    try {
      const stmt = db.prepare(t.sql);
      const result = stmt.run(...t.params);
      console.log(`[cleanup] ${t.name}: deleted ${result.changes} rows`);
      total += result.changes;
    } catch (err) {
      // Table might not exist yet (schema migration not yet applied) — log
      // and continue rather than aborting the whole run.
      console.warn(`[cleanup] ${t.name}: skipped (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // Optional MCP OAuth code cleanup — guard with try/catch since the table
  // may not exist yet on older deploys.
  try {
    const result = db.prepare("DELETE FROM mcp_oauth_codes WHERE expires_at < ?").run(now);
    console.log(`[cleanup] mcp_oauth_codes: deleted ${result.changes} rows`);
    total += result.changes;
  } catch {
    // Silent: table absent in older schemas.
  }

  // Optional request_log retention — keep last 30d, prune the rest.
  try {
    const cutoff = now - REQUEST_LOG_RETENTION_MS;
    const result = db.prepare("DELETE FROM request_log WHERE timestamp < ?").run(cutoff);
    console.log(`[cleanup] request_log: deleted ${result.changes} rows older than 30d`);
    total += result.changes;
  } catch {
    // Silent.
  }

  // Analytics events: prune older than EVENTS_RETENTION_MS. Without this the
  // events table is unbounded. Idempotent.
  try {
    const cutoff = now - EVENTS_RETENTION_MS;
    const result = db.prepare("DELETE FROM events WHERE ts < ?").run(cutoff);
    console.log(`[cleanup] events: deleted ${result.changes} rows older than 180d`);
    total += result.changes;
  } catch {
    // Silent: table absent on first deploys before migration 002.
  }

  console.log(`[cleanup] done. Total rows deleted: ${total}`);
}

main();
