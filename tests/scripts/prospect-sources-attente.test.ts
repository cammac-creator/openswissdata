// Refus pour trop d'appels du catalogue (21.10.2026) : le passage du 19.10 s'est arrêté à la 4e page
// sur un HTTP 429 après une seule retentative. Ces tests fixent le nouveau comportement sans toucher
// à celui des autres pannes (un essai et une seule retentative, tests de prospect-sources.test.ts).
import { describe, expect, it } from "vitest";
import {
  CkanHttpError,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_MAX_WAIT_MS,
  fetchCkanPageWithRetry,
  parseRetryAfterMs,
  rateLimitWaitMs,
} from "../../scripts/prospect-sources.js";

const PAGE_OK = JSON.stringify({ success: true, result: { count: 1, results: [] } });

function catalogue(reponses: Array<number | "ok">, entetes: Record<string, string> = {}) {
  const appels: string[] = [];
  const fetchImpl = (async (url: string) => {
    appels.push(String(url));
    const r = reponses[Math.min(appels.length - 1, reponses.length - 1)];
    if (r === "ok") return new Response(PAGE_OK, { status: 200, headers: { "content-type": "application/json" } });
    return new Response("refus", { status: r, headers: entetes });
  }) as unknown as typeof fetch;
  return { fetchImpl, appels };
}

function sommeil() {
  const attentes: number[] = [];
  return { attentes, sleepImpl: async (ms: number) => { attentes.push(ms); } };
}

describe("délai demandé par Retry-After", () => {
  it("lit des secondes, une date HTTP, et ignore le reste", () => {
    expect(parseRetryAfterMs("120", 0)).toBe(120_000);
    const maintenant = Date.parse("2026-10-19T11:10:00Z");
    expect(parseRetryAfterMs("Mon, 19 Oct 2026 11:11:30 GMT", maintenant)).toBe(90_000);
    expect(parseRetryAfterMs("Mon, 19 Oct 2026 11:00:00 GMT", maintenant)).toBe(0);
    expect(parseRetryAfterMs("bientôt", 0)).toBeNull();
    expect(parseRetryAfterMs(null, 0)).toBeNull();
  });
});

describe("attente après un refus pour trop d'appels", () => {
  it("double à chaque refus : 30, 60, 120, 240 s", () => {
    expect([1, 2, 3, 4].map(n => rateLimitWaitMs(n, null))).toEqual([30_000, 60_000, 120_000, 240_000]);
  });
  it("respecte un Retry-After plus long, plafonné à 300 s", () => {
    expect(rateLimitWaitMs(1, 200_000)).toBe(200_000);
    expect(rateLimitWaitMs(1, 5_000)).toBe(30_000);
    expect(rateLimitWaitMs(1, 3_600_000)).toBe(RATE_LIMIT_MAX_WAIT_MS);
  });
});

describe("page du catalogue refusée pour trop d'appels", () => {
  it("réessaie après des attentes croissantes, puis rend la page", async () => {
    const { fetchImpl, appels } = catalogue([429, 429, "ok"]);
    const { attentes, sleepImpl } = sommeil();
    const page = await fetchCkanPageWithRetry(fetchImpl, "essai", 300, 100, 1000, 500, sleepImpl);
    expect(page).toEqual({ count: 1, results: [] });
    expect(appels).toHaveLength(3);
    expect(attentes).toEqual([30_000, 60_000]);
  });

  it("suit le Retry-After du serveur quand il est plus long", async () => {
    const { fetchImpl } = catalogue([429, "ok"], { "retry-after": "180" });
    const { attentes, sleepImpl } = sommeil();
    await fetchCkanPageWithRetry(fetchImpl, "essai", 0, 100, 1000, 500, sleepImpl);
    expect(attentes).toEqual([180_000]);
  });

  it("traite un 503 comme une surcharge, pas comme une panne", async () => {
    const { fetchImpl, appels } = catalogue([503, 503, "ok"]);
    const { sleepImpl } = sommeil();
    expect(await fetchCkanPageWithRetry(fetchImpl, "essai", 0, 100, 1000, 500, sleepImpl)).not.toBeNull();
    expect(appels).toHaveLength(3);
  });

  it("abandonne la page après le nombre maximal de refus, sans jamais dépasser", async () => {
    const { fetchImpl, appels } = catalogue([429]);
    const { attentes, sleepImpl } = sommeil();
    expect(await fetchCkanPageWithRetry(fetchImpl, "essai", 0, 100, 1000, 500, sleepImpl)).toBeNull();
    expect(appels).toHaveLength(RATE_LIMIT_MAX_ATTEMPTS);
    expect(attentes).toEqual([30_000, 60_000, 120_000, 240_000]);
  });

  it("garde une seule retentative pour une autre panne", async () => {
    const { fetchImpl, appels } = catalogue([500]);
    const { attentes, sleepImpl } = sommeil();
    expect(await fetchCkanPageWithRetry(fetchImpl, "essai", 0, 100, 1000, 500, sleepImpl)).toBeNull();
    expect(appels).toHaveLength(2);
    expect(attentes).toEqual([500]);
  });

  it("expose le statut et le délai demandé dans l'erreur", () => {
    const e = new CkanHttpError(429, 120_000);
    expect(e.status).toBe(429);
    expect(e.retryAfterMs).toBe(120_000);
    expect(e.message).toContain("HTTP 429");
  });
});
