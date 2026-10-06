/**
 * Profil de commune (tâche osd.donnees, tâche B2 du plan `2026-10-06-prospection-et-api.md`).
 *
 * Tout en mémoire : aucune lecture disque, aucun appel réseau. Les dépendances par défaut
 * (`../mcp/data-loader.js`) ne sont jamais exercées ici — chaque test injecte ses propres lignes.
 */
import { describe, expect, it } from "vitest";
import {
  buildFinmaMatchIndex,
  communeProfile,
  nationalFinmaMatchingStats,
  _resetFinmaMatchIndexCache,
  type CommuneProfileDeps,
} from "../../src/lib/commune-profile.js";
import type { FinmaRegistryRow, LocalityRow, StreetRow } from "../../src/mcp/data-loader.js";

function locality(partial: Partial<LocalityRow>): LocalityRow {
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

function finmaRow(partial: Partial<FinmaRegistryRow>): FinmaRegistryRow {
  return {
    entity_type: "bank",
    name: "Institution fictive",
    uid: "CHE-100.000.000",
    lei: "",
    licence_type: "Bank",
    licence_type_de: "",
    licence_type_fr: "",
    licence_type_it: "",
    licence_date: "2020-01-01",
    status: "authorised",
    canton: "ZH",
    city: "",
    address: "",
    source_list: "finma-uid-csv",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/",
    is_warning_listed: "false",
    ...partial,
  };
}

// Winterthur (230) : une seule localité/commune, un NPA, utilisée dans plusieurs tests ci-dessous.
const WINTERTHUR = locality({ postal_code: "8400", locality: "Winterthur", municipality: "Winterthur", municipality_bfs_id: "230", canton: "ZH" });
// 8310 Kemptthal : NPA partagé par Lindau (176) ET Winterthur (230), même structure que les
// fixtures réelles de `tests/mcp/company-localities.test.ts` (tâche osd.localites).
const KEMPTTHAL_LINDAU = locality({ postal_code: "8310", locality: "Kemptthal", municipality: "Lindau", municipality_bfs_id: "176", canton: "ZH" });
const KEMPTTHAL_WINTERTHUR = locality({ postal_code: "8310", locality: "Kemptthal", municipality: "Winterthur", municipality_bfs_id: "230", canton: "ZH" });

function deps(overrides: Partial<CommuneProfileDeps> = {}): Partial<CommuneProfileDeps> {
  return overrides;
}

describe("communeProfile : identité de la commune (nom, canton, NPA, localités)", () => {
  it("une seule localité/commune : nom, canton, NPA et localité repris du répertoire", () => {
    const profile = communeProfile("230", deps({
      getLocalities: () => ({ rows: [WINTERTHUR], edition: "2026-10-01" }),
      getStreets: () => null,
      getFinmaRegistry: () => [],
      getFinmaVersion: () => null,
    }));
    expect(profile.bfs_id).toBe("230");
    expect(profile.name).toBe("Winterthur");
    expect(profile.canton).toBe("ZH");
    expect(profile.postal_codes).toEqual(["8400"]);
    expect(profile.localities).toEqual(["Winterthur"]);
    expect(profile.streets_count).toBeNull(); // répertoire des rues non câblé (deps -> null)
    expect(profile.editions).toEqual({ localities: "2026-10-01", streets: null, finma: null });
    expect(profile.sources).toContain("swisstopo.localities");
    expect(profile.sources).not.toContain("swisstopo.streets");
  });

  it("commune multi-NPA (8310 Kemptthal partagé par Lindau 176 et Winterthur 230) : chaque commune garde SES NPA/localités propres", () => {
    const rows = [WINTERTHUR, KEMPTTHAL_LINDAU, KEMPTTHAL_WINTERTHUR];
    const winterthur = communeProfile("230", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => [], getFinmaVersion: () => null }));
    expect(winterthur.postal_codes.sort()).toEqual(["8310", "8400"]);
    expect(winterthur.localities.sort()).toEqual(["Kemptthal", "Winterthur"]);

    const lindau = communeProfile("176", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => [], getFinmaVersion: () => null }));
    expect(lindau.name).toBe("Lindau");
    expect(lindau.postal_codes).toEqual(["8310"]);
    expect(lindau.localities).toEqual(["Kemptthal"]);
  });

  it("répertoire des localités absent : nom/canton repris du répertoire des rues (repli), postal_codes/localities vides", () => {
    const streetRow: StreetRow = { street: "Bahnhofplatz", postal_code: "8400", locality: "Winterthur", municipality_bfs_id: "230", municipality: "Winterthur", canton: "ZH" };
    const profile = communeProfile("230", deps({
      getLocalities: () => null,
      getStreets: () => ({ rows: [streetRow], byMunicipality: new Map([["230", new Set(["bahnhofplatz"])]]), edition: "2026-10-06" }),
      getFinmaRegistry: () => [],
      getFinmaVersion: () => null,
    }));
    expect(profile.name).toBe("Winterthur");
    expect(profile.canton).toBe("ZH");
    expect(profile.postal_codes).toEqual([]);
    expect(profile.localities).toEqual([]);
    expect(profile.streets_count).toBe(1);
    expect(profile.editions).toEqual({ localities: null, streets: "2026-10-06", finma: null });
    // `finma.uid_csv`/`gleif.lei_api` restent présents : le registre FINMA (vide dans ce test) a
    // bien été lu, même sans répertoire des localités câblé — seule une lecture en échec retire
    // ces deux sources (voir le test dédié plus bas).
    expect(profile.sources).toEqual(["finma.uid_csv", "gleif.lei_api", "swisstopo.streets"]);
  });

  it("commune inconnue des deux répertoires chargés : name/canton null, streets_count 0, jamais une exception", () => {
    const profile = communeProfile("999999", deps({
      getLocalities: () => ({ rows: [WINTERTHUR], edition: "2026-10-01" }),
      getStreets: () => ({ rows: [], byMunicipality: new Map(), edition: "2026-10-06" }),
      getFinmaRegistry: () => [],
      getFinmaVersion: () => null,
    }));
    expect(profile.name).toBeNull();
    expect(profile.canton).toBeNull();
    expect(profile.postal_codes).toEqual([]);
    expect(profile.streets_count).toBe(0);
  });
});

