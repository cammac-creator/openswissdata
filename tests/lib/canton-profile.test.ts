/**
 * Profil de canton (tâche osd.donnees, tâche B5 du plan `2026-10-06-prospection-et-api.md`).
 *
 * Même méthode que `tests/lib/commune-profile.test.ts`/`tests/lib/commune-profile-seats.test.ts` :
 * cas limites avec des dépendances injectées (jamais de lecture disque), puis un cas de
 * PRODUCTION réelle qui ne vérifie que la FORME des champs (jamais une valeur figée).
 */
import { describe, expect, it } from "vitest";
import {
  bfsIdsForCanton,
  buildBfsCantonIndex,
  cantonProfile,
  cantonPvSeries,
  countCommunesAndLocalities,
  PV_RATIOS_NOTE,
  PV_SCOPE_NOTE,
  SWISS_CANTON_ABBREVIATIONS,
  toPvNumber,
  type CantonProfileDeps,
} from "../../src/lib/canton-profile.js";
import { FINMA_SEAT_MATCHING_RULE } from "../../src/lib/commune-profile.js";
import { getFinmaVersion, type BfePvRow, type FinmaRegistryRow, type LocalityRow } from "../../src/mcp/data-loader.js";

function locality(partial: Partial<LocalityRow>): LocalityRow {
  return {
    postal_code: "", postal_code_suffix: "00", locality: "", municipality: "", municipality_bfs_id: "",
    canton: "ZH", language: "de", ...partial,
  };
}

function finmaRow(partial: Partial<FinmaRegistryRow>): FinmaRegistryRow {
  return {
    entity_type: "bank", name: "Institution fictive", uid: "CHE-100.000.000", lei: "", licence_type: "Bank",
    licence_type_de: "", licence_type_fr: "", licence_type_it: "", licence_date: "2020-01-01", status: "authorised",
    canton: "ZH", city: "", address: "", source_list: "finma-uid-csv",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/",
    is_warning_listed: "false", ...partial,
  };
}

function bfeRow(partial: Partial<BfePvRow>): BfePvRow {
  return {
    year: "2020", canton: "ZH", installations_count: "1", installed_capacity_kw: "1",
    remuneration_chf: "1", installations_per_100000_inhabitants: "1", installed_capacity_kw_per_100000_inhabitants: "1",
    ...partial,
  };
}

const WINTERTHUR = locality({ postal_code: "8400", locality: "Winterthur", municipality: "Winterthur", municipality_bfs_id: "230", canton: "ZH" });
const KEMPTTHAL_LINDAU = locality({ postal_code: "8310", postal_code_suffix: "00", locality: "Kemptthal", municipality: "Lindau", municipality_bfs_id: "175", canton: "ZH" });
const KEMPTTHAL_WINTERTHUR = locality({ postal_code: "8310", postal_code_suffix: "00", locality: "Kemptthal", municipality: "Winterthur", municipality_bfs_id: "230", canton: "ZH" });
const GENEVE = locality({ postal_code: "1201", locality: "Genève", municipality: "Genève", municipality_bfs_id: "6621", canton: "GE" });

function seats(byUid: ReadonlyMap<string, string>, edition: string | null = "2026-10-07") {
  return () => ({ byUid, edition });
}

function deps(overrides: Partial<CantonProfileDeps> = {}): Partial<CantonProfileDeps> {
  return overrides;
}

describe("SWISS_CANTON_ABBREVIATIONS", () => {
  it("26 cantons, ordre alphabétique, aucun doublon", () => {
    expect(SWISS_CANTON_ABBREVIATIONS).toHaveLength(26);
    expect(new Set(SWISS_CANTON_ABBREVIATIONS).size).toBe(26);
    expect([...SWISS_CANTON_ABBREVIATIONS]).toEqual([...SWISS_CANTON_ABBREVIATIONS].sort());
  });
});

