/**
 * Section `datasets` de `communeProfile()` (tâche osd.jeux, piste G2 du plan
 * `2026-10-07-moteur-jeux-ouverts.md`).
 *
 * Fichier NEUF, à côté de `tests/lib/commune-profile.test.ts` (déjà présent sur `origin/main`,
 * jamais modifié) : `getDatasetsIndex` fabriqué en mémoire. Relecture adverse du 07.10.2026
 * (avant le lot de 36 jeux) : `communeProfile()` lit SEULEMENT `by_commune_bfs` PRÉCALCULÉ
 * (jamais un fichier de jeu) — ces tests fabriquent directement ce compteur, jamais des lignes
 * brutes. Le cas de PRODUCTION réelle ne fixe ni id ni commune précise (le catalogue réel change
 * de forme à chaque lot d'approbations) : forme seulement.
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
    ...overrides,
  };
}

describe("communeProfile().datasets", () => {
  it("catalogue absent : tableau vide (jamais null)", () => {
    const profile = communeProfile("230", minimalDeps());
    expect(profile.datasets).toEqual([]);
  });

  it("jeu à clé commune_bfs (by_commune_bfs précalculé) : compte par numéro OFS exact", () => {
    const profile = communeProfile(
      "230",
      minimalDeps({
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-commune", keys: ["commune_bfs", "year"], by_commune_bfs: { "230": 2, "999": 1 } })] }),
      }),
    );
    expect(profile.datasets).toEqual([{ id: "jeu-commune", rows: 2 }]);
  });

  it("jeu à clé canton (jamais utilisable pour une commune) : absent du tableau", () => {
    const profile = communeProfile(
      "230",
      minimalDeps({
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-canton", keys: ["canton"], by_canton: { ZH: 1 } })] }),
      }),
    );
    expect(profile.datasets).toEqual([]);
  });

  it("aucune ligne pour cette commune : jeu absent du tableau", () => {
    const profile = communeProfile(
      "230",
      minimalDeps({
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-commune", keys: ["commune_bfs"], by_commune_bfs: { "999": 1 } })] }),
      }),
    );
    expect(profile.datasets).toEqual([]);
  });

  it("n'ajoute jamais d'entrée à sources ni à editions", () => {
    const profile = communeProfile(
      "230",
      minimalDeps({
        getLocalities: () => null,
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-commune", keys: ["commune_bfs"], by_commune_bfs: { "230": 1 } })] }),
      }),
    );
    expect(profile.sources).toEqual(["finma.uid_csv", "gleif.lei_api"]);
    expect(profile.editions).toEqual({ localities: null, streets: null, finma: null });
  });

  it("production réelle : forme correcte seulement, jamais un id ou une commune figés (le catalogue réel change de forme à chaque lot d'approbations)", () => {
    // 230 (Winterthur) choisi seulement parce qu'une commune doit être passée ; aucune
    // hypothèse sur la présence ou l'absence de lignes pour elle dans le catalogue actuel.
    const profile = communeProfile("230");
    expect(Array.isArray(profile.datasets)).toBe(true);
    for (const d of profile.datasets) {
      expect(typeof d.id).toBe("string");
      expect(d.id.length).toBeGreaterThan(0);
      expect(Number.isInteger(d.rows)).toBe(true);
      expect(d.rows).toBeGreaterThan(0);
    }
  });
});