describe("communeProfile : rattachement FINMA exact city+canton, unique (décision du 06.10.2026)", () => {
  it("ville trouvée une seule fois dans le canton : rattachée, comptée par type d'autorisation", () => {
    const rows = [WINTERTHUR];
    const finma = [
      finmaRow({ uid: "CHE-100.000.001", city: "Winterthur", canton: "ZH", licence_type: "Bank" }),
      finmaRow({ uid: "CHE-100.000.002", city: "Winterthur", canton: "ZH", licence_type: "Insurance" }),
      finmaRow({ uid: "CHE-100.000.003", city: "Winterthur", canton: "ZH", licence_type: "Bank" }),
    ];
    const profile = communeProfile("230", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => "2026.10.06" }));
    expect(profile.finma.authorised_entities).toBe(3);
    expect(profile.finma.by_licence_type).toEqual({ Bank: 2, Insurance: 1 });
    expect(profile.finma.matching).toBe("exact city+canton, unique");
    expect(profile.editions.finma).toBe("2026.10.06");
    expect(profile.sources).toContain("finma.uid_csv");
  });

  it("cite GLEIF comme source du rattachement : le canton FINMA utilisé ici vient de l'enrichissement GLEIF, jamais directement de la FINMA", () => {
    const profile = communeProfile("230", deps({ getLocalities: () => ({ rows: [WINTERTHUR], edition: null }), getStreets: () => null, getFinmaRegistry: () => [finmaRow({ city: "Winterthur", canton: "ZH" })], getFinmaVersion: () => null }));
    expect(profile.sources).toContain("gleif.lei_api");
  });

  it("national_matching : mêmes compteurs que nationalFinmaMatchingStats(), jamais recalculés différemment", () => {
    const rows = [WINTERTHUR];
    const finma = [finmaRow({ city: "Winterthur", canton: "ZH" }), finmaRow({ city: "Ville Inconnue", canton: "ZH" })];
    const profile = communeProfile("230", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null }));
    expect(profile.finma.national_matching).toEqual(nationalFinmaMatchingStats({ getLocalities: () => ({ rows, edition: null }), getFinmaRegistry: () => finma }));
    expect(profile.finma.national_matching).toEqual({ matched: 1, unmatched: 1, ambiguous: 0, total: 2 });
  });

  it("casse et espaces ignorés (NFC, casse, espaces — jamais le trait d'union ≡ espace réservé aux rues)", () => {
    const rows = [WINTERTHUR];
    const finma = [finmaRow({ city: "  WINTERTHUR  ", canton: "ZH" })];
    const profile = communeProfile("230", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null }));
    expect(profile.finma.authorised_entities).toBe(1);
  });

  it("homonymes dans deux cantons différents : rattachement non ambigu (le canton distingue les deux communes)", () => {
    const buchsSG = locality({ postal_code: "9470", locality: "Buchs", municipality: "Buchs", municipality_bfs_id: "3301", canton: "SG" });
    const buchsAG = locality({ postal_code: "5033", locality: "Buchs", municipality: "Buchs", municipality_bfs_id: "4001", canton: "AG" });
    const rows = [buchsSG, buchsAG];
    const finmaSG = [finmaRow({ city: "Buchs", canton: "SG" })];
    const profileSG = communeProfile("3301", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finmaSG, getFinmaVersion: () => null }));
    expect(profileSG.finma.authorised_entities).toBe(1);
    const profileAG = communeProfile("4001", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finmaSG, getFinmaVersion: () => null }));
    expect(profileAG.finma.authorised_entities).toBe(0); // canton différent : pas de confusion
  });

  it("ville ambiguë dans le MÊME canton (deux communes portent le même nom de localité) : non rattachée pour les deux, jamais devinée", () => {
    const communeA = locality({ postal_code: "1000", locality: "Ambigue", municipality: "Commune A", municipality_bfs_id: "501", canton: "VD" });
    const communeB = locality({ postal_code: "1001", locality: "Ambigue", municipality: "Commune B", municipality_bfs_id: "502", canton: "VD" });
    const rows = [communeA, communeB];
    const finma = [finmaRow({ city: "Ambigue", canton: "VD" })];
    const profileA = communeProfile("501", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null }));
    const profileB = communeProfile("502", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null }));
    expect(profileA.finma.authorised_entities).toBe(0);
    expect(profileB.finma.authorised_entities).toBe(0);
  });

  it("localité avec suffixe (« Lausanne 25 ») : rattachée seulement si le texte FINMA est identique, suffixe compris", () => {
    const lausanne = locality({ postal_code: "1000", locality: "Lausanne", municipality: "Lausanne", municipality_bfs_id: "5586", canton: "VD" });
    const lausanne25 = locality({ postal_code: "1025", locality: "Lausanne 25", municipality: "Lausanne", municipality_bfs_id: "5586", canton: "VD" });
    const rows = [lausanne, lausanne25];
    const sansSuffixe = communeProfile("5586", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => [finmaRow({ city: "Lausanne", canton: "VD" })], getFinmaVersion: () => null }));
    expect(sansSuffixe.finma.authorised_entities).toBe(1); // correspond à la localité "Lausanne" telle quelle
    const avecSuffixe = communeProfile("5586", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => [finmaRow({ city: "Lausanne 25", canton: "VD" })], getFinmaVersion: () => null }));
    expect(avecSuffixe.finma.authorised_entities).toBe(1); // correspond à la localité "Lausanne 25" telle quelle
    const suffixeInconnu = communeProfile("5586", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => [finmaRow({ city: "Lausanne 99", canton: "VD" })], getFinmaVersion: () => null }));
    expect(suffixeInconnu.finma.authorised_entities).toBe(0); // "Lausanne 99" n'existe pas au répertoire : jamais un retrait de suffixe
  });

  it("ligne FINMA sans ville ou sans canton : ignorée, jamais une exception", () => {
    const rows = [WINTERTHUR];
    const finma = [finmaRow({ city: "", canton: "ZH" }), finmaRow({ city: "Winterthur", canton: "" })];
    const profile = communeProfile("230", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null }));
    expect(profile.finma.authorised_entities).toBe(0);
  });

  it("registre FINMA illisible (getFinmaRegistry qui lève) : authorised_entities à 0, source FINMA absente, jamais une exception propagée", () => {
    const profile = communeProfile("230", deps({
      getLocalities: () => ({ rows: [WINTERTHUR], edition: null }),
      getStreets: () => null,
      getFinmaRegistry: () => { throw new Error("FINMA registry could not be read"); },
      getFinmaVersion: () => null,
    }));
    expect(profile.finma.authorised_entities).toBe(0);
    expect(profile.finma.by_licence_type).toEqual({});
    expect(profile.sources).not.toContain("finma.uid_csv");
    expect(profile.sources).not.toContain("gleif.lei_api");
  });

  it("aucune note, aucun classement : seulement des compteurs et une notice factuelle", () => {
    const profile = communeProfile("230", deps({ getLocalities: () => ({ rows: [WINTERTHUR], edition: null }), getStreets: () => null, getFinmaRegistry: () => [], getFinmaVersion: () => null }));
    expect(profile.notice.length).toBeGreaterThan(0);
    const banned = ["score", "rank", "best", "worst", "safe", "risky"];
    const lower = profile.notice.toLowerCase();
    for (const word of banned) expect(lower).not.toContain(word);
  });
});