describe("countCommunesAndLocalities", () => {
  it("une localité qui chevauche deux communes du même canton : comptée une seule fois", () => {
    const { communes, localities } = countCommunesAndLocalities("ZH", [WINTERTHUR, KEMPTTHAL_LINDAU, KEMPTTHAL_WINTERTHUR]);
    expect(communes).toBe(2); // Winterthur (230) et Lindau (175)
    expect(localities).toBe(2); // Winterthur (8400) et Kemptthal (8310) — chevauchement compté une fois
  });
  it("canton sans ligne : zéro, jamais une exception", () => {
    expect(countCommunesAndLocalities("JU", [WINTERTHUR])).toEqual({ communes: 0, localities: 0 });
  });
  it("insensible à la casse et aux espaces du canton", () => {
    const row = locality({ municipality_bfs_id: "230", canton: " zh " });
    expect(countCommunesAndLocalities("ZH", [row]).communes).toBe(1);
  });
});

describe("bfsIdsForCanton et buildBfsCantonIndex", () => {
  it("localités en priorité, repli sur le répertoire des rues pour une commune absente des localités", () => {
    const streetsInfo = new Map([["999", { municipality: "Commune fictive", canton: "BE" }]]);
    const ids = bfsIdsForCanton("BE", [WINTERTHUR], streetsInfo);
    expect(ids).toEqual(new Set(["999"]));
    const index = buildBfsCantonIndex([WINTERTHUR], streetsInfo);
    expect(index.get("230")).toBe("ZH");
    expect(index.get("999")).toBe("BE");
  });
  it("une commune présente dans les deux répertoires n'est comptée qu'une fois", () => {
    const streetsInfo = new Map([["230", { municipality: "Winterthur", canton: "ZH" }]]);
    const ids = bfsIdsForCanton("ZH", [WINTERTHUR], streetsInfo);
    expect(ids.size).toBe(1);
  });
});

describe("toPvNumber", () => {
  it("\"NA\" (donnée OFEN non disponible) : null, jamais un zéro deviné", () => {
    expect(toPvNumber("NA")).toBeNull();
  });
  it("nombre valide : converti", () => {
    expect(toPvNumber("12.5")).toBe(12.5);
  });
  it("texte illisible : null", () => {
    expect(toPvNumber("abc")).toBeNull();
  });
});

describe("cantonPvSeries", () => {
  it("filtre par canton, trie par année, recopie \"NA\" en null sans rien recalculer", () => {
    const rows = [
      bfeRow({ year: "2021", canton: "ZH", installations_count: "5" }),
      bfeRow({ year: "2020", canton: "ZH", installations_count: "3" }),
      bfeRow({ year: "2020", canton: "GE", installations_count: "9" }),
      bfeRow({ year: "2022", canton: "ZH", installations_count: "NA", installed_capacity_kw: "NA", remuneration_chf: "NA", installations_per_100000_inhabitants: "NA", installed_capacity_kw_per_100000_inhabitants: "NA" }),
    ];
    const series = cantonPvSeries("ZH", rows);
    expect(series.map((r) => r.year)).toEqual([2020, 2021, 2022]);
    expect(series[0].installations_count).toBe(3);
    expect(series[2].installations_count).toBeNull();
    expect(series[2].installed_capacity_kw).toBeNull();
  });
});

