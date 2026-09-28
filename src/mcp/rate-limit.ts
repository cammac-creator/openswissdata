/**
 * In-memory rate limiter for the MCP server (MVP).
 *
 * Sliding-ish 1-hour window per IP. NOT distributed — fine for a single
 * Railway replica + 100 req/h threshold. V2 replaces this with Redis +
 * licence-keyed quotas (see docs/mcp/README.md).
 *
 * La clé est l'adresse fiable du proxy Railway réduite par `abuseIp` (IPv6 en /64),
 * jamais un X-Forwarded-For fourni librement. Les compteurs repartent à zéro à chaque
 * redémarrage : c'est une protection souple, pas une mesure.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1h
const DEFAULT_MAX_REQ = 100;
// Plafond de mémoire : au-delà, les fenêtres expirées sont purgées avant toute insertion.
const MAX_BUCKETS = 50_000;

/** Valeurs annoncées aux agents (consignes, erreurs, llms.txt) : une seule source. */
export const ANONYMOUS_RATE_LIMIT = { calls: DEFAULT_MAX_REQ, window: "hour" } as const;

interface Bucket {
  count: number;
  resetAt: number;
  refusalSeen: boolean;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  /** Premier refus de cette fenêtre pour cette clé : sert à mesurer sans inonder le journal. */
  firstRefusal: boolean;
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  // Toutes les fenêtres encore actives : la plus ancienne insérée cède sa place.
  if (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }
}

export function checkRateLimit(ip: string, limit: number = DEFAULT_MAX_REQ): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    if (!bucket && buckets.size >= MAX_BUCKETS) prune(now);
    bucket = { count: 0, resetAt: now + WINDOW_MS, refusalSeen: false };
    buckets.set(ip, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= limit;
  const firstRefusal = !allowed && !bucket.refusalSeen;
  if (!allowed) bucket.refusalSeen = true;
  return {
    allowed,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    limit,
    firstRefusal,
  };
}

/** Test helper: clears the rate-limit state. */
export function _resetRateLimit(): void {
  buckets.clear();
}

/** Test helper: number of live buckets. */
export function _bucketCount(): number {
  return buckets.size;
}
