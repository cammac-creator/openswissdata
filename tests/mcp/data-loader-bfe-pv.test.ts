/**
 * `getBfePv()` (tâche osd.donnees, tâche B5 du plan `2026-10-06-prospection-et-api.md`) :
 * rétribution unique OFEN pour les installations photovoltaïques, par canton et année.
 *
 * Même méthode que `tests/mcp/data-loader-finma-seats.test.ts` : contrôles de FORME seulement
 * sur le fichier réel embarqué (jamais une valeur, une date ou un nombre de lignes figé — la
 * collecte annuelle rejoue ce fichier avant tout commit), cas limites par les fonctions pures.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { _resetDataLoaderCache, getBfePv, parseBfePvEdition } from "../../src/mcp/data-loader.js";

afterEach(() => {
  _resetDataLoaderCache();
});

const YEAR_RE = /^\d{4}$/;
const CANTONS = new Set([
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW",
  "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH",
]);
const NUMBER_OR_NA_RE = /^(NA|\d+(\.\d+)?)$/;

describe("getBfePv() : fichier réel embarqué", () => {
  it("se charge, avec l'édition lue dans bfe_pv.meta.json — contrôles de forme seulement, aucune valeur figée", () => {
    const loaded = getBfePv();
    expect(loaded).not.toBeNull(); // produit par `npm run sync:bfe-pv` : doit exister dans cette copie
    if (!loaded) return;
    expect(loaded.rows.length).toBeGreaterThanOrEqual(200); // même seuil que DEFAULT_MIN_ROWS du script
    const seenCantons = new Set<string>();
    for (const row of loaded.rows) {
      expect(row.year).toMatch(YEAR_RE);
      expect(CANTONS.has(row.canton), row.canton).toBe(true);
      seenCantons.add(row.canton);
      for (const field of [
        "installations_count", "installed_capacity_kw", "remuneration_chf",
        "installations_per_100000_inhabitants", "installed_capacity_kw_per_100000_inhabitants",
      ] as const) {
        expect(row[field], `${row.year}/${row.canton}/${field}`).toMatch(NUMBER_OR_NA_RE);
      }
    }
    expect(seenCantons.size).toBe(26); // les 26 cantons apparaissent au moins une fois
    // Grille année × canton complète, sans doublon (même contrôle que `validateRows` du
    // script) : chaque année compte exactement les 26 cantons, chacun une seule fois.
    const byYear = new Map<string, Set<string>>();
    for (const row of loaded.rows) {
      const set = byYear.get(row.year) ?? new Set<string>();
      expect(set.has(row.canton), `doublon ${row.year}/${row.canton}`).toBe(false);
      set.add(row.canton);
      byYear.set(row.year, set);
    }
    for (const [year, cantons] of byYear) expect(cantons.size, `année ${year}`).toBe(26);
    const meta = JSON.parse(readFileSync(new URL("../../src/mcp/data/bfe_pv.meta.json", import.meta.url), "utf8")) as { edition: string };
    expect(meta.edition).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(loaded.edition).toBe(meta.edition);
  });
});

describe("parseBfePvEdition : édition affichée seulement si la fiche est saine et cohérente", () => {
  it("fiche saine et même nombre de lignes : édition rendue", () => {
    expect(parseBfePvEdition(JSON.stringify({ edition: "2026-10-07", rows: 260 }), 260)).toBe("2026-10-07");
  });
  it("JSON illisible : null, jamais une exception", () => {
    expect(parseBfePvEdition("{ ceci n'est pas du JSON valide", 260)).toBeNull();
  });
  it("édition mal formée : null, jamais une date devinée", () => {
    expect(parseBfePvEdition(JSON.stringify({ edition: "07.10.2026", rows: 260 }), 260)).toBeNull();
  });
  it("nombre de lignes différent du fichier chargé : null", () => {
    expect(parseBfePvEdition(JSON.stringify({ edition: "2026-10-07", rows: 261 }), 260)).toBeNull();
  });
});

describe("_resetDataLoaderCache : efface aussi le cache de la rétribution unique OFEN", () => {
  it("un second appel après reset relit le fichier (même résultat, nouvelle lecture)", () => {
    const first = getBfePv();
    _resetDataLoaderCache();
    const second = getBfePv();
    expect(second?.rows.length).toBe(first?.rows.length);
    expect(second?.edition).toBe(first?.edition);
  });
});
