/**
 * `getFinmaSeats()` (tâche osd.donnees, tâche B4 du plan `2026-10-06-prospection-et-api.md`) :
 * siège exact FINMA × registre du commerce, personnes morales seulement.
 *
 * Même méthode que `tests/mcp/data-loader-streets.test.ts` : les cas limites passent par les
 * fonctions pures `indexFinmaSeats`/`parseFinmaSeatsEdition`, aucun test n'écrit dans le dépôt.
 * Le fichier réel embarqué (`finma_seats.csv`) n'est testé qu'au travers de `getFinmaSeats()`
 * directement, SANS fixer son nombre de lignes exact (la collecte mensuelle le change).
 */
import { readFileSync, existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetDataLoaderCache,
  getFinmaSeats,
  indexFinmaSeats,
  parseFinmaSeatsEdition,
} from "../../src/mcp/data-loader.js";

afterEach(() => {
  _resetDataLoaderCache();
});

describe("getFinmaSeats() : fichier réel embarqué", () => {
  it("se charge, indexé par IDE, avec l'édition lue dans finma_seats.meta.json (quand le fichier existe déjà)", () => {
    const dataPath = new URL("../../src/mcp/data/finma_seats.csv", import.meta.url);
    if (!existsSync(dataPath)) return; // produit par `npm run sync:finma-seats`, pas encore présent dans ce test isolé
    const loaded = getFinmaSeats();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.byUid.size).toBeGreaterThan(0);
    // AXA Leben AG (CHE-103.137.179) → commune de Winterthur (230), vérifié en direct le 06.10.2026
    // (voir `src/mcp/company/lindas.ts`) ; décision de Claude-Alain du 06.10.2026 (tâche B4).
    expect(loaded.byUid.get("CHE-103.137.179")).toBe("230");
    const meta = JSON.parse(readFileSync(new URL("../../src/mcp/data/finma_seats.meta.json", import.meta.url), "utf8")) as { edition: string };
    expect(meta.edition).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(loaded.edition).toBe(meta.edition);
  });
});

describe("indexFinmaSeats : fichier sans ligne = absent", () => {
  it("aucune ligne : null, jamais un index vide", () => {
    expect(indexFinmaSeats([])).toBeNull();
  });
  it("index par IDE canonique", () => {
    const index = indexFinmaSeats([
      { uid: "CHE-100.000.000", municipality_bfs_id: "230" },
      { uid: "CHE-200.000.000", municipality_bfs_id: "6621" },
    ]);
    expect(index?.get("CHE-100.000.000")).toBe("230");
    expect(index?.get("CHE-200.000.000")).toBe("6621");
    expect(index?.size).toBe(2);
  });
  it("lignes à IDE ou numéro OFS vide : ignorées, jamais une entrée vide", () => {
    const index = indexFinmaSeats([{ uid: "", municipality_bfs_id: "230" }, { uid: "CHE-100.000.000", municipality_bfs_id: "" }]);
    expect(index).toBeNull();
  });
});

describe("parseFinmaSeatsEdition : édition affichée seulement si la fiche est saine et cohérente", () => {
  it("fiche saine et même nombre de lignes : édition rendue", () => {
    expect(parseFinmaSeatsEdition(JSON.stringify({ edition: "2026-10-07", rows: 1100 }), 1100)).toBe("2026-10-07");
  });
  it("JSON illisible : null, jamais une exception", () => {
    expect(parseFinmaSeatsEdition("{ ceci n'est pas du JSON valide", 1100)).toBeNull();
  });
  it("édition mal formée : null, jamais une date devinée", () => {
    expect(parseFinmaSeatsEdition(JSON.stringify({ edition: "07.10.2026", rows: 1100 }), 1100)).toBeNull();
  });
  it("nombre de lignes différent du fichier chargé : null", () => {
    expect(parseFinmaSeatsEdition(JSON.stringify({ edition: "2026-10-07", rows: 1101 }), 1100)).toBeNull();
  });
});
