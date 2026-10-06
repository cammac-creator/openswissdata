/**
 * `getLocalities()` (tâche osd.localites, relecture finale du 06.10.2026, points 4 et 5).
 *
 * Le fichier réel embarqué n'est que LU. Les cas limites (répertoire vide, fiche d'édition
 * illisible, mal formée ou incohérente) passent par les fonctions pures `indexLocalities` et
 * `parseLocalitiesEdition` : aucun test n'écrit dans le dépôt (des écritures temporaires
 * faisaient échouer au hasard les autres fichiers de tests lancés en parallèle).
 */
import { afterEach, describe, expect, it } from "vitest";
import { _resetDataLoaderCache, getLocalities, indexLocalities, parseLocalitiesEdition } from "../../src/mcp/data-loader.js";


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
