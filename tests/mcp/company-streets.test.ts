/**
 * Vérification `street_in_municipality` (répertoire officiel des rues, swisstopo — tâche
 * osd.localites, tâche B1 du plan `2026-10-06-prospection-et-api.md`, décision de
 * Claude-Alain du 06.10.2026, RELUE le 06.10.2026 : chemin dans `street_checks`, SÉPARÉ de
 * `address_checks`, avec sa propre édition `street_checks_edition`).
 *
 * Fichier NEUF (relecture du 06.10.2026, point 1) : ces cas vivaient par erreur dans
 * `tests/mcp/company-localities.test.ts`, un fichier déjà présent sur `origin/main` — remis à
 * l'identique, les cas rues déplacés ici avec leur propre aide (`streetsDirectory`, `ficheWith`).
 * Même esprit que `company-localities.test.ts` : des FAITS, jamais un verdict.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCompanyFiche, companyCheck, type LocalitiesAccess, type StreetsAccess } from "../../src/mcp/company/check.js";
import { companyCheckHandler } from "../../src/mcp/tools/company-check.js";
import { LINDAS_ENDPOINT, resetLindasCache } from "../../src/mcp/company/lindas.js";
import { resetGleifCache } from "../../src/mcp/company/gleif.js";
import { _resetDataLoaderCache, normalizeStreetName, type LocalityRow } from "../../src/mcp/data-loader.js";
import type { FinmaRegistryRow } from "../../src/mcp/data-loader.js";
import type { GleifRecord, LindasCompany, Part } from "../../src/mcp/company/types.js";

const DEBUT = Date.UTC(2026, 9, 6, 10, 0, 0);
const now = () => DEBUT;
const AVAILABLE_NOT_FOUND = <T,>(): Part<T> => ({ available: true, found: false, retrieved_at: new Date(DEBUT).toISOString(), data: null });

function row(partial: Partial<LocalityRow>): LocalityRow {
  return {
    postal_code: "",
    postal_code_suffix: "00",
    locality: "",
    municipality: "",
    municipality_bfs_id: "",
    canton: "ZH",
    language: "de",
    ...partial,
  };
}

const WINTERTHUR_8400 = row({ postal_code: "8400", locality: "Winterthur", municipality: "Winterthur", municipality_bfs_id: "230" });
const KEMPTTHAL_LINDAU = row({ postal_code: "8310", locality: "Kemptthal", municipality: "Lindau", municipality_bfs_id: "176" });
const KEMPTTHAL_WINTERTHUR = row({ postal_code: "8310", locality: "Kemptthal", municipality: "Winterthur", municipality_bfs_id: "230" });

function byPostalCode(rows: LocalityRow[]): ReadonlyMap<string, readonly LocalityRow[]> {
  const index = new Map<string, LocalityRow[]>();
  for (const r of rows) {
    const list = index.get(r.postal_code);
    if (list) list.push(r);
    else index.set(r.postal_code, [r]);
  }
  return index;
}

function directory(rows: LocalityRow[], edition: string | null = null): LocalitiesAccess {
  return { available: true, byPostalCode: byPostalCode(rows), edition };
}

/** Répertoire des rues en mémoire pour les tests (tâche osd.localites, tâche B1) : les noms
 *  fournis sont normalisés avec la MÊME fonction que la production (`normalizeStreetName`),
 *  jamais une normalisation réécrite ici qui pourrait diverger. `edition` : ajoutée à
 *  `StreetsAccess` lors de la relecture du 06.10.2026 (point 2), pour `street_checks_edition`. */
function streetsDirectory(byMunicipality: Record<string, string[]>, edition: string | null = null): StreetsAccess {
  const map = new Map<string, Set<string>>();
  for (const [bfsId, streets] of Object.entries(byMunicipality)) {
    map.set(bfsId, new Set(streets.map(normalizeStreetName)));
  }
  return { available: true, byMunicipality: map, edition };
}

/** Société fictive de forme ouverte (0106, SA), adresse AXA-like (8400 Winterthur 230 ZH). */
const OPEN_FORM_COMPANY: LindasCompany = {
  legal_name: "Société Fictive SA",
  other_names: [],
  legal_form_code: "0106",
  legal_form_label_fr: "Société anonyme",
  legal_form_label_de: "Aktiengesellschaft",
  municipality: "Winterthur",
  municipality_bfs_id: "230",
  canton: "ZH",
  street_address: "Rue Fictive 1",
  postal_code: "8400",
  locality: "Winterthur",
  purpose: "Essai",
  ch_id: "CH00000000001",
  register_uri: "https://register.ld.admin.ch/zefix/company/fictif",
};

