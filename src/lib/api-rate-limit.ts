/**
 * Petit limiteur en mémoire à fenêtre fixe pour l'API publique `/api/v1` (tâche osd.donnees,
 * tâche B3 du plan `2026-10-06-prospection-et-api.md`).
 *
 * `src/lib/rate-limit.ts` existant (`checkRateLimit(bucket, ip)`) impose un espacement minimal
 * entre deux requêtes d'une même adresse — au plus UNE requête par fenêtre — ce qui convient à
 * `admin`/`oauth-register` mais ne sait pas compter N requêtes par heure (60 pour la fiche
 * société, 600 pour les données locales). `src/mcp/rate-limit.ts` compte bien par fenêtre fixe,
 * mais vit dans le périmètre MCP (`.claude/rules/mcp-et-comptes.md`) et n'est pas un module
 * générique réutilisable par une route REST. Ce fichier reprend la même mécanique de fenêtre
 * fixe que `src/mcp/rate-limit.ts` (purge des fenêtres expirées, éviction de la plus ancienne au
 * plafond), pour l'API REST seule.
 *
 * Horloge toujours injectée (`now: () => Date.now()`, jamais `Date.now()` lu directement ici) :
 * les tests contrôlent le temps sans dépendre de l'horloge réelle de la machine.
 */

const MAX_KEYS_PER_LIMITER = 10_000;

interface Window {
  count: number;
  resetAt: number;
}

interface Limiter {
  windowMs: number;
  limit: number;
  windows: Map<string, Window>;
}

const limiters = new Map<string, Limiter>();

export interface ApiRateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfterSeconds: number;
}

/** Déclare (ou retrouve) un compteur nommé. `limit`/`windowMs` ne sont lus qu'à la création : un
 *  appel ultérieur avec des valeurs différentes pour le même nom ne change rien (toujours
 *  appelé avec les mêmes constantes par route dans `src/routes/api-v1.ts`). */
function limiterFor(name: string, limit: number, windowMs: number): Limiter {
  const existing = limiters.get(name);
  if (existing) return existing;
  const limiter: Limiter = { windowMs, limit, windows: new Map() };
  limiters.set(name, limiter);
  return limiter;
}

/**
 * Consomme une requête pour `key` dans le compteur `name`. Fenêtre fixe ouverte au premier appel
 * de chaque clé ; au plafond `MAX_KEYS_PER_LIMITER`, purge d'abord les fenêtres déjà expirées
 * (ordre d'insertion = ordre d'expiration, comme `src/mcp/rate-limit.ts`), puis au besoin évince
 * la fenêtre la plus proche d'expirer — jamais une exception, jamais une croissance illimitée.
 */
export function checkApiRateLimit(name: string, key: string, limit: number, windowMs: number, now: () => number): ApiRateLimitResult {
  const limiter = limiterFor(name, limit, windowMs);
  const nowMs = now();
  let w = limiter.windows.get(key);
  if (!w || w.resetAt <= nowMs) {
    if (w) limiter.windows.delete(key);
    if (limiter.windows.size >= MAX_KEYS_PER_LIMITER) {
      for (const [k, win] of limiter.windows) {
        if (win.resetAt > nowMs) break;
        limiter.windows.delete(k);
      }
      if (limiter.windows.size >= MAX_KEYS_PER_LIMITER) {
        const oldest = limiter.windows.keys().next().value;
        if (oldest !== undefined) limiter.windows.delete(oldest);
      }
    }
    w = { count: 0, resetAt: nowMs + windowMs };
    limiter.windows.set(key, w);
  }
  w.count += 1;
  const allowed = w.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - w.count),
    limit,
    resetAt: w.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - nowMs) / 1000)),
  };
}

/** Aide de test : vide tous les compteurs nommés (isolation entre suites). */
export function _resetApiRateLimit(): void {
  for (const limiter of limiters.values()) limiter.windows.clear();
}

/** Aide de test : nombre de clés vivantes pour un compteur nommé (0 si le compteur n'existe pas encore). */
export function _apiRateLimitKeyCount(name: string): number {
  return limiters.get(name)?.windows.size ?? 0;
}
