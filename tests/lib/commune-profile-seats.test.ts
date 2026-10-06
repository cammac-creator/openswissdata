/**
 * Siège exact FINMA × registre du commerce dans le profil de commune (tâche osd.donnees, tâche
 * B4 du plan `2026-10-06-prospection-et-api.md`).
 *
 * Fichier NEUF, à côté de `tests/lib/commune-profile.test.ts` (fichier déjà présent sur
 * `origin/main`, jamais modifié) : ces cas injectent TOUJOURS `getFinmaSeats` explicitement en
 * plus de `getFinmaRegistry`, pour exercer la fonctionnalité sans dépendre du vrai fichier
 * `finma_seats.csv` ni risquer de changer le comportement des tests déjà présents (voir la garde
 * dans `communeProfile()` : `deps.getFinmaRegistry === undefined`).
 */
import { describe, expect, it } from "vitest";
import { communeProfile, FINMA_SEAT_MATCHING_RULE, type CommuneProfileDeps } from "../../src/lib/commune-profile.js";
import type { FinmaRegistryRow, LocalityRow } from "../../src/mcp/data-loader.js";

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

const WINTERTHUR = locality({ postal_code: "8400", locality: "Winterthur", municipality: "Winterthur", municipality_bfs_id: "230", canton: "ZH" });

function seats(byUid: ReadonlyMap<string, string>, edition: string | null = "2026-10-07") {
  return () => ({ byUid, edition });
}

function deps(overrides: Partial<CommuneProfileDeps> = {}): Partial<CommuneProfileDeps> {
  return overrides;
}

