/**
 * Garde-fous de charge sortante (`src/mcp/company/outbound-guard.ts`), posés AVANT
 * l'ouverture de `company_check` aux agents sans clé (tâche d'ouverture du 06.10.2026).
 *
 * Deux niveaux de test :
 *  - unitaires, directement sur `SourceBreaker` et `RequestCoalescer` (horloge fictive,
 *    aucun réseau) ;
 *  - d'intégration, via `lookupLindas`/`lookupGleif` (fetch simulé), pour vérifier que le
 *    disjoncteur et le regroupement sont bien branchés sur les deux clients en direct.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestCoalescer, retryAfterMs, SourceBreaker } from "../../src/mcp/company/outbound-guard.js";
import { lookupLindas, resetLindasBreaker, resetLindasCache } from "../../src/mcp/company/lindas.js";
import { lookupGleif, resetGleifBreaker, resetGleifCache } from "../../src/mcp/company/gleif.js";
import type { LiveDeps } from "../../src/mcp/company/types.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/company/${name}`, import.meta.url), "utf8"));
const LINDAS_AXA = fixture("lindas-axa-leben.json");
const GLEIF_AXA = fixture("gleif-axa-leben.json");

const MINUTE_MS = 60_000;
const QUINZE_MIN_MS = 15 * MINUTE_MS;

describe("SourceBreaker (unitaire, horloge fictive)", () => {
  it("fermé au départ : jamais en pause avant le premier échec", () => {
    const breaker = new SourceBreaker({ now: () => 0 });
    expect(breaker.isPaused()).toBe(false);
  });

  it("un 429 ouvre une pause de 60 s, levée après son expiration", () => {
    let horloge = 0;
    const breaker = new SourceBreaker({ now: () => horloge });
    breaker.recordFailure(undefined, true);
    expect(breaker.isPaused()).toBe(true);
    horloge += MINUTE_MS - 1;
    expect(breaker.isPaused()).toBe(true); // encore en pause, une milliseconde avant la fin
    horloge += 1;
    expect(breaker.isPaused()).toBe(false); // levée exactement à l'expiration
  });

  it("la pause double à chaque échec consécutif, plafonnée à 15 minutes", () => {
    let horloge = 0;
    const breaker = new SourceBreaker({ now: () => horloge });
    const pauseesAttendues = [MINUTE_MS, 2 * MINUTE_MS, 4 * MINUTE_MS, 8 * MINUTE_MS, QUINZE_MIN_MS, QUINZE_MIN_MS];
    for (const attendue of pauseesAttendues) {
      breaker.recordFailure(undefined, true);
      horloge += attendue - 1;
      expect(breaker.isPaused()).toBe(true); // toujours en pause juste avant la durée attendue
      horloge += 1;
      expect(breaker.isPaused()).toBe(false); // levée exactement à la durée attendue, jamais au-delà
    }
  });

  it("remise à zéro complète au premier succès : l'échec suivant repart à 60 s, pas à la valeur doublée", () => {
    let horloge = 0;
    const breaker = new SourceBreaker({ now: () => horloge });
    breaker.recordFailure(undefined, true); // pause 60s, prochaine durée de base 120s
    horloge += MINUTE_MS;
    expect(breaker.isPaused()).toBe(false);
    breaker.recordSuccess();
    breaker.recordFailure(undefined, true);
    horloge += MINUTE_MS - 1;
    expect(breaker.isPaused()).toBe(true); // encore la pause de 60s, pas déjà levée
    horloge += 1;
    expect(breaker.isPaused()).toBe(false); // bien 60s seulement, la remise à zéro a fonctionné
  });

  it("un succès pendant la pause referme le disjoncteur immédiatement", () => {
    let horloge = 0;
    const breaker = new SourceBreaker({ now: () => horloge });
    breaker.recordFailure(undefined, true);
    expect(breaker.isPaused()).toBe(true);
    breaker.recordSuccess();
    expect(breaker.isPaused()).toBe(false);
  });

  it("Retry-After plus long que la pause de base : la pause vaut au moins cette durée", () => {
    let horloge = 0;
    const breaker = new SourceBreaker({ now: () => horloge });
    breaker.recordFailure(5 * MINUTE_MS, true); // 1er échec : base 60s, mais Retry-After = 5 min
    horloge += 5 * MINUTE_MS - 1;
    expect(breaker.isPaused()).toBe(true);
    horloge += 1;
    expect(breaker.isPaused()).toBe(false);
  });

  it("Retry-After plafonné à 15 minutes, même s'il demande davantage", () => {
    let horloge = 0;
    const breaker = new SourceBreaker({ now: () => horloge });
    breaker.recordFailure(60 * MINUTE_MS, true); // Retry-After d'une heure : jamais appliqué tel quel
    horloge += QUINZE_MIN_MS - 1;
    expect(breaker.isPaused()).toBe(true);
    horloge += 1;
    expect(breaker.isPaused()).toBe(false); // jamais plus de 15 minutes
  });

  it("Retry-After plus court que la pause de base ne la réduit jamais", () => {
    let horloge = 0;
    const breaker = new SourceBreaker({ now: () => horloge });
    breaker.recordFailure(undefined, true); // pause de base 60s
    horloge += MINUTE_MS;
    breaker.recordSuccess();
    breaker.recordFailure(undefined, true);
    horloge += MINUTE_MS; // lève la 1re pause (60s), prochaine base 120s
    breaker.recordFailure(5_000, true); // Retry-After de 5s, bien plus court que la base (120s)
    horloge += 120_000 - 1;
    expect(breaker.isPaused()).toBe(true); // la base (plus longue) prévaut
    horloge += 1;
    expect(breaker.isPaused()).toBe(false);
  });
  it("une erreur isolée (5xx, délai) ne coupe pas la source ; la deuxième consécutive ouvre la pause", () => {
    let horloge = 0;
    const breaker = new SourceBreaker({ now: () => horloge });
    breaker.recordFailure();
    expect(breaker.isPaused()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isPaused()).toBe(true);
    horloge += MINUTE_MS;
    expect(breaker.isPaused()).toBe(false);
  });

  it("un succès entre deux erreurs isolées remet le compte à zéro : aucune pause", () => {
    const breaker = new SourceBreaker({ now: () => 0 });
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.isPaused()).toBe(false);
  });
});

describe("retryAfterMs (lecture de l'en-tête HTTP)", () => {
  it("absent : undefined", () => {
    expect(retryAfterMs(new Response(null, { status: 429 }))).toBeUndefined();
  });

  it("secondes valides : converties en millisecondes", () => {
    const res = new Response(null, { status: 429, headers: { "retry-after": "30" } });
    expect(retryAfterMs(res)).toBe(30_000);
  });

  it("valeur non numérique (ex. une date HTTP) : undefined, jamais une valeur devinée", () => {
    const res = new Response(null, { status: 429, headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" } });
    expect(retryAfterMs(res)).toBeUndefined();
  });

  it("valeur négative : undefined", () => {
    const res = new Response(null, { status: 429, headers: { "retry-after": "-5" } });
    expect(retryAfterMs(res)).toBeUndefined();
  });
});

describe("RequestCoalescer (unitaire)", () => {
  it("deux appels simultanés sur la même clé : une seule exécution de `fn`, même résultat rendu aux deux", async () => {
    const coalescer = new RequestCoalescer<string>();
    let appels = 0;
    let resoudre: (v: string) => void = () => {};
    const fn = () =>
      new Promise<string>((resolve) => {
        appels += 1;
        resoudre = resolve;
      });

    const p1 = coalescer.run("CHE-103.137.179", fn);
    const p2 = coalescer.run("CHE-103.137.179", fn);
    expect(appels).toBe(1); // le second appelant n'a pas redéclenché `fn`
    resoudre("valeur-unique");
    await expect(p1).resolves.toBe("valeur-unique");
    await expect(p2).resolves.toBe("valeur-unique");
  });

  it("des clés différentes ne sont jamais regroupées", async () => {
    const coalescer = new RequestCoalescer<string>();
    let appels = 0;
    const fn = async () => {
      appels += 1;
      return "x";
    };
    await Promise.all([coalescer.run("CHE-103.137.179", fn), coalescer.run("CHE-999.999.999", fn)]);
    expect(appels).toBe(2);
  });

  it("une fois la promesse résolue, un nouvel appel sur la même clé redéclenche bien `fn`", async () => {
    const coalescer = new RequestCoalescer<string>();
    let appels = 0;
    const fn = async () => {
      appels += 1;
      return `appel-${appels}`;
    };
    const premier = await coalescer.run("CHE-103.137.179", fn);
    const second = await coalescer.run("CHE-103.137.179", fn);
    expect(appels).toBe(2);
    expect(premier).toBe("appel-1");
    expect(second).toBe("appel-2");
  });
});

// --- Intégration : le disjoncteur et le regroupement vus depuis les clients en direct ---

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("lookupLindas : disjoncteur et regroupement branchés", () => {
  let horloge: number;
  const now = () => horloge;
  beforeEach(() => {
    horloge = Date.UTC(2026, 9, 6, 10, 0, 0);
    resetLindasCache(now);
    resetLindasBreaker(now);
  });
  const deps = (fetchImpl: LiveDeps["fetch"]): LiveDeps => ({ fetch: fetchImpl, now });

  it("pause après deux 503 consécutifs : l'appel suivant n'atteint pas le réseau", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("indisponible", { status: 503 }));
    const premier = await lookupLindas("CHE103137179", deps(fetchMock));
    expect(premier).toEqual({ available: false, reason: "LINDAS responded with HTTP 503" });
    const second = await lookupLindas("CHE103137179", deps(fetchMock)); // erreur isolée : la source reste appelée
    expect(second).toEqual({ available: false, reason: "LINDAS responded with HTTP 503" });

    const troisieme = await lookupLindas("CHE103137179", deps(fetchMock));
    expect(troisieme).toEqual({ available: false, reason: "source temporarily paused after errors" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // le troisième appel n'a jamais touché le réseau
  });

  it("pause après un 429 : au moins la durée de Retry-After, puis levée", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("trop de requêtes", { status: 429, headers: { "retry-after": "300" } }))
      .mockResolvedValueOnce(jsonResponse(LINDAS_AXA));
    await lookupLindas("CHE103137179", deps(fetchMock));

    horloge += 5 * MINUTE_MS - 1;
    const pendantLaPause = await lookupLindas("CHE123456008", deps(fetchMock)); // IDE différent : pas de cache en jeu
    expect(pendantLaPause).toEqual({ available: false, reason: "source temporarily paused after errors" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    horloge += 1;
    const apresLaPause = await lookupLindas("CHE103137179", deps(fetchMock));
    expect(apresLaPause.available).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("remise à zéro après succès : le compte d'erreurs repart de zéro", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("indisponible", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(LINDAS_AXA))
      .mockResolvedValueOnce(new Response("indisponible", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(LINDAS_AXA));
    await lookupLindas("CHE103137179", deps(fetchMock)); // erreur isolée : pas de pause
    const succes = await lookupLindas("CHE103137179", deps(fetchMock));
    expect(succes.available).toBe(true); // remise à zéro

    const echecSuivant = await lookupLindas("CHE999999994", deps(fetchMock)); // IDE différent : nouveau fetch
    expect(echecSuivant.available).toBe(false);
    const appelSuivant = await lookupLindas("CHE123456008", deps(fetchMock)); // une seule erreur depuis le succès : pas de pause
    expect(appelSuivant).not.toEqual({ available: false, reason: "source temporarily paused after errors" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("deux appels simultanés pour le même IDE : un seul fetch sortant", async () => {
    let resoudre: (r: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementationOnce(
      () => new Promise<Response>((resolve) => { resoudre = resolve; }),
    );
    const p1 = lookupLindas("CHE103137179", deps(fetchMock));
    const p2 = lookupLindas("CHE103137179", deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(1); // le second appelant n'a pas redéclenché de fetch
    resoudre(jsonResponse(LINDAS_AXA));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(r1.available).toBe(true);
  });
});

describe("lookupGleif : disjoncteur et regroupement branchés (symétrique à LINDAS)", () => {
  let horloge: number;
  const now = () => horloge;
  beforeEach(() => {
    horloge = Date.UTC(2026, 9, 6, 10, 0, 0);
    resetGleifCache(now);
    resetGleifBreaker(now);
  });
  const deps = (fetchImpl: LiveDeps["fetch"]): LiveDeps => ({ fetch: fetchImpl, now });

  it("pause après deux 503 consécutifs : l'appel suivant n'atteint pas le réseau", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("indisponible", { status: 503 }));
    await lookupGleif("CHE-103.137.179", deps(fetchMock));
    await lookupGleif("CHE-103.137.179", deps(fetchMock));
    const troisieme = await lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(troisieme).toEqual({ available: false, reason: "source temporarily paused after errors" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("pause après un 429 avec Retry-After, levée ensuite", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("trop de requêtes", { status: 429, headers: { "retry-after": "120" } }))
      .mockResolvedValueOnce(jsonResponse(GLEIF_AXA));
    await lookupGleif("CHE-103.137.179", deps(fetchMock));

    horloge += 2 * MINUTE_MS - 1;
    const pendant = await lookupGleif("CHE-123.456.009", deps(fetchMock));
    expect(pendant).toEqual({ available: false, reason: "source temporarily paused after errors" });

    horloge += 1;
    const apres = await lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(apres.available).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deux appels simultanés pour le même IDE : un seul fetch sortant", async () => {
    let resoudre: (r: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementationOnce(
      () => new Promise<Response>((resolve) => { resoudre = resolve; }),
    );
    const p1 = lookupGleif("CHE-103.137.179", deps(fetchMock));
    const p2 = lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resoudre(jsonResponse(GLEIF_AXA));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(r1.available).toBe(true);
  });
});
