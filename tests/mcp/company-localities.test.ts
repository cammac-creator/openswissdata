/**
 * Vérifications de l'adresse officielle (répertoire swisstopo des localités) dans la fiche
 * société (tâche osd.localites, tâche 2).
 *
 * Décision de Claude-Alain du 06.10.2026 : ces vérifications vivent dans un champ SÉPARÉ
 * `address_checks` (jamais dans `cross_checks` — ce sont des comparaisons à une référence
 * officielle, pas un recoupement entre deux sources qui se corroborent), TOUJOURS présent
 * (tableau vide quand il n'y a pas d'adresse publiée ou pas de répertoire), et `localities`
 * est désormais câblé PAR DÉFAUT dans `companyCheck()` (`src/mcp/company/check.ts`).
 *
 * Ce fichier teste `buildCompanyFiche` avec `parts.localities` fourni explicitement (pas de
 * réseau, pas de lecture disque). Les cas `undefined` ci-dessous couvrent les appels directs
 * à `buildCompanyFiche` qui ne connaissent pas ce paramètre (voir
 * `tests/mcp/company-check.test.ts`, jamais modifié par cette tâche) : leur comportement
 * reste strictement inchangé.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCompanyFiche, companyCheck, type LocalitiesAccess } from "../../src/mcp/company/check.js";
import { LINDAS_ENDPOINT, resetLindasCache } from "../../src/mcp/company/lindas.js";
import { resetGleifCache } from "../../src/mcp/company/gleif.js";
import { _resetDataLoaderCache, type LocalityRow } from "../../src/mcp/data-loader.js";
import type { FinmaRegistryRow } from "../../src/mcp/data-loader.js";
import type { GleifRecord, LindasCompany, Part } from "../../src/mcp/company/types.js";

const DEBUT = Date.UTC(2026, 9, 6, 10, 0, 0);
const now = () => DEBUT;
const AVAILABLE_NOT_FOUND = <T,>(): Part<T> => ({ available: true, found: false, retrieved_at: new Date(DEBUT).toISOString(), data: null });

/** Lignes réelles du répertoire officiel du 06.10.2026 (mêmes valeurs que
 *  `src/mcp/data/localities.csv`), construites en mémoire : aucune lecture disque. */
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
const GENEVE_1201 = row({ postal_code: "1201", locality: "Genève", municipality: "Genève", municipality_bfs_id: "6621", canton: "GE", language: "fr" });

function byPostalCode(rows: LocalityRow[]): ReadonlyMap<string, readonly LocalityRow[]> {
  const index = new Map<string, LocalityRow[]>();
  for (const r of rows) {
    const list = index.get(r.postal_code);
    if (list) list.push(r);
    else index.set(r.postal_code, [r]);
  }
  return index;
}

