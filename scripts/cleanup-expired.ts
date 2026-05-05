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
 * Idempotent. Safe to run hourly.
 *
 * Two ways to run:
 *  1. Locally / Railway shell:  tsx scripts/cleanup-expired.ts
 *  2. Cron via GitHub Actions:  POST /api/admin/cleanup-expired (see workflow)
 *
 * The second path is the production one — GitHub Actions runners cannot reach
 * the Railway DB volume directly, so we expose `runCleanup()` as a function
 * the admin endpoint calls.
 */

import { getDb } from "../src/lib/db.js";
import { runCleanup } from "../src/lib/cleanup.js";

function main() {
  const db = getDb();
  const result = runCleanup(db);
  for (const entry of result.entries) {
    if (entry.skipped) {
      console.warn(`[cleanup] ${entry.name}: skipped (${entry.skipped})`);
    } else {
      console.log(`[cleanup] ${entry.name}: deleted ${entry.deleted} rows`);
    }
  }
  console.log(`[cleanup] done. Total rows deleted: ${result.totalDeleted}`);
}

main();
