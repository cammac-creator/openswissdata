/**
 * In-memory rate limiter for the MCP server (MVP).
 *
 * Sliding-ish 1-hour window per IP. NOT distributed — fine for a single
 * Railway replica + 100 req/h threshold. V2 replaces this with Redis +
 * licence-keyed quotas (see docs/mcp/README.md).
 */

const WINDOW_MS = 60 * 60 * 1000; // 1h
const DEFAULT_MAX_REQ = 100;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export function checkRateLimit(ip: string, limit: number = DEFAULT_MAX_REQ): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    limit,
  };
}

/** Test helper: clears the rate-limit state. */
export function _resetRateLimit(): void {
  buckets.clear();
}
