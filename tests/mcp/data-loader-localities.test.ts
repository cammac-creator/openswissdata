/**
 * `getLocalities()` (tâche osd.localites, relecture finale du 06.10.2026, points 4 et 5).
 *
 * Le fichier réel embarqué n'est que LU. Les cas limites (répertoire vide, fiche d'édition
 * illisible, mal formée ou incohérente) passent par les fonctions pures `indexLocalities` et
 * `parseLocalitiesEdition` : aucun test n'écrit dans le dépôt (des écritures temporaires
 * faisaient échouer au hasard les autres fichiers de tests lancés en parallèle).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetDataLoaderCache,
  getLocalities,
  getStreets,
  indexLocalities,
  indexStreets,
  normalizeStreetName,
  parseLocalitiesEdition,
  parseStreetsEdition,
} from "../../src/mcp/data-loader.js";


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
    // Édition lue au moment du test (la collecte mensuelle la change : jamais une date figée).
    const meta = JSON.parse(readFileSync(new URL("../../src/mcp/data/localities.meta.json", import.meta.url), "utf8")) as { edition: string };
    expect(meta.edition).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(loaded.edition).toBe(meta.edition);
  });
});

describe("indexLocalities : répertoire sans ligne = absent", () => {
  it("aucune ligne : null, jamais un index vide", () => {
    expect(indexLocalities([])).toBeNull();
  });
  it("index par NPA, plusieurs communes pour un même NPA", () => {
    const row = (postal_code: string, municipality: string) => ({ postal_code, postal_code_suffix: "00", locality: "X", municipality, municipality_bfs_id: "1", canton: "ZH", language: "de" });
    const index = indexLocalities([row("8310", "Winterthur"), row("8310", "Illnau-Effretikon"), row("8400", "Winterthur")]);
    expect(index?.get("8310")?.length).toBe(2);
    expect(index?.get("8400")?.length).toBe(1);
  });
});

describe("parseLocalitiesEdition : édition affichée seulement si la fiche est saine et cohérente", () => {
  it("fiche saine et même nombre de lignes : édition rendue", () => {
    expect(parseLocalitiesEdition(JSON.stringify({ edition: "2026-10-01", rows: 5696 }), 5696)).toBe("2026-10-01");
  });
  it("JSON illisible : null, jamais une exception", () => {
    expect(parseLocalitiesEdition("{ ceci n'est pas du JSON valide", 5696)).toBeNull();
  });
  it("édition mal formée : null, jamais une date devinée", () => {
    expect(parseLocalitiesEdition(JSON.stringify({ edition: "01.10.2026", rows: 5696 }), 5696)).toBeNull();
  });
  it("nombre de lignes différent du répertoire chargé : null", () => {
    expect(parseLocalitiesEdition(JSON.stringify({ edition: "2026-10-01", rows: 5697 }), 5696)).toBeNull();
  });
});

/**
 * `getStreets()` (tâche osd.localites, tâche B1 du plan `2026-10-06-prospection-et-api.md`).
 * Même méthode que `getLocalities()` ci-dessus : le fichier réel embarqué n'est que LU, les
 * cas limites passent par les fonctions pures `indexStreets` et `parseStreetsEdition` — aucun
 * test n'écrit dans le dépôt.
 */
describe("getStreets() : fichier réel embarqué", () => {
  it("se charge, indexé par numéro OFS de commune, avec l'édition lue dans streets.meta.json", () => {
    const loaded = getStreets();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.rows.length).toBeGreaterThan(200_000);
    // Winterthur (230) : General-Guisan-Strasse, rue réelle du fichier officiel du 06.10.2026.
    expect(loaded.byMunicipality.get("230")?.has(normalizeStreetName("General-Guisan-Strasse"))).toBe(true);
    // Édition lue au moment du test (la collecte mensuelle la change : jamais une date figée).
    const meta = JSON.parse(readFileSync(new URL("../../src/mcp/data/streets.meta.json", import.meta.url), "utf8")) as { edition: string };
    expect(meta.edition).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(loaded.edition).toBe(meta.edition);
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
