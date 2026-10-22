/**
 * Client HTTP poli pour le Portail des feuilles officielles.
 *
 * - Une requête à la fois (file interne : un appel attend la fin du précédent).
 * - Une pause (`delayMs`, 500 ms par défaut) avant chaque requête sauf la première.
 * - Refus pour trop d'appels (429) ou serveur surchargé (503) : attente qui double à chaque essai
 *   (30 s, 60 s, 120 s, 240 s), jamais plus courte que le délai demandé par `Retry-After` (même
 *   lecteur que `scripts/prospect-sources.ts`). Si le serveur demande plus de 300 s, ou après
 *   5 essais, le passage s'arrête au lieu d'insister.
 * - Toute autre erreur : une seule nouvelle tentative.
 * - Plafond de requêtes par passage et heure limite : au-delà, `FoscBudgetError` et le passage
 *   s'arrête proprement (l'état déjà calculé est gardé).
 * Les CG du portail (07.06.2024) ne fixent aucune limite chiffrée de requêtes (relu le 22.10.2026).
 * Aucun message d'erreur ne reprend le corps d'une réponse.
 */
import { parseRetryAfterMs } from "../../scripts/prospect-sources.js";
import { FOSC_USER_AGENT } from "./sources.js";

export const DEFAULT_DELAY_MS = 500;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const RATE_LIMIT_BASE_WAIT_MS = 30_000;
export const RATE_LIMIT_MAX_WAIT_MS = 300_000;
export const RATE_LIMIT_MAX_ATTEMPTS = 5;

export class FoscHttpError extends Error {
  constructor(readonly status: number | null, readonly kind: string) {
    super(`Portail des feuilles officielles : ${kind} en échec (${status === null ? "réseau" : `HTTP ${status}`})`);
    this.name = "FoscHttpError";
  }
}

export class FoscBudgetError extends Error {
  constructor(readonly reason: "requests" | "time" | "rate_limit") {
    super(reason === "requests" ? "Plafond de requêtes du passage atteint"
      : reason === "time" ? "Heure limite du passage atteinte"
        : "Le portail demande d'attendre trop longtemps (429/503) : passage arrêté");
    this.name = "FoscBudgetError";
  }
}

export interface ClientStats {
  requests: number;
  rateLimited: number;
  waitedMs: number;
  retries: number;
}

export interface PoliteClientOptions {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
  delayMs?: number;
  timeoutMs?: number;
  maxRequests: number;
  /** Heure limite absolue (ms depuis l'époque) ; aucune requête ne part après. */
  deadlineMs?: number;
}

export interface PoliteClient {
  get(url: string, opts: { kind: string; accept: string; maxBytes: number }): Promise<Buffer>;
  readonly stats: ClientStats;
  remaining(): number;
}

/** Attente avant l'essai suivant (attempt commence à 1) ; null = trop long, on arrête. */
export function rateLimitWait(attempt: number, retryAfterMs: number | null): number | null {
  const doubled = RATE_LIMIT_BASE_WAIT_MS * 2 ** (attempt - 1);
  const wait = Math.max(doubled, retryAfterMs ?? 0);
  return wait > RATE_LIMIT_MAX_WAIT_MS ? null : wait;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createPoliteClient(opts: PoliteClientOptions): PoliteClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const sleep = opts.sleepImpl ?? defaultSleep;
  const now = opts.nowImpl ?? Date.now;
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stats: ClientStats = { requests: 0, rateLimited: 0, waitedMs: 0, retries: 0 };
  let queue: Promise<unknown> = Promise.resolve();

  const pause = async (ms: number) => {
    stats.waitedMs += ms;
    await sleep(ms);
  };

  const once = async (url: string, accept: string, maxBytes: number): Promise<{ status: number; body?: Buffer; retryAfterMs: number | null }> => {
    if (stats.requests >= opts.maxRequests) throw new FoscBudgetError("requests");
    if (opts.deadlineMs !== undefined && now() >= opts.deadlineMs) throw new FoscBudgetError("time");
    if (stats.requests > 0) await pause(delayMs);
    stats.requests++;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { "User-Agent": FOSC_USER_AGENT, Accept: accept },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch {
      return { status: 0, retryAfterMs: null };
    }
    if (!res.ok) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"), now());
      try { await res.body?.cancel(); } catch { /* corps déjà fermé */ }
      return { status: res.status, retryAfterMs };
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      try { await res.body?.cancel(); } catch { /* corps déjà fermé */ }
      return { status: -1, retryAfterMs: null };
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > maxBytes) return { status: -1, retryAfterMs: null };
    return { status: res.status, body, retryAfterMs: null };
  };

  const run = async (url: string, kind: string, accept: string, maxBytes: number): Promise<Buffer> => {
    let rateLimited = 0;
    let otherFailures = 0;
    for (;;) {
      const r = await once(url, accept, maxBytes);
      if (r.body) return r.body;
      if (r.status === 429 || r.status === 503) {
        rateLimited++;
        stats.rateLimited++;
        if (rateLimited >= RATE_LIMIT_MAX_ATTEMPTS) throw new FoscBudgetError("rate_limit");
        const wait = rateLimitWait(rateLimited, r.retryAfterMs);
        if (wait === null) throw new FoscBudgetError("rate_limit");
        await pause(wait);
        continue;
      }
      if (r.status === -1) throw new FoscHttpError(null, `${kind} (réponse trop volumineuse)`);
      // 404 : l'avis n'existe plus (ou pas encore) ; inutile d'insister.
      if (r.status === 404) throw new FoscHttpError(404, kind);
      otherFailures++;
      if (otherFailures >= 2) throw new FoscHttpError(r.status === 0 ? null : r.status, kind);
      stats.retries++;
    }
  };

  return {
    stats,
    remaining: () => Math.max(0, opts.maxRequests - stats.requests),
    get(url, { kind, accept, maxBytes }) {
      const next = queue.then(() => run(url, kind, accept, maxBytes));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
