import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSource } from "../../etl/shared/sources/registry.js";
import { buildCompanyFiche, companyCheck } from "../../src/mcp/company/check.js";
import { LINDAS_ENDPOINT, resetLindasCache } from "../../src/mcp/company/lindas.js";
import { resetGleifCache } from "../../src/mcp/company/gleif.js";
import { parseUid } from "../../src/mcp/company/uid.js";
import { _resetDataLoaderCache, setFinmaVersion, type FinmaRegistryRow } from "../../src/mcp/data-loader.js";
import { COMPANY_SOURCES } from "../../src/mcp/company/sources.js";
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
      finma: { available: true, rows: [] },
      now,
    });
    const fields = fiche.commercial_register.facts.map((f) => f.field);
    expect(fields).not.toContain("street_address");
    expect(fields).not.toContain("postal_code");
    expect(fields).not.toContain("locality");
    expect(fields).not.toContain("purpose"); // correction 1 : 0101 CONFIRMÉ retire aussi purpose
    expect(fields).toContain("municipality");
    expect(fields).toContain("canton");
    // other_names reste autorisé pour 0101 (plan) : la fixture n'en a simplement aucun ici
    // (`other_names: []`), donc aucun fait "other_names" n'est émis — comportement normal
    // de `lindasFacts`, pas une exclusion liée à 0101.
    expect(fiche.commercial_register.found).toBe(true);
  });

  // Liste blanche des formes juridiques (relecture finale du 06.10.2026, remplace l'ancienne
  // règle « fermé si 0101 ou code inconnu ») : SEULES les formes de
  // `ADDRESS_AND_PURPOSE_FORM_CODES` ouvrent adresse ET but. "0101", "0103", "0118", "0151"
  // et un code absent (null) ferment les deux, pas seulement l'adresse.
  it.each([
    ["0101", "entreprise individuelle"],
    ["0103", "société en nom collectif"],
    ["0118", "hors liste blanche"],
    ["0151", "hors liste blanche"],
    [null, "code absent"],
  ] as const)("forme fermée (%s, %s) : aucune adresse NI but, commune et canton restent", (code) => {
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: code },
    };
    const fiche = buildCompanyFiche(INDIVIDUAL_ENTERPRISE_UID, {
      lindas,
      gleif: AVAILABLE_NOT_FOUND<GleifRecord[]>(),
      finma: { available: true, rows: [] },
      now,
    });
    const fields = fiche.commercial_register.facts.map((f) => f.field);
    expect(fields).not.toContain("street_address");
    expect(fields).not.toContain("postal_code");
    expect(fields).not.toContain("locality");
    expect(fields).not.toContain("purpose"); // fermé aussi, contrairement à l'ancienne règle
    expect(fields).toContain("municipality");
    expect(fields).toContain("canton");
  });

  it("forme ouverte (0107, Sàrl, de la liste blanche) : adresse ET but présents", () => {
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: "0107" },
    };
    const fiche = buildCompanyFiche(INDIVIDUAL_ENTERPRISE_UID, {
      lindas,
      gleif: AVAILABLE_NOT_FOUND<GleifRecord[]>(),
      finma: { available: true, rows: [] },
      now,
    });
    const fields = fiche.commercial_register.facts.map((f) => f.field);
    expect(fields).toContain("street_address");
    expect(fields).toContain("postal_code");
    expect(fields).toContain("locality");
    expect(fields).toContain("purpose");
  });

  it("correction 1 : legal_form_code \"\" (chaîne vide, pas null) → aucune adresse ni but (chaîne vide n'est pas une clé de la liste blanche)", () => {
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: "" },
    };
    const fiche = buildCompanyFiche(INDIVIDUAL_ENTERPRISE_UID, {
      lindas,
      gleif: AVAILABLE_NOT_FOUND<GleifRecord[]>(),
      finma: { available: true, rows: [] },
      now,
    });
    const fields = fiche.commercial_register.facts.map((f) => f.field);
    expect(fields).not.toContain("street_address");
    expect(fields).not.toContain("postal_code");
    expect(fields).not.toContain("locality");
    expect(fields).not.toContain("purpose");
  });

  it("correction 1 (item 2) : faits GLEIF renommés gleif_entity_status/lei_registration_status, jamais entity_status/registration_status", () => {
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: "0106", legal_name: "AXA Leben AG" },
    };
    const fiche = buildCompanyFiche("CHE-103.137.179", {
      lindas,
      gleif: { available: true, found: true, retrieved_at: new Date(DEBUT).toISOString(), data: [GLEIF_AXA_RECORD] },
      finma: { available: true, rows: [] },
      now,
    });
    const fields = fiche.lei.facts.map((f) => f.field);
    expect(fields).toContain("gleif_entity_status");
    expect(fields).toContain("lei_registration_status");
    expect(fields).not.toContain("entity_status");
    expect(fields).not.toContain("registration_status");
  });

  it("correction 1 (item 2) : statut GLEIF null (jamais \"unknown\") → aucun fait de statut émis", () => {
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: "0106", legal_name: "AXA Leben AG" },
    };
    const gleifSansStatut: GleifRecord = { ...GLEIF_AXA_RECORD, entity_status: null, registration_status: null };
    const fiche = buildCompanyFiche("CHE-103.137.179", {
      lindas,
      gleif: { available: true, found: true, retrieved_at: new Date(DEBUT).toISOString(), data: [gleifSansStatut] },
      finma: { available: true, rows: [] },
      now,
    });
    const fields = fiche.lei.facts.map((f) => f.field);
    expect(fields).not.toContain("gleif_entity_status");
    expect(fields).not.toContain("lei_registration_status");
    expect(fields.some((f) => f.includes("unknown"))).toBe(false);
    expect(fiche.lei.facts.some((f) => f.value === "unknown")).toBe(false);
  });

  it("LINDAS en panne : commercial_register.available false, le reste de la fiche reste présent", () => {
    const fiche = buildCompanyFiche("CHE-103.137.179", {
      lindas: { available: false, reason: "LINDAS request failed or timed out" },
      gleif: { available: true, found: true, retrieved_at: new Date(DEBUT).toISOString(), data: [GLEIF_AXA_RECORD] },
      finma: { available: true, rows: [finmaRow()] },
      now,
    });
    expect(fiche.commercial_register).toMatchObject({ available: false, found: false, reason: "LINDAS request failed or timed out", facts: [] });
    expect(fiche.lei.found).toBe(true);
    expect(fiche.lei.facts.length).toBeGreaterThan(0); // la panne LINDAS n'empêche pas les faits GLEIF
    expect(fiche.finma.available).toBe(true);
    expect(fiche.finma.found).toBe(true);
    // LINDAS absent : aucun recoupement qui l'implique (nom LINDAS/GLEIF, nom FINMA/LINDAS).
    // Plus de recoupement finma_lei_vs_gleif_lei depuis sa suppression (relecture finale du
    // 06.10.2026) : cross_checks reste donc entièrement vide ici.
    expect(fiche.cross_checks).toEqual([]);
    expect(fiche.not_covered).toEqual(["commercial_register_status", "fosc_publications", "seco_sanctions", "officers"]);
    expect(fiche.notice).toMatch(/zefix\.admin\.ch/);
  });

  it("correction 1 : registre FINMA illisible → finma.available false, found false, facts vides, le reste de la fiche présent", () => {
    const fiche = buildCompanyFiche("CHE-103.137.179", {
      lindas: { available: true, found: true, retrieved_at: new Date(DEBUT).toISOString(), data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: "0106", legal_name: "AXA Leben AG" } },
      gleif: { available: true, found: true, retrieved_at: new Date(DEBUT).toISOString(), data: [GLEIF_AXA_RECORD] },
      finma: { available: false, reason: "FINMA registry could not be read" },
      now,
    });
    expect(fiche.finma).toMatchObject({ available: false, found: false, facts: [], reason: "FINMA registry could not be read" });
    expect(fiche.commercial_register.found).toBe(true); // le reste de la fiche reste présent
    expect(fiche.lei.found).toBe(true);
    // Aucun recoupement qui implique FINMA (registre illisible) ; LINDAS/GLEIF reste calculé.
    expect(fiche.cross_checks.map((c) => c.check)).toEqual(["legal_name_lindas_vs_gleif"]);
  });

  it("finmaVersion connue (ex. \"2026.10.06\") : data_note la cite, retrieved_at des faits FINMA est la date ISO de cette version (relecture finale du 06.10.2026)", () => {
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: "0106" }, // forme quelconque, hors du cas 0101
    };
    const fiche = buildCompanyFiche(INDIVIDUAL_ENTERPRISE_UID, {
      lindas,
      gleif: AVAILABLE_NOT_FOUND<GleifRecord[]>(),
      finma: { available: true, rows: [finmaRow({ uid: INDIVIDUAL_ENTERPRISE_UID })] },
      finmaVersion: "2026.10.06",
      now,
    });
    expect(fiche.finma.data_note).toBe(
      "Facts from the FINMA copy currently loaded by this service (version 2026.10.06), not a live FINMA lookup.",
    );
    // Jamais `generated_at` (relecture finale du 06.10.2026) : la version connue devient une
    // date ISO sans heure, distincte de l'heure de fabrication de la fiche.
    const generatedAt = new Date(DEBUT).toISOString();
    expect(fiche.finma.facts.every((f) => f.retrieved_at === "2026-10-06")).toBe(true);
    expect(fiche.finma.facts.every((f) => f.retrieved_at !== generatedAt)).toBe(true);
  });

  it("finmaVersion dans un format inattendu (pas AAAA.MM.JJ) : retrieved_at reste null, jamais une date devinée", () => {
    const fiche = buildCompanyFiche(INDIVIDUAL_ENTERPRISE_UID, {
      lindas: { available: false, reason: "LINDAS request failed or timed out" },
      gleif: AVAILABLE_NOT_FOUND<GleifRecord[]>(),
      finma: { available: true, rows: [finmaRow({ uid: INDIVIDUAL_ENTERPRISE_UID })] },
      finmaVersion: "pas une version",
      now,
    });
    expect(fiche.finma.facts.length).toBeGreaterThan(0);
    expect(fiche.finma.facts.every((f) => f.retrieved_at === null)).toBe(true);
  });

  it("finmaVersion absente (undefined) : data_note générique, retrieved_at des faits FINMA est null (pas de date inventée)", () => {
    const fiche = buildCompanyFiche(INDIVIDUAL_ENTERPRISE_UID, {
      lindas: { available: false, reason: "LINDAS request failed or timed out" },
      gleif: AVAILABLE_NOT_FOUND<GleifRecord[]>(),
      finma: { available: true, rows: [finmaRow({ uid: INDIVIDUAL_ENTERPRISE_UID })] },
      now,
    });
    expect(fiche.finma.facts.length).toBeGreaterThan(0);
    expect(fiche.finma.facts.every((f) => f.retrieved_at === null)).toBe(true);
    expect(fiche.finma.data_note).toBe(
      "Facts from the FINMA copy currently loaded by this service, not a live FINMA lookup.",
    );
    expect(fiche.finma.data_note).not.toMatch(/\d{4}[.-]\d{2}[.-]\d{2}/);
  });

  it("ligne FINMA réaliste (copie embarquée : status/licence_date/lei vides, seul licence_type rempli) → un seul fait FINMA, pas de recoupement LEI", () => {
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: "0106", legal_name: "AXA Leben AG" },
    };
    const fiche = buildCompanyFiche("CHE-103.137.179", {
      lindas,
      gleif: { available: true, found: true, retrieved_at: new Date(DEBUT).toISOString(), data: [GLEIF_AXA_RECORD] },
      finma: {
        available: true,
        rows: [finmaRow({ status: "", licence_date: "", lei: "" })], // ligne réelle de finma_registry.csv (AXA Leben AG)
      },
      now,
    });
    expect(fiche.finma.facts).toEqual([
      expect.objectContaining({ field: "licence_type", value: "Life insurance company" }),
    ]);
    // Le nom FINMA (non vide) reste comparé au nom légal LINDAS, même sans LEI.
    expect(fiche.cross_checks.map((c) => c.check)).toContain("finma_name_vs_lindas_legal_name");
  });

  it("divergence : nom FINMA ≠ nom légal LINDAS → result false", () => {
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: "0106", legal_name: "Une Société Complètement Différente SA" },
    };
    const fiche = buildCompanyFiche("CHE-103.137.179", {
      lindas,
      gleif: AVAILABLE_NOT_FOUND<GleifRecord[]>(),
      finma: { available: true, rows: [finmaRow({ name: "AXA Leben AG" })] },
      now,
    });
    const nameCheck = fiche.cross_checks.find((c) => c.check === "finma_name_vs_lindas_legal_name");
    expect(nameCheck).toMatchObject({ result: false });
    expect(nameCheck?.detail).toContain("AXA Leben AG");
    expect(nameCheck?.detail).toContain("Une Société Complètement Différente SA");
  });

  it("plusieurs lignes FINMA pour le même IDE (une par autorisation) : facts des deux lignes, ligne d'un autre IDE exclue, recoupements dédupliqués par valeur", () => {
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: "0106", legal_name: "AXA Leben AG" },
    };
    const rows = [
      finmaRow({ uid: "CHE-103.137.179", licence_type: "Life insurance company", status: "authorised" }),
      finmaRow({ uid: "CHE-103.137.179", licence_type: "Portfolio manager", status: "authorised" }),
      finmaRow({ uid: "CHE-999.999.999", licence_type: "Ne doit jamais apparaître" }), // autre IDE, exclue
    ];
    const fiche = buildCompanyFiche("CHE-103.137.179", {
      lindas,
      gleif: { available: true, found: true, retrieved_at: new Date(DEBUT).toISOString(), data: [GLEIF_AXA_RECORD] },
      finma: { available: true, rows },
      now,
    });
    const licenceTypes = fiche.finma.facts.filter((f) => f.field === "licence_type").map((f) => f.value);
    expect(licenceTypes).toEqual(["Life insurance company", "Portfolio manager"]);
    expect(fiche.finma.facts.some((f) => f.value === "Ne doit jamais apparaître")).toBe(false);
    // Les deux lignes partagent le même `name` : un seul recoupement de nom, jamais un par
    // ligne (voir le commentaire dans check.ts). Plus de recoupement LEI FINMA/GLEIF depuis
    // sa suppression (relecture finale du 06.10.2026).
    const nameChecks = fiche.cross_checks.filter((c) => c.check === "finma_name_vs_lindas_legal_name");
    expect(fiche.cross_checks.map((c) => c.check)).not.toContain("finma_lei_vs_gleif_lei");
    expect(nameChecks).toHaveLength(1);
  });

  it("correction 1 : chaque cross_checks[].sources contient des ids de COMPANY_SOURCES", () => {
    const lindas: Part<LindasCompany> = {
      available: true,
      found: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      data: { ...INDIVIDUAL_ENTERPRISE, legal_form_code: "0106", legal_name: "AXA Leben AG" },
    };
    const fiche = buildCompanyFiche("CHE-103.137.179", {
      lindas,
      gleif: { available: true, found: true, retrieved_at: new Date(DEBUT).toISOString(), data: [GLEIF_AXA_RECORD] },
      finma: { available: true, rows: [finmaRow()] },
      now,
    });
    expect(fiche.cross_checks.length).toBeGreaterThan(0);
    const validIds = new Set(Object.keys(COMPANY_SOURCES));
    for (const check of fiche.cross_checks) {
      expect(check.sources.length).toBeGreaterThan(0);
      for (const id of check.sources) expect(validIds.has(id)).toBe(true);
    }
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
    // AXA Leben AG a une forme juridique connue (0106, pas 0101) : la porte fermée par
    // défaut ne doit fermer l'adresse QUE pour une forme inconnue ou "0101", jamais pour
    // une société ordinaire — testé du côté OUVERT, pas seulement du côté fermé.
    const registerFields = fiche.commercial_register.facts.map((f) => f.field);
    expect(registerFields).toContain("street_address");
    expect(registerFields).toContain("postal_code");
    expect(registerFields).toContain("locality");
    expect(fiche.lei.found).toBe(true);
    expect(fiche.finma.available).toBe(true);
    expect(fiche.finma.found).toBe(true);
    expect(fiche.finma.warning_list).toBe("not_checkable_by_uid");
    expect(fiche.finma.data_note).toMatch(/currently loaded by this service/i);

    expect(fiche.cross_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: "legal_name_lindas_vs_gleif", result: true }),
        expect.objectContaining({ check: "finma_name_vs_lindas_legal_name", result: true }),
      ]),
    );
    // Plus de recoupement finma_lei_vs_gleif_lei (retiré en relecture finale du 06.10.2026) :
    // deux recoupements seulement, et aucun fait `lei` dans le groupe FINMA.
    expect(fiche.cross_checks).toHaveLength(2);
    expect(fiche.cross_checks.map((c) => c.check)).not.toContain("finma_lei_vs_gleif_lei");
    expect(fiche.finma.facts.map((f) => f.field)).not.toContain("lei");
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

  it("4. divergence : nom GLEIF différent du nom légal LINDAS → result false, détail présent", async () => {
    const gleifAutreNom = JSON.parse(JSON.stringify(GLEIF_AXA)) as { data: Array<{ attributes: { entity: { legalName: { name: string } } } }> };
    gleifAutreNom.data[0].attributes.entity.legalName.name = "Une Autre Société Complètement Différente SA";
    const fetchMock = async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(gleifAutreNom);
    };
    // Plus de recoupement LEI FINMA/GLEIF (retiré en relecture finale du 06.10.2026) : un LEI
    // FINMA différent du LEI GLEIF ne produit donc plus aucun recoupement sur ce point.
    const result = await companyCheck(
      "CHE-103.137.179",
      deps(fetchMock, () => [finmaRow({ lei: "UNEAUTRELEI000000000" })]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nameCheck = result.fiche.cross_checks.find((c) => c.check === "legal_name_lindas_vs_gleif");
    expect(nameCheck).toMatchObject({ result: false });
    expect(nameCheck?.detail).toContain("Une Autre Société Complètement Différente SA");
    expect(result.fiche.cross_checks.map((c) => c.check)).not.toContain("finma_lei_vs_gleif_lei");
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

  it("correction 1 : deps.finma qui lève → ok true, finma.available false, reason présente, le reste de la fiche servi", async () => {
    const fetchMock = async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    };
    const finmaQuiLeve = (): readonly FinmaRegistryRow[] => {
      throw new Error("lecture impossible (détail jamais exposé dans la fiche)");
    };
    const result = await companyCheck("CHE-103.137.179", deps(fetchMock, finmaQuiLeve));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fiche.finma).toMatchObject({ available: false, found: false, facts: [] });
    expect(typeof result.fiche.finma.reason).toBe("string");
    expect(result.fiche.finma.reason?.length).toBeGreaterThan(0);
    // Jamais le détail brut de l'erreur levée par l'appelant dans la fiche publique.
    expect(result.fiche.finma.reason).not.toContain("lecture impossible");
    expect(result.fiche.commercial_register.found).toBe(true); // le reste de la fiche reste servi
    expect(result.fiche.lei.found).toBe(true);
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
