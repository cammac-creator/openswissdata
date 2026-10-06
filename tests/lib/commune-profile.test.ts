/**
 * Profil de commune (tâche osd.donnees, tâche B2 du plan `2026-10-06-prospection-et-api.md`,
 * RÈGLE DE RATTACHEMENT REVUE le 06.10.2026 : priorité 1 au nom de COMMUNE — canton-filtré quand
 * connu —, priorité 2 (seulement si aucune commune ne porte ce nom) au nom de LOCALITÉ).
 *
 * Tout en mémoire : aucune lecture disque, aucun appel réseau. Les dépendances par défaut
 * (`../mcp/data-loader.js`) ne sont jamais exercées ici — chaque test injecte ses propres lignes.
 */
import { describe, expect, it } from "vitest";
import {
  buildFinmaMatchIndexes,
  communeProfile,
  nationalFinmaMatchingStats,
  _resetFinmaMatchIndexCache,
  FINMA_MATCHING_RULE,
  type CommuneProfileDeps,
} from "../../src/lib/commune-profile.js";
import type { FinmaRegistryRow, LocalityRow } from "../../src/mcp/data-loader.js";

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

function streets(byMunicipality: ReadonlyMap<string, ReadonlySet<string>>, municipalityInfo: ReadonlyMap<string, { municipality: string; canton: string }>, edition: string | null) {
  return { byMunicipality, municipalityInfo, edition };
}

// Winterthur (230) : une seule localité/commune, un NPA, utilisée dans plusieurs tests ci-dessous.
const WINTERTHUR = locality({ postal_code: "8400", locality: "Winterthur", municipality: "Winterthur", municipality_bfs_id: "230", canton: "ZH" });
// 8310 Kemptthal : NPA partagé par Lindau (176) ET Winterthur (230), même structure que les
// fixtures réelles de `tests/mcp/company-localities.test.ts` (tâche osd.localites).
const KEMPTTHAL_LINDAU = locality({ postal_code: "8310", locality: "Kemptthal", municipality: "Lindau", municipality_bfs_id: "176", canton: "ZH" });
const KEMPTTHAL_WINTERTHUR = locality({ postal_code: "8310", locality: "Kemptthal", municipality: "Winterthur", municipality_bfs_id: "230", canton: "ZH" });
// Situation réelle au 06.10.2026, repérée en production (rapport de la tâche B2) : un secteur
// postal de la commune de Schlatt (ZH, 226) porte la LOCALITÉ « Winterthur » (NPA 8405), bien que
// son nom de COMMUNE soit « Schlatt (ZH) » — jamais « Winterthur ». C'est ce qui rendait
// l'ancienne règle (localité OU commune, sans priorité) ambiguë pour AXA Leben AG.
const SCHLATT_WINTERTHUR_LOCALITY = locality({ postal_code: "8405", locality: "Winterthur", municipality: "Schlatt (ZH)", municipality_bfs_id: "226", canton: "ZH" });

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

  it("répertoire des localités absent : nom/canton repris du petit répertoire nom/canton des rues (repli, point 5), postal_codes/localities vides", () => {
    const municipalityInfo = new Map([["230", { municipality: "Winterthur", canton: "ZH" }]]);
    const profile = communeProfile("230", deps({
      getLocalities: () => null,
      getStreets: () => streets(new Map([["230", new Set(["bahnhofplatz"])]]), municipalityInfo, "2026-10-06"),
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
      getStreets: () => streets(new Map(), new Map(), "2026-10-06"),
      getFinmaRegistry: () => [],
      getFinmaVersion: () => null,
    }));
    expect(profile.name).toBeNull();
    expect(profile.canton).toBeNull();
    expect(profile.postal_codes).toEqual([]);
    expect(profile.streets_count).toBe(0);
  });
});