describe("cantonProfile : cas limites (dépendances injectées)", () => {
  it("communes, localités et rues comptées pour le canton demandé", () => {
    const profile = cantonProfile("ZH", deps({
      getLocalities: () => ({ rows: [WINTERTHUR, GENEVE], edition: "2026-10-01" }),
      getStreets: () => ({
        byMunicipality: new Map([["230", new Set(["bahnhofstrasse"])], ["6621", new Set(["rue du mont blanc", "rue de la gare"])]]),
        municipalityInfo: new Map([["230", { municipality: "Winterthur", canton: "ZH" }], ["6621", { municipality: "Genève", canton: "GE" }]]),
        edition: "2026-10-01",
      }),
      getFinmaRegistry: () => [],
      getFinmaVersion: () => null,
      getFinmaSeats: () => null,
      getBfePv: () => null,
    }));
    expect(profile.abbreviation).toBe("ZH");
    expect(profile.communes_count).toBe(1);
    expect(profile.localities_count).toBe(1);
    expect(profile.streets_count).toBe(1);
    expect(profile.sources).toEqual(["swisstopo.localities", "swisstopo.streets"]);
    expect(profile.editions).toEqual({ localities: "2026-10-01", streets: "2026-10-01", finma: null, finma_seats: null, bfe_pv: null });
    expect(profile.finma.entities_with_seat_in_canton).toBeNull();
    expect(profile.pv).toBeNull();
  });

  it("répertoires indisponibles : tous les champs correspondants à null, jamais zéro", () => {
    const profile = cantonProfile("ZH", deps({
      getLocalities: () => null, getStreets: () => null, getFinmaRegistry: () => [], getFinmaSeats: () => null, getBfePv: () => null,
    }));
    expect(profile.communes_count).toBeNull();
    expect(profile.localities_count).toBeNull();
    expect(profile.streets_count).toBeNull();
    expect(profile.sources).toEqual([]);
  });

  it("siège exact FINMA : seulement les IDE dont le siège (fichier combiné) est dans CE canton, jamais la colonne canton du registre FINMA", () => {
    const finma = [
      finmaRow({ uid: "CHE-100.000.000", city: "Genève", canton: "GE" }), // ville/canton FINMA = GE, mais siège réel = ZH (ci-dessous)
      finmaRow({ uid: "CHE-100.000.001", city: "Winterthur", canton: "ZH", licence_type: "Insurance" }),
    ];
    const byUid = new Map([["CHE-100.000.000", "230"], ["CHE-100.000.001", "6621"]]); // sièges réels : 230=ZH, 6621=GE
    const profile = cantonProfile("ZH", deps({
      getLocalities: () => ({ rows: [WINTERTHUR, GENEVE], edition: null }),
      getStreets: () => null,
      getFinmaRegistry: () => finma,
      getFinmaSeats: seats(byUid),
      getBfePv: () => null,
    }));
    // CHE-100.000.000 a son SIÈGE à Winterthur (230, ZH) malgré sa ville FINMA "Genève" : compté ici.
    expect(profile.finma.entities_with_seat_in_canton).toBe(1);
    expect(profile.finma.distinct_entities_with_seat_in_canton).toBe(1);
    expect(profile.finma.by_licence_type).toEqual({ Bank: 1 });
    expect(profile.finma.seat_matching).toBe(FINMA_SEAT_MATCHING_RULE);
    expect(profile.sources).toContain("ofrc.zefix_lindas");
    expect(profile.sources).toContain("finma.uid_csv");
  });

  it("plusieurs autorisations du même IDE : comptées chacune, une seule fois dans distinct_", () => {
    const finma = [
      finmaRow({ uid: "CHE-100.000.000", licence_type: "Bank" }),
      finmaRow({ uid: "CHE-100.000.000", licence_type: "Insurance" }),
    ];
    const byUid = new Map([["CHE-100.000.000", "230"]]);
    const profile = cantonProfile("ZH", deps({
      getLocalities: () => ({ rows: [WINTERTHUR], edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaSeats: seats(byUid), getBfePv: () => null,
    }));
    expect(profile.finma.entities_with_seat_in_canton).toBe(2);
    expect(profile.finma.distinct_entities_with_seat_in_canton).toBe(1);
  });

  it("registre FINMA indisponible (lance une exception) alors que le fichier des sièges est disponible : les deux compteurs restent null, jamais 0", () => {
    const byUid = new Map([["CHE-100.000.000", "230"]]);
    const profile = cantonProfile("ZH", deps({
      getLocalities: () => ({ rows: [WINTERTHUR], edition: null }),
      getStreets: () => null,
      getFinmaRegistry: () => { throw new Error("registre FINMA indisponible (test)"); },
      getFinmaSeats: seats(byUid),
      getBfePv: () => null,
    }));
    expect(profile.finma.entities_with_seat_in_canton).toBeNull();
    expect(profile.finma.distinct_entities_with_seat_in_canton).toBeNull();
    expect(profile.finma.by_licence_type).toEqual({});
    expect(profile.sources).toContain("ofrc.zefix_lindas"); // fichier des sièges lu malgré tout
    expect(profile.sources).not.toContain("finma.uid_csv"); // jamais cité : jamais lu avec succès
  });

  it("editions.finma reflète la version FINMA injectée (tâche B5, point 4 de la relecture du 07.10.2026)", () => {
    const profile = cantonProfile("ZH", deps({
      getLocalities: () => null, getStreets: () => null, getFinmaRegistry: () => [], getFinmaVersion: () => "2026-10-05", getFinmaSeats: () => null, getBfePv: () => null,
    }));
    expect(profile.editions.finma).toBe("2026-10-05");
  });

  it("siège dont le numéro OFS n'apparaît dans aucun répertoire : jamais rattaché par approximation", () => {
    const finma = [finmaRow({ uid: "CHE-100.000.000" })];
    const byUid = new Map([["CHE-100.000.000", "999999"]]); // numéro OFS inconnu des deux répertoires
    const profile = cantonProfile("ZH", deps({
      getLocalities: () => ({ rows: [WINTERTHUR], edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaSeats: seats(byUid), getBfePv: () => null,
    }));
    expect(profile.finma.entities_with_seat_in_canton).toBe(0);
  });

  it("série OFEN par année : recopiée, ratios et portée décrits tels quels", () => {
    const rows = [bfeRow({ year: "2020", canton: "ZH", installations_count: "42" }), bfeRow({ year: "2021", canton: "ZH", installations_count: "50" })];
    const profile = cantonProfile("ZH", deps({
      getLocalities: () => null, getStreets: () => null, getFinmaRegistry: () => [], getFinmaSeats: () => null,
      getBfePv: () => ({ rows, edition: "2026-10-07" }),
    }));
    expect(profile.pv?.by_year.map((r) => r.installations_count)).toEqual([42, 50]);
    expect(profile.pv?.ratios_note).toBe(PV_RATIOS_NOTE);
    expect(profile.pv?.scope_note).toBe(PV_SCOPE_NOTE);
    expect(profile.editions.bfe_pv).toBe("2026-10-07");
    expect(profile.sources).toContain("bfe.pv_one_time_remuneration");
  });

  it("aucune note, aucun classement : les notices sont des phrases factuelles, jamais un score", () => {
    const profile = cantonProfile("ZH", deps({
      getLocalities: () => null, getStreets: () => null, getFinmaRegistry: () => [], getFinmaSeats: () => null, getBfePv: () => null,
    }));
    const banned = ["score", "rank", "best", "worst"];
    const lower = profile.notice.toLowerCase();
    for (const word of banned) expect(lower).not.toContain(word);
  });

  it("abréviation normalisée (casse, espaces)", () => {
    const profile = cantonProfile(" zh ", deps({
      getLocalities: () => null, getStreets: () => null, getFinmaRegistry: () => [], getFinmaSeats: () => null, getBfePv: () => null,
    }));
    expect(profile.abbreviation).toBe("ZH");
  });
});

describe("cantonProfile : chemin de PRODUCTION (sans dépendance)", () => {
  it("cantonProfile(\"ZH\") : champs de forme correcte, sans fixer de valeur exacte", () => {
    const profile = cantonProfile("ZH");
    expect(profile.abbreviation).toBe("ZH");
    expect(typeof profile.communes_count).toBe("number");
    expect(typeof profile.localities_count).toBe("number");
    expect(typeof profile.streets_count).toBe("number");
    expect(Array.isArray(profile.sources)).toBe(true);
    expect(profile.sources).toContain("swisstopo.localities");
    expect(profile.sources).toContain("bfe.pv_one_time_remuneration");
    // Siège exact FINMA (tâche B4) : jamais mocké ici, donc le fichier combiné réel doit être
    // lu — leçon de la relecture du 07.10.2026 (B4, point 3) : sans ce contrôle, un câblage
    // cassé qui renverrait `null` passerait inaperçu.
    expect(typeof profile.finma.entities_with_seat_in_canton).toBe("number");
    expect(typeof profile.finma.distinct_entities_with_seat_in_canton).toBe("number");
    expect(profile.sources).toContain("ofrc.zefix_lindas");
    expect(typeof profile.editions.finma_seats).toBe("string");
    expect(profile.editions.finma).toBe(getFinmaVersion()); // version FINMA réellement servie, jamais figée
    expect(Array.isArray(profile.pv?.by_year)).toBe(true);
    expect(profile.pv?.by_year.length).toBeGreaterThan(0);
    for (const row of profile.pv?.by_year ?? []) {
      expect(typeof row.year).toBe("number");
    }
    expect(typeof profile.editions.bfe_pv).toBe("string");
    expect(profile.notice.length).toBeGreaterThan(0);
  });
});