const UID = "CHE-103.137.179"; // IDE réel AXA, réutilisé seulement comme identifiant de fiche

function ficheWith(lindasData: LindasCompany, localities: LocalitiesAccess | undefined, streets?: StreetsAccess): ReturnType<typeof buildCompanyFiche> {
  const lindas: Part<LindasCompany> = { available: true, found: true, retrieved_at: new Date(DEBUT).toISOString(), data: lindasData };
  return buildCompanyFiche(UID, {
    lindas,
    gleif: AVAILABLE_NOT_FOUND<GleifRecord[]>(),
    finma: { available: true, rows: [] },
    localities,
    streets,
    now,
  });
}

// Adresse réelle d'AXA Leben AG au 06.10.2026 : General Guisan-Strasse 40, 8400 Winterthur
// (numéro OFS de commune 230). Le nom officiel au répertoire des rues porte un trait d'union
// ("General-Guisan-Strasse") : la vérification doit les traiter comme identiques (règle "trait
// d'union ≡ espace", réservée aux noms de rue).
const AXA_LIKE_COMPANY: LindasCompany = { ...OPEN_FORM_COMPANY, street_address: "General Guisan-Strasse 40" };

describe("buildCompanyFiche : street_in_municipality vit dans street_checks, SÉPARÉ de address_checks (relecture du 06.10.2026, point 2)", () => {
  it("`streets` absent (undefined) : aucune entrée street_checks, address_checks des localités inchangé, street_checks_edition null", () => {
    const fiche = ficheWith(AXA_LIKE_COMPANY, directory([WINTERTHUR_8400]), undefined);
    expect(fiche.street_checks).toEqual([]);
    expect(fiche.street_checks_edition).toBeNull();
    expect(fiche.address_checks).toHaveLength(3); // les trois vérifications de localités, inchangées — jamais mélangées
    expect(fiche.address_checks.map((c) => c.check)).not.toContain("street_in_municipality");
    expect(fiche.not_covered).not.toContain("official_street_directory_checks");
  });

  it("répertoire des rues absent (`{ available: false }`) : street_checks VIDE, not_covered le dit, jamais une exception", () => {
    const fiche = ficheWith(AXA_LIKE_COMPANY, directory([WINTERTHUR_8400]), { available: false });
    expect(fiche.street_checks).toEqual([]);
    expect(fiche.street_checks_edition).toBeNull();
    expect(fiche.address_checks.map((c) => c.check)).not.toContain("street_in_municipality");
    expect(fiche.not_covered).toContain("official_street_directory_checks");
  });

  it("rue trouvée dans la commune du siège, avec un trait d'union à la place d'un espace (\"General Guisan-Strasse\" ↔ \"General-Guisan-Strasse\") : yes dans street_checks, édition du répertoire des RUES portée séparément", () => {
    const streets = streetsDirectory({ "230": ["General-Guisan-Strasse"] }, "2026-10-06");
    const fiche = ficheWith(AXA_LIKE_COMPANY, directory([WINTERTHUR_8400], "2026-10-01"), streets);
    expect(fiche.street_checks).toHaveLength(1);
    expect(fiche.street_checks[0]).toMatchObject({
      check: "street_in_municipality",
      result: true,
      detail: "Street found in the official street directory of the seat municipality.",
      sources: ["ofrc.zefix_lindas", "swisstopo.streets"],
    });
    expect(fiche.street_checks_edition).toBe("2026-10-06"); // édition des RUES, pas celle des localités (2026-10-01)
    expect(fiche.address_checks_edition).toBe("2026-10-01");
    expect(fiche.address_checks.map((c) => c.check)).not.toContain("street_in_municipality");
  });

  it("rue inconnue (absente de toute commune) : no, libellé exact de la relecture du 06.10.2026, point 3", () => {
    const streets = streetsDirectory({ "230": ["Bahnhofplatz"] }); // General-Guisan-Strasse absente
    const fiche = ficheWith(AXA_LIKE_COMPANY, directory([WINTERTHUR_8400]), streets);
    expect(fiche.street_checks[0]?.result).toBe(false);
    expect(fiche.street_checks[0]?.detail).toBe("Street not found among the official street names of the seat municipality.");
  });

  it("rue absente de la commune du siège MAIS présente dans une autre commune du même NPA : no, détail qui le dit (le siège et l'adresse peuvent différer), un fait jamais un verdict", () => {
    const company: LindasCompany = { ...AXA_LIKE_COMPANY, postal_code: "8310", locality: "Kemptthal", municipality: "Winterthur", municipality_bfs_id: "230" };
    const streets = streetsDirectory({ "176": ["General-Guisan-Strasse"] });
    const fiche = ficheWith(company, directory([KEMPTTHAL_LINDAU, KEMPTTHAL_WINTERTHUR]), streets);
    expect(fiche.street_checks[0]?.result).toBe(false);
    expect(fiche.street_checks[0]?.detail).toBe(
      "Street not found among the official street names of the seat municipality, but found in another municipality sharing the same postal code (the seat and the address can differ).",
    );
  });

  it("rue absente de la commune du siège ET absente des autres communes du NPA : no, détail générique (pas de fausse piste \"ailleurs\")", () => {
    const company: LindasCompany = { ...AXA_LIKE_COMPANY, postal_code: "8310", locality: "Kemptthal", municipality: "Winterthur", municipality_bfs_id: "230" };
    const streets = streetsDirectory({ "176": ["Chemin de la Chapelle"] });
    const fiche = ficheWith(company, directory([KEMPTTHAL_LINDAU, KEMPTTHAL_WINTERTHUR]), streets);
    expect(fiche.street_checks[0]?.result).toBe(false);
    expect(fiche.street_checks[0]?.detail).toBe("Street not found among the official street names of the seat municipality.");
  });

  it("`localities` absent mais `streets` présent : la vérification principale fonctionne quand même (seul le recoupement \"ailleurs dans le NPA\" dépend des localités)", () => {
    const streets = streetsDirectory({ "230": ["General-Guisan-Strasse"] });
    const fiche = ficheWith(AXA_LIKE_COMPANY, undefined, streets);
    expect(fiche.street_checks[0]?.result).toBe(true);
    expect(fiche.street_checks).toHaveLength(1);
    expect(fiche.address_checks).toEqual([]); // aucune vérification de localités (undefined)
  });

  it("municipality_bfs_id inconnu (commune du siège non publiée) : aucune vérification émise", () => {
    const company: LindasCompany = { ...AXA_LIKE_COMPANY, municipality_bfs_id: null };
    const streets = streetsDirectory({ "230": ["General-Guisan-Strasse"] });
    const fiche = ficheWith(company, directory([WINTERTHUR_8400]), streets);
    expect(fiche.street_checks).toEqual([]);
  });

  it("entreprise individuelle (0101) : adresse non publiée → aucune vérification de rue, même avec un répertoire disponible", () => {
    const individuelle: LindasCompany = { ...AXA_LIKE_COMPANY, legal_form_code: "0101" };
    const streets = streetsDirectory({ "230": ["General-Guisan-Strasse"] });
    const fiche = ficheWith(individuelle, directory([WINTERTHUR_8400]), streets);
    expect(fiche.street_checks).toEqual([]);
    expect(fiche.not_covered).not.toContain("official_street_directory_checks"); // répertoire disponible, juste non applicable ici
  });

  it("aucun mot de verdict dans le détail de street_in_municipality (yes et no)", () => {
    const banned = ["safe", "risky", "compliant", "verified", "trustworthy", "suspicious", "valid company"];
    const streetsYes = streetsDirectory({ "230": ["General-Guisan-Strasse"] });
    const ficheYes = ficheWith(AXA_LIKE_COMPANY, directory([WINTERTHUR_8400]), streetsYes);
    const streetsNo = streetsDirectory({ "230": ["Bahnhofplatz"] });
    const ficheNo = ficheWith(AXA_LIKE_COMPANY, directory([WINTERTHUR_8400]), streetsNo);
    for (const fiche of [ficheYes, ficheNo]) {
      const lower = (fiche.street_checks[0]?.detail ?? "").toLowerCase();
      for (const word of banned) expect(lower).not.toContain(word);
    }
  });
});

