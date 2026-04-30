/**
 * Simple in-memory per-IP rate limiter for sensitive endpoints.
 *
 * Suitable for single-instance deploys (Railway). Migrate to Upstash/Redis
 * if/when we run multiple instances behind a load balancer.
 *
 * Each named bucket has its own Map<ip, lastRequestTimestamp> and its own
 * window. Returns true if the request is allowed, false if it should be
 * rejected with 429.
 */

interface Bucket {
  windowMs: number;
  capacity: number;
  map: Map<string, number>;
}

const buckets = new Map<string, Bucket>();

export function makeRateLimit(name: string, windowMs: number, capacity = 10_000): Bucket {
  const existing = buckets.get(name);
  if (existing) return existing;
  const bucket: Bucket = { windowMs, capacity, map: new Map() };
  buckets.set(name, bucket);
  return bucket;
}

export function checkRateLimit(bucket: Bucket, ip: string): boolean {
  const now = Date.now();
  const last = bucket.map.get(ip);
  if (last !== undefined && now - last < bucket.windowMs) return false;
  if (bucket.map.size >= bucket.capacity) {
    const oldest = bucket.map.keys().next().value;
    if (oldest !== undefined) bucket.map.delete(oldest);
  }
  bucket.map.set(ip, now);
  return true;
}

/**
 * Read the client IP from `X-Forwarded-For` (Railway sets this) with a fallback
 * to `unknown` so we don't crash. Note: in a single-instance setup behind
 * Railway's proxy, this header is set by the proxy itself and reasonably
 * trusted. In a multi-tenant proxy chain, the leftmost entry might be spoofed.
 */
export function getClientIp(c: {
  req: { header: (name: string) => string | undefined };
}): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = c.req.header("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

// Pre-defined buckets for common endpoints — shared across the codebase.
export const checkoutBucket = makeRateLimit("checkout", 6_000); // 10 req/min/IP
export const oauthRegisterBucket = makeRateLimit("oauth-register", 6_000);
export const adminBucket = makeRateLimit("admin", 2_000); // 30 req/min/IP
