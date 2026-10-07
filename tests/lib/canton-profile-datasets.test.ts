/**
 * Section `datasets` de `cantonProfile()` (tâche osd.jeux, piste G2 du plan
 * `2026-10-07-moteur-jeux-ouverts.md`).
 *
 * Fichier NEUF, à côté de `tests/lib/canton-profile.test.ts` (déjà présent sur `origin/main`,
 * jamais modifié) : mêmes dépendances injectées (localités, rues), plus `getDatasetsIndex`
 * fabriqué en mémoire — jamais le vrai dossier `src/mcp/data/datasets`, pour ne dépendre
 * d'aucun jeu réellement collecté. Relecture adverse du 07.10.2026 (avant le lot de 36 jeux) :
 * `cantonProfile()` lit SEULEMENT `by_canton`/`by_commune_bfs` PRÉCALCULÉS (jamais un fichier de
 * jeu) — ces tests fabriquent donc directement ces compteurs, jamais des lignes brutes. Le cas
 * de PRODUCTION réelle ne fixe ni id ni canton précis (le catalogue réel change de forme à
 * chaque lot d'approbations) : forme seulement, sur n'importe quel contenu actuel.
 */
import { describe, expect, it } from "vitest";
import { cantonProfile, type CantonProfileDeps } from "../../src/lib/canton-profile.js";
import type { DatasetIndexEntry, LocalityRow } from "../../src/mcp/data-loader.js";

function locality(partial: Partial<LocalityRow>): LocalityRow {
  return {
    postal_code: "", postal_code_suffix: "00", locality: "", municipality: "", municipality_bfs_id: "",
    canton: "ZH", language: "de", ...partial,
  };
}

function datasetEntry(partial: Partial<DatasetIndexEntry>): DatasetIndexEntry {
  return {
    id: "jeu-x", title: "Jeu X", publisher: "Éditeur", licence: "terms_open", attribution: "",
    resource_url: "https://example.ch/x.csv", columns: [], keys: [], rows: 0, edition: "2026-10-07",
    ...partial,
  };
}

function minimalDeps(overrides: Partial<CantonProfileDeps> = {}): Partial<CantonProfileDeps> {
  return {
    getLocalities: () => ({ rows: [], edition: null }),
    getStreets: () => null,
    getFinmaRegistry: () => [],
    getFinmaVersion: () => null,
    getFinmaSeats: () => null,
    getBfePv: () => null,
    getDatasetsIndex: () => null,
    ...overrides,
  };
}

const ZH_COMMUNE = locality({ postal_code: "8400", locality: "Winterthur", municipality: "Winterthur", municipality_bfs_id: "230", canton: "ZH" });

describe("cantonProfile().datasets", () => {
  it("catalogue absent : tableau vide (jamais null)", () => {
    const profile = cantonProfile("ZH", minimalDeps());
    expect(profile.datasets).toEqual([]);
  });

  it("jeu à clé canton (by_canton précalculé) : compte direct sur l'abréviation", () => {
    const profile = cantonProfile(
      "ZH",
      minimalDeps({
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-canton", keys: ["canton", "year"], by_canton: { ZH: 2, GR: 1 } })] }),
      }),
    );
    expect(profile.datasets).toEqual([{ id: "jeu-canton", rows: 2 }]);
  });

  it("jeu à clé commune_bfs (by_commune_bfs précalculé) : somme sur les communes de ce canton", () => {
    const profile = cantonProfile(
      "ZH",
      minimalDeps({
        getLocalities: () => ({ rows: [ZH_COMMUNE], edition: "2026-10-01" }),
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-commune", keys: ["commune_bfs"], by_commune_bfs: { "230": 2, "999": 1 } })] }),
      }),
    );
    expect(profile.datasets).toEqual([{ id: "jeu-commune", rows: 2 }]);
  });

  it("aucune ligne pour ce canton : jeu absent du tableau", () => {
    const profile = cantonProfile(
      "VD",
      minimalDeps({
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-canton", keys: ["canton"], by_canton: { ZH: 1 } })] }),
      }),
    );
    expect(profile.datasets).toEqual([]);
  });

  it("jeu sans by_canton ni by_commune_bfs précalculé : jamais dans le tableau, jamais une exception", () => {
    const profile = cantonProfile(
      "ZH",
      minimalDeps({
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-sans-cle", keys: ["noga"] })] }),
      }),
    );
    expect(profile.datasets).toEqual([]);
  });

  it("n'ajoute jamais d'entrée à sources ni à editions", () => {
    const profile = cantonProfile(
      "ZH",
      minimalDeps({
        getLocalities: () => ({ rows: [ZH_COMMUNE], edition: "2026-10-01" }),
        getDatasetsIndex: () => ({ datasets: [datasetEntry({ id: "jeu-canton", keys: ["canton"], by_canton: { ZH: 1 } })] }),
      }),
    );
    expect(profile.sources).toEqual(["swisstopo.localities"]);
    expect(profile.editions).toEqual({ localities: "2026-10-01", streets: null, finma: null, finma_seats: null, bfe_pv: null });
  });

  it("production réelle : forme correcte seulement, jamais un id ou un canton figé (le catalogue réel change de forme à chaque lot d'approbations)", () => {
    // ZH choisi seulement parce qu'un canton doit être passé ; aucune hypothèse sur son contenu.
    const profile = cantonProfile("ZH");
    expect(Array.isArray(profile.datasets)).toBe(true);
    for (const d of profile.datasets) {
      expect(typeof d.id).toBe("string");
      expect(d.id.length).toBeGreaterThan(0);
      expect(Number.isInteger(d.rows)).toBe(true);
      expect(d.rows).toBeGreaterThan(0);
    }
  });
});