describe("retrait du numéro de rue en fin d'adresse (relecture du 06.10.2026, point 4)", () => {
  it("adresse réduite au seul numéro (\"40\") : aucune vérification émise (aucun nom de rue exploitable)", () => {
    const company: LindasCompany = { ...AXA_LIKE_COMPANY, street_address: "40" };
    const streets = streetsDirectory({ "230": ["General-Guisan-Strasse"] });
    const fiche = ficheWith(company, directory([WINTERTHUR_8400]), streets);
    expect(fiche.street_checks).toEqual([]);
  });

  it("numéro suivi d'une lettre isolée dans un jeton SÉPARÉ (\"General Guisan-Strasse 12 A\") : les deux jetons finaux sont retirés, yes", () => {
    const company: LindasCompany = { ...AXA_LIKE_COMPANY, street_address: "General Guisan-Strasse 12 A" };
    const streets = streetsDirectory({ "230": ["General-Guisan-Strasse"] });
    const fiche = ficheWith(company, directory([WINTERTHUR_8400]), streets);
    expect(fiche.street_checks[0]?.result).toBe(true);
  });

  it("numéro et lettre COLLÉS (\"General Guisan-Strasse 12a\") : un seul jeton numéro retiré, yes", () => {
    const company: LindasCompany = { ...AXA_LIKE_COMPANY, street_address: "General Guisan-Strasse 12a" };
    const streets = streetsDirectory({ "230": ["General-Guisan-Strasse"] });
    const fiche = ficheWith(company, directory([WINTERTHUR_8400]), streets);
    expect(fiche.street_checks[0]?.result).toBe(true);
  });

  it("adresse réduite à \"12 A\" (numéro + lettre isolée, aucun nom de rue) : aucune vérification émise", () => {
    const company: LindasCompany = { ...AXA_LIKE_COMPANY, street_address: "12 A" };
    const streets = streetsDirectory({ "230": ["General-Guisan-Strasse"] });
    const fiche = ficheWith(company, directory([WINTERTHUR_8400]), streets);
    expect(fiche.street_checks).toEqual([]);
  });

  it("le nom COMPLET est essayé EN PREMIER : une rue officielle qui finit par un nombre (\"Place du 700ème\") n'est jamais tronquée", () => {
    const company: LindasCompany = { ...AXA_LIKE_COMPANY, street_address: "Place du 700ème" };
    const streets = streetsDirectory({ "230": ["Place du 700ème"] });
    const fiche = ficheWith(company, directory([WINTERTHUR_8400]), streets);
    expect(fiche.street_checks[0]?.result).toBe(true);
  });

  it("nom complet avec un numéro de bâtiment APRÈS une rue qui finit par un nombre (\"Place du 700ème 12\") : le nom complet échoue, la version sans numéro réussit", () => {
    const company: LindasCompany = { ...AXA_LIKE_COMPANY, street_address: "Place du 700ème 12" };
    const streets = streetsDirectory({ "230": ["Place du 700ème"] });
    const fiche = ficheWith(company, directory([WINTERTHUR_8400]), streets);
    expect(fiche.street_checks[0]?.result).toBe(true);
  });
});

