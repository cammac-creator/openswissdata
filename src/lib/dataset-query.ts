/**
 * Lecture des jeux ouverts du moteur générique (tâche osd.jeux, piste G2 du plan
 * `2026-10-07-moteur-jeux-ouverts.md`) : fonctions PURES partagées par `src/routes/api-v1.ts`
 * (`GET /api/v1/datasets`, `GET /api/v1/datasets/:id`) — filtrage, pagination, forme publique du
 * catalogue. Aucune E/S ici : `getDatasetsIndex()`/`getDataset()` (`src/mcp/data-loader.ts`)
 * restent les seuls points de lecture disque.
 *
 * Normalisation des valeurs de filtre : `src/lib/dataset-keys.ts`, PARTAGÉE avec
 * `scripts/sync-datasets.ts` (même fonction à l'écriture et à la lecture, jamais deux
 * implémentations qui pourraient diverger).
 */

import { DATASET_KEY_NAMES, normalizeDatasetKeyValue, type DatasetKeyName } from "./dataset-keys.js";
import type { DatasetIndexEntry } from "../mcp/data-loader.js";

export const DEFAULT_DATASET_LIMIT = 100;
export const MAX_DATASET_LIMIT = 1000;

/** Licences qui EXIGENT une attribution (plan, piste G2) : `terms_by` et `cc-by` seulement —
 *  `terms_open` et `cc0` n'en exigent aucune. */
export function licenceRequiresAttribution(licence: string): boolean {
  return licence === "terms_by" || licence === "cc-by";
}

export interface DatasetCatalogueEntry {
  id: string;
  title: string;
  publisher: string;
  licence: string;
  /** `null` : licence qui n'exige pas d'attribution, ou texte d'attribution vide au registre.
   *  Jamais une chaîne vide (une absence se lit `null`, jamais `""`). */
  attribution: string | null;
  source: string;
  edition: string;
  /** Nombre de lignes du jeu ENTIER (jamais le nombre de lignes d'une réponse filtrée — voir
   *  `GET /api/v1/datasets/:id`, qui rend `total`/`data` séparément). */
  rows: number;
  columns: string[];
  keys: string[];
}

/** Forme publique d'une entrée de catalogue (`GET /api/v1/datasets`). Fonction pure, testée
 *  directement avec des entrées fabriquées — jamais besoin du fichier réel pour couvrir le cas
 *  `terms_by`/attribution. */
export function datasetCatalogueEntry(entry: DatasetIndexEntry): DatasetCatalogueEntry {
  const hasAttribution = licenceRequiresAttribution(entry.licence) && entry.attribution.trim().length > 0;
  return {
    id: entry.id,
    title: entry.title,
    publisher: entry.publisher,
    licence: entry.licence,
    attribution: hasAttribution ? entry.attribution : null,
    source: entry.resource_url,
    edition: entry.edition,
    rows: entry.rows,
    columns: entry.columns,
    keys: entry.keys,
  };
}

export type DatasetFilterResult = { ok: true; filters: Record<string, string> } | { ok: false; error: string };

/**
 * Lit, parmi les paramètres de requête, ceux qui nomment une des cinq clés fermées
 * (`DATASET_KEY_NAMES`) et normalise chaque valeur. Un paramètre qui nomme une clé que CE jeu
 * n'a PAS (`availableKeys`) ou une valeur qui ne respecte pas la forme de sa clé rend une erreur
 * — JAMAIS un filtre silencieusement ignoré : un client croirait alors recevoir des lignes
 * filtrées alors qu'il reçoit tout le jeu. Un paramètre qui ne nomme AUCUNE des cinq clés
 * (pagination, etc.) est simplement ignoré ici, jamais une erreur.
 */
export function parseDatasetFilters(query: Record<string, string | undefined>, availableKeys: readonly string[]): DatasetFilterResult {
  const filters: Record<string, string> = {};
  const available = new Set(availableKeys);
  for (const key of DATASET_KEY_NAMES) {
    const raw = query[key];
    if (raw === undefined) continue;
    if (!available.has(key)) return { ok: false, error: `unknown_filter_key:${key}` };
    const normalized = normalizeDatasetKeyValue(key as DatasetKeyName, raw);
    if (normalized === null) return { ok: false, error: `invalid_filter_value:${key}` };
    filters[key] = normalized;
  }
  return { ok: true, filters };
}

/** Égalité exacte sur chaque clé normalisée (plan : « filtres par égalité exacte sur clés
 *  normalisées »). Aucun filtre : toutes les lignes, copiées (jamais la référence du tableau
 *  d'origine, pour ne jamais risquer une mutation partagée). */
export function filterDatasetRows(rows: readonly Record<string, string>[], filters: Record<string, string>): Record<string, string>[] {
  const entries = Object.entries(filters);
  if (entries.length === 0) return [...rows];
  return rows.filter((row) => entries.every(([k, v]) => row[k] === v));
}