describe("nationalFinmaMatchingStats : rattachées / non rattachées / ambiguës, nombres seulement", () => {
  it("répartit correctement les trois catégories", () => {
    const communeA = locality({ postal_code: "1000", locality: "Ambigue", municipality: "Commune A", municipality_bfs_id: "501", canton: "VD" });
    const communeB = locality({ postal_code: "1001", locality: "Ambigue", municipality: "Commune B", municipality_bfs_id: "502", canton: "VD" });
    const rows = [WINTERTHUR, communeA, communeB];
    const finma = [
      finmaRow({ city: "Winterthur", canton: "ZH" }), // rattachée
      finmaRow({ city: "Ambigue", canton: "VD" }), // ambiguë
      finmaRow({ city: "Ville Inconnue", canton: "ZH" }), // non rattachée
      finmaRow({ city: "", canton: "ZH" }), // non rattachée (ville vide)
    ];
    const stats = nationalFinmaMatchingStats({ getLocalities: () => ({ rows, edition: null }), getFinmaRegistry: () => finma });
    expect(stats).toEqual({ matched: 1, unmatched: 2, ambiguous: 1, total: 4 });
  });

  it("registre FINMA vide : tous les compteurs à zéro", () => {
    const stats = nationalFinmaMatchingStats({ getLocalities: () => ({ rows: [WINTERTHUR], edition: null }), getFinmaRegistry: () => [] });
    expect(stats).toEqual({ matched: 0, unmatched: 0, ambiguous: 0, total: 0 });
  });
});

describe("buildFinmaMatchIndex : index pur, mémoïsable par référence de tableau", () => {
  it("même référence de tableau : le même index est rendu (mémoïsation)", () => {
    _resetFinmaMatchIndexCache();
    const rows = [WINTERTHUR];
    const first = buildFinmaMatchIndex(rows);
    const second = buildFinmaMatchIndex(rows);
    expect(second).toBe(first);
  });

  it("référence différente : un nouvel index est reconstruit", () => {
    _resetFinmaMatchIndexCache();
    const first = buildFinmaMatchIndex([WINTERTHUR]);
    const second = buildFinmaMatchIndex([WINTERTHUR]);
    expect(second).not.toBe(first);
  });

  it("indexe à la fois la localité et le nom de commune, mêmes numéro OFS", () => {
    _resetFinmaMatchIndexCache();
    const index = buildFinmaMatchIndex([WINTERTHUR]);
    expect(index.get("ZH||winterthur")?.has("230")).toBe(true);
  });
});
