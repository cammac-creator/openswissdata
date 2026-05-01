/**
 * Per-licence usage quotas for the MCP server (V2).
 *
 * Free tier without a token still falls back to the in-memory IP rate limit
 * (`src/mcp/rate-limit.ts`). Any request authenticated with an OAuth token
 * goes through `consumeQuota()` which atomically increments the right
 * day/month bucket and rejects if the tier ceiling is reached.
 */

import type Database from "better-sqlite3";
import { getDb } from "../../lib/db.js";
import { TIER_QUOTA, type Tier } from "./scopes.js";

export interface QuotaResult {
  allowed: boolean;
  tier: Tier;
  day_used: number;
  day_limit: number;
  month_used: number;
  month_limit: number;
  bucket: { day: string; month: string };
}

/** YYYY-MM-DD in UTC. */
function dayBucket(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
/** YYYY-MM in UTC. */
function monthBucket(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

/**
 * Atomically consume one quota unit for a client. Returns whether the call
 * was allowed and the post-increment counters.
 *
 * Implementation detail: we run an UPSERT that resets the day_count when the
 * day_bucket flips, and the month_count when the month_bucket flips, in a
 * single transaction. SQLite's UPSERT semantics (`ON CONFLICT … DO UPDATE`)
 * support reading `excluded.*` for this kind of conditional reset.
 */
export function consumeQuota(clientId: string, tier: Tier, db?: Database.Database): QuotaResult {
  const d = db ?? getDb();
  const now = Date.now();
  const day = dayBucket();
  const month = monthBucket();
  const limits = TIER_QUOTA[tier];

  const upsert = d.prepare(`
    INSERT INTO mcp_usage (client_id, day_bucket, day_count, month_bucket, month_count, total_count, last_reset, updated_at)
    VALUES (@client_id, @day, 1, @month, 1, 1, @now, @now)
    ON CONFLICT(client_id) DO UPDATE SET
      day_count    = CASE WHEN day_bucket   = excluded.day_bucket   THEN day_count   + 1 ELSE 1 END,
      month_count  = CASE WHEN month_bucket = excluded.month_bucket THEN month_count + 1 ELSE 1 END,
      day_bucket   = excluded.day_bucket,
      month_bucket = excluded.month_bucket,
      total_count  = total_count + 1,
      last_reset   = CASE
        WHEN day_bucket = excluded.day_bucket AND month_bucket = excluded.month_bucket
          THEN last_reset
        ELSE excluded.last_reset
      END,
      updated_at   = excluded.updated_at
  `);

  upsert.run({ client_id: clientId, day, month, now });

  const row = d
    .prepare(
      "SELECT day_count, month_count FROM mcp_usage WHERE client_id = ?",
    )
    .get(clientId) as { day_count: number; month_count: number } | undefined;

  const dayUsed = row?.day_count ?? 0;
  const monthUsed = row?.month_count ?? 0;

  // The UPSERT above incremented BEFORE this SELECT, so dayUsed reflects the
  // count INCLUDING the current request. With `<=`:
  //   - 1st request:   dayUsed=1,   limit=100 → ok   (1 <= 100)
  //   - 100th request: dayUsed=100, limit=100 → ok   (100 <= 100)
  //   - 101st request: dayUsed=101, limit=100 → fail (101 > 100)
  // So a tier with `day=100` correctly allows exactly 100 calls per day.
  // DO NOT change to `<` strict — that would cap the tier at limit-1.
  const dayOk = limits.day < 0 || dayUsed <= limits.day;
  const monthOk = limits.month < 0 || monthUsed <= limits.month;

  return {
    allowed: dayOk && monthOk,
    tier,
    day_used: dayUsed,
    day_limit: limits.day,
    month_used: monthUsed,
    month_limit: limits.month,
    bucket: { day, month },
  };
}

/** Test helper: zero out usage for a client. */
export function _resetUsage(clientId?: string, db?: Database.Database): void {
  const d = db ?? getDb();
  if (clientId) {
    d.prepare("DELETE FROM mcp_usage WHERE client_id = ?").run(clientId);
  } else {
    d.prepare("DELETE FROM mcp_usage").run();
  }
}
