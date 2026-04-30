/**
 * MCP data loader — lazy-loads bundled CSV slices into in-memory maps.
 *
 * Data files live in `src/mcp/data/` and are copied to `dist/mcp/data/` at
 * build time (see package.json `build` script). They ship inside the deploy
 * artifact, unlike the full `data/` tree which is gitignored / railwayignored.
 *
 * Datasets:
 *   - tares.csv               (TARES customs tariffs, ~7.5k HS8 rows)
 *   - finma_registry.csv      (FINMA-supervised entities, ~2.9k rows)
 *   - finma_warnings.csv      (FINMA warnings list, ~2.2k rows)
 *   - crosswalks.csv          (NOGA/NACE/ISIC translations, ~2.2k rows)
 *
 * NOTE: V2 will replace these with R2-backed parquet + a streaming reader
 * to support deltas + entity_history.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

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

let _tares: TaresRow[] | null = null;
let _taresByHs8: Map<string, TaresRow> | null = null;
let _finmaRegistry: FinmaRegistryRow[] | null = null;
let _finmaWarnings: FinmaWarningRow[] | null = null;
let _crosswalks: CrosswalkRow[] | null = null;

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

/** Test helper: clears in-memory caches so tests can swap fixture data. */
export function _resetDataLoaderCache(): void {
  _tares = null;
  _taresByHs8 = null;
  _finmaRegistry = null;
  _finmaWarnings = null;
  _crosswalks = null;
}
