/**
 * Tests de `src/lib/dataset-query.ts` (tâche osd.jeux, piste G2 du plan
 * `2026-10-07-moteur-jeux-ouverts.md`) : fonctions pures, sans E/S, sans réseau — y compris le
 * cas `terms_by`/attribution, qui ne dépend d'aucun jeu réel du dépôt.
 */
import { describe, expect, it } from "vitest";
import {
  datasetCatalogueEntry,
  datasetsForCanton,
  datasetsForCommune,
  filterDatasetRows,
  paginateDatasetRows,
  parseDatasetFilters,
  parseDatasetPagination,
  licenceRequiresAttribution,
} from "../../src/lib/dataset-query.js";
import type { DatasetIndexEntry } from "../../src/mcp/data-loader.js";

function entry(overrides: Partial<DatasetIndexEntry> = {}): DatasetIndexEntry {
  return {
    id: "demo-jeu",
    title: "Jeu de démonstration",
    publisher: "Éditeur de test",
    licence: "terms_open",
    attribution: "",
    resource_url: "https://example.ch/demo.csv",
    columns: ["year", "commune_bfs", "name"],
    keys: ["commune_bfs", "year"],
    rows: 3,
    edition: "2026-10-07",
    ...overrides,
  };
}

describe("licenceRequiresAttribution", () => {
  it("terms_by et cc-by seulement", () => {
    expect(licenceRequiresAttribution("terms_by")).toBe(true);
    expect(licenceRequiresAttribution("cc-by")).toBe(true);
    expect(licenceRequiresAttribution("terms_open")).toBe(false);
    expect(licenceRequiresAttribution("cc0")).toBe(false);
  });
});

describe("datasetCatalogueEntry", () => {
  it("terms_open : attribution null même si le registre porte un texte", () => {
    const e = datasetCatalogueEntry(entry({ licence: "terms_open", attribution: "texte ignoré pour cette licence" }));
    expect(e.attribution).toBeNull();
  });

  it("terms_by avec texte : attribution présente", () => {
    const e = datasetCatalogueEntry(entry({ licence: "terms_by", attribution: "Canton de test, terms_by" }));
    expect(e.attribution).toBe("Canton de test, terms_by");
  });

  it("terms_by sans texte (registre incomplet) : attribution null, jamais une chaîne vide", () => {
    const e = datasetCatalogueEntry(entry({ licence: "terms_by", attribution: "" }));
    expect(e.attribution).toBeNull();
  });

  it("forme complète", () => {
    const e = datasetCatalogueEntry(entry());
    expect(e).toEqual({
      id: "demo-jeu",
      title: "Jeu de démonstration",
      publisher: "Éditeur de test",
      licence: "terms_open",
      attribution: null,
      source: "https://example.ch/demo.csv",
      edition: "2026-10-07",
      rows: 3,
      columns: ["year", "commune_bfs", "name"],
      filters: ["commune_bfs", "year"],
    });
  });
});

describe("parseDatasetFilters", () => {
  const availableKeys = ["commune_bfs", "year"];

  it("aucun paramètre : filtres vides", () => {
    expect(parseDatasetFilters({}, availableKeys)).toEqual({ ok: true, filters: {} });
  });

  it("clé disponible, valeur valide : normalisée", () => {
    expect(parseDatasetFilters({ commune_bfs: "0230", year: "2024" }, availableKeys)).toEqual({
      ok: true,
      filters: { commune_bfs: "230", year: "2024" },
    });
  });

  it("clé reconnue mais absente de ce jeu : erreur", () => {
    const r = parseDatasetFilters({ canton: "ZH" }, availableKeys);
    expect(r).toEqual({ ok: false, error: "unknown_filter_key:canton" });
  });

  it("valeur invalide pour sa clé : erreur", () => {
    const r = parseDatasetFilters({ year: "24" }, availableKeys);
    expect(r).toEqual({ ok: false, error: "invalid_filter_value:year" });
  });

  it("paramètre hors des cinq clés (ex. limit) : ignoré, jamais une erreur", () => {
    expect(parseDatasetFilters({ limit: "10" }, availableKeys)).toEqual({ ok: true, filters: {} });
  });
});

describe("filterDatasetRows", () => {
  const rows = [
    { year: "2024", commune_bfs: "230", name: "a" },
    { year: "2024", commune_bfs: "231", name: "b" },
    { year: "2023", commune_bfs: "230", name: "c" },
  ];

  it("aucun filtre : toutes les lignes (copie)", () => {
    const out = filterDatasetRows(rows, {});
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
  });

  it("un filtre : égalité exacte", () => {
    expect(filterDatasetRows(rows, { commune_bfs: "230" })).toEqual([rows[0], rows[2]]);
  });

  it("deux filtres combinés (ET)", () => {
    expect(filterDatasetRows(rows, { commune_bfs: "230", year: "2023" })).toEqual([rows[2]]);
  });

  it("aucune ligne ne correspond : tableau vide", () => {
    expect(filterDatasetRows(rows, { commune_bfs: "999" })).toEqual([]);
  });
});

