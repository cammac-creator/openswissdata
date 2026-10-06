import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSource } from "../../etl/shared/sources/registry.js";
import { buildCompanyFiche, companyCheck } from "../../src/mcp/company/check.js";
import { LINDAS_ENDPOINT, resetLindasCache } from "../../src/mcp/company/lindas.js";
import { resetGleifCache } from "../../src/mcp/company/gleif.js";
import { parseUid } from "../../src/mcp/company/uid.js";
import { _resetDataLoaderCache, setFinmaVersion, type FinmaRegistryRow } from "../../src/mcp/data-loader.js";
import type { GleifRecord, LindasCompany, LiveDeps, Part } from "../../src/mcp/company/types.js";

// Fixtures réelles de la tâche 3 : AXA Leben AG CHE-103.137.179, et un IDE valide mais
// inconnu CHE-123.456.009 (tâche osd.fiche, tâche 4).
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/company/${name}`, import.meta.url), "utf8"));
const LINDAS_AXA = fixture("lindas-axa-leben.json");
const LINDAS_VIDE = fixture("lindas-vide.json");
const GLEIF_AXA = fixture("gleif-axa-leben.json");
const GLEIF_VIDE = fixture("gleif-vide.json");

const DEBUT = Date.UTC(2026, 9, 6, 10, 0, 0); // 2026-10-06 10:00:00 UTC
const now = () => DEBUT;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Un `AXA` fictif de registre FINMA, même IDE que la fixture LINDAS/GLEIF réelle. */
function finmaRow(overrides: Partial<FinmaRegistryRow> = {}): FinmaRegistryRow {
  return {
    entity_type: "insurance",
    name: "AXA Leben AG",
    uid: "CHE-103.137.179",
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
    ...overrides,
  };
}

/** Entreprise individuelle FICTIVE (nom et IDE inventés, jamais une vraie société). */
const INDIVIDUAL_ENTERPRISE: LindasCompany = {
  legal_name: "Muster Test Einzelunternehmen",
  other_names: [],
  legal_form_code: "0101",
  legal_form_label_fr: "Entreprise individuelle",
  legal_form_label_de: "Einzelunternehmen",
  municipality: "Muristalden",
  municipality_bfs_id: "999",
  canton: "BE",
  street_address: "Musterweg 1",
  postal_code: "3000",
  locality: "Muristalden",
  purpose: "Essai de fiche, société fictive",
  ch_id: "CH00000000000",
  register_uri: "https://register.ld.admin.ch/zefix/company/fictif-test",
};
const INDIVIDUAL_ENTERPRISE_UID = "CHE-123.000.046"; // chiffre de contrôle calculé, non une vraie société

/** Copie littérale de l'enregistrement GLEIF réel de la fixture AXA (évite de caster la
 *  forme JSON:API brute, dont les champs ne sont pas ceux de `GleifRecord`). */
const GLEIF_AXA_RECORD: GleifRecord = {
  lei: "52990032J6E61LFTO024",
  legal_name: "AXA Leben AG",
  entity_status: "ACTIVE",
  registration_status: "ISSUED",
  last_update: "2026-07-29T14:22:24Z",
  registered_as: "CHE-103.137.179",
};

describe("buildCompanyFiche (assemblage pur, sans réseau)", () => {
  const AVAILABLE_NOT_FOUND = <T,>(): Part<T> => ({ available: true, found: false, retrieved_at: new Date(DEBUT).toISOString(), data: null });

  it("entreprise individuelle (0101) : aucun fait street_address/postal_code/locality, commune et canton gardés", () => {
    // L'IDE fictif doit lui-même être un IDE VALIDE au sens de `parseUid` (chiffre de
    // contrôle correct), jamais une chaîne inventée qui ne respecterait pas la règle du
    // modulo 11 (décision du 06.10.2026, tâche osd.fiche).
    expect(parseUid(INDIVIDUAL_ENTERPRISE_UID)).toMatchObject({ ok: true, uid: INDIVIDUAL_ENTERPRISE_UID });
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: INDIVIDUAL_ENTERPRISE,
    };
    const fiche = buildCompanyFiche(INDIVIDUAL_ENTERPRISE_UID, {
      lindas,
      gleif: AVAILABLE_NOT_FOUND<GleifRecord[]>(),
      finma: [],
      now,
    });
    const fields = fiche.commercial_register.facts.map((f) => f.field);
    expect(fields).not.toContain("street_address");
    expect(fields).not.toContain("postal_code");
    expect(fields).not.toContain("locality");
    expect(fields).toContain("municipality");
    expect(fields).toContain("canton");
    expect(fiche.commercial_register.found).toBe(true);
  });

  it("LINDAS en panne : commercial_register.available false, le reste de la fiche reste présent", () => {
    const fiche = buildCompanyFiche("CHE-103.137.179", {
      lindas: { available: false, reason: "LINDAS request failed or timed out" },
      gleif: { available: true, found: true, retrieved_at: new Date(DEBUT).toISOString(), data: [GLEIF_AXA_RECORD] },
      finma: [finmaRow()],
      now,
    });
    expect(fiche.commercial_register).toMatchObject({ available: false, found: false, reason: "LINDAS request failed or timed out", facts: [] });
    expect(fiche.lei.found).toBe(true);
    expect(fiche.lei.facts.length).toBeGreaterThan(0); // la panne LINDAS n'empêche pas les faits GLEIF
    expect(fiche.finma.found).toBe(true);
    // LINDAS absent : aucun recoupement qui l'implique (nom LINDAS/GLEIF, nom FINMA/LINDAS).
    // Le LEI FINMA/GLEIF ne dépend pas de LINDAS et reste calculé.
    expect(fiche.cross_checks.map((c) => c.check)).toEqual(["finma_lei_vs_gleif_lei"]);
    expect(fiche.not_covered).toEqual(["registration_status", "fosc_publications", "seco_sanctions", "officers"]);
    expect(fiche.notice).toMatch(/zefix\.admin\.ch/);
  });

  it("finmaVersion connue (ex. \"2026.10.06\") : data_note la cite, retrieved_at des faits FINMA reste generated_at (pas une date ISO)", () => {
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: "0106" }, // forme quelconque, hors du cas 0101
    };
    const fiche = buildCompanyFiche(INDIVIDUAL_ENTERPRISE_UID, {
      lindas,
      gleif: AVAILABLE_NOT_FOUND<GleifRecord[]>(),
      finma: [finmaRow({ uid: INDIVIDUAL_ENTERPRISE_UID })],
      finmaVersion: "2026.10.06",
      now,
    });
    expect(fiche.finma.data_note).toContain("2026.10.06");
    const generatedAt = new Date(DEBUT).toISOString();
    expect(fiche.finma.facts.every((f) => f.retrieved_at === generatedAt)).toBe(true);
  });

  it("finmaVersion absente (undefined) : data_note générique, aucune date de version inventée", () => {
    const fiche = buildCompanyFiche(INDIVIDUAL_ENTERPRISE_UID, {
      lindas: { available: false, reason: "LINDAS request failed or timed out" },
      gleif: AVAILABLE_NOT_FOUND<GleifRecord[]>(),
      finma: [finmaRow({ uid: INDIVIDUAL_ENTERPRISE_UID })],
      now,
    });
    expect(fiche.finma.data_note).not.toMatch(/\d{4}[.-]\d{2}[.-]\d{2}/);
    expect(fiche.finma.data_note).toMatch(/last scheduled/i);
  });

  it("plusieurs lignes FINMA pour le même IDE (une par autorisation) : facts des deux lignes, ligne d'un autre IDE exclue, recoupements dédupliqués par valeur", () => {
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: "0106", legal_name: "AXA Leben AG" },
    };
    const finma = [
      finmaRow({ uid: "CHE-103.137.179", licence_type: "Life insurance company", status: "authorised" }),
      finmaRow({ uid: "CHE-103.137.179", licence_type: "Portfolio manager", status: "authorised" }),
      finmaRow({ uid: "CHE-999.999.999", licence_type: "Ne doit jamais apparaître" }), // autre IDE, exclue
    ];
    const fiche = buildCompanyFiche("CHE-103.137.179", {
      lindas,
      gleif: { available: true, found: true, retrieved_at: new Date(DEBUT).toISOString(), data: [GLEIF_AXA_RECORD] },
      finma,
      now,
    });
    const licenceTypes = fiche.finma.facts.filter((f) => f.field === "licence_type").map((f) => f.value);
    expect(licenceTypes).toEqual(["Life insurance company", "Portfolio manager"]);
    expect(fiche.finma.facts.some((f) => f.value === "Ne doit jamais apparaître")).toBe(false);
    // Les deux lignes partagent le même `lei` et le même `name` : un seul recoupement de
    // chaque sorte, jamais un par ligne (voir le commentaire dans check.ts).
    const leiChecks = fiche.cross_checks.filter((c) => c.check === "finma_lei_vs_gleif_lei");
    const nameChecks = fiche.cross_checks.filter((c) => c.check === "finma_name_vs_lindas_legal_name");
    expect(leiChecks).toHaveLength(1);
    expect(nameChecks).toHaveLength(1);
  });
});

describe("companyCheck (bout en bout, fetch injecté, sans réseau)", () => {
  // Les caches LINDAS/GLEIF sont des singletons de module (TTL 24h) : sans remise à zéro,
  // deux tests sur le même IDE et la même horloge `now` se serviraient l'un l'autre un
  // résultat déjà en cache, au lieu d'appeler le `fetch` propre à chaque test.
  beforeEach(() => {
    resetLindasCache(now);
    resetGleifCache(now);
  });
  // `_resetDataLoaderCache` efface aussi `_finmaVersion` et la copie FINMA chargée en
  // mémoire par le test « registre par défaut » ci-dessous, pour ne jamais laisser une
  // version réglée par un test polluer les suivants.
  afterEach(() => {
    _resetDataLoaderCache();
  });

  const deps = (fetchImpl: LiveDeps["fetch"], finma: () => readonly FinmaRegistryRow[]): LiveDeps & { finma: () => readonly FinmaRegistryRow[] } => ({
    fetch: fetchImpl,
    now,
    finma,
  });

  it("1. AXA Leben AG : trois groupes trouvés, recoupements calculés et vrais", async () => {
    const fetchMock = async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    };
    const result = await companyCheck("CHE-103.137.179", deps(fetchMock, () => [finmaRow()]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { fiche } = result;
    expect(fiche.commercial_register.found).toBe(true);
    expect(fiche.lei.found).toBe(true);
    expect(fiche.finma.found).toBe(true);
    expect(fiche.finma.warning_list).toBe("not_checkable_by_uid");
    expect(fiche.finma.data_note).toMatch(/[Cc]ollection|snapshot|version/);

    expect(fiche.cross_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: "legal_name_lindas_vs_gleif", result: true }),
        expect.objectContaining({ check: "finma_lei_vs_gleif_lei", result: true }),
        expect.objectContaining({ check: "finma_name_vs_lindas_legal_name", result: true }),
      ]),
    );
    expect(fiche.cross_checks).toHaveLength(3);
    for (const check of fiche.cross_checks) {
      expect(typeof check.detail).toBe("string");
      expect(check.detail.length).toBeGreaterThan(0);
      expect(check.sources.length).toBeGreaterThan(0);
    }
  });

  it("2. IDE inconnu partout : trois groupes found false, cross_checks vide, aucune erreur", async () => {
    const fetchMock = async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_VIDE) : jsonResponse(GLEIF_VIDE);
    };
    const result = await companyCheck("CHE-123.456.009", deps(fetchMock, () => []));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { fiche } = result;
    expect(fiche.commercial_register.found).toBe(false);
    expect(fiche.lei.found).toBe(false);
    expect(fiche.finma.found).toBe(false);
    expect(fiche.cross_checks).toEqual([]);
  });

  it("4. divergences : nom GLEIF différent et LEI FINMA différent du LEI GLEIF → result false, détail présent", async () => {
    const gleifAutreNom = JSON.parse(JSON.stringify(GLEIF_AXA)) as { data: Array<{ attributes: { entity: { legalName: { name: string } } } }> };
    gleifAutreNom.data[0].attributes.entity.legalName.name = "Une Autre Société Complètement Différente SA";
    const fetchMock = async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(gleifAutreNom);
    };
    const result = await companyCheck(
      "CHE-103.137.179",
      deps(fetchMock, () => [finmaRow({ lei: "UNEAUTRELEI000000000" })]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nameCheck = result.fiche.cross_checks.find((c) => c.check === "legal_name_lindas_vs_gleif");
    const leiCheck = result.fiche.cross_checks.find((c) => c.check === "finma_lei_vs_gleif_lei");
    expect(nameCheck).toMatchObject({ result: false });
    expect(leiCheck).toMatchObject({ result: false });
    expect(nameCheck?.detail).toContain("Une Autre Société Complètement Différente SA");
    expect(leiCheck?.detail).toContain("UNEAUTRELEI000000000");
  });

  it("5. LINDAS en panne : commercial_register.available false, le reste de la fiche présent", async () => {
    const fetchMock = async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.startsWith(LINDAS_ENDPOINT)) throw new Error("réseau coupé");
      return jsonResponse(GLEIF_AXA);
    };
    const result = await companyCheck("CHE-103.137.179", deps(fetchMock, () => [finmaRow()]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fiche.commercial_register.available).toBe(false);
    expect(result.fiche.commercial_register.found).toBe(false);
    expect(result.fiche.lei.found).toBe(true);
    expect(result.fiche.finma.found).toBe(true);
  });

  it("6. IDE invalide : ok false, fetch jamais appelé", async () => {
    let appele = false;
    const fetchMock = (async () => {
      appele = true;
      return jsonResponse({});
    }) as LiveDeps["fetch"];
    const result = await companyCheck("pas un IDE", deps(fetchMock, () => []));
    expect(result.ok).toBe(false);
    expect(appele).toBe(false);
  });

  it("le registre FINMA PAR DÉFAUT porte sa version dans data_note ; un registre injecté n'en hérite jamais", async () => {
    setFinmaVersion("2026.10.06"); // ex. `release-finma.ts`, format "AAAA.MM.JJ" (pas ISO)
    const fetchMock = async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    };
    // Pas de `deps.finma` : le registre PAR DÉFAUT (`getFinmaRegistry`, CSV réel embarqué)
    // est utilisé, celui dont la version vient d'être réglée.
    const defaut = await companyCheck("CHE-103.137.179", { fetch: fetchMock, now });
    expect(defaut.ok).toBe(true);
    if (!defaut.ok) return;
    expect(defaut.fiche.finma.found).toBe(true); // AXA Leben AG figure dans le CSV réel
    expect(defaut.fiche.finma.data_note).toContain("2026.10.06");

    resetLindasCache(now);
    resetGleifCache(now);
    const injecte = await companyCheck("CHE-103.137.179", deps(fetchMock, () => [finmaRow()]));
    expect(injecte.ok).toBe(true);
    if (!injecte.ok) return;
    expect(injecte.fiche.finma.data_note).not.toContain("2026.10.06");
  });

  it("7. chaque Fact.source_id de la fiche existe dans le registre unique des sources", async () => {
    const fetchMock = async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    };
    const result = await companyCheck("CHE-103.137.179", deps(fetchMock, () => [finmaRow()]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const allFacts = [
      ...result.fiche.commercial_register.facts,
      ...result.fiche.finma.facts,
      ...result.fiche.lei.facts,
    ];
    expect(allFacts.length).toBeGreaterThan(0);
    const sourceIds = new Set(allFacts.map((f) => f.source_id));
    for (const id of sourceIds) {
      expect(() => getSource(id)).not.toThrow();
    }
  });
});
