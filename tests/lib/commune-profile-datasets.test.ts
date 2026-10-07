/**
 * Section `datasets` de `communeProfile()` (tâche osd.jeux, piste G2 du plan
 * `2026-10-07-moteur-jeux-ouverts.md`).
 *
 * Fichier NEUF, à côté de `tests/lib/commune-profile.test.ts` (déjà présent sur `origin/main`,
 * jamais modifié) : `getDatasetsIndex`/`getDataset` fabriqués en mémoire. Un cas de PRODUCTION
 * réelle à la fin : forme seulement.
 */
import { describe, expect, it } from "vitest";
import { communeProfile, type CommuneProfileDeps } from "../../src/lib/commune-profile.js";
import type { DatasetIndexEntry } from "../../src/mcp/data-loader.js";

function datasetEntry(partial: Partial<DatasetIndexEntry>): DatasetIndexEntry {
  return {
    id: "jeu-x", title: "Jeu X", publisher: "Éditeur", licence: "terms_open", attribution: "",
    resource_url: "https://example.ch/x.csv", columns: [], keys: [], rows: 0, edition: "2026-10-07",
    ...partial,
  };
}

function minimalDeps(overrides: Partial<CommuneProfileDeps> = {}): Partial<CommuneProfileDeps> {
  return {
    getLocalities: () => ({ rows: [], edition: null }),
    getStreets: () => null,
    getFinmaRegistry: () => [],
    getFinmaVersion: () => null,
    getFinmaSeats: () => null,
    getDatasetsIndex: () => null,
    getDataset: () => null,
    ...overrides,
  };
}

describe("communeProfile().datasets", () => {
  it("catalogue absent : tableau vide (jamais null)", () => {
    const profile = communeProfile("230", minimalDeps());
    expect(profile.datasets).toEqual([]);
  });

  it("jeu à clé commune_bfs : compte par numéro OFS exact", () => {
    const profile = communeProfile(
      "230",
      minimalDeps({
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-commune", keys: ["commune_bfs", "year"] })] }),
        getDataset: (id) => (id === "jeu-commune" ? { rows: [{ commune_bfs: "230" }, { commune_bfs: "230" }, { commune_bfs: "999" }] } : null),
      }),
    );
    expect(profile.datasets).toEqual([{ id: "jeu-commune", rows: 2 }]);
  });

  it("jeu à clé canton (jamais utilisable pour une commune) : absent du tableau", () => {
    const profile = communeProfile(
      "230",
      minimalDeps({
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-canton", keys: ["canton"] })] }),
        getDataset: () => ({ rows: [{ canton: "ZH" }] }),
      }),
    );
    expect(profile.datasets).toEqual([]);
  });

  it("aucune ligne pour cette commune : jeu absent du tableau", () => {
    const profile = communeProfile(
      "230",
      minimalDeps({
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-commune", keys: ["commune_bfs"] })] }),
        getDataset: () => ({ rows: [{ commune_bfs: "999" }] }),
      }),
    );
    expect(profile.datasets).toEqual([]);
  });

  it("n'ajoute jamais d'entrée à sources ni à editions", () => {
    const profile = communeProfile(
      "230",
      minimalDeps({
        getLocalities: () => null,
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-commune", keys: ["commune_bfs"] })] }),
        getDataset: () => ({ rows: [{ commune_bfs: "230" }] }),
      }),
    );
    expect(profile.sources).toEqual(["finma.uid_csv", "gleif.lei_api"]);
    expect(profile.editions).toEqual({ localities: null, streets: null, finma: null });
  });

  it("production réelle : forme correcte, jamais une valeur figée", () => {
    // Winterthur n'a pas de ligne dans le jeu de démonstration (communes grisonnes) : tableau
    // vide, mais jamais une exception ni une entrée inventée.
    const profile = communeProfile("230");
    expect(Array.isArray(profile.datasets)).toBe(true);
    for (const d of profile.datasets) {
      expect(typeof d.id).toBe("string");
      expect(d.rows).toBeGreaterThan(0);
    }
  });

  it("production réelle, une commune grisonne réellement présente dans le jeu de démonstration", () => {
    // 3542 = Albula/Alvra (Grisons), vue dans l'échantillon réel du 07.10.2026 (README de ce test).
    const profile = communeProfile("3542");
    const demo = profile.datasets.find((d) => d.id === "gr-finances-communes");
    expect(demo).toBeDefined();
    expect(demo?.rows).toBeGreaterThan(0);
  });
});
