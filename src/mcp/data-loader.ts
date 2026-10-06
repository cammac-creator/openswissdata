/**
 * MCP data loader — lazy-loads bundled CSV slices into in-memory maps.
 *
 * Data files live in `src/mcp/data/` and are copied to `dist/mcp/data/` at
 * build time (see package.json `build` script). They ship inside the deploy
 * artifact, unlike the full `data/` tree which is gitignored / railwayignored.
 *
 * Datasets:
 *   - tares.csv                              (TARES customs tariffs, ~7.5k HS8 rows)
 *   - finma_registry.csv                     (FINMA-supervised entities, ~2.9k rows)
 *   - finma_warnings.csv                     (FINMA warnings list, ~2.2k rows)
 *   - crosswalks.csv                         (NOGA/NACE/ISIC translations, ~2.2k rows)
 *   - localities.csv                         (répertoire officiel des localités swisstopo, ~5.7k rows)
 *   - embeddings/tares_index.{json,bin}      (TARES, 7 511 lignes × 4 langues, chemin officiel ; search-index.ts)
 *   - embeddings/noga_2025_index.{json,bin}  (NOGA 2025, 798 genres × 4 langues ; search-index.ts)
 *
 * NOTE: V2 will replace these with R2-backed parquet + a streaming reader
 * to support deltas + entity_history.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import type { ClassificationLink, ClassificationSource } from "../lib/classification-links.js";
import { loadSearchIndex, type SearchIndex } from "./search-index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

export interface TaresRow {
  hs8: string;
  hs6: string;
  chapter: string;
  heading: string;
  designation_fr: string;
  designation_de: string;
  designation_it: string;
  designation_en: string;
  unit_stat: string;
  duty_mfn_value: string;
  duty_mfn_unit: string;
  duty_mfn_currency: string;
  duty_rates_count?: string;
  preferential_regimes: string;
  restrictions_codes: string;
  customs_relief_codes: string;
  valid_from: string;
  source_url: string;
}

export interface FinmaRegistryRow {
  entity_type: string;
  name: string;
  uid: string;
  lei: string;
  licence_type: string;
  licence_type_de: string;
  licence_type_fr: string;
  licence_type_it: string;
  licence_date: string;
  status: string;
  canton: string;
  city: string;
  address: string;
  source_list: string;
  source_url: string;
  is_warning_listed: string;
}

export interface FinmaWarningRow {
  name: string;
  country: string;
  date_added: string;
  category: string;
  source_url: string;
  source_list: string;
  warning_type: string;
  additional_info: string;
}

export interface CrosswalkRow {
  noga_2008: string;
  noga_2025: string;
  nace_2_0: string;
  nace_2_1: string;
  isic_4: string;
  mapping_type: string;
  notes: string;
}

/** Une ligne du répertoire officiel des localités (swisstopo, tâche osd.localites) : un
 *  même (postal_code, postal_code_suffix, locality) peut apparaître plusieurs fois, une
 *  ligne par commune couverte (ex. NPA 8310 Kemptthal : Lindau ET Winterthur). */
export interface LocalityRow {
  postal_code: string;
  postal_code_suffix: string;
  locality: string;
  municipality: string;
  municipality_bfs_id: string;
  canton: string;
  language: string;
}

let _taresVersion: string | null = null;
let _tares: TaresRow[] | null = null;
let _taresByHs8: Map<string, TaresRow> | null = null;
let _finmaRegistry: FinmaRegistryRow[] | null = null;
let _finmaWarnings: FinmaWarningRow[] | null = null;
let _finmaVersion: string | null = null;
let _crosswalks: CrosswalkRow[] | null = null;
let _localities: LocalityRow[] | null = null;
let _localitiesByPostalCode: Map<string, LocalityRow[]> | null = null;
let _localitiesLoadFailed = false;
let _classificationLinks: ClassificationLink[] | null = null;
let _classificationSources: ClassificationSource[] | null = null;
let _taresEmbeddingsPromise: Promise<SearchIndex> | null = null;
let _nogaEmbeddingsPromise: Promise<SearchIndex> | null = null;

function loadCsv<T>(filename: string): T[] {
  const path = join(DATA_DIR, filename);
  const raw = readFileSync(path, "utf8");
  return parse(raw, { columns: true, skip_empty_lines: true, relax_quotes: true }) as T[];
}

export function getTares(): { rows: readonly TaresRow[]; byHs8: ReadonlyMap<string, TaresRow>; version: string | null } {
  if (!_tares || !_taresByHs8) {
    _tares = loadCsv<TaresRow>("tares.csv");
    _taresByHs8 = new Map(_tares.map((r) => [r.hs8, r]));
  }
  return { rows: _tares, byHs8: _taresByHs8, version: _taresVersion };
}

/** Remplace ensemble les lignes TARES et leur index après validation de l'archive. */
export function setTares(rows: TaresRow[], version: string): void {
  const index = new Map(rows.map(row => [row.hs8, row]));
  _tares = rows;
  _taresVersion = version;
  _taresByHs8 = index;
}

/**
 * READ-CONSISTENCY INVARIANT: a consumer that needs BOTH the registry and the
 * warnings (kyc_check, finma_search) must read them WITHOUT an `await` between
 * the two getter calls. The R2 refresh swaps both maps from the same ZIP run
 * with no await between the two setters (see r2-refresh.ts), so back-to-back
 * synchronous reads always observe a matching registry+warnings pair. Insert an
 * `await` between the reads and a scheduled refresh could land in the gap.
 */