describe("communeProfile : siège exact FINMA × registre du commerce (tâche B4)", () => {
  it("un IDE dont le siège (fichier combiné) est cette commune : compté, source et édition exposées", () => {
    const rows = [WINTERTHUR];
    const finma = [finmaRow({ uid: "CHE-100.000.000", city: "Winterthur", canton: "ZH" })];
    const byUid = new Map([["CHE-100.000.000", "230"]]);
    const profile = communeProfile("230", deps({
      getLocalities: () => ({ rows, edition: null }),
      getStreets: () => null,
      getFinmaRegistry: () => finma,
      getFinmaVersion: () => null,
      getFinmaSeats: seats(byUid),
    }));
    expect(profile.finma.entities_with_seat_in_commune).toBe(1);
    expect(profile.finma.distinct_entities_with_seat_in_commune).toBe(1);
    expect(profile.finma.seat_matching).toBe(FINMA_SEAT_MATCHING_RULE);
    expect(profile.finma.national_seats_known).toBe(1);
    expect(profile.sources).toContain("ofrc.zefix_lindas");
    expect(profile.editions.finma_seats).toBe("2026-10-07");
  });

  it("plusieurs autorisations du même IDE : comptées chacune dans entities_with_seat_in_commune, une seule fois dans distinct_", () => {
    const rows = [WINTERTHUR];
    const finma = [
      finmaRow({ uid: "CHE-100.000.000", city: "Winterthur", canton: "ZH", licence_type: "Bank" }),
      finmaRow({ uid: "CHE-100.000.000", city: "Winterthur", canton: "ZH", licence_type: "Insurance" }),
    ];
    const byUid = new Map([["CHE-100.000.000", "230"]]);
    const profile = communeProfile("230", deps({
      getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null, getFinmaSeats: seats(byUid),
    }));
    expect(profile.finma.entities_with_seat_in_commune).toBe(2);
    expect(profile.finma.distinct_entities_with_seat_in_commune).toBe(1);
  });

  it("le siège (fichier combiné) est une AUTRE commune : non compté ici, même si le nom de ville FINMA coïncide", () => {
    const schlatt = locality({ postal_code: "8405", locality: "Winterthur", municipality: "Schlatt (ZH)", municipality_bfs_id: "226", canton: "ZH" });
    const rows = [WINTERTHUR, schlatt];
    // Ville FINMA "Winterthur" → rattachée par nom à la commune 230 (entities_with_city_named_like_commune),
    // mais le SIÈGE réel (fichier combiné) est la commune 226.
    const finma = [finmaRow({ uid: "CHE-100.000.000", city: "Winterthur", canton: "ZH" })];
    const byUid = new Map([["CHE-100.000.000", "226"]]);
    const winterthur = communeProfile("230", deps({
      getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null, getFinmaSeats: seats(byUid),
    }));
    expect(winterthur.finma.entities_with_city_named_like_commune).toBe(1); // nom de ville : rattachée
    expect(winterthur.finma.entities_with_seat_in_commune).toBe(0); // siège réel : pas ici
    const schlattProfile = communeProfile("226", deps({
      getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null, getFinmaSeats: seats(byUid),
    }));
    expect(schlattProfile.finma.entities_with_city_named_like_commune).toBe(0); // "Winterthur" n'est pas le nom de Schlatt
    expect(schlattProfile.finma.entities_with_seat_in_commune).toBe(1); // mais le siège réel y est
  });

  it("IDE absent du fichier combiné (siège inconnu) : jamais compté nulle part", () => {
    const rows = [WINTERTHUR];
    const finma = [finmaRow({ uid: "CHE-100.000.000", city: "Winterthur", canton: "ZH" })];
    const byUid = new Map<string, string>(); // fichier combiné vide pour cet IDE
    const profile = communeProfile("230", deps({
      getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null, getFinmaSeats: seats(byUid),
    }));
    expect(profile.finma.entities_with_seat_in_commune).toBe(0);
    expect(profile.finma.national_seats_known).toBe(0);
  });

  it("fichier combiné non fourni (ancien appel, comme les tests existants) : champs à null, jamais de clé editions.finma_seats, jamais de source ofrc.zefix_lindas ajoutée pour ce motif", () => {
    const rows = [WINTERTHUR];
    const finma = [finmaRow({ uid: "CHE-100.000.000", city: "Winterthur", canton: "ZH" })];
    const profile = communeProfile("230", deps({
      getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null,
    }));
    expect(profile.finma.entities_with_seat_in_commune).toBeNull();
    expect(profile.finma.distinct_entities_with_seat_in_commune).toBeNull();
    expect(profile.finma.national_seats_known).toBeNull();
    expect(profile.finma.seat_matching).toBe(FINMA_SEAT_MATCHING_RULE); // la règle reste décrite même sans donnée
    expect(profile.editions).toEqual({ localities: null, streets: null, finma: null }); // jamais une 4e clé
    expect("finma_seats" in profile.editions).toBe(false);
    expect(profile.sources).not.toContain("ofrc.zefix_lindas");
  });

  it("fichier combiné explicitement indisponible (getFinmaSeats rend null) : mêmes garanties que ci-dessus", () => {
    const rows = [WINTERTHUR];
    const finma = [finmaRow({ uid: "CHE-100.000.000", city: "Winterthur", canton: "ZH" })];
    const profile = communeProfile("230", deps({
      getLocalities: () => ({ rows, edition: null }), getStreets: () => null, getFinmaRegistry: () => finma, getFinmaVersion: () => null, getFinmaSeats: () => null,
    }));
    expect(profile.finma.entities_with_seat_in_commune).toBeNull();
    expect(profile.sources).not.toContain("ofrc.zefix_lindas");
    expect("finma_seats" in profile.editions).toBe(false);
  });

  it("aucune note, aucun classement : seat_matching est une phrase factuelle, jamais un score", () => {
    const profile = communeProfile("230", deps({
      getLocalities: () => ({ rows: [WINTERTHUR], edition: null }), getStreets: () => null, getFinmaRegistry: () => [], getFinmaVersion: () => null, getFinmaSeats: seats(new Map()),
    }));
    const banned = ["score", "rank", "best", "worst"];
    const lower = profile.finma.seat_matching.toLowerCase();
    for (const word of banned) expect(lower).not.toContain(word);
  });
});

describe("communeProfile : chemin de PRODUCTION (tâche B4, point 3 de la relecture du 07.10.2026)", () => {
  it("communeProfile(\"230\") SANS dépendance : les trois champs de siège sont des nombres (fichier combiné réel câblé), sans fixer de valeur exacte", () => {
    // Appel sans deps() : lit le VRAI finma_seats.csv embarqué (même garde que `usingDefaultFinmaRegistry`
    // dans `src/mcp/company/check.ts`). Si ce fichier est absent, `typeof null !== "number"` fait
    // échouer ce test — jamais un `if (!existsSync) return` silencieux.
    const profile = communeProfile("230");
    expect(typeof profile.finma.entities_with_seat_in_commune).toBe("number");
    expect(typeof profile.finma.distinct_entities_with_seat_in_commune).toBe("number");
    expect(typeof profile.finma.national_seats_known).toBe("number");
    expect(profile.sources).toContain("ofrc.zefix_lindas");
    expect(typeof profile.editions.finma_seats).toBe("string");
  });
});
