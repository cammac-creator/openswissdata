/**
 * `getFinmaSeats()` (tâche osd.donnees, tâche B4 du plan `2026-10-06-prospection-et-api.md`) :
 * siège exact FINMA × registre du commerce, personnes morales seulement.
 *
 * Même méthode que `tests/mcp/data-loader-streets.test.ts` : les cas limites passent par les
 * fonctions pures `indexFinmaSeats`/`parseFinmaSeatsEdition`, aucun test n'écrit dans le dépôt.
 *
 * Correction du 07.10.2026 (relecture de Claude-Alain) : le test du fichier réel embarqué
 * n'ignore PLUS silencieusement une absence (`existsSync` retiré — un fichier absent fait
 * échouer ce test, comme pour `tests/mcp/data-loader-streets.test.ts`) et ne fige PLUS « AXA →
 * 230 » (ce fichier est rejoué chaque mois par `refresh-finma-seats.yml` avant tout commit : une
 * valeur exacte s'y casserait à la première collecte réelle suivante). Contrôles de forme
 * seulement : au moins 800 lignes (même seuil que `scripts/sync-finma-seats.ts`), IDE au format
 * canonique `CHE-xxx.xxx.xxx`, numéro OFS entier, aucun doublon d'IDE.
 */
import { readFileSync } from "node:fs";
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

const CANONICAL_UID_RE = /^CHE-\d{3}\.\d{3}\.\d{3}$/;
const BFS_ID_RE = /^\d+$/;

describe("getFinmaSeats() : fichier réel embarqué", () => {
  it("se charge, indexé par IDE, avec l'édition lue dans finma_seats.meta.json — contrôles de forme seulement, aucune valeur figée", () => {
    const loaded = getFinmaSeats();
    expect(loaded).not.toBeNull(); // produit par `npm run sync:finma-seats` : doit exister dans cette copie
    if (!loaded) return;
    expect(loaded.byUid.size).toBeGreaterThanOrEqual(800); // même seuil que DEFAULT_MIN_ROWS du script
    const uids = [...loaded.byUid.keys()];
    expect(new Set(uids).size).toBe(uids.length); // aucun doublon d'IDE (`Map` le garantit déjà, contrôle explicite)
    for (const uid of uids) expect(uid).toMatch(CANONICAL_UID_RE);
    for (const bfsId of loaded.byUid.values()) expect(bfsId).toMatch(BFS_ID_RE);
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
