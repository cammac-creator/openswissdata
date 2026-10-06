/**
 * Garde-fous de charge sortante partagés par les deux clients en direct de la fiche société
 * (LINDAS, GLEIF), posés AVANT l'ouverture de `company_check` aux agents sans clé (tâche
 * d'ouverture du 06.10.2026, carnet « Ce que l'ouverture devra aussi faire »).
 *
 * Deux mécanismes, indépendants l'un de l'autre :
 *  - `SourceBreaker` : un disjoncteur par source. Une réponse 429 met la source en pause tout
 *    de suite (elle demande explicitement de ralentir) ; une réponse 5xx ou un délai dépassé
 *    ne la met en pause qu'au deuxième échec consécutif (une erreur isolée ne coupe pas la
 *    source). Pause de 60 s, doublée à chaque nouvel échec, plafonnée à 15 min, remise à
 *    zéro au premier succès. Horloge injectée
 *    (`now: () => number`), jamais `Date.now` lu directement — même discipline que
 *    `TtlCache` (`cache.ts`), pour qu'un test fige le temps, le fasse avancer, puis vérifie
 *    la levée de la pause sans dépendre de l'horloge réelle.
 *  - `RequestCoalescer` : regroupe les appels concurrents pour une même clé (IDE canonique),
 *    pour qu'une même source ne reçoive jamais deux requêtes en vol pour le même IDE au même
 *    instant. Seul le premier appelant exécute réellement `fn` ; les suivants reçoivent la
 *    même promesse, donc la même valeur figée (cache.ts) à la fin.
 */

const DEFAULT_PAUSE_MS = 60_000;
const MAX_PAUSE_MS = 15 * 60_000;

export interface BreakerDeps {
  now: () => number;
}

export class SourceBreaker {
  private readonly now: () => number;
  private pauseUntil = 0;
  // Durée de la PROCHAINE pause si un nouvel échec survient ; doublée à chaque échec
  // consécutif (jamais réappliquée plusieurs fois pour un seul échec), plafonnée à 15 min.
  private nextPauseMs = DEFAULT_PAUSE_MS;
  private consecutiveFailures = 0;

  constructor(deps: BreakerDeps) {
    this.now = deps.now;
  }

  /** `true` pendant la pause : l'appelant ne doit faire AUCUN appel réseau. */
  isPaused(): boolean {
    return this.now() < this.pauseUntil;
  }

  /** Premier succès après une ou plusieurs pauses : remise à zéro complète. */
  recordSuccess(): void {
    this.pauseUntil = 0;
    this.nextPauseMs = DEFAULT_PAUSE_MS;
    this.consecutiveFailures = 0;
  }

  /**
   * `retryAfterMs` : valeur de l'en-tête `Retry-After` d'une réponse 429, en millisecondes,
   * quand elle est connue (voir `retryAfterMs` plus bas). La pause vaut alors AU MOINS cette
   * durée, sans jamais dépasser le plafond de 15 min, même si `retryAfterMs` le dépasse.
   */
  recordFailure(retryAfterMs?: number, rateLimited = false): void {
    this.consecutiveFailures += 1;
    // Une erreur isolée (5xx, délai) ne coupe pas la source ; un 429 la coupe tout de suite.
    if (!rateLimited && this.consecutiveFailures < 2) return;
    const voulu = retryAfterMs !== undefined ? Math.max(this.nextPauseMs, retryAfterMs) : this.nextPauseMs;
    const pauseMs = Math.min(voulu, MAX_PAUSE_MS);
    this.pauseUntil = this.now() + pauseMs;
    // La progression de l'échec suivant double toujours depuis la dernière valeur de base
    // (jamais depuis une pause allongée par `Retry-After`), plafonnée elle aussi.
    this.nextPauseMs = Math.min(this.nextPauseMs * 2, MAX_PAUSE_MS);
  }
}

/**
 * Lit l'en-tête `Retry-After` d'une réponse HTTP, en millisecondes. Seule la forme « nombre
 * de secondes » (RFC 9110) est reconnue ; une forme « date HTTP » ou un en-tête absent rend
 * `undefined`, jamais une valeur devinée.
 */
export function retryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/**
 * Regroupe les appels concurrents pour une même clé : seul le premier appelant exécute `fn`,
 * les suivants reçoivent la MÊME promesse (jamais une seconde requête sortante en vol pour
 * cette clé). La clé part de la map dès que `fn` se résout, succès ou échec confondus — un
 * appel ultérieur, même immédiat, redéclenche alors un nouvel appel (jamais figé à tort).
 */
export class RequestCoalescer<T> {
  private readonly enVol = new Map<string, Promise<T>>();

  run(key: string, fn: () => Promise<T>): Promise<T> {
    const existante = this.enVol.get(key);
    if (existante) return existante;
    const promesse = fn().finally(() => {
      this.enVol.delete(key);
    });
    this.enVol.set(key, promesse);
    return promesse;
  }
}
