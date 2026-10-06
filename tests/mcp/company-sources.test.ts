import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupLindas, resetLindasCache } from "../../src/mcp/company/lindas.js";
import { lookupGleif, resetGleifCache } from "../../src/mcp/company/gleif.js";
import type { LiveDeps } from "../../src/mcp/company/types.js";

// Fixtures : réponses brutes enregistrées le 06.10.2026, AXA Leben AG CHE-103.137.179 et un
// IDE valide inexistant CHE-123.456.009. GLEIF : 2 appels réels (conforme au plafond de la
// consigne). LINDAS : 5 appels réels (une requête d'exploration des nœuds d'identifiant a
// été nécessaire pour découvrir que le nœud CHID porte `schema:name "CompanyCHID"`, pas
// "CHID" ; détail dans task-3-report.md, section « Correction 1 »).
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
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("délai dépassé pendant la lecture du corps (distinct d'un JSON invalide)", async () => {
    const reponseLente = { status: 200, json: () => Promise.reject(new DOMException("trop lent", "TimeoutError")) };
    const fetchMock = vi.fn().mockResolvedValueOnce(reponseLente as unknown as Response);
    const result = await lookupLindas("CHE103137179", deps(fetchMock));
    expect(result).toEqual({ available: false, reason: expect.stringMatching(/timed out|timeout/i) });
    if (!result.available) expect(result.reason).not.toMatch(/valid JSON/i);
  });

  describe("formes inattendues dans une réponse HTTP 200 (jamais d'exception, jamais de faux succès mis en cache)", () => {
    // Un `vi.fn()` qui rend une Response NEUVE à chaque appel (un corps ne se lit qu'une
    // fois) : deux appels à `lookupLindas` doivent redéclencher deux `fetch` si, et
    // seulement si, rien n'a été mis en cache — ce que `sansCache` vérifie explicitement,
    // plutôt que de se fier à son seul nom.
    const sansCache = async (bindings: unknown[]) => {
      const fetchMock = vi.fn(async () => jsonResponse({ results: { bindings } }));
      const premier = await lookupLindas("CHE103137179", deps(fetchMock));
      const second = await lookupLindas("CHE103137179", deps(fetchMock));
      expect(fetchMock).toHaveBeenCalledTimes(2); // jamais mis en cache
      expect(second).toEqual(premier);
      return premier;
    };

    it("bindings: [null] ne lève pas d'exception", async () => {
      const result = await sansCache([null]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("une ligne qui est une chaîne ne lève pas d'exception", async () => {
      const result = await sansCache(["oups"]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("une ligne sans URI de société (pas de `company`) est rejetée, pas groupée sous \"\"", async () => {
      const result = await sansCache([{ legalName: { value: "Société sans URI" } }]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("une ligne avec URI mais sans legalName exploitable ne donne pas un faux succès (legal_name vide)", async () => {
      const result = await sansCache([{ company: { value: "https://register.ld.admin.ch/zefix/company/1" } }]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("company numérique n'est jamais accepté comme URI, ni groupé sous une clé numérique", async () => {
      const result = await sansCache([{ company: { value: 1 }, legalName: { value: "X SA" } }]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("company vide (\"\") est une forme inattendue, pas une URI valide groupée sous \"\"", async () => {
      const result = await sansCache([{ company: { value: "" }, legalName: { value: "X SA" } }]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("legalName numérique (présent mais invalide) rejette toute la réponse, pas juste cette ligne", async () => {
      const result = await sansCache([
        { company: { value: "https://register.ld.admin.ch/zefix/company/1" }, legalName: { value: 5 } },
      ]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("legalName vide (\"\") rejette toute la réponse, pas un `legal_name: \"\"` accepté", async () => {
      const result = await sansCache([
        { company: { value: "https://register.ld.admin.ch/zefix/company/1" }, legalName: { value: "" } },
      ]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("un élément qui n'est pas un objet (null) mêlé à une ligne par ailleurs valide rejette toute la réponse", async () => {
      const result = await sansCache([
        null,
        { company: { value: "https://register.ld.admin.ch/zefix/company/1" }, legalName: { value: "Bonne Société SA" } },
      ]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("une valeur numérique dans un champ FACULTATIF (other_names) est ignorée, pas un échec global", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({
        results: {
          bindings: [
            { company: { value: "https://register.ld.admin.ch/zefix/company/1" }, legalName: { value: "Vrai Nom SA" }, name: { value: 7 } },
          ],
        },
      }));
      const result = await lookupLindas("CHE103137179", deps(fetchMock));
      expect(result).toMatchObject({ available: true, found: true, data: { legal_name: "Vrai Nom SA", other_names: [] } });
    });

    it("une ligne sans URI mêlée à une ligne valide est simplement écartée, pas groupée en tête du tri", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({
        results: {
          bindings: [
            { legalName: { value: "Orpheline (sans URI, triée avant toute lettre)" } },
            { company: { value: "https://register.ld.admin.ch/zefix/company/2" }, legalName: { value: "Vraie Société SA" } },
          ],
        },
      }));
      const result = await lookupLindas("CHE103137179", deps(fetchMock));
      expect(result).toMatchObject({
        available: true,
        found: true,
        data: { legal_name: "Vraie Société SA", register_uri: "https://register.ld.admin.ch/zefix/company/2" },
      });
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
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ accept: "application/vnd.api+json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
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

  it("délai dépassé pendant la lecture du corps (distinct d'un JSON invalide)", async () => {
    const reponseLente = { status: 200, json: () => Promise.reject(new DOMException("trop lent", "TimeoutError")) };
    const fetchMock = vi.fn().mockResolvedValueOnce(reponseLente as unknown as Response);
    const result = await lookupGleif("CHE-103.137.179", deps(fetchMock));
    expect(result).toEqual({ available: false, reason: expect.stringMatching(/timed out|timeout/i) });
    if (!result.available) expect(result.reason).not.toMatch(/valid JSON/i);
  });

  describe("formes inattendues dans une réponse HTTP 200 (jamais d'exception, jamais de faux succès mis en cache)", () => {
    // Un `vi.fn()` qui rend une Response NEUVE à chaque appel (un corps ne se lit qu'une
    // fois) : deux appels à `lookupGleif` doivent redéclencher deux `fetch` si, et
    // seulement si, rien n'a été mis en cache — ce que `sansCache` vérifie explicitement,
    // plutôt que de se fier à son seul nom.
    const sansCache = async (data: unknown[]) => {
      const fetchMock = vi.fn(async () => jsonResponse({ data }));
      const premier = await lookupGleif("CHE-103.137.179", deps(fetchMock));
      const second = await lookupGleif("CHE-103.137.179", deps(fetchMock));
      expect(fetchMock).toHaveBeenCalledTimes(2); // jamais mis en cache
      expect(second).toEqual(premier);
      return premier;
    };

    it("data: [null] ne lève pas d'exception", async () => {
      const result = await sansCache([null]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("un élément sans `attributes` est simplement ignoré (absence tolérée, pas un échec en soi)", async () => {
      // Seul élément de la réponse et sans `attributes` : aucun enregistrement exploitable
      // n'en ressort, donc `available:false` — mais par le chemin "aucune ligne valide",
      // pas par un `attributes` jugé en lui-même invalide (il est juste absent).
      const result = await sansCache([{ type: "lei-records", id: "x" }]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("registeredAs numérique (présent mais invalide) rejette toute la réponse (raw.trim n'est jamais appelé dessus)", async () => {
      const result = await sansCache([{
        attributes: {
          lei: "L00000000000000000001",
          entity: { legalName: { name: "Société à champ cassé" }, registeredAs: 103137179, status: "ACTIVE" },
          registration: { status: "ISSUED" },
        },
      }]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("lei vide (\"\") rejette toute la réponse, pas un enregistrement avec lei: \"\"", async () => {
      const result = await sansCache([{
        attributes: {
          lei: "",
          entity: { legalName: { name: "Société à LEI vide" }, registeredAs: "CHE-103.137.179", status: "ACTIVE" },
          registration: { status: "ISSUED" },
        },
      }]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("legal_name numérique (présent mais invalide) rejette toute la réponse, pas juste cet élément", async () => {
      const result = await sansCache([{
        attributes: {
          lei: "L00000000000000000002",
          entity: { legalName: { name: 5 }, registeredAs: "CHE-103.137.179", status: "ACTIVE" },
          registration: { status: "ISSUED" },
        },
      }]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("legal_name vide (\"\") rejette toute la réponse", async () => {
      const result = await sansCache([{
        attributes: {
          lei: "L00000000000000000004",
          entity: { legalName: { name: "" }, registeredAs: "CHE-103.137.179", status: "ACTIVE" },
          registration: { status: "ISSUED" },
        },
      }]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("un élément qui n'est pas un objet (null) mêlé à un élément par ailleurs valide rejette toute la réponse", async () => {
      const result = await sansCache([
        null,
        {
          attributes: {
            lei: "L00000000000000000003",
            entity: { legalName: { name: "Bonne Société SA" }, registeredAs: "CHE-103.137.179", status: "ACTIVE" },
            registration: { status: "ISSUED", lastUpdateDate: "2026-01-01T00:00:00Z" },
          },
        },
      ]);
      expect(result).toEqual({ available: false, reason: expect.any(String) });
    });

    it("registeredAs null (vraiment absent, pas invalide) n'est pas confondu avec un mauvais type", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({
        data: [{
          attributes: {
            lei: "L00000000000000000005",
            entity: { legalName: { name: "Société sans registeredAs" }, registeredAs: null, status: "ACTIVE" },
            registration: { status: "ISSUED" },
          },
        }],
      }));
      const result = await lookupGleif("CHE-103.137.179", deps(fetchMock));
      // enregistrement bien formé, mais qui ne correspond pas à l'IDE demandé (registered_as
      // null) : "non trouvé", pas une erreur de forme.
      expect(result).toMatchObject({ available: true, found: false, data: null });
    });
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
