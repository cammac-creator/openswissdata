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
 *   - embeddings/tares_embeddings.parquet    (TARES FR mpnet 768d, ~7.5k vectors)
 *   - embeddings/noga_2025_embeddings.parquet (NOGA FR mpnet 768d, ~1.8k vectors)
 *
 * NOTE: V2 will replace these with R2-backed parquet + a streaming reader
 * to support deltas + entity_history.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import parquet from "parquetjs-lite";

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

/** Pre-computed embedding row, materialised once at first use. */
export interface EmbeddingRow {
  code: string;
  lang: string;
  description: string;
  /** Float32Array of fixed dimension (768). L2-normalised at generation time. */
  vector: Float32Array;
}

export interface StatentRow {
  canton_code: string;
  canton_name: string;
  noga_division: string;
  noga_label: string;
  year: string;
  etablissements: string;
  emplois: string;
  emplois_eq_plein_temps: string;
}

let _tares: TaresRow[] | null = null;
let _taresByHs8: Map<string, TaresRow> | null = null;
let _finmaRegistry: FinmaRegistryRow[] | null = null;
let _finmaWarnings: FinmaWarningRow[] | null = null;
let _crosswalks: CrosswalkRow[] | null = null;
let _statent: StatentRow[] | null = null;
let _taresEmbeddingsPromise: Promise<EmbeddingRow[]> | null = null;
let _nogaEmbeddingsPromise: Promise<EmbeddingRow[]> | null = null;

function loadCsv<T>(filename: string): T[] {
  const path = join(DATA_DIR, filename);
  const raw = readFileSync(path, "utf8");
  return parse(raw, { columns: true, skip_empty_lines: true, relax_quotes: true }) as T[];
}

export function getTares(): { rows: readonly TaresRow[]; byHs8: ReadonlyMap<string, TaresRow> } {
  if (!_tares || !_taresByHs8) {
    _tares = loadCsv<TaresRow>("tares.csv");
    _taresByHs8 = new Map(_tares.map((r) => [r.hs8, r]));
  }
  return { rows: _tares, byHs8: _taresByHs8 };
}

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

export function getCrosswalks(): readonly CrosswalkRow[] {
  if (!_crosswalks) {
    _crosswalks = loadCsv<CrosswalkRow>("crosswalks.csv");
  }
  return _crosswalks;
}

export function getStatent(): readonly StatentRow[] {
  if (!_statent) {
    _statent = loadCsv<StatentRow>("statent.csv");
  }
  return _statent;
}

/**
 * Read every row of a Parquet file into memory. We use this once per
 * embeddings dataset (TARES ~7.5k × 768f = 23 MB; NOGA ~1.8k × 768f = 5.6 MB)
 * — well within RAM budget. parquetjs-lite is async-cursor only.
 */
interface ParquetEmbeddingRow {
  hs_code?: string;
  code?: string;
  lang: string;
  description: string;
  embedding: number[];
}

async function readEmbeddingsParquet(filename: string): Promise<EmbeddingRow[]> {
  const path = join(DATA_DIR, "embeddings", filename);
  const reader = await parquet.ParquetReader.openFile(path);
  try {
    const cursor = reader.getCursor();
    const out: EmbeddingRow[] = [];
    let row: ParquetEmbeddingRow | null = (await cursor.next()) as ParquetEmbeddingRow | null;
    while (row) {
      // Schemas differ: TARES bundle uses `hs_code`, classifications uses `code`.
      const code = row.hs_code ?? row.code ?? "";
      out.push({
        code,
        lang: row.lang,
        description: row.description,
        // Float32 keeps memory ~half of double — cosine math handles it natively.
        vector: new Float32Array(row.embedding),
      });
      row = (await cursor.next()) as ParquetEmbeddingRow | null;
    }
    return out;
  } finally {
    await reader.close();
  }
}

/**
 * TARES embeddings — multilingual mpnet 768d, FR-only in v1.
 * Promise-cached so concurrent boot calls share the same load.
 */
export function getTaresEmbeddings(): Promise<EmbeddingRow[]> {
  if (!_taresEmbeddingsPromise) {
    _taresEmbeddingsPromise = readEmbeddingsParquet("tares_embeddings.parquet").catch((e) => {
      // Reset on failure so a retried request can attempt again rather than
      // sticking to a poisoned promise forever.
      _taresEmbeddingsPromise = null;
      throw e;
    });
  }
  return _taresEmbeddingsPromise;
}

/**
 * NOGA 2025 embeddings — multilingual mpnet 768d, FR-only in v1.
 * Promise-cached so concurrent boot calls share the same load.
 */
export function getNogaEmbeddings(): Promise<EmbeddingRow[]> {
  if (!_nogaEmbeddingsPromise) {
    _nogaEmbeddingsPromise = readEmbeddingsParquet("noga_2025_embeddings.parquet").catch((e) => {
      _nogaEmbeddingsPromise = null;
      throw e;
    });
  }
  return _nogaEmbeddingsPromise;
}

/** Test helper: clears in-memory caches so tests can swap fixture data. */
export function _resetDataLoaderCache(): void {
  _tares = null;
  _taresByHs8 = null;
  _finmaRegistry = null;
  _finmaWarnings = null;
  _crosswalks = null;
  _taresEmbeddingsPromise = null;
  _nogaEmbeddingsPromise = null;
}