export function getFinmaRegistry(): readonly FinmaRegistryRow[] {
  if (!_finmaRegistry) {
    _finmaRegistry = loadCsv<FinmaRegistryRow>("finma_registry.csv");
  }
  return _finmaRegistry;
}

export function getFinmaWarnings(): readonly FinmaWarningRow[] {
  if (!_finmaWarnings) {
    _finmaWarnings = loadCsv<FinmaWarningRow>("finma_warnings.csv");
  }
  return _finmaWarnings;
}

/**
 * Hot-swap the in-memory FINMA slices with fresh rows pulled from R2 (see
 * `r2-refresh.ts`). The committed CSVs remain the cold-start SEED; once a
 * refresh succeeds these setters replace the served data — no redeploy, no
 * commit. The getters stay synchronous, so the 7 sync tools are untouched.
 *
 * Assignment is a single reference swap (JS is single-threaded) → no lock and
 * no torn read: a getter either returns the old array or the new one, never a
 * half-built one. The refresh engine validates rows BEFORE calling these, so a
 * bad/truncated download never lands here.
 */
export function setFinmaRegistry(rows: FinmaRegistryRow[]): void {
  _finmaRegistry = rows;
}

export function setFinmaWarnings(rows: FinmaWarningRow[]): void {
  _finmaWarnings = rows;
}

/** Version FINMA actuellement servie ; null tant que la copie embarquée au déploiement est utilisée. */
export function getFinmaVersion(): string | null {
  return _finmaVersion;
}

/** Enregistrée dans le même bloc synchrone que le registre et les mises en garde qu'elle décrit. */
export function setFinmaVersion(version: string): void {
  _finmaVersion = version;
}

export function getCrosswalks(): readonly CrosswalkRow[] {
  if (!_crosswalks) {
    _crosswalks = loadCsv<CrosswalkRow>("crosswalks.csv");
  }
  return _crosswalks;
}

/**
 * Répertoire officiel des localités (tâche osd.localites, tâche 2), indexé par NPA. Tolérant
 * à l'absence ou à une lecture illisible : `null`, JAMAIS une exception — `company_check`
 * sert alors la fiche sans les recoupements d'adresse qui en dépendent (voir
 * `src/mcp/company/check.ts`). L'échec de lecture est mémorisé pour ne pas retenter le
 * disque à chaque appel (le fichier n'apparaît pas en cours d'exécution en production).
 */
export function getLocalities(): { rows: readonly LocalityRow[]; byPostalCode: ReadonlyMap<string, readonly LocalityRow[]> } | null {
  if (_localitiesLoadFailed) return null;
  if (!_localities || !_localitiesByPostalCode) {
    try {
      const rows = loadCsv<LocalityRow>("localities.csv");
      const index = new Map<string, LocalityRow[]>();
      for (const row of rows) {
        const list = index.get(row.postal_code);
        if (list) list.push(row);
        else index.set(row.postal_code, [row]);
      }
      _localities = rows;
      _localitiesByPostalCode = index;
    } catch {
      _localitiesLoadFailed = true;
      return null;
    }
  }
  return { rows: _localities, byPostalCode: _localitiesByPostalCode };
}

/** Révision et sources du référentiel effectivement embarqué dans le service. */
export function getClassificationLinks(): { links: readonly ClassificationLink[]; sources: readonly ClassificationSource[]; version: string } {
  _classificationLinks ??= loadCsv<ClassificationLink>("classification_links.csv");
  _classificationSources ??= loadCsv<ClassificationSource>("classification_sources.csv");
  const versions = new Set(_classificationSources.map(s => s.version));
  if (versions.size !== 1 || !_classificationLinks.length) throw new Error("Référentiel classifications incohérent");
  return { links: _classificationLinks, sources: _classificationSources, version: _classificationSources[0].version };
}

/** Remplacement atomique des relations et de leur provenance après contrôle. */
export function setClassificationLinks(links: ClassificationLink[], sources: ClassificationSource[]): void {
  _classificationLinks = links;
  _classificationSources = sources;
}

/**
 * Index TARES : une entrée par ligne à 8 chiffres, chemin officiel dans les quatre langues.
 * Promesse partagée par les appels simultanés ; remise à zéro après un échec pour permettre un nouvel essai.
 */
export function getTaresEmbeddings(): Promise<SearchIndex> {
  if (!_taresEmbeddingsPromise) {
    _taresEmbeddingsPromise = loadSearchIndex("tares", "tares").catch((e) => {
      _taresEmbeddingsPromise = null;
      throw e;
    });
  }
  return _taresEmbeddingsPromise;
}

/** Index NOGA 2025 : une entrée par genre (6 chiffres), libellés dans les quatre langues. */
export function getNogaEmbeddings(): Promise<SearchIndex> {
  if (!_nogaEmbeddingsPromise) {
    _nogaEmbeddingsPromise = loadSearchIndex("noga_2025", "noga_2025").catch((e) => {
      _nogaEmbeddingsPromise = null;
      throw e;
    });
  }
  return _nogaEmbeddingsPromise;
}

/** Test helper: clears in-memory caches so tests can swap fixture data. */
export function _resetDataLoaderCache(): void {
  _tares = null;
  _taresVersion = null;
  _taresByHs8 = null;
  _finmaRegistry = null;
  _finmaWarnings = null;
  _finmaVersion = null;
  _crosswalks = null;
  _localities = null;
  _localitiesByPostalCode = null;
  _localitiesLoadFailed = false;
  _classificationLinks = null;
  _classificationSources = null;
  _taresEmbeddingsPromise = null;
  _nogaEmbeddingsPromise = null;
}