describe("case postale : jamais de vérification de rue (relecture du 06.10.2026, point 4)", () => {
  it.each([
    "Postfach 123",
    "Case postale 456",
    "Casella postale 789",
    "Postbox 1",
    "postfach 42", // insensible à la casse
  ])("adresse %j : aucune vérification street_in_municipality émise", (streetAddress) => {
    const company: LindasCompany = { ...AXA_LIKE_COMPANY, street_address: streetAddress };
    const streets = streetsDirectory({ "230": ["General-Guisan-Strasse"] });
    const fiche = ficheWith(company, directory([WINTERTHUR_8400]), streets);
    expect(fiche.street_checks).toEqual([]);
  });

  it("une rue qui ne COMMENCE pas par ces mots reste vérifiée normalement", () => {
    const company: LindasCompany = { ...AXA_LIKE_COMPANY, street_address: "Chemin du Postfach 3" }; // ne commence pas par "Postfach"
    const streets = streetsDirectory({ "230": ["Chemin du Postfach"] });
    const fiche = ficheWith(company, directory([WINTERTHUR_8400]), streets);
    expect(fiche.street_checks).toHaveLength(1);
  });
});

describe("rendu texte (company-check.ts) : section « Street check » séparée de « Address checks », datée de SA PROPRE édition", () => {
  it("AXA-like, éditions connues : deux en-têtes distincts, chacun avec sa propre édition", async () => {
    const lindas = JSON.stringify({
      results: {
        bindings: [
          {
            company: { value: "https://register.ld.admin.ch/zefix/company/431354" },
            legalName: { value: "Société Fictive SA" },
            legalFormCode: { value: "0106" },
            legalFormLabelFr: { value: "Société anonyme" },
            legalFormLabelDe: { value: "Aktiengesellschaft" },
            municipalityName: { value: "Winterthur" },
            municipalityId: { value: "230" },
            region: { value: "ZH" },
            street: { value: "General Guisan-Strasse 40" },
            postalCode: { value: "8400" },
            locality: { value: "Winterthur" },
            chid: { value: "CH00000000001" },
          },
        ],
      },
    });
    const fetchStub = async (_url: string | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(lindas, { status: 200, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });

    const res = await companyCheckHandler(
      { uid: "CHE-103.137.179" },
      { fetch: fetchStub, now, finma: () => [] },
    );
    expect(res.isError).toBeUndefined();
    const text = res.content[0]?.text ?? "";
    const localitiesMeta = JSON.parse(readFileSync(new URL("../../src/mcp/data/localities.meta.json", import.meta.url), "utf8")) as { edition: string };
    const streetsMeta = JSON.parse(readFileSync(new URL("../../src/mcp/data/streets.meta.json", import.meta.url), "utf8")) as { edition: string };
    expect(text).toContain(`Address checks (official locality directory, swisstopo, edition ${localitiesMeta.edition}):`);
    expect(text).toContain(`Street check (official street directory, swisstopo, edition ${streetsMeta.edition}):`);
    // `street_in_municipality` apparaît dans la section « Street check », jamais dans « Address checks ».
    const addressSection = text.split("Street check")[0]?.split("Address checks")[1] ?? "";
    expect(addressSection).not.toContain("street_in_municipality");
    const streetSection = text.split("Street check")[1] ?? "";
    expect(streetSection).toMatch(/street_in_municipality: yes/);
  });
});

describe("companyCheck (bout en bout) : localities et streets câblés PAR DÉFAUT, répertoires réels embarqués", () => {
  const fixture = (name: string): unknown =>
    JSON.parse(readFileSync(new URL(`../fixtures/company/${name}`, import.meta.url), "utf8"));
  const LINDAS_AXA = fixture("lindas-axa-leben.json");
  const GLEIF_AXA = fixture("gleif-axa-leben.json");
  const jsonResponse = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  beforeEach(() => {
    resetLindasCache(now);
    resetGleifCache(now);
  });
  afterEach(() => {
    _resetDataLoaderCache();
  });

  function finmaRow(): FinmaRegistryRow {
    return {
      entity_type: "insurance", name: "AXA Leben AG", uid: "CHE-103.137.179", lei: "52990032J6E61LFTO024",
      licence_type: "Life insurance company", licence_type_de: "", licence_type_fr: "", licence_type_it: "",
      licence_date: "2006-01-01", status: "authorised", canton: "ZH", city: "Winterthur", address: "",
      source_list: "finma-uid-csv",
      source_url: "https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/",
      is_warning_listed: "false",
    };
  }

  it("AXA Leben AG : companyCheck() sans deps.streets rend déjà street_checks=[street_in_municipality: true], lu depuis le fichier embarqué, édition des rues présente", async () => {
    const fetchMock = async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    };
    const result = await companyCheck("CHE-103.137.179", { fetch: fetchMock, now, finma: () => [finmaRow()] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fiche.street_checks).toHaveLength(1);
    expect(result.fiche.street_checks[0]).toMatchObject({ check: "street_in_municipality", result: true });
    expect(result.fiche.not_covered).not.toContain("official_street_directory_checks");
    const meta = JSON.parse(readFileSync(new URL("../../src/mcp/data/streets.meta.json", import.meta.url), "utf8")) as { edition: string };
    expect(meta.edition).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.fiche.street_checks_edition).toBe(meta.edition);
    // `address_checks` ne contient plus `street_in_municipality` (tâche B1, relecture, point 2) :
    // seulement les trois vérifications de localités, inchangées (voir `company-localities.test.ts`).
    expect(result.fiche.address_checks.map((c) => c.check)).not.toContain("street_in_municipality");
  });
});