function directory(rows: LocalityRow[]): LocalitiesAccess {
  return { available: true, byPostalCode: byPostalCode(rows) };
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

function ficheWith(lindasData: LindasCompany, localities: LocalitiesAccess | undefined): ReturnType<typeof buildCompanyFiche> {
  const lindas: Part<LindasCompany> = { available: true, found: true, retrieved_at: new Date(DEBUT).toISOString(), data: lindasData };
  return buildCompanyFiche(UID, {
    lindas,
    gleif: AVAILABLE_NOT_FOUND<GleifRecord[]>(),
    finma: { available: true, rows: [] },
    localities,
    now,
  });
}

describe("buildCompanyFiche : address_checks (répertoire officiel des localités), champ distinct de cross_checks", () => {
  it("`localities` absent (undefined, appel direct antérieur à cette tâche) : address_checks vide, cross_checks et not_covered strictement identiques à avant la tâche osd.localites", () => {
    const fiche = ficheWith(OPEN_FORM_COMPANY, undefined);
    expect(fiche.address_checks).toEqual([]);
    expect(fiche.cross_checks).toEqual([]);
    expect(fiche.not_covered).toEqual(["commercial_register_status", "fosc_publications", "seco_sanctions", "officers"]);
  });

  it("répertoire absent (`{ available: false }`) : address_checks VIDE, not_covered le dit, jamais une exception", () => {
    const fiche = ficheWith(OPEN_FORM_COMPANY, { available: false });
    expect(fiche.address_checks).toEqual([]);
    expect(fiche.cross_checks).toEqual([]); // jamais mélangé à cross_checks
    expect(fiche.not_covered).toEqual([
      "commercial_register_status",
      "fosc_publications",
      "seco_sanctions",
      "officers",
      "official_locality_directory_checks",
    ]);
  });

  it("AXA-like (8400 Winterthur 230 ZH) : trois address_checks, tous vrais, cross_checks non affecté", () => {
    const fiche = ficheWith(OPEN_FORM_COMPANY, directory([WINTERTHUR_8400]));
    expect(fiche.cross_checks).toEqual([]); // aucun recoupement GLEIF/FINMA dans ce scénario : address_checks n'y ajoute rien
    const checks = Object.fromEntries(fiche.address_checks.map((c) => [c.check, c]));
    expect(Object.keys(checks).sort()).toEqual(
      ["locality_matches_postal_code", "postal_code_in_official_directory", "seat_municipality_matches_postal_code"].sort(),
    );
    expect(checks.postal_code_in_official_directory.result).toBe(true);
    expect(checks.locality_matches_postal_code.result).toBe(true);
    expect(checks.seat_municipality_matches_postal_code.result).toBe(true);
    for (const c of fiche.address_checks) {
      expect(c.sources).toEqual(["ofrc.zefix_lindas", "swisstopo.localities"]);
      expect(c.detail.length).toBeGreaterThan(0);
    }
    expect(fiche.not_covered).not.toContain("official_locality_directory_checks");
  });

  it("NPA absent du répertoire : les trois address_checks sont false (jamais une exception)", () => {
    const fiche = ficheWith(OPEN_FORM_COMPANY, directory([GENEVE_1201])); // 8400 absent de ce répertoire-ci
    const checks = Object.fromEntries(fiche.address_checks.map((c) => [c.check, c]));
    expect(checks.postal_code_in_official_directory.result).toBe(false);
    expect(checks.locality_matches_postal_code.result).toBe(false);
    expect(checks.seat_municipality_matches_postal_code.result).toBe(false);
  });

  it("NPA partagé par plusieurs communes (8310 Kemptthal : Lindau 176 ET Winterthur 230) : le siège à Lindau (176) est trouvé parmi les communes du NPA", () => {
    const company: LindasCompany = { ...OPEN_FORM_COMPANY, postal_code: "8310", locality: "Kemptthal", municipality: "Lindau", municipality_bfs_id: "176" };
    const fiche = ficheWith(company, directory([KEMPTTHAL_LINDAU, KEMPTTHAL_WINTERTHUR]));
    const checks = Object.fromEntries(fiche.address_checks.map((c) => [c.check, c]));
    expect(checks.postal_code_in_official_directory.result).toBe(true);
    expect(checks.locality_matches_postal_code.result).toBe(true);
    expect(checks.seat_municipality_matches_postal_code.result).toBe(true);
  });

  it("NPA partagé par plusieurs communes : un siège dans une TROISIÈME commune (hors 176/230) donne seat_municipality_matches_postal_code=false, sans faire échouer les deux autres", () => {
    const company: LindasCompany = { ...OPEN_FORM_COMPANY, postal_code: "8310", locality: "Kemptthal", municipality: "Une Autre Commune", municipality_bfs_id: "999" };
    const fiche = ficheWith(company, directory([KEMPTTHAL_LINDAU, KEMPTTHAL_WINTERTHUR]));
    const checks = Object.fromEntries(fiche.address_checks.map((c) => [c.check, c]));
    expect(checks.postal_code_in_official_directory.result).toBe(true);
    expect(checks.locality_matches_postal_code.result).toBe(true);
    expect(checks.seat_municipality_matches_postal_code.result).toBe(false);
    expect(checks.seat_municipality_matches_postal_code.detail).toContain("can differ from the postal address");
  });

  it("localité accentuée (Genève) : correspondance exacte après NFC, MAJUSCULES/espaces ignorés, mais un accent retiré reste 'different'", () => {
    const company: LindasCompany = { ...OPEN_FORM_COMPANY, postal_code: "1201", locality: "Genève", municipality: "Genève", municipality_bfs_id: "6621" };
    const ficheIdentique = ficheWith(company, directory([GENEVE_1201]));
    expect(ficheIdentique.address_checks.find((c) => c.check === "locality_matches_postal_code")?.result).toBe(true);

    const companyMajuscules: LindasCompany = { ...company, locality: "  GENÈVE  " }; // casse et espaces différents
    const ficheMajuscules = ficheWith(companyMajuscules, directory([GENEVE_1201]));
    expect(ficheMajuscules.address_checks.find((c) => c.check === "locality_matches_postal_code")?.result).toBe(true);

    const companySansAccent: LindasCompany = { ...company, locality: "Geneve" }; // accent retiré : divergence factuelle réelle
    const ficheSansAccent = ficheWith(companySansAccent, directory([GENEVE_1201]));
    const sansAccentCheck = ficheSansAccent.address_checks.find((c) => c.check === "locality_matches_postal_code");
    expect(sansAccentCheck?.result).toBe(false);
    expect(sansAccentCheck?.detail).not.toMatch(/safe|risky|compliant|verified|trustworthy|legitimate\b|suspicious|valid company/i);
  });

  it("entreprise individuelle (0101) : adresse non publiée → address_checks VIDE, même avec un répertoire disponible (jamais de fuite d'un NPA retenu)", () => {
    const individuelle: LindasCompany = { ...OPEN_FORM_COMPANY, legal_form_code: "0101" };
    const fiche = ficheWith(individuelle, directory([WINTERTHUR_8400]));
    expect(fiche.address_checks).toEqual([]);
    expect(fiche.cross_checks).toEqual([]);
    expect(fiche.not_covered).not.toContain("official_locality_directory_checks"); // répertoire disponible, juste non applicable ici
  });

  it("entreprise individuelle (0101) + répertoire indisponible : address_checks VIDE, not_covered ajoute l'entrée malgré l'adresse non publiée (l'indisponibilité du répertoire reste un fait à part)", () => {
    const individuelle: LindasCompany = { ...OPEN_FORM_COMPANY, legal_form_code: "0101" };
    const fiche = ficheWith(individuelle, { available: false });
    expect(fiche.address_checks).toEqual([]);
    expect(fiche.not_covered).toContain("official_locality_directory_checks");
  });

  it("aucun mot de verdict dans le détail des trois address_checks", () => {
    const fiche = ficheWith(OPEN_FORM_COMPANY, directory([WINTERTHUR_8400]));
    const banned = ["safe", "risky", "compliant", "verified", "trustworthy", "suspicious", "valid company"];
    expect(fiche.address_checks.length).toBe(3);
    for (const c of fiche.address_checks) {
      const lower = c.detail.toLowerCase();
      for (const word of banned) expect(lower).not.toContain(word);
    }
  });
});

describe("companyCheck (bout en bout) : localities câblé PAR DÉFAUT, répertoire réel embarqué", () => {
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

  it("AXA Leben AG (adresse réelle 8400 Winterthur 230 ZH) : companyCheck() sans deps.localities rend déjà trois address_checks vrais, lus depuis le fichier embarqué", async () => {
    const fetchMock = async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    };
    const result = await companyCheck("CHE-103.137.179", { fetch: fetchMock, now, finma: () => [finmaRow()] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const checks = Object.fromEntries(result.fiche.address_checks.map((c) => [c.check, c]));
    expect(checks.postal_code_in_official_directory?.result).toBe(true);
    expect(checks.locality_matches_postal_code?.result).toBe(true);
    expect(checks.seat_municipality_matches_postal_code?.result).toBe(true);
    // cross_checks garde EXACTEMENT son comportement d'avant cette tâche (test existant,
    // tests/mcp/company-check.test.ts, "1. AXA Leben AG" : toHaveLength(2)) : jamais mélangé.
    expect(result.fiche.cross_checks).toHaveLength(2);
    expect(result.fiche.not_covered).not.toContain("official_locality_directory_checks");
  });
});
