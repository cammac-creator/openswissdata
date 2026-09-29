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
 *
 * Deux tables distinctes, même mécanique :
 *   - la limite anonyme générale (100 messages par heure, tout message compte) ;
 *   - l'essai des outils de recherche (20 appels par 24 heures, décision de Claude-Alain du
 *     29.09.2026), ouverte au premier appel d'essai du réseau et partagée par les trois outils.
 * Un appel d'essai reste aussi un message pour la limite horaire : l'essai a son propre compteur,
 * il ne crée pas de chemin hors de la protection contre l'inondation.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1h
const DEFAULT_MAX_REQ = 100;
// Plafond de mémoire : au-delà, les fenêtres expirées sont purgées avant toute insertion.
const MAX_BUCKETS = 50_000;

const TRIAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const TRIAL_MAX_CALLS = 20;

/** Valeurs annoncées aux agents (consignes, erreurs, llms.txt) : une seule source. */
export const ANONYMOUS_RATE_LIMIT = { calls: DEFAULT_MAX_REQ, window: "hour" } as const;

/** Essai sans clé des outils de recherche : une seule source pour les textes et les en-têtes. */
export const ANONYMOUS_TRIAL_LIMIT = { calls: TRIAL_MAX_CALLS, window: "day", windowMs: TRIAL_WINDOW_MS } as const;

interface Bucket {
  count: number;
  resetAt: number;
  refusalSeen: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  /** Premier refus de cette fenêtre pour cette clé : sert à mesurer sans inonder le journal. */
  firstRefusal: boolean;
}

/** Table de fenêtres fixes ouvertes au premier appel, bornée en mémoire. */
function windowLimiter(windowMs: number, maxBuckets: number) {
  const buckets = new Map<string, Bucket>();

  // Chaque fenêtre ouverte est réinsérée en fin de table : l'ordre d'insertion suit l'ordre
  // d'expiration, et la purge s'arrête à la première fenêtre encore active.
  function prune(now: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt > now) break;
      buckets.delete(key);
    }
    // Toutes les fenêtres encore actives : celle qui expire la première cède sa place.
    if (buckets.size >= maxBuckets) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
  }

  function check(key: string, limit: number, cost: number): RateLimitResult {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (bucket) buckets.delete(key);
      else if (buckets.size >= maxBuckets) prune(now);
      bucket = { count: 0, resetAt: now + windowMs, refusalSeen: false };
      buckets.set(key, bucket);
    }
    bucket.count += Math.max(1, Math.floor(cost));
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

  return { check, clear: () => buckets.clear(), size: () => buckets.size };
}

const anonymous = windowLimiter(WINDOW_MS, MAX_BUCKETS);
const trial = windowLimiter(TRIAL_WINDOW_MS, MAX_BUCKETS);

/**
 * Consomme `cost` unités (un lot JSON-RPC coûte un appel par message) pour cette clé et dit si la
 * requête reste dans la limite.
 */
export function checkRateLimit(ip: string, limit: number = DEFAULT_MAX_REQ, cost = 1): RateLimitResult {
  return anonymous.check(ip, limit, cost);
}

export interface TrialResult extends RateLimitResult {
  /** Appels d'essai servis dans cette fenêtre, celui-ci compris ; la limite une fois épuisée. */
  used: number;
}

/** Consomme un appel d'essai pour ce réseau (même clé que la limite anonyme). */
export function checkTrialLimit(key: string): TrialResult {
  const result = trial.check(key, TRIAL_MAX_CALLS, 1);
  return { ...result, used: TRIAL_MAX_CALLS - result.remaining };
}

/** Test helper: clears the rate-limit state (limite horaire et essai). */
export function _resetRateLimit(): void {
  anonymous.clear();
  trial.clear();
}

/** Test helper: number of live buckets. */
export function _bucketCount(): number {
  return anonymous.size();
}

/** Test helper: number of live trial windows. */
export function _trialBucketCount(): number {
  return trial.size();
}
