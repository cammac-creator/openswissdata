/**
 * Statut d'inscription au registre du commerce par l'API REST Zefix de l'OFRC (11.10.2026,
 * `src/mcp/company/zefix-rest.ts`, branché dans `company_check` et `/api/v1/company`).
 *
 * Aucun appel réseau réel : `fetch` est toujours simulé, et les identifiants sont des valeurs
 * fictives évidentes posées par `vi.stubEnv` (jamais l'environnement ambiant). Les réponses Zefix
 * sont synthétiques (IDE fictifs, sauf l'IDE d'AXA Leben AG déjà présent dans les fixtures
 * LINDAS/GLEIF), construites sur les clés relevées le 11.10.2026 : tableau d'objets, `uid`,
 * `status` (ACTIVE, CANCELLED ; BEING_CANCELLED d'après la documentation de Zefix), `deletionDate`.
 */

import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DAILY_LIMIT,
  lookupZefixRest,
  readZefixRestCredentials,
  resetZefixRest,
  ZEFIX_REST_COMPANY_UID_URL,
  ZEFIX_REST_NOT_CONFIGURED,
} from "../../src/mcp/company/zefix-rest.js";
import { SerialGate } from "../../src/mcp/company/outbound-guard.js";
import { companyCheck } from "../../src/mcp/company/check.js";
import { COMPANY_SOURCES } from "../../src/mcp/company/sources.js";
import { LINDAS_ENDPOINT, resetLindasBreaker, resetLindasCache } from "../../src/mcp/company/lindas.js";
import { resetGleifBreaker, resetGleifCache } from "../../src/mcp/company/gleif.js";
import { parseUid } from "../../src/mcp/company/uid.js";
import { companyCheckHandler } from "../../src/mcp/tools/company-check.js";
import { PUBLIC_SOURCES } from "../../src/lib/public-sources.js";
import { getSource } from "../../etl/shared/sources/registry.js";
import { PRODUCT_SOURCES } from "../../etl/shared/sources/products.js";
import type { LiveDeps } from "../../src/mcp/company/types.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/company/${name}`, import.meta.url), "utf8"));
const LINDAS_AXA = fixture("lindas-axa-leben.json");
const GLEIF_AXA = fixture("gleif-axa-leben.json");

// Identifiants FICTIFS évidents : jamais un vrai compte.
const USERNAME = "utilisateur-fictif-osd";
const PASSWORD = "mot-de-passe-fictif-osd";
const BASIC_TOKEN = Buffer.from(`${USERNAME}:${PASSWORD}`, "utf8").toString("base64");
const EXPECTED_AUTHORIZATION = `Basic ${BASIC_TOKEN}`;

const DEBUT = Date.UTC(2026, 9, 11, 10, 0, 0); // 2026-10-11 10:00:00 UTC
const HEURE_MS = 60 * 60 * 1000;
const JOUR_MS = 24 * HEURE_MS;

const AXA_COMPACT = "CHE103137179";
const AXA_UID = "CHE-103.137.179";

/** IDE fictifs valides (chiffre de contrôle calculé), jamais une vraie société choisie à la main. */
function fictitiousUids(count: number): string[] {
  const poids = [5, 4, 3, 2, 7, 6, 5, 4];
  const out: string[] = [];
  for (let base = 90000000; out.length < count; base += 1) {
    const huit = String(base);
    const reste = 11 - (poids.reduce((t, p, i) => t + p * Number(huit[i]), 0) % 11);
    const controle = reste === 11 ? 0 : reste;
    if (controle === 10) continue;
    const compact = `CHE${huit}${controle}`;
    if (parseUid(compact).ok) out.push(compact);
  }
  return out;
}
const [UID_A, UID_B, UID_C, UID_D, UID_E, UID_F] = fictitiousUids(6);

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Réponse Zefix synthétique : les champs que le module doit IGNORER (nom, adresse, but) sont
 *  présents exprès, pour vérifier qu'ils ne ressortent jamais. */
