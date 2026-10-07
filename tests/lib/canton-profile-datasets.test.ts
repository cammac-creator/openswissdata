/**
 * Section `datasets` de `cantonProfile()` (tâche osd.jeux, piste G2 du plan
 * `2026-10-07-moteur-jeux-ouverts.md`).
 *
 * Fichier NEUF, à côté de `tests/lib/canton-profile.test.ts` (déjà présent sur `origin/main`,
 * jamais modifié) : mêmes dépendances injectées (localités, rues), plus `getDatasetsIndex`/
 * `getDataset` fabriqués en mémoire — jamais le vrai dossier `src/mcp/data/datasets`, pour ne
 * dépendre d'aucun jeu réellement collecté. Un cas de PRODUCTION réelle à la fin : forme
 * seulement (le jeu de démonstration réel est `terms_open`, `commune_bfs`/`year`).
 */
import { describe, expect, it } from "vitest";
import { cantonProfile, type CantonProfileDeps } from "../../src/lib/canton-profile.js";
import type { DatasetIndexEntry, LocalityRow } from "../../src/mcp/data-loader.js";

function locality(partial: Partial<LocalityRow>): LocalityRow {
  return {
    postal_code: "", postal_code_suffix: "00", locality: "", municipality: "", municipality_bfs_id: "",
    canton: "ZH", language: "de", ...partial,
  };
}

function datasetEntry(partial: Partial<DatasetIndexEntry>): DatasetIndexEntry {
  return {
    id: "jeu-x", title: "Jeu X", publisher: "Éditeur", licence: "terms_open", attribution: "",
    resource_url: "https://example.ch/x.csv", columns: [], keys: [], rows: 0, edition: "2026-10-07",
    ...partial,
  };
}

function minimalDeps(overrides: Partial<CantonProfileDeps> = {}): Partial<CantonProfileDeps> {
  return {
    getLocalities: () => ({ rows: [], edition: null }),
    getStreets: () => null,
    getFinmaRegistry: () => [],
    getFinmaVersion: () => null,
    getFinmaSeats: () => null,
    getBfePv: () => null,
    getDatasetsIndex: () => null,
    getDataset: () => null,
    ...overrides,
  };
}

const ZH_COMMUNE = locality({ postal_code: "8400", locality: "Winterthur", municipality: "Winterthur", municipality_bfs_id: "230", canton: "ZH" });

describe("cantonProfile().datasets", () => {
  it("catalogue absent : tableau vide (jamais null)", () => {
    const profile = cantonProfile("ZH", minimalDeps());
    expect(profile.datasets).toEqual([]);
  });

  it("jeu à clé canton : compte direct sur l'abréviation", () => {
    const profile = cantonProfile(
      "ZH",
      minimalDeps({
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-canton", keys: ["canton", "year"] })] }),
        getDataset: (id) => (id === "jeu-canton" ? { rows: [{ canton: "ZH", year: "2024" }, { canton: "ZH", year: "2023" }, { canton: "GR", year: "2024" }] } : null),
      }),
    );
    expect(profile.datasets).toEqual([{ id: "jeu-canton", rows: 2 }]);
  });

  it("jeu à clé commune_bfs : compte les lignes des communes de ce canton", () => {
    const profile = cantonProfile(
      "ZH",
      minimalDeps({
        getLocalities: () => ({ rows: [ZH_COMMUNE], edition: "2026-10-01" }),
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-commune", keys: ["commune_bfs"] })] }),
        getDataset: (id) => (id === "jeu-commune" ? { rows: [{ commune_bfs: "230" }, { commune_bfs: "230" }, { commune_bfs: "999" }] } : null),
      }),
    );
    expect(profile.datasets).toEqual([{ id: "jeu-commune", rows: 2 }]);
  });

  it("aucune ligne pour ce canton : jeu absent du tableau", () => {
    const profile = cantonProfile(
      "VD",
      minimalDeps({
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-canton", keys: ["canton"] })] }),
        getDataset: () => ({ rows: [{ canton: "ZH" }] }),
      }),
    );
    expect(profile.datasets).toEqual([]);
  });

  it("n'ajoute jamais d'entrée à sources ni à editions", () => {
    const profile = cantonProfile(
      "ZH",
      minimalDeps({
        getLocalities: () => ({ rows: [ZH_COMMUNE], edition: "2026-10-01" }),
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-canton", keys: ["canton"] })] }),
        getDataset: () => ({ rows: [{ canton: "ZH" }] }),
      }),
    );
    expect(profile.sources).toEqual(["swisstopo.localities"]);
    expect(profile.editions).toEqual({ localities: "2026-10-01", streets: null, finma: null, finma_seats: null, bfe_pv: null });
  });

  it("production réelle : forme correcte, jamais une valeur figée", () => {
    const profile = cantonProfile("GR");
    expect(Array.isArray(profile.datasets)).toBe(true);
    for (const d of profile.datasets) {
      expect(typeof d.id).toBe("string");
      expect(d.rows).toBeGreaterThan(0);
    }
    // Le jeu de démonstration réel (`gr-finances-communes`, terms_open, clé commune_bfs) est
    // attendu avec des lignes pour le canton des Grisons.
    const demo = profile.datasets.find((d) => d.id === "gr-finances-communes");
    expect(demo).toBeDefined();
  });
});