export type DatasetPaginationResult = { ok: true; limit: number; offset: number } | { ok: false; error: string };

/** `limit` par défaut 100, maximum 1 000 ; `offset` par défaut 0. Toute valeur hors de ces
 *  bornes, ou non entière, rend une erreur — jamais une valeur silencieusement plafonnée (un
 *  client croirait alors avoir demandé la bonne page). */
export function parseDatasetPagination(query: { limit?: string; offset?: string }): DatasetPaginationResult {
  let limit = DEFAULT_DATASET_LIMIT;
  if (query.limit !== undefined) {
    const n = Number(query.limit);
    if (!Number.isInteger(n) || n < 1 || n > MAX_DATASET_LIMIT) return { ok: false, error: "invalid_limit" };
    limit = n;
  }
  let offset = 0;
  if (query.offset !== undefined) {
    const n = Number(query.offset);
    if (!Number.isInteger(n) || n < 0) return { ok: false, error: "invalid_offset" };
    offset = n;
  }
  return { ok: true, limit, offset };
}

/** Découpe `rows` (déjà filtrées) ; `total` = nombre de lignes APRÈS filtre, AVANT pagination —
 *  jamais le nombre de lignes du jeu entier (voir `DatasetCatalogueEntry.rows`, un champ
 *  distinct et volontairement absent de la réponse de `GET /api/v1/datasets/:id`, pour ne
 *  jamais confondre les deux dans la même réponse). */
export function paginateDatasetRows<T>(rows: readonly T[], limit: number, offset: number): { rows: T[]; total: number } {
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

// --------------------------------------------------------------------------------------------
// Section « datasets » des profils de canton/commune (plan, piste G2) : « la liste des jeux
// approuvés qui ont des lignes pour ce canton/cette commune (ids et nombre de lignes, pas les
// données) ». Fonctions PURES (données déjà chargées passées en paramètre) — SANS E/S — pour
// rester testables sans toucher `src/mcp/data`, et réutilisées À L'IDENTIQUE par
// `src/lib/canton-profile.ts` et `src/lib/commune-profile.ts` (jamais deux implémentations qui
// pourraient diverger). Volontairement SELF-CONTAINED : jamais ajouté à `sources`/`editions` des
// profils (listes déjà comparées par égalité stricte dans des tests existants).
// --------------------------------------------------------------------------------------------
export interface DatasetProfileMatch {
  id: string;
  rows: number;
}

type DatasetRowsLoader = (id: string) => { rows: readonly Record<string, string>[] } | null;

function cmpIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Jeux approuvés qui ont au moins une ligne pour une COMMUNE donnée (numéro OFS) : seulement
 *  ceux dont la clé `commune_bfs` est disponible, par égalité exacte sur `bfsId` — jamais un
 *  comptage approximatif par canton pour une commune, et jamais un jeu sans cette clé. */
export function datasetsForCommune(
  bfsId: string,
  index: { datasets: readonly DatasetIndexEntry[] } | null,
  loadDataset: DatasetRowsLoader,
): DatasetProfileMatch[] {
  if (!index) return [];
  const out: DatasetProfileMatch[] = [];
  for (const entry of index.datasets) {
    if (!entry.keys.includes("commune_bfs")) continue;
    const loaded = loadDataset(entry.id);
    if (!loaded) continue;
    const rows = loaded.rows.filter((r) => r.commune_bfs === bfsId).length;
    if (rows > 0) out.push({ id: entry.id, rows });
  }
  return out.sort((a, b) => cmpIds(a.id, b.id));
}

/** Jeux approuvés qui ont au moins une ligne pour un CANTON donné : un jeu à clé `canton`
 *  compte par égalité directe sur l'abréviation ; un jeu à clé `commune_bfs` (jamais les deux
 *  clés en même temps dans ce moteur) compte les lignes dont la commune appartient à ce canton
 *  (`communeBfsIds`, déjà calculé par l'appelant — `bfsIdsForCanton` de `canton-profile.ts`). */
export function datasetsForCanton(
  abbr: string,
  communeBfsIds: ReadonlySet<string>,
  index: { datasets: readonly DatasetIndexEntry[] } | null,
  loadDataset: DatasetRowsLoader,
): DatasetProfileMatch[] {
  if (!index) return [];
  const out: DatasetProfileMatch[] = [];
  for (const entry of index.datasets) {
    const usesCanton = entry.keys.includes("canton");
    const usesCommune = entry.keys.includes("commune_bfs");
    if (!usesCanton && !usesCommune) continue;
    const loaded = loadDataset(entry.id);
    if (!loaded) continue;
    const rows = usesCanton
      ? loaded.rows.filter((r) => r.canton === abbr).length
      : loaded.rows.filter((r) => communeBfsIds.has(r.commune_bfs)).length;
    if (rows > 0) out.push({ id: entry.id, rows });
  }
  return out.sort((a, b) => cmpIds(a.id, b.id));
}
