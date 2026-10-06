import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupLindas, resetLindasCache } from "../../src/mcp/company/lindas.js";
import { lookupGleif, resetGleifCache } from "../../src/mcp/company/gleif.js";
import type { LiveDeps } from "../../src/mcp/company/types.js";

// Fixtures : réponses brutes enregistrées une fois le 06.10.2026 (au plus deux appels réels
// par source), AXA Leben AG CHE-103.137.179 et un IDE valide inexistant CHE-123.456.009.
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/company/${name}`, import.meta.url), "utf8"));
const LINDAS_AXA = fixture("lindas-axa-leben.json");
const LINDAS_VIDE = fixture("lindas-vide.json");
const GLEIF_AXA = fixture("gleif-axa-leben.json");
const GLEIF_VIDE = fixture("gleif-vide.json");

const JOUR_MS = 24 * 60 * 60 * 1000;
const DEBUT = Date.UTC(2026, 9, 6, 10, 0, 0); // 2026-10-06 10:00:00 UTC

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const brokenJsonResponse = (status = 200): Response => new Response("pas du json", { status });
const abortError = (): DOMException => new DOMException("délai dépassé", "AbortError");

describe("lookupLindas (registre du commerce en données liées, LINDAS)", () => {
  let horloge: number;
  const now = () => horloge;
  beforeEach(() => {
    horloge = DEBUT;
    resetLindasCache(now);
  });
  const deps = (fetchImpl: LiveDeps["fetch"]): LiveDeps => ({ fetch: fetchImpl, now });

  it("trouvée : retourne les champs attendus pour AXA Leben AG", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(LINDAS_AXA));
    const result = await lookupLindas("CHE103137179", deps(fetchMock));
    expect(result).toMatchObject({
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: {
        legal_name: "AXA Leben AG",
        other_names: ["AXA Life Ltd", "AXA Vie SA", "AXA Vita SA"],
        legal_form_code: "0106",
        legal_form_label_fr: "Société anonyme",
        legal_form_label_de: "Aktiengesellschaft",
        municipality: "Winterthur",
        municipality_bfs_id: "230",
        canton: "ZH",
        street_address: "General Guisan-Strasse 40",
        postal_code: "8400",
        locality: "Winterthur",
        ch_id: "CH02039287958",
        register_uri: "https://register.ld.admin.ch/zefix/company/431354",
      },
    });
    if (result.available) expect(result.data?.purpose).toMatch(/^Die Gesellschaft bezweckt/);
  });

  it("absente : IDE valide mais inconnu de LINDAS", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(LINDAS_VIDE));
    const result = await lookupLindas("CHE123456009", deps(fetchMock));
    expect(result).toEqual({ available: true, found: false, retrieved_at: new Date(DEBUT).toISOString(), data: null });
  });

  it("délai dépassé : available false, sans corps brut", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(abortError());
    const result = await lookupLindas("CHE103137179", deps(fetchMock));
    expect(result).toEqual({ available: false, reason: expect.any(String) });
  });

  it("statut HTTP 503 : available false", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("indisponible", { status: 503 }));
    const result = await lookupLindas("CHE103137179", deps(fetchMock));
    expect(result).toEqual({ available: false, reason: expect.any(String) });
  });

  it("JSON invalide : available false", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(brokenJsonResponse());
    const result = await lookupLindas("CHE103137179", deps(fetchMock));
    expect(result).toEqual({ available: false, reason: expect.any(String) });
  });

  it("une entrée qui n'est pas la forme compacte validée est refusée sans appel réseau", async () => {
    const fetchMock = vi.fn();
    const result = await lookupLindas('CHE123456009" } UNION { ?x ?y ?z', deps(fetchMock));
    expect(result.available).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("la requête SPARQL envoyée contient le compact et rien d'autre venant de l'entrée", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(LINDAS_AXA));
    await lookupLindas("CHE103137179", deps(fetchMock));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain('schema:value "CHE103137179"');
    expect(body.split("CHE103137179")).toHaveLength(2); // une seule occurrence
    expect(init.headers).toMatchObject({
      "content-type": "application/sparql-query",
      accept: "application/sparql-results+json",
    });
  });

  it("cache : deux appels identiques ne font qu'un seul fetch, un échec n'est jamais mis en cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(LINDAS_AXA))
      .mockRejectedValueOnce(new Error("réseau"))
      .mockResolvedValueOnce(jsonResponse(LINDAS_AXA))
      .mockResolvedValueOnce(jsonResponse(LINDAS_AXA));

    await lookupLindas("CHE103137179", deps(fetchMock));
    await lookupLindas("CHE103137179", deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(1); // second appel servi par le cache

    resetLindasCache(now); // isole le scénario échec→succès du précédent
    const echec = await lookupLindas("CHE103137179", deps(fetchMock));
    expect(echec.available).toBe(false);
    const succes = await lookupLindas("CHE103137179", deps(fetchMock));
    expect(succes.available).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3); // l'échec n'a pas été mis en cache

    horloge += JOUR_MS + 1;
    const apres24h = await lookupLindas("CHE103137179", deps(fetchMock));
    // un nouveau fetch a bien eu lieu : la quatrième réponse programmée a été consommée.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(apres24h.available).toBe(true);
  });
});

describe("lookupGleif (registre LEI public de GLEIF)", () => {
  let horloge: number;
  const now = () => horloge;
  beforeEach(() => {
    horloge = DEBUT;
    resetGleifCache(now);
  });
  const deps = (fetchImpl: LiveDeps["fetch"]): LiveDeps => ({ fetch: fetchImpl, now });

  it("trouvé : un LEI, registered_as égal à l'IDE demandé", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(GLEIF_AXA));
    const result = await lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(result).toEqual({
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: [
        {
          lei: "52990032J6E61LFTO024",
          legal_name: "AXA Leben AG",
          entity_status: "ACTIVE",
          registration_status: "ISSUED",
          last_update: "2026-07-29T14:22:24Z",
          registered_as: "CHE-103.137.179",
        },
      ],
    });
  });

  it("absent : IDE valide mais inconnu de GLEIF", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(GLEIF_VIDE));
    const result = await lookupGleif("CHE-123.456.009", deps(fetchMock));
    expect(result).toEqual({ available: true, found: false, retrieved_at: new Date(DEBUT).toISOString(), data: null });
  });

  it("un enregistrement dont registeredAs diffère de l'IDE demandé est filtré", async () => {
    const autre = {
      data: [
        {
          type: "lei-records",
          id: "AUTRE",
          attributes: {
            lei: "AUTRELEI00000000000A",
            entity: { legalName: { name: "Une autre société" }, registeredAs: "CHE-555.000.006", status: "ACTIVE" },
            registration: { status: "ISSUED", lastUpdateDate: "2026-01-01T00:00:00Z" },
          },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(autre));
    const result = await lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(result).toEqual({ available: true, found: false, retrieved_at: new Date(DEBUT).toISOString(), data: null });
  });

  it("délai dépassé : available false", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(abortError());
    const result = await lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(result).toEqual({ available: false, reason: expect.any(String) });
  });

  it("statut HTTP 503 : available false", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("indisponible", { status: 503 }));
    const result = await lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(result).toEqual({ available: false, reason: expect.any(String) });
  });

  it("JSON invalide : available false", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(brokenJsonResponse());
    const result = await lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(result).toEqual({ available: false, reason: expect.any(String) });
  });

  it("une entrée qui n'est pas la forme canonique est refusée sans appel réseau", async () => {
    const fetchMock = vi.fn();
    const result = await lookupGleif("CHE103137179", deps(fetchMock)); // forme compacte, pas canonique
    expect(result.available).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cache : deux appels identiques ne font qu'un seul fetch, expire après 24h + 1ms", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(GLEIF_AXA))
      .mockRejectedValueOnce(new Error("réseau"))
      .mockResolvedValueOnce(jsonResponse(GLEIF_AXA))
      .mockResolvedValueOnce(jsonResponse(GLEIF_AXA));

    await lookupGleif("CHE-103.137.179", deps(fetchMock));
    await lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resetGleifCache(now);
    const echec = await lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(echec.available).toBe(false);
    const succes = await lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(succes.available).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    horloge += JOUR_MS + 1;
    const apres24h = await lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(apres24h.available).toBe(true);
  });
});
