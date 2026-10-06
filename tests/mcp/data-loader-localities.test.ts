/**
 * `getLocalities()` (tâche osd.localites, relecture finale du 06.10.2026, points 4 et 5).
 *
 * `getLocalities()` lit un chemin fixe (`src/mcp/data/localities.csv` et
 * `localities.meta.json`, à côté du module) : pas de point d'injection pour un chemin de
 * test. Les deux tests qui ont besoin d'un contenu différent du fichier RÉELLEMENT
 * embarqué sauvegardent son contenu, écrivent une fixture, restaurent l'original dans un
 * `finally` (même en cas d'échec de l'assertion) et réinitialisent le cache du module avant
 * et après — jamais de fichier du dépôt laissé modifié.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { _resetDataLoaderCache, getLocalities } from "../../src/mcp/data-loader.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "mcp", "data");
const CSV_PATH = join(DATA_DIR, "localities.csv");
const META_PATH = join(DATA_DIR, "localities.meta.json");

afterEach(() => {
  _resetDataLoaderCache();
});

describe("getLocalities() : fichier réel embarqué", () => {
  it("se charge, indexé par NPA, avec l'édition lue dans localities.meta.json", () => {
    const loaded = getLocalities();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.rows.length).toBeGreaterThan(5000);
    expect(loaded.byPostalCode.get("8400")?.some((r) => r.municipality === "Winterthur")).toBe(true);
    expect(loaded.edition).toBe("2026-10-01"); // édition réelle de localities.meta.json
  });
});

describe("getLocalities() : fichier SANS ligne de données = absent (relecture finale, point 5)", () => {
  it("en-tête seul (aucune ligne de données) : null, jamais un répertoire vide", () => {
    const originalCsv = readFileSync(CSV_PATH, "utf8");
    try {
      const header = originalCsv.split("\n")[0] + "\n"; // en-tête seul, aucune ligne de données
      writeFileSync(CSV_PATH, header, "utf8");
      _resetDataLoaderCache();
      expect(getLocalities()).toBeNull();
    } finally {
      writeFileSync(CSV_PATH, originalCsv, "utf8");
      _resetDataLoaderCache();
    }
  });

  it("fichier complètement vide : null", () => {
    const originalCsv = readFileSync(CSV_PATH, "utf8");
    try {
      writeFileSync(CSV_PATH, "", "utf8");
      _resetDataLoaderCache();
      expect(getLocalities()).toBeNull();
    } finally {
      writeFileSync(CSV_PATH, originalCsv, "utf8");
      _resetDataLoaderCache();
    }
  });

  it("après restauration du fichier réel : getLocalities() fonctionne de nouveau normalement", () => {
    // Vérifie que les deux tests ci-dessus ont bien restauré le fichier (pas de pollution
    // entre tests ni de fichier du dépôt laissé modifié).
    const loaded = getLocalities();
    expect(loaded).not.toBeNull();
    expect(loaded?.rows.length).toBeGreaterThan(5000);
  });
});

describe("getLocalities() : localities.meta.json absent ou illisible → edition null, jamais une exception (relecture finale, point 4)", () => {
  it("meta.json absent : rows chargées normalement, edition null", () => {
    const originalMeta = readFileSync(META_PATH, "utf8");
    try {
      writeFileSync(META_PATH, "{ ceci n'est pas du JSON valide", "utf8"); // simule un fichier illisible
      _resetDataLoaderCache();
      const loaded = getLocalities();
      expect(loaded).not.toBeNull();
      expect(loaded?.edition).toBeNull();
      expect(loaded?.rows.length).toBeGreaterThan(5000); // le CSV reste lisible indépendamment
    } finally {
      writeFileSync(META_PATH, originalMeta, "utf8");
      _resetDataLoaderCache();
    }
  });

  it("meta.json avec une édition mal formée (pas AAAA-MM-JJ) : edition null, jamais une date devinée", () => {
    const originalMeta = readFileSync(META_PATH, "utf8");
    try {
      writeFileSync(META_PATH, JSON.stringify({ edition: "01.10.2026", source: "x", rows: 1 }), "utf8");
      _resetDataLoaderCache();
      expect(getLocalities()?.edition).toBeNull();
    } finally {
      writeFileSync(META_PATH, originalMeta, "utf8");
      _resetDataLoaderCache();
    }
  });
});