describe("parseDatasetPagination", () => {
  it("rien fourni : défauts (limit 100, offset 0)", () => {
    expect(parseDatasetPagination({})).toEqual({ ok: true, limit: 100, offset: 0 });
  });

  it("limit et offset valides", () => {
    expect(parseDatasetPagination({ limit: "5", offset: "10" })).toEqual({ ok: true, limit: 5, offset: 10 });
  });

  it("limit à la borne haute (1000) : acceptée", () => {
    expect(parseDatasetPagination({ limit: "1000" })).toEqual({ ok: true, limit: 1000, offset: 0 });
  });

  it("limit au-delà de 1000 : erreur", () => {
    expect(parseDatasetPagination({ limit: "1001" })).toEqual({ ok: false, error: "invalid_limit" });
  });

  it("limit à zéro ou négative : erreur", () => {
    expect(parseDatasetPagination({ limit: "0" })).toEqual({ ok: false, error: "invalid_limit" });
    expect(parseDatasetPagination({ limit: "-5" })).toEqual({ ok: false, error: "invalid_limit" });
  });

  it("limit non entière : erreur", () => {
    expect(parseDatasetPagination({ limit: "3.5" })).toEqual({ ok: false, error: "invalid_limit" });
  });

  it("offset négatif : erreur", () => {
    expect(parseDatasetPagination({ offset: "-1" })).toEqual({ ok: false, error: "invalid_offset" });
  });
});

// Relecture adverse du 07.10.2026 (avant le lot de 36 jeux) : `datasetsForCommune`/
// `datasetsForCanton` lisent SEULEMENT `by_commune_bfs`/`by_canton`, précalculés à la collecte
// (`scripts/sync-datasets.ts`) — jamais un chargeur de lignes, jamais `getDataset`. Ces tests ne
// fabriquent donc plus de lignes brutes, seulement les compteurs déjà agrégés.
describe("datasetsForCommune", () => {
  const index = {
    datasets: [
      entry({ id: "jeu-commune", keys: ["commune_bfs", "year"], by_commune_bfs: { "230": 2, "61": 1 } }),
      entry({ id: "jeu-canton", keys: ["canton", "year"], by_canton: { ZH: 1 } }),
      entry({ id: "jeu-commune-absente", keys: ["commune_bfs"], by_commune_bfs: { "999": 1 } }),
    ],
  };

  it("seulement les jeux à by_commune_bfs précalculé, comptage par commune", () => {
    expect(datasetsForCommune("230", index)).toEqual([{ id: "jeu-commune", rows: 2 }]);
  });

  it("aucune ligne pour cette commune : jeu absent du résultat", () => {
    expect(datasetsForCommune("777", index)).toEqual([]);
  });

  it("catalogue absent : tableau vide", () => {
    expect(datasetsForCommune("230", null)).toEqual([]);
  });

  it("jeu sans by_commune_bfs (clé absente de ce jeu) : jamais dans le résultat, jamais une exception", () => {
    const idx = { datasets: [entry({ id: "jeu-sans-cle", keys: ["canton"], by_canton: { ZH: 1 } })] };
    expect(datasetsForCommune("230", idx)).toEqual([]);
  });
});

describe("datasetsForCanton", () => {
  const index = {
    datasets: [
      entry({ id: "jeu-canton", keys: ["canton", "year"], by_canton: { GR: 2, ZH: 1 } }),
      entry({ id: "jeu-commune", keys: ["commune_bfs"], by_commune_bfs: { "3542": 2, "999": 1 } }),
      entry({ id: "jeu-sans-cle-geo", keys: ["noga"] }),
    ],
  };
  const grCommunes = new Set(["3542", "3681"]);

  it("jeu à clé canton (by_canton) : égalité directe sur l'abréviation", () => {
    const result = datasetsForCanton("GR", grCommunes, index);
    expect(result).toEqual([
      { id: "jeu-canton", rows: 2 },
      { id: "jeu-commune", rows: 2 },
    ]);
  });

  it("jeu sans by_canton ni by_commune_bfs : jamais dans le résultat", () => {
    const result = datasetsForCanton("GR", grCommunes, index);
    expect(result.find((r) => r.id === "jeu-sans-cle-geo")).toBeUndefined();
  });

  it("aucune commune du canton dans by_commune_bfs : jeu absent du résultat", () => {
    const result = datasetsForCanton("ZH", new Set(["230"]), index);
    expect(result.find((r) => r.id === "jeu-commune")).toBeUndefined();
  });

  it("catalogue absent : tableau vide", () => {
    expect(datasetsForCanton("GR", grCommunes, null)).toEqual([]);
  });
});

describe("paginateDatasetRows", () => {
  const rows = Array.from({ length: 25 }, (_, i) => i);

  it("total = nombre de lignes avant pagination, rows = la page demandée", () => {
    expect(paginateDatasetRows(rows, 10, 0)).toEqual({ rows: rows.slice(0, 10), total: 25 });
    expect(paginateDatasetRows(rows, 10, 20)).toEqual({ rows: rows.slice(20, 25), total: 25 });
  });

  it("offset au-delà de la fin : page vide, total inchangé", () => {
    expect(paginateDatasetRows(rows, 10, 100)).toEqual({ rows: [], total: 25 });
  });
});