function zefixBody(compact: string, status: unknown, deletionDate: unknown = null): unknown[] {
  return [
    {
      uid: compact,
      name: "Nom Fictif A Ne Pas Garder SA",
      address: { street: "Rue Fictive A Ne Pas Garder", houseNumber: "1", swissZipCode: "9999", city: "Lieu Fictif" },
      purpose: "But fictif a ne pas garder",
      status,
      deletionDate,
      legalForm: { id: 3 },
    },
  ];
}

function configure(): void {
  vi.stubEnv("ZEFIX_REST_USERNAME", USERNAME);
  vi.stubEnv("ZEFIX_REST_PASSWORD", PASSWORD);
}

function unconfigure(): void {
  vi.stubEnv("ZEFIX_REST_USERNAME", "");
  vi.stubEnv("ZEFIX_REST_PASSWORD", "");
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

let horloge: number;
const now = () => horloge;
const deps = (fetchImpl: LiveDeps["fetch"]): LiveDeps => ({ fetch: fetchImpl, now });

beforeEach(() => {
  horloge = DEBUT;
  resetZefixRest(now);
  resetLindasCache(now);
  resetLindasBreaker(now);
  resetGleifCache(now);
  resetGleifBreaker(now);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("identifiants absents : aucune requête, fiche strictement inchangée", () => {
  it("variables vides : motif fixe, aucun appel à fetch", async () => {
    unconfigure();
    const fetchMock = vi.fn();
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(result).toEqual({ available: false, reason: ZEFIX_REST_NOT_CONFIGURED });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("une seule des deux variables : toujours non configuré", () => {
    expect(readZefixRestCredentials({ ZEFIX_REST_USERNAME: USERNAME })).toBeNull();
    expect(readZefixRestCredentials({ ZEFIX_REST_PASSWORD: PASSWORD })).toBeNull();
    expect(readZefixRestCredentials({ ZEFIX_REST_USERNAME: "  ", ZEFIX_REST_PASSWORD: PASSWORD })).toBeNull();
    expect(readZefixRestCredentials({ ZEFIX_REST_USERNAME: USERNAME, ZEFIX_REST_PASSWORD: PASSWORD })).toEqual({
      username: USERNAME,
      password: PASSWORD,
    });
  });

  it("companyCheck : aucune requête vers Zefix, pas de clé commercial_register_status, not_covered d'avant", async () => {
    unconfigure();
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      urls.push(href);
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    });
    const result = await companyCheck(AXA_UID, { fetch: fetchMock, now, finma: () => [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(urls.some((u) => u.includes("zefix.admin.ch"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2); // LINDAS et GLEIF seulement
    expect("commercial_register_status" in result.fiche).toBe(false);
    expect(result.fiche.not_covered).toEqual(["commercial_register_status", "fosc_publications", "seco_sanctions", "officers"]);
  });
});

describe("lookupZefixRest : statut normalisé", () => {
  beforeEach(configure);

  it("ACTIVE → active ; requête GET unitaire, IDE compact, Basic, accept JSON, user-agent", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(zefixBody(UID_A, "ACTIVE")));
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(result).toEqual({
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { status: "active", deletion_date: null },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ZEFIX_REST_COMPANY_UID_URL}/${UID_A}`);
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      accept: "application/json",
      authorization: EXPECTED_AUTHORIZATION,
      "user-agent": "OpenSwissData company_check (+https://www.openswissdata.com)",
    });
    expect(String((init.headers as Record<string, string>).authorization)).toMatch(/^Basic [A-Za-z0-9+/]+=*$/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("CANCELLED avec date → deleted et deletion_date AAAA-MM-JJ", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(zefixBody(UID_A, "CANCELLED", "2005-03-07")));
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(result).toMatchObject({ available: true, found: true, data: { status: "deleted", deletion_date: "2005-03-07" } });
  });

  it("BEING_CANCELLED → in_liquidation", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(zefixBody(UID_A, "BEING_CANCELLED")));
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(result).toMatchObject({ available: true, found: true, data: { status: "in_liquidation", deletion_date: null } });
  });

  it.each([
    ["valeur inconnue", "SOMETHING_NEW"],
    ["casse différente (jamais devinée)", "active"],
    ["propriété héritée", "toString"],
    ["absente", undefined],
    ["nombre", 3],
  ])("statut %s → unknown", async (_cas, status) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(zefixBody(UID_A, status)));
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(result).toMatchObject({ available: true, found: true, data: { status: "unknown" } });
  });

  it.each(["2005-02-30", "07.03.2005", "2005-03-07T00:00:00", "", 20050307])(
    "date de radiation %j d'une autre forme : null, jamais reformatée",
    async (date) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(zefixBody(UID_A, "CANCELLED", date)));
      const result = await lookupZefixRest(UID_A, deps(fetchMock));
      expect(result).toMatchObject({ available: true, found: true, data: { status: "deleted", deletion_date: null } });
    },
  );

  it("IDE rendu par Zefix sous forme canonique (CHE-xxx.xxx.xxx) : reconnu comme le même", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(zefixBody(AXA_UID, "ACTIVE")));
    const result = await lookupZefixRest(AXA_COMPACT, deps(fetchMock));
    expect(result).toMatchObject({ available: true, found: true, data: { status: "active" } });
  });

  it("minimisation : nom, adresse et but de la réponse ne ressortent jamais", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(zefixBody(UID_A, "ACTIVE")));
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    const texte = JSON.stringify(result);
    expect(texte).not.toContain("Ne Pas Garder");
    expect(texte).not.toContain("a ne pas garder");
    expect(texte).not.toContain("9999");
    if (result.available && result.data) expect(Object.keys(result.data).sort()).toEqual(["deletion_date", "status"]);
  });

  it("plusieurs éléments pour le même IDE qui divergent : unknown, jamais un choix arbitraire", async () => {
    const body = [...zefixBody(UID_A, "ACTIVE"), ...zefixBody(UID_A, "CANCELLED", "2001-01-01")];
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(body));
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(result).toMatchObject({ available: true, found: true, data: { status: "unknown", deletion_date: null } });
  });

  it("plusieurs éléments concordants : leur statut commun", async () => {
    const body = [...zefixBody(UID_A, "CANCELLED", "2005-03-07"), ...zefixBody(UID_A, "CANCELLED", "2005-03-07")];
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(body));
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(result).toMatchObject({ data: { status: "deleted", deletion_date: "2005-03-07" } });
  });

  it("une entrée qui n'est pas la forme compacte validée est refusée sans appel réseau", async () => {
    const fetchMock = vi.fn();
    const result = await lookupZefixRest("CHE-103.137.179/../x", deps(fetchMock));
    expect(result.available).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("lookupZefixRest : non trouvé, échecs, formes inattendues", () => {
  beforeEach(configure);

  it("404 → non trouvé, corps annulé, gardé en cache une heure seulement", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 404, body: { cancel } } as unknown as Response)
      .mockResolvedValueOnce(jsonResponse(zefixBody(UID_A, "ACTIVE")));
    const premier = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(premier).toEqual({ available: true, found: false, retrieved_at: new Date(DEBUT).toISOString(), data: null });
    expect(cancel).toHaveBeenCalledTimes(1);

    horloge += HEURE_MS - 1;
    await lookupZefixRest(UID_A, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(1); // encore en cache

    horloge += 2;
    const apres = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(2); // expiré après une heure
    expect(apres).toMatchObject({ found: true, data: { status: "active" } });
  });

  it("tableau vide → non trouvé", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(result).toEqual({ available: true, found: false, retrieved_at: new Date(DEBUT).toISOString(), data: null });
  });

  it("seulement des éléments d'un autre IDE → non trouvé", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(zefixBody(UID_B, "ACTIVE")));
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(result).toMatchObject({ available: true, found: false, data: null });
  });

  it.each([
    ["401", 401, "Zefix REST responded with HTTP 401"],
    ["403", 403, "Zefix REST responded with HTTP 403"],
    ["500", 500, "Zefix REST responded with HTTP 500"],
    ["429", 429, "Zefix REST responded with HTTP 429"],
  ])("HTTP %s : available false, motif fixe, jamais le corps brut", async (_cas, status, motif) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("CORPS-BRUT-SECRET contenu interne", { status }));
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(result).toEqual({ available: false, reason: motif });
    expect(JSON.stringify(result)).not.toContain("CORPS-BRUT-SECRET");
  });

  it("délai dépassé : available false, motif fixe, l'erreur (qui pourrait citer l'en-tête) n'est jamais relayée", async () => {
    const erreur = new DOMException(`délai dépassé ${EXPECTED_AUTHORIZATION}`, "AbortError");
    const fetchMock = vi.fn().mockRejectedValueOnce(erreur);
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(result).toEqual({ available: false, reason: "Zefix REST request failed or timed out" });
    expect(JSON.stringify(result)).not.toContain(BASIC_TOKEN);
  });

  it("délai dépassé pendant la lecture du corps (distinct d'un JSON invalide)", async () => {
    const reponseLente = { status: 200, json: () => Promise.reject(new DOMException("trop lent", "TimeoutError")) };
    const fetchMock = vi.fn().mockResolvedValueOnce(reponseLente as unknown as Response);
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(result).toEqual({ available: false, reason: "Zefix REST request timed out while reading the response" });
  });

  it.each([
    ["JSON invalide", () => new Response("pas du json", { status: 200 })],
    ["objet au lieu d'un tableau", () => jsonResponse({ uid: "CHE903000001" })],
    ["élément null", () => jsonResponse([null])],
    ["uid numérique", () => jsonResponse([{ uid: 103137179, status: "ACTIVE" }])],
    ["aucun élément avec un uid", () => jsonResponse([{ status: "ACTIVE" }])],
  ])("%s : available false, jamais mis en cache", async (_cas, reponse) => {
    const fetchMock = vi.fn(async () => reponse());
    const premier = await lookupZefixRest(UID_A, deps(fetchMock));
    const second = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(premier.available).toBe(false);
    expect(second).toEqual(premier);
    expect(fetchMock).toHaveBeenCalledTimes(2); // jamais mis en cache
  });

  it("401 : disjoncteur ouvert tout de suite, l'appel suivant ne touche pas le réseau", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 401 }));
    await lookupZefixRest(UID_A, deps(fetchMock));
    const second = await lookupZefixRest(UID_B, deps(fetchMock));
    expect(second).toEqual({ available: false, reason: "source temporarily paused after errors" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    horloge += 60_000; // pause de base levée
    await lookupZefixRest(UID_B, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("500 isolé : pas de pause, et l'échec n'est jamais mis en cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(zefixBody(UID_A, "ACTIVE")));
    expect((await lookupZefixRest(UID_A, deps(fetchMock))).available).toBe(false);
    expect(await lookupZefixRest(UID_A, deps(fetchMock))).toMatchObject({ available: true, found: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("lookupZefixRest : cache, sérialisation, plafond quotidien", () => {
  beforeEach(configure);

  it("cache 24 h : deuxième appel servi sans requête, nouvelle requête après 24 h + 1 ms", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(zefixBody(UID_A, "ACTIVE")));
    const premier = await lookupZefixRest(UID_A, deps(fetchMock));
    horloge += JOUR_MS - 1;
    const second = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(premier);
    horloge += 2;
    await lookupZefixRest(UID_A, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("valeur en cache figée : un appelant ne peut pas la modifier", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(zefixBody(UID_A, "ACTIVE")));
    const result = await lookupZefixRest(UID_A, deps(fetchMock));
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("deux IDE demandés en même temps : jamais deux requêtes Zefix en vol", async () => {
    let enVol = 0;
    let maxEnVol = 0;
    const liberer: Array<() => void> = [];
    const fetchMock = vi.fn((url: string | URL) => {
      enVol += 1;
      maxEnVol = Math.max(maxEnVol, enVol);
      const compact = String(url).split("/").pop()!;
      return new Promise<Response>((resolve) => {
        liberer.push(() => {
          enVol -= 1;
          resolve(jsonResponse(zefixBody(compact, "ACTIVE")));
        });
      });
    });

    const pA = lookupZefixRest(UID_A, deps(fetchMock));
    const pB = lookupZefixRest(UID_B, deps(fetchMock));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); // B attend que A soit terminé
    liberer.shift()!();
    await pA;
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    liberer.shift()!();
    const [a, b] = await Promise.all([pA, pB]);
    expect(maxEnVol).toBe(1);
    expect(a).toMatchObject({ found: true, data: { status: "active" } });
    expect(b).toMatchObject({ found: true, data: { status: "active" } });
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain(UID_A);
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain(UID_B);
  });

  it("même IDE demandé deux fois en même temps : une seule requête", async () => {
    let liberer!: () => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        liberer = () => resolve(jsonResponse(zefixBody(UID_A, "ACTIVE")));
      }),
    );
    const p1 = lookupZefixRest(UID_A, deps(fetchMock));
    const p2 = lookupZefixRest(UID_A, deps(fetchMock));
    await flush();
    liberer();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r2).toEqual(r1);
  });

  it("file bornée : au-delà d'une requête en cours et de quatre en attente, motif « busy » sans requête", async () => {
    const liberer: Array<() => void> = [];
    const fetchMock = vi.fn((url: string | URL) => {
      const compact = String(url).split("/").pop()!;
      return new Promise<Response>((resolve) => {
        liberer.push(() => resolve(jsonResponse(zefixBody(compact, "ACTIVE"))));
      });
    });
    const enAttente = [UID_A, UID_B, UID_C, UID_D, UID_E].map((uid) => lookupZefixRest(uid, deps(fetchMock)));
    const refuse = await lookupZefixRest(UID_F, deps(fetchMock));
    expect(refuse).toEqual({ available: false, reason: "Zefix REST busy, try again later" });

    for (let i = 0; i < 5; i += 1) {
      await flush();
      liberer.shift()!();
    }
    const resultats = await Promise.all(enAttente);
    expect(resultats.every((r) => r.available)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5); // jamais pour UID_F
    // La file s'est vidée : UID_F passe désormais.
    const fetchSimple = vi.fn(async () => jsonResponse(zefixBody(UID_F, "ACTIVE")));
    expect(await lookupZefixRest(UID_F, deps(fetchSimple))).toMatchObject({ available: true, found: true });
  });

  it("plafond quotidien : requêtes réelles comptées (échecs et 404 compris), puis motif « daily limit » sans requête, remis à zéro le jour UTC suivant", async () => {
    resetZefixRest(now, { dailyLimit: 3 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse(zefixBody(UID_C, "ACTIVE")))
      .mockResolvedValueOnce(jsonResponse(zefixBody(UID_D, "ACTIVE")));
    await lookupZefixRest(UID_A, deps(fetchMock)); // 500 : compté
    await lookupZefixRest(UID_B, deps(fetchMock)); // 404 : compté
    await lookupZefixRest(UID_C, deps(fetchMock)); // trouvé : compté
    await lookupZefixRest(UID_C, deps(fetchMock)); // cache : pas compté
    const refuse = await lookupZefixRest(UID_D, deps(fetchMock));
    expect(refuse).toEqual({ available: false, reason: "Zefix REST daily limit reached" });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    horloge = Date.UTC(2026, 9, 12, 0, 0, 0); // jour UTC suivant
    expect(await lookupZefixRest(UID_D, deps(fetchMock))).toMatchObject({ available: true, found: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("plafond par défaut : 2 000 requêtes par jour", () => {
    expect(DEFAULT_DAILY_LIMIT).toBe(2000);
  });
});

describe("SerialGate (unitaire)", () => {
  it("une tâche qui échoue ne bloque jamais la suivante", async () => {
    const gate = new SerialGate({ maxWaiting: 2 });
    const echec = gate.run(() => Promise.reject(new Error("échec")));
    const suite = gate.run(() => Promise.resolve("ok"));
    await expect(echec).rejects.toThrow("échec");
    await expect(suite).resolves.toBe("ok");
  });

  it("refuse (null) au-delà d'une tâche en cours et de maxWaiting en attente, puis accepte de nouveau", async () => {
    const gate = new SerialGate({ maxWaiting: 1 });
    let liberer!: () => void;
    const enCours = gate.run(() => new Promise<void>((r) => { liberer = r; }));
    const attente = gate.run(() => Promise.resolve());
    expect(gate.run(() => Promise.resolve())).toBeNull();
    await flush();
    liberer();
    await enCours;
    await attente;
    expect(gate.run(() => Promise.resolve())).not.toBeNull();
  });
});

describe("fiche société avec l'API REST Zefix configurée", () => {
  beforeEach(configure);

  /** LINDAS (POST), GLEIF et Zefix (GET) simulés, routés par adresse. */
  const routedFetch = (zefix: () => Response) =>
    vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.startsWith(ZEFIX_REST_COMPANY_UID_URL)) return zefix();
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    });

  it("radiée : bloc daté et sourcé, provenance Zefix (OFRC), statut retiré de not_covered, notice inchangée", async () => {
    const fetchMock = routedFetch(() => jsonResponse(zefixBody(AXA_COMPACT, "CANCELLED", "2005-03-07")));
    const result = await companyCheck(AXA_UID, { fetch: fetchMock, now, finma: () => [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { fiche } = result;
    expect(fiche.commercial_register_status).toEqual({
      available: true,
      found: true,
      status: "deleted",
      deletion_date: "2005-03-07",
      provenance: "Zefix (OFRC)",
      data_note: expect.stringContaining("Zefix REST API"),
      facts: [
        { field: "registry_status", value: "deleted", source_id: "ofrc.zefix_rest", source_url: COMPANY_SOURCES["ofrc.zefix_rest"].url, retrieved_at: new Date(DEBUT).toISOString() },
        { field: "deletion_date", value: "2005-03-07", source_id: "ofrc.zefix_rest", source_url: COMPANY_SOURCES["ofrc.zefix_rest"].url, retrieved_at: new Date(DEBUT).toISOString() },
      ],
    });
    expect(fiche.commercial_register_status?.data_note).toMatch(/normalised/);
    expect(fiche.commercial_register_status?.data_note).toMatch(/certified register extract/);
    expect(fiche.not_covered).toEqual(["fosc_publications", "seco_sanctions", "officers"]);
    expect(fiche.notice).toBe(
      "Unofficial copy assembled from public sources. Check the official registers before any decision: zefix.admin.ch, finma.ch, search.gleif.org.",
    );
    // Le statut n'entre dans aucun recoupement.
    expect(fiche.cross_checks.every((c) => !c.sources.includes("ofrc.zefix_rest"))).toBe(true);
    for (const f of fiche.commercial_register_status!.facts) expect(() => getSource(f.source_id)).not.toThrow();
  });

  it("Zefix en panne : bloc indisponible avec motif fixe, not_covered inchangé, reste de la fiche servi", async () => {
    const fetchMock = routedFetch(() => new Response("panne", { status: 503 }));
    const result = await companyCheck(AXA_UID, { fetch: fetchMock, now, finma: () => [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fiche.commercial_register_status).toMatchObject({
      available: false,
      found: false,
      reason: "Zefix REST responded with HTTP 503",
      status: null,
      deletion_date: null,
      provenance: "Zefix (OFRC)",
      facts: [],
    });
    expect(result.fiche.not_covered).toEqual(["commercial_register_status", "fosc_publications", "seco_sanctions", "officers"]);
    expect(result.fiche.commercial_register.found).toBe(true);
  });

  it("statut non reconnu : bloc présent (unknown) mais le statut reste dans not_covered", async () => {
    const fetchMock = routedFetch(() => jsonResponse(zefixBody(AXA_COMPACT, "SOMETHING_NEW")));
    const result = await companyCheck(AXA_UID, { fetch: fetchMock, now, finma: () => [] });
    if (!result.ok) throw new Error("fiche attendue");
    expect(result.fiche.commercial_register_status).toMatchObject({ available: true, found: true, status: "unknown" });
    expect(result.fiche.not_covered[0]).toBe("commercial_register_status");
  });

  it("résumé MCP : ligne Zefix (OFRC) datée, phrase « still registered » retirée, aucun mot de verdict, aucun identifiant", async () => {
    const fetchMock = routedFetch(() => jsonResponse(zefixBody(AXA_COMPACT, "ACTIVE")));
    const res = await companyCheckHandler({ uid: AXA_UID }, { fetch: fetchMock, now, finma: () => [] });
    expect(res.isError).toBeUndefined();
    const text = res.content[0]?.text ?? "";
    expect(text).toContain(`Registry status (Zefix, OFRC, read ${new Date(DEBUT).toISOString()}): active.`);
    expect(text).not.toContain("still registered");
    expect(text).toContain("This fiche does not cover FOSC publications, SECO sanctions or officers.");
    // Origine, normalisation et documents qui font foi restent dans `structured`.
    expect(res.structured?.commercial_register_status?.data_note).toContain("only the certified register extract and the SOGC (FOSC) publication are legally binding");
    expect(text).toContain("FOSC");
    expect(text).toContain(res.structured!.notice);
    for (const mot of ["safe", "risky", "compliant", "verified", "trustworthy", "legitimate", "suspicious", "valid company"]) {
      expect(text.toLowerCase()).not.toContain(mot);
    }
    const tout = JSON.stringify(res);
    for (const secret of [BASIC_TOKEN, PASSWORD, USERNAME, "Ne Pas Garder"]) expect(tout).not.toContain(secret);
  });

  it.each([
    ["radiée avec date", () => jsonResponse(zefixBody(AXA_COMPACT, "CANCELLED", "2005-03-07")), "Registry status (Zefix, OFRC, read 2026-10-11T10:00:00.000Z): deleted, deletion date 2005-03-07."],
    ["statut non reconnu", () => jsonResponse(zefixBody(AXA_COMPACT, "SOMETHING_NEW")), "still registered (Zefix, OFRC: status value not recognised)"],
    ["non trouvée", () => jsonResponse([]), "still registered (Zefix, OFRC: no record for this UID)"],
    ["Zefix en panne", () => new Response("", { status: 500 }), "still registered (Zefix, OFRC: not available)"],
  ])("résumé MCP AXA avec Zefix configuré et une ligne FINMA (%s) : sous 2 500 caractères", async (_cas, zefix, attendu) => {
    const finmaRow = {
      entity_type: "insurance",
      name: "AXA Leben AG",
      uid: AXA_UID,
      lei: "52990032J6E61LFTO024",
      licence_type: "Life insurance company",
      licence_type_de: "Lebensversicherer",
      licence_type_fr: "Assureur-vie",
      licence_type_it: "Assicurazione vita",
      licence_date: "2006-01-01",
      status: "authorised",
      canton: "ZH",
      city: "Winterthur",
      address: "",
      source_list: "finma-uid-csv",
      source_url: "https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/",
      is_warning_listed: "false",
    };
    const fetchMock = routedFetch(zefix);
    const res = await companyCheckHandler({ uid: AXA_UID }, { fetch: fetchMock, now, finma: () => [finmaRow] });
    const text = res.content[0]?.text ?? "";
    expect(res.structured?.finma.found).toBe(true);
    expect(text).toContain(attendu);
    expect(text.length).toBeLessThan(2500);
  });

  it("résumé MCP, Zefix indisponible : la phrase « still registered » reste", async () => {
    const fetchMock = routedFetch(() => new Response("", { status: 500 }));
    const res = await companyCheckHandler({ uid: AXA_UID }, { fetch: fetchMock, now, finma: () => [] });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("This fiche does not say whether the company is still registered (Zefix, OFRC: not available)");
    expect(text).not.toContain("Registry status (Zefix");
    expect(res.structured?.commercial_register_status?.reason).toBe("Zefix REST responded with HTTP 500");
  });

  it("aucune sortie ni erreur ne contient l'en-tête Authorization ni les identifiants (succès et échecs)", async () => {
    const cas: Array<() => Response | Promise<Response>> = [
      () => jsonResponse(zefixBody(AXA_COMPACT, "ACTIVE")),
      () => new Response(EXPECTED_AUTHORIZATION, { status: 401 }),
      () => Promise.reject(new Error(`échec réseau avec ${EXPECTED_AUTHORIZATION}`)),
      () => new Response(`pas du json ${PASSWORD}`, { status: 200 }),
    ];
    for (const reponse of cas) {
      resetZefixRest(now);
      resetLindasCache(now);
      resetGleifCache(now);
      const fetchMock = vi.fn(async (url: string | URL) => {
        const href = String(url);
        if (href.startsWith(ZEFIX_REST_COMPANY_UID_URL)) return reponse();
        return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
      });
      const res = await companyCheckHandler({ uid: AXA_UID }, { fetch: fetchMock, now, finma: () => [] });
      const tout = JSON.stringify(res);
      for (const secret of [BASIC_TOKEN, PASSWORD, USERNAME]) expect(tout).not.toContain(secret);
    }
  });
});

describe("registre des sources : ofrc.zefix_rest", () => {
  it("même adresse que le registre unique, sans canari, licence propre, hors de toute archive vendue", () => {
    const source = getSource("ofrc.zefix_rest");
    expect(source.url).toBe(ZEFIX_REST_COMPANY_UID_URL);
    expect(source.institution).toBe("OFRC");
    expect(source.canary).toBeUndefined();
    expect(source.licence.reference).toBe("PUBLIC-OFFICIAL-SOURCE-OFRC-REST-TERMS");
    expect(COMPANY_SOURCES["ofrc.zefix_rest"]).toEqual({ url: source.url, licence_reference: source.licence.reference });
    for (const ids of Object.values(PRODUCT_SOURCES)) expect(ids).not.toContain("ofrc.zefix_rest");
  });

  it("listée par /api/v1/sources avec la même licence que le registre", () => {
    const entree = PUBLIC_SOURCES.find((s) => s.id === "ofrc.zefix_rest");
    const source = getSource("ofrc.zefix_rest");
    expect(entree?.url).toBe(source.url);
    expect(entree?.licence).toEqual({ reference: source.licence.reference, authority: source.licence.authority, jurisdiction: source.licence.jurisdiction });
  });
});

describe("GET /api/v1/company/:uid avec l'API REST Zefix configurée (même fonction que company_check)", () => {
  let tmp: string;
  beforeEach(async () => {
    configure();
    tmp = mkdtempSync(join(tmpdir(), "osd-zefix-rest-"));
    vi.stubEnv("DATABASE_PATH", join(tmp, "test.sqlite"));
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "fictif");
    const { getDb } = await import("../../src/lib/db.js");
    const { _resetApiRateLimit } = await import("../../src/lib/api-rate-limit.js");
    getDb();
    _resetApiRateLimit();
  });
  afterEach(async () => {
    const { closeDb } = await import("../../src/lib/db.js");
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("la fiche porte commercial_register_status et `sources` cite alors ofrc.zefix_rest", async () => {
    vi.stubGlobal("fetch", async (url: string | URL) => {
      const href = String(url);
      if (href.startsWith(ZEFIX_REST_COMPANY_UID_URL)) return jsonResponse(zefixBody(AXA_COMPACT, "ACTIVE"));
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    });
    const { createApp } = await import("../../src/index.js");
    const res = await createApp().request(`/api/v1/company/${AXA_UID}`, { headers: { "x-real-ip": "192.0.2.90" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commercial_register_status).toMatchObject({ available: true, found: true, status: "active", provenance: "Zefix (OFRC)" });
    const ids = body.sources.map((s: { id: string }) => s.id);
    expect(ids).toHaveLength(6);
    expect(ids).toContain("ofrc.zefix_rest");
    const zefix = body.sources.find((s: { id: string }) => s.id === "ofrc.zefix_rest");
    expect(zefix.institution).toBe("OFRC");
    expect(JSON.stringify(body)).not.toContain(BASIC_TOKEN);
  });
});
