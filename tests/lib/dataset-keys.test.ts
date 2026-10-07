/**
 * Tests de `src/lib/dataset-keys.ts` (tâche osd.jeux, piste G1/G2 du plan
 * `2026-10-07-moteur-jeux-ouverts.md`) : normalisation des cinq clés de jointure, PARTAGÉE entre
 * le collecteur et l'API. Fonctions pures, sans E/S, sans réseau.
 */
import { describe, expect, it } from "vitest";
import { DATASET_KEY_NAMES, isDatasetKeyName, normalizeDatasetKeyValue } from "../../src/lib/dataset-keys.js";

describe("DATASET_KEY_NAMES / isDatasetKeyName", () => {
  it("ensemble fermé de cinq clés", () => {
    expect([...DATASET_KEY_NAMES]).toEqual(["canton", "commune_bfs", "postal_code", "noga", "year"]);
  });
  it("reconnaît une clé valide, rejette le reste", () => {
    expect(isDatasetKeyName("canton")).toBe(true);
    expect(isDatasetKeyName("commune_bfs")).toBe(true);
    expect(isDatasetKeyName("ide")).toBe(false);
    expect(isDatasetKeyName("")).toBe(false);
  });
});

describe("normalizeDatasetKeyValue : canton", () => {
  it("abréviation valide, casse et espaces tolérés", () => {
    expect(normalizeDatasetKeyValue("canton", " zh ")).toBe("ZH");
    expect(normalizeDatasetKeyValue("canton", "GR")).toBe("GR");
  });
  it("abréviation inconnue : null", () => {
    expect(normalizeDatasetKeyValue("canton", "XX")).toBeNull();
    expect(normalizeDatasetKeyValue("canton", "")).toBeNull();
    expect(normalizeDatasetKeyValue("canton", "Zürich")).toBeNull();
  });
});

describe("normalizeDatasetKeyValue : commune_bfs", () => {
  it("entier, zéros de tête retirés", () => {
    expect(normalizeDatasetKeyValue("commune_bfs", "3542")).toBe("3542");
    expect(normalizeDatasetKeyValue("commune_bfs", "0230")).toBe("230");
    expect(normalizeDatasetKeyValue("commune_bfs", " 61 ")).toBe("61");
  });
  it("non numérique ou vide : null", () => {
    expect(normalizeDatasetKeyValue("commune_bfs", "abc")).toBeNull();
    expect(normalizeDatasetKeyValue("commune_bfs", "")).toBeNull();
    expect(normalizeDatasetKeyValue("commune_bfs", "12.5")).toBeNull();
  });
});

describe("normalizeDatasetKeyValue : postal_code", () => {
  it("exactement quatre chiffres", () => {
    expect(normalizeDatasetKeyValue("postal_code", "8400")).toBe("8400");
  });
  it("autre longueur : null", () => {
    expect(normalizeDatasetKeyValue("postal_code", "840")).toBeNull();
    expect(normalizeDatasetKeyValue("postal_code", "84001")).toBeNull();
    expect(normalizeDatasetKeyValue("postal_code", "")).toBeNull();
  });
});

describe("normalizeDatasetKeyValue : year", () => {
  it("exactement quatre chiffres", () => {
    expect(normalizeDatasetKeyValue("year", "2024")).toBe("2024");
  });
  it("autre forme : null", () => {
    expect(normalizeDatasetKeyValue("year", "24")).toBeNull();
    expect(normalizeDatasetKeyValue("year", "202x")).toBeNull();
  });
});

describe("normalizeDatasetKeyValue : noga", () => {
  it("texte non vide, trim seul", () => {
    expect(normalizeDatasetKeyValue("noga", " 62.01 ")).toBe("62.01");
  });
  it("vide : null", () => {
    expect(normalizeDatasetKeyValue("noga", "   ")).toBeNull();
  });
});