describe("communeProfile : rattachement FINMA — priorité 1 commune (canton filtré si connu), priorité 2 localité (décision du 06.10.2026, relecture du même jour)", () => {
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
    expect(profile.finma.matching).toBe(FINMA_MATCHING_RULE);
    expect(profile.editions.finma).toBe("2026.10.06");
    expect(profile.sources).toContain("finma.uid_csv");
  });

  it("RELECTURE DU 06.10.2026 — AXA Leben AG (ville « Winterthur », canton ZH) se rattache à la commune 230, malgré l'homonymie avec la LOCALITÉ « Winterthur » du secteur postal de Schlatt (ZH, 226) : le nom de COMMUNE gagne toujours sur une coïncidence de nom de localité ailleurs", () => {
    const rows = [WINTERTHUR, SCHLATT_WINTERTHUR_LOCALITY];
    const finma = [finmaRow({ city: "Winterthur", canton: "ZH" })];
    const winterthur = communeProfile("230", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null }));
    expect(winterthur.finma.authorised_entities).toBe(1);
    const schlatt = communeProfile("226", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null }));
    expect(schlatt.finma.authorised_entities).toBe(0); // "Winterthur" n'est PAS le nom de la commune de Schlatt
    const stats = nationalFinmaMatchingStats({ getLocalities: () => ({ rows, edition: null }), getFinmaRegistry: () => finma });
    expect(stats).toEqual({ matched: 1, unmatched: 0, ambiguous: 0, total: 1 }); // jamais ambiguë : priorité 1 tranche avant la priorité 2
  });

  it("priorité 2 (localité) seulement quand AUCUNE commune ne porte ce nom : rattachée via la localité", () => {
    // "Rickenbach Sulz" est une LOCALITÉ réelle (secteur de Winterthur) qui n'est le nom
    // d'AUCUNE commune suisse : la priorité 1 ne trouve rien, la priorité 2 doit rattacher.
    const rickenbachSulz = locality({ postal_code: "8352", locality: "Rickenbach Sulz", municipality: "Winterthur", municipality_bfs_id: "230", canton: "ZH" });
    const rows = [WINTERTHUR, rickenbachSulz];
    const finma = [finmaRow({ city: "Rickenbach Sulz", canton: "ZH" })];
    const profile = communeProfile("230", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null }));
    expect(profile.finma.authorised_entities).toBe(1);
  });

  it("canton FINMA inconnu : priorité 1 cherche tout le pays ; rattachée si un seul nom de commune au pays porte ce nom", () => {
    const rows = [WINTERTHUR, SCHLATT_WINTERTHUR_LOCALITY];
    const finma = [finmaRow({ city: "Winterthur", canton: "" })]; // canton vide : recherche nationale
    const profile = communeProfile("230", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null }));
    expect(profile.finma.authorised_entities).toBe(1); // "Winterthur" reste un nom de COMMUNE unique au pays, même sans filtrer par canton
  });

  it("canton FINMA inconnu ET nom de commune ambigu au niveau national : ambiguë, jamais devinée", () => {
    const communeA = locality({ postal_code: "1000", locality: "Homonyme", municipality: "Homonyme", municipality_bfs_id: "501", canton: "VD" });
    const communeB = locality({ postal_code: "9999", locality: "Homonyme", municipality: "Homonyme", municipality_bfs_id: "777", canton: "GR" });
    const rows = [communeA, communeB];
    const finma = [finmaRow({ city: "Homonyme", canton: "" })];
    const profileA = communeProfile("501", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null }));
    const profileB = communeProfile("777", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null }));
    expect(profileA.finma.authorised_entities).toBe(0);
    expect(profileB.finma.authorised_entities).toBe(0);
    const stats = nationalFinmaMatchingStats({ getLocalities: () => ({ rows, edition: null }), getFinmaRegistry: () => finma });
    expect(stats).toEqual({ matched: 0, unmatched: 0, ambiguous: 1, total: 1 });
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

  it("ville ambiguë dans le MÊME canton, aucune commune ne porte ce nom (priorité 2 ambiguë) : non rattachée pour les deux, jamais devinée", () => {
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
    expect(sansSuffixe.finma.authorised_entities).toBe(1); // correspond au nom de commune "Lausanne" (priorité 1)
    const avecSuffixe = communeProfile("5586", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => [finmaRow({ city: "Lausanne 25", canton: "VD" })], getFinmaVersion: () => null }));
    expect(avecSuffixe.finma.authorised_entities).toBe(1); // aucune commune "Lausanne 25" : rattachée via la localité (priorité 2)
    const suffixeInconnu = communeProfile("5586", deps({ getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => [finmaRow({ city: "Lausanne 99", canton: "VD" })], getFinmaVersion: () => null }));
    expect(suffixeInconnu.finma.authorised_entities).toBe(0); // "Lausanne 99" n'existe nulle part : jamais un retrait de suffixe
  });

  it("ligne FINMA sans ville : ignorée, jamais une exception", () => {
    const rows = [WINTERTHUR];
    const finma = [finmaRow({ city: "", canton: "ZH" })];
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

describe("buildFinmaMatchIndexes : index purs, mémoïsables par référence de tableau", () => {
  it("même référence de tableau : les mêmes index sont rendus (mémoïsation)", () => {
    _resetFinmaMatchIndexCache();
    const rows = [WINTERTHUR];
    const first = buildFinmaMatchIndexes(rows);
    const second = buildFinmaMatchIndexes(rows);
    expect(second).toBe(first);
  });

  it("référence différente : de nouveaux index sont reconstruits", () => {
    _resetFinmaMatchIndexCache();
    const first = buildFinmaMatchIndexes([WINTERTHUR]);
    const second = buildFinmaMatchIndexes([WINTERTHUR]);
    expect(second).not.toBe(first);
  });

  it("indexe séparément les noms de commune et de localité, canton par numéro OFS", () => {
    _resetFinmaMatchIndexCache();
    const indexes = buildFinmaMatchIndexes([WINTERTHUR, SCHLATT_WINTERTHUR_LOCALITY]);
    expect(indexes.municipalityByName.get("winterthur")?.has("230")).toBe(true);
    expect(indexes.municipalityByName.get("winterthur")?.has("226")).toBe(false); // "Schlatt (ZH)" est le nom de commune, pas "Winterthur"
    expect(indexes.localityByName.get("winterthur")?.has("230")).toBe(true);
    expect(indexes.localityByName.get("winterthur")?.has("226")).toBe(true); // "Winterthur" EST une localité de Schlatt
    expect(indexes.cantonByBfsId.get("230")).toBe("ZH");
    expect(indexes.cantonByBfsId.get("226")).toBe("ZH");
  });
});
