/**
 * `getStreets()` (tâche osd.localites, tâche B1 du plan `2026-10-06-prospection-et-api.md`).
 *
 * Fichier NEUF (relecture du 06.10.2026, point 1) : ces cas vivaient par erreur dans
 * `tests/mcp/data-loader-localities.test.ts`, un fichier déjà présent sur `origin/main` — remis
 * à l'identique, les cas rues déplacés ici. Même méthode que ce fichier : le fichier réel
 * embarqué n'est que LU, les cas limites passent par les fonctions pures `indexStreets` et
 * `parseStreetsEdition` ; aucun test n'écrit dans le dépôt.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetDataLoaderCache,
  _streetsRowsForTest,
  buildStreetsMunicipalityInfo,
  getStreets,
  indexStreets,
  normalizeStreetName,
  parseStreetsEdition,
} from "../../src/mcp/data-loader.js";

afterEach(() => {
  _resetDataLoaderCache();
});

describe("getStreets() : fichier réel embarqué", () => {
  it("se charge, indexé par numéro OFS de commune, avec l'édition lue dans streets.meta.json", () => {
    const loaded = getStreets();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    // Mémoire (relecture du 06.10.2026, point 5) : plus de tableau `rows` exposé en production,
    // seulement l'index déjà construit (`byMunicipality`) et le petit répertoire nom/canton par
    // commune (`municipalityInfo`, une entrée par commune — pas une par rue).
    expect(loaded.byMunicipality.get("230")?.size).toBeGreaterThan(0);
    // Winterthur (230) : General-Guisan-Strasse, rue réelle du fichier officiel du 06.10.2026.
    expect(loaded.byMunicipality.get("230")?.has(normalizeStreetName("General-Guisan-Strasse"))).toBe(true);
    expect(loaded.municipalityInfo.get("230")).toEqual({ municipality: "Winterthur", canton: "ZH" });
    // Répertoire nom/canton beaucoup plus petit que le nombre de rues (relecture, point 5) :
    // une entrée par commune (quelques milliers), jamais une par rue (plus de 200 000).
    expect(loaded.municipalityInfo.size).toBeGreaterThan(1000);
    expect(loaded.municipalityInfo.size).toBeLessThan(5000);
    // Édition lue au moment du test (la collecte mensuelle la change : jamais une date figée).
    const meta = JSON.parse(readFileSync(new URL("../../src/mcp/data/streets.meta.json", import.meta.url), "utf8")) as { edition: string };
    expect(meta.edition).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(loaded.edition).toBe(meta.edition);
  });

  it("_streetsRowsForTest() : seule la fonction de test recharge le tableau complet (relecture du 06.10.2026, point 5)", () => {
    const rows = _streetsRowsForTest();
    expect(rows.length).toBeGreaterThan(200_000);
    expect(rows.some((r) => r.municipality_bfs_id === "230" && normalizeStreetName(r.street) === normalizeStreetName("General-Guisan-Strasse"))).toBe(true);
    // Le petit répertoire nom/canton construit depuis ce même tableau retrouve Winterthur.
    expect(buildStreetsMunicipalityInfo(rows).get("230")).toEqual({ municipality: "Winterthur", canton: "ZH" });
  });
});

describe("normalizeStreetName : NFC, casse, espaces, trait d'union ≡ espace (règle réservée aux rues)", () => {
  it("\"General Guisan-Strasse\" et \"General-Guisan-Strasse\" se normalisent à l'identique", () => {
    expect(normalizeStreetName("General Guisan-Strasse")).toBe(normalizeStreetName("General-Guisan-Strasse"));
  });
  it("casse et espaces multiples ignorés", () => {
    expect(normalizeStreetName("  RUE   DE LA Gare  ")).toBe("rue de la gare");
  });
  it("apostrophes unifiées", () => {
    expect(normalizeStreetName("Chemin de l’Église")).toBe(normalizeStreetName("Chemin de l'Église"));
  });
  it("un accent retiré reste une divergence réelle (pas de repli sur une comparaison sans accent)", () => {
    expect(normalizeStreetName("Général-Guisan-Strasse")).not.toBe(normalizeStreetName("General-Guisan-Strasse"));
  });
});

describe("indexStreets : répertoire sans ligne = absent", () => {
  it("aucune ligne : null, jamais un index vide", () => {
    expect(indexStreets([])).toBeNull();
  });
  it("index par numéro OFS de commune, plusieurs rues pour une même commune, noms normalisés", () => {
    const row = (street: string, municipality_bfs_id: string) => ({ street, postal_code: "8400", locality: "Winterthur", municipality_bfs_id, municipality: "Winterthur", canton: "ZH" });
    const index = indexStreets([row("General-Guisan-Strasse", "230"), row("Bahnhofplatz", "230"), row("Dorfstrasse", "176")]);
    expect(index?.get("230")?.size).toBe(2);
    expect(index?.get("230")?.has("general guisan strasse")).toBe(true);
    expect(index?.get("176")?.size).toBe(1);
  });
});

describe("buildStreetsMunicipalityInfo : une entrée par commune, jamais par rue (relecture du 06.10.2026, point 5)", () => {
  it("plusieurs rues d'une même commune : une seule entrée, le nom/canton de la PREMIÈRE ligne rencontrée", () => {
    const row = (street: string, municipality_bfs_id: string, municipality: string, canton: string) => ({ street, postal_code: "8400", locality: "Winterthur", municipality_bfs_id, municipality, canton });
    const info = buildStreetsMunicipalityInfo([
      row("General-Guisan-Strasse", "230", "Winterthur", "ZH"),
      row("Bahnhofplatz", "230", "Winterthur", "ZH"),
      row("Dorfstrasse", "176", "Lindau", "ZH"),
    ]);
    expect(info.size).toBe(2);
    expect(info.get("230")).toEqual({ municipality: "Winterthur", canton: "ZH" });
    expect(info.get("176")).toEqual({ municipality: "Lindau", canton: "ZH" });
  });

  it("numéro OFS de commune absent : ignoré, jamais une entrée vide", () => {
    const info = buildStreetsMunicipalityInfo([{ street: "Rue Fictive", postal_code: "", locality: "", municipality_bfs_id: "", municipality: "", canton: "" }]);
    expect(info.size).toBe(0);
  });
});

describe("parseStreetsEdition : édition affichée seulement si la fiche est saine et cohérente", () => {
  it("fiche saine et même nombre de lignes : édition rendue", () => {
    expect(parseStreetsEdition(JSON.stringify({ edition: "2026-10-06", rows: 221189 }), 221189)).toBe("2026-10-06");
  });
  it("JSON illisible : null, jamais une exception", () => {
    expect(parseStreetsEdition("{ ceci n'est pas du JSON valide", 221189)).toBeNull();
  });
  it("édition mal formée : null, jamais une date devinée", () => {
    expect(parseStreetsEdition(JSON.stringify({ edition: "06.10.2026", rows: 221189 }), 221189)).toBeNull();
  });
  it("nombre de lignes différent du répertoire chargé : null", () => {
    expect(parseStreetsEdition(JSON.stringify({ edition: "2026-10-06", rows: 221190 }), 221189)).toBeNull();
  });
});
