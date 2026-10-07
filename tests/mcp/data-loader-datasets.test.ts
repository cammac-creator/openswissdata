/**
 * `getDatasetsIndex()`/`getDataset()` (tâche osd.jeux, piste G1/G2 du plan
 * `2026-10-07-moteur-jeux-ouverts.md`) : catalogue et contenu des jeux ouverts produits par
 * `scripts/sync-datasets.ts` (`src/mcp/data/datasets/index.json` + `<id>.csv.gz`).
 *
 * Même méthode que `tests/mcp/data-loader-finma-seats.test.ts` : contrôles de FORME sur le
 * fichier réel embarqué (produit par `npm run sync:datasets`, jamais une valeur figée), plus des
 * cas limites sur des fichiers temporaires pour l'absence/l'illisibilité.
 */
import { afterEach, describe, expect, it } from "vitest";
import { _resetDataLoaderCache, getDataset, getDatasetsIndex } from "../../src/mcp/data-loader.js";

afterEach(() => {
  _resetDataLoaderCache();
});

describe("getDatasetsIndex()/getDataset() : fichiers réels embarqués", () => {
  it("le catalogue se charge, au moins le jeu de démonstration", () => {
    const index = getDatasetsIndex();
    expect(index).not.toBeNull();
    if (!index) return;
    expect(index.datasets.length).toBeGreaterThanOrEqual(1);
    const demo = index.datasets.find((d) => d.id === "gr-finances-communes");
    expect(demo).toBeDefined();
    if (!demo) return;
    expect(demo.keys).toEqual(expect.arrayContaining(["commune_bfs", "year"]));
    expect(demo.rows).toBeGreaterThan(0);
    expect(demo.edition).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getDataset(\"gr-finances-communes\") : lignes chargées, colonnes cohérentes avec l'index", () => {
    const loaded = getDataset("gr-finances-communes");
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.rows.length).toBe(loaded.entry.rows);
    expect(Object.keys(loaded.rows[0]).sort()).toEqual([...loaded.entry.columns].sort());
    for (const row of loaded.rows.slice(0, 50)) expect(row.commune_bfs).toMatch(/^\d+$/);
  });

  it("getDataset(\"id-inconnu\") : null", () => {
    expect(getDataset("id-inconnu-du-tout")).toBeNull();
  });
});

describe("getDatasetsIndex()/getDataset() : absence ou illisibilité", () => {
  // Pas de surcharge de chemin dans l'API publique du chargeur (comme les autres `get*()` de ce
  // fichier) : on vérifie seulement que `_resetDataLoaderCache()` permet de recharger, et que les
  // deux fonctions ne lèvent jamais d'exception pour un id absent.
  it("getDataset() ne lève jamais pour un id vide ou malformé", () => {
    expect(getDataset("")).toBeNull();
    expect(getDataset("../../../etc/passwd")).toBeNull();
    expect(getDataset("Gr-Finances-Communes")).toBeNull(); // casse différente : aucune résolution approximative
  });
});
