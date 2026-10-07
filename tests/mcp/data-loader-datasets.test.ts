/**
 * `getDatasetsIndex()`/`getDataset()` (tâche osd.jeux, piste G1/G2 du plan
 * `2026-10-07-moteur-jeux-ouverts.md`) : catalogue et contenu des jeux ouverts produits par
 * `scripts/sync-datasets.ts` (`src/mcp/data/datasets/index.json` + `<id>.csv.gz`).
 *
 * Relecture adverse du 07.10.2026 (avant le lot de 36 jeux) : le cas « fichier réel embarqué »
 * ne fixe plus AUCUN id ni compteur précis (le catalogue réel change de forme à chaque lot
 * d'approbations) — forme seulement, sur n'importe quel contenu actuel. Les cas détaillés
 * (plusieurs jeux, cache LRU borné) utilisent `_setDatasetsDirForTest()` : un dossier TEMPORAIRE
 * fabriqué en test, jamais le vrai dossier `src/mcp/data/datasets` — toujours nettoyé en
 * `afterEach` (retour à `null` + `_resetDataLoaderCache()`), jamais un mélange entre le contenu
 * réel du dépôt et un dossier de test.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  _datasetRowsCacheKeys,
  _datasetRowsCacheSize,
  _resetDataLoaderCache,
  _setDatasetsDirForTest,
  getDataset,
  getDatasetsIndex,
  type DatasetIndexEntry,
} from "../../src/mcp/data-loader.js";

describe("getDatasetsIndex()/getDataset() : fichier réel embarqué", () => {
  it("le catalogue se charge (au moins un jeu approuvé) ; forme correcte seulement, jamais un id ou un compteur figés", () => {
    const index = getDatasetsIndex();
    expect(index).not.toBeNull();
    if (!index) return;
    expect(index.datasets.length).toBeGreaterThanOrEqual(1);
    for (const d of index.datasets) {
      expect(typeof d.id).toBe("string");
      expect(d.id.length).toBeGreaterThan(0);
      expect(typeof d.title).toBe("string");
      expect(typeof d.publisher).toBe("string");
      expect(["terms_open", "terms_by", "cc0", "cc-by"]).toContain(d.licence);
      expect(Array.isArray(d.keys)).toBe(true);
      expect(d.rows).toBeGreaterThan(0);
      expect(d.edition).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const loaded = getDataset(d.id);
      expect(loaded).not.toBeNull();
      if (!loaded) continue;
      expect(loaded.rows.length).toBe(d.rows);
      expect(Object.keys(loaded.rows[0]).sort()).toEqual([...d.columns].sort());
      for (const key of d.keys) {
        if (key === "commune_bfs") for (const row of loaded.rows.slice(0, 20)) expect(row.commune_bfs).toMatch(/^\d+$/);
        if (key === "year") for (const row of loaded.rows.slice(0, 20)) expect(row.year).toMatch(/^\d{4}$/);
      }
    }
  });

  it("getDataset(\"id-inconnu\") : null", () => {
    expect(getDataset("id-inconnu-du-tout-x7q9")).toBeNull();
  });

  it("getDataset() ne lève jamais pour un id vide ou malformé (jamais de construction de chemin sans validation)", () => {
    expect(getDataset("")).toBeNull();
    expect(getDataset("../../../etc/passwd")).toBeNull();
    expect(getDataset("Majuscule-Interdite")).toBeNull();
  });
});

// --------------------------------------------------------------------------------------------
// Dossier de test fabriqué : plusieurs jeux, pour exercer le catalogue à plusieurs entrées et le
// cache LRU borné sans dépendre du contenu réel du dépôt.
// --------------------------------------------------------------------------------------------
function fakeEntry(partial: Partial<DatasetIndexEntry>): DatasetIndexEntry {
  return {
    id: "jeu-x", title: "Jeu de test", publisher: "Éditeur de test", licence: "terms_open", attribution: "",
    resource_url: "https://example.ch/x.csv", columns: ["year", "commune_bfs"], keys: ["commune_bfs", "year"], rows: 2, edition: "2026-10-07",
    ...partial,
  };
}

function writeFakeDataset(dir: string, entry: DatasetIndexEntry, csv: string): void {
  writeFileSync(join(dir, `${entry.id}.csv.gz`), gzipSync(Buffer.from(csv, "utf8")));
}

function writeFakeIndex(dir: string, entries: DatasetIndexEntry[]): void {
  writeFileSync(join(dir, "index.json"), JSON.stringify({ datasets: entries }, null, 2));
}

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "osd-data-loader-datasets-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  _setDatasetsDirForTest(null);
  _resetDataLoaderCache();
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("getDatasetsIndex()/getDataset() : dossier fabriqué, plusieurs jeux", () => {
  it("getDatasetsIndex() lit le dossier injecté, jamais le vrai dépôt", () => {
    const dir = tmpDir();
    writeFakeIndex(dir, [fakeEntry({ id: "jeu-un" }), fakeEntry({ id: "jeu-deux" })]);
    _setDatasetsDirForTest(dir);
    _resetDataLoaderCache();

    const index = getDatasetsIndex();
    expect(index?.datasets.map((d) => d.id).sort()).toEqual(["jeu-deux", "jeu-un"]);
  });

  it("getDataset() lit les lignes du jeu fabriqué, jamais le vrai dépôt", () => {
    const dir = tmpDir();
    const entry = fakeEntry({ id: "jeu-un" });
    writeFakeIndex(dir, [entry]);
    writeFakeDataset(dir, entry, "year,commune_bfs\n2024,230\n2024,231\n");
    _setDatasetsDirForTest(dir);
    _resetDataLoaderCache();

    const loaded = getDataset("jeu-un");
    expect(loaded?.rows).toEqual([{ year: "2024", commune_bfs: "230" }, { year: "2024", commune_bfs: "231" }]);
  });

  it("index.json absent : null, jamais une exception", () => {
    const dir = tmpDir();
    _setDatasetsDirForTest(dir);
    _resetDataLoaderCache();
    expect(getDatasetsIndex()).toBeNull();
    expect(getDataset("jeu-un")).toBeNull();
  });

  it(".csv.gz absent pour un id pourtant au catalogue : null, jamais une exception", () => {
    const dir = tmpDir();
    writeFakeIndex(dir, [fakeEntry({ id: "jeu-sans-fichier" })]);
    _setDatasetsDirForTest(dir);
    _resetDataLoaderCache();
    expect(getDataset("jeu-sans-fichier")).toBeNull();
  });
});

describe("getDataset() : cache LRU borné (relecture adverse du 07.10.2026, avant le lot de 36 jeux)", () => {
  function setUpSixDatasets(): string {
    const dir = tmpDir();
    const ids = ["jeu-1", "jeu-2", "jeu-3", "jeu-4", "jeu-5", "jeu-6"];
    const entries = ids.map((id) => fakeEntry({ id }));
    writeFakeIndex(dir, entries);
    for (const entry of entries) writeFakeDataset(dir, entry, "year,commune_bfs\n2024,230\n");
    _setDatasetsDirForTest(dir);
    _resetDataLoaderCache();
    return dir;
  }

  it("au plus 5 jeux gardés en mémoire en même temps", () => {
    setUpSixDatasets();
    for (const id of ["jeu-1", "jeu-2", "jeu-3", "jeu-4", "jeu-5", "jeu-6"]) {
      expect(getDataset(id)).not.toBeNull();
    }
    expect(_datasetRowsCacheSize()).toBe(5);
  });

  it("évince le jeu le MOINS récemment utilisé, jamais un autre", () => {
    setUpSixDatasets();
    for (const id of ["jeu-1", "jeu-2", "jeu-3", "jeu-4", "jeu-5"]) getDataset(id);
    expect(_datasetRowsCacheKeys()).toEqual(["jeu-1", "jeu-2", "jeu-3", "jeu-4", "jeu-5"]);

    getDataset("jeu-6"); // 6e jeu : évince le plus ancien (jeu-1)
    expect(_datasetRowsCacheKeys()).toEqual(["jeu-2", "jeu-3", "jeu-4", "jeu-5", "jeu-6"]);
    expect(_datasetRowsCacheSize()).toBe(5);
  });

  it("un accès à un jeu déjà en cache le replace en position « la plus récente » (ne l'évince pas en premier)", () => {
    setUpSixDatasets();
    for (const id of ["jeu-1", "jeu-2", "jeu-3", "jeu-4", "jeu-5"]) getDataset(id);

    getDataset("jeu-1"); // ré-accédé : repasse en fin de file LRU
    expect(_datasetRowsCacheKeys()).toEqual(["jeu-2", "jeu-3", "jeu-4", "jeu-5", "jeu-1"]);

    getDataset("jeu-6"); // évince jeu-2 (maintenant le plus ancien), PAS jeu-1
    expect(_datasetRowsCacheKeys()).toEqual(["jeu-3", "jeu-4", "jeu-5", "jeu-1", "jeu-6"]);
  });
});
