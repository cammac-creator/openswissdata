/**
 * STATENT — Statistique structurelle des entreprises (BFS)
 *
 * Source : opendata.swiss STATENT (BFS, OFS).
 *   https://opendata.swiss/fr/dataset/betriebszahlung-unternehmensstatistik-arbeitsstatten
 *
 * The bulk download advertised on opendata.swiss for STATENT is a hectare-grid
 * GEOSTAT product (XLSX, key 32258831) — not what we need for joining with
 * NOGA. The structural data (establishments + FTE × dimensions × year) is
 * exposed via the BFS PX-Web JSON-stat2 API:
 *
 *   - `_101` : Année × Canton × NOGA division (2-digit) × Unité d'observation
 *   - `_102` : Année × Commune × Secteur économique × Unité d'observation
 *
 * Important — confidentiality:
 *   BFS does NOT publish a commune × full-NOGA-class table publicly because
 *   cells with 1–4 establishments are suppressed for statistical confidentiality.
 *   What we ship are the two complementary public slices:
 *     - canton × NOGA division (joins to `noga_2008` / `noga_2025` on the 2-digit code)
 *     - commune × sector (4 sectors: total / primary / secondary / tertiary)
 *
 * License — `terms_by_ask` (CH Open Data ToU): free non-commercial, commercial use
 * requires written authorisation from BFS. The Classifications Pro tier MUST
 * have a written waiver from BFS before redistributing this dataset to paying
 * customers (contact: statent@bfs.admin.ch).
 *
 * The PX-Web API caps response size; we therefore chunk per Jahr (year). For
 * each table, we issue 14 small POST requests (2011–2024, falling back gracefully
 * when a year is not yet available) and concatenate the long-form rows.
 *
 * We cache each per-year JSON-stat2 response in `cacheDir/statent_<table>_<year>.json`
 * with a 30-day TTL.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PXWEB_BASE = "https://www.pxweb.bfs.admin.ch/api/v1/fr";
const TABLE_CANTON_DIVISION = "px-x-0602010000_101";
const TABLE_COMMUNE_SECTOR = "px-x-0602010000_102";
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
const DEFAULT_YEARS = [
  2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024,
] as const;

/* ---------------------------------------------------------------- *
 * Public types
 * ---------------------------------------------------------------- */

export type StatentObservationUnit =
  | "establishments"
  | "employment_total"
  | "employment_female"
  | "employment_male"
  | "fte_total"
  | "fte_female"
  | "fte_male";

/**
 * One long-form row from STATENT (canton × NOGA division × year).
 *
 * `noga_division` is a 2-digit NOGA code such as "01", "47", "62" (or "999" for
 * the "all divisions" aggregate, which we drop). `noga_division` joins to the
 * `code` column of the Classifications nomenclatures at level=division.
 */
export interface StatentCantonDivisionRow {
  year: number;
  canton_bfs_id: number;       // 1..26 ; 999 (= Switzerland total) is dropped
  canton_label: string;
  noga_division: string;       // 2-digit, e.g. "47", "01"
  noga_division_label: string; // e.g. "47 Commerce de détail…"
  observation_unit: StatentObservationUnit;
  value: number | null;        // null = confidentiality-suppressed
}

/**
 * One long-form row from STATENT (commune × sector × year).
 *
 * Sectors are NOGA-derived buckets: total / primary / secondary / tertiary.
 * `commune_bfs_id` is the official BFS commune identifier; `99999` = CH total
 * is dropped.
 */
export interface StatentCommuneSectorRow {
  year: number;
  commune_bfs_id: number;      // BFS code (e.g. 261 = Zürich, 6621 = Lausanne)
  commune_label: string;
  sector: "total" | "primary" | "secondary" | "tertiary";
  sector_label: string;
  observation_unit: StatentObservationUnit;
  value: number | null;
}

export interface IngestStatentResult {
  cantonDivision: StatentCantonDivisionRow[];
  communeSector: StatentCommuneSectorRow[];
  source: {
    table_canton_division: string;
    table_commune_sector: string;
    api_base: string;
    license: string;
    attribution: string;
    permission_status: string;
  };
  stats: {
    canton_division_rows: number;
    commune_sector_rows: number;
    suppressed_cells: number;
    years_ingested: number[];
    years_missing: number[];
    fetch_seconds: number;
  };
}

export interface IngestStatentOptions {
  cacheDir: string;
  /** Subset of years to pull. Defaults to 2011..2024. */
  years?: readonly number[];
  /** If true, skip the `_102` slice (used by tests). */
  skipCommune?: boolean;
}

/* ---------------------------------------------------------------- *
 * JSON-stat2 minimal types (we only consume what we need)
 * ---------------------------------------------------------------- */

interface JsonStatCategory {
  index: Record<string, number>;
  label: Record<string, string>;
}
interface JsonStatDimension {
  label: string;
  category: JsonStatCategory;
}
interface JsonStat2Response {
  class: "dataset";
  label: string;
  source: string;
  updated: string;
  id: string[];
  size: number[];
  dimension: Record<string, JsonStatDimension>;
  value: Array<number | null>;
}

const OBS_UNIT_MAP: Record<string, StatentObservationUnit> = {
  "1": "establishments",
  "2": "employment_total",
  "3": "employment_female",
  "4": "employment_male",
  "5": "fte_total",
  "6": "fte_female",
  "7": "fte_male",
};

/* ---------------------------------------------------------------- *
 * Cache + fetch helpers
 * ---------------------------------------------------------------- */

async function pxwebFetch(
  table: string,
  body: object,
  cachePath: string,
): Promise<JsonStat2Response> {
  if (existsSync(cachePath) && Date.now() - statSync(cachePath).mtimeMs < CACHE_TTL_MS) {
    return JSON.parse(readFileSync(cachePath, "utf8")) as JsonStat2Response;
  }
  const url = `${PXWEB_BASE}/${table}/${table}.px`;
  // Retry once on 429/503 with a short wait.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 404 || res.status === 400) {
        // 404 = year value not in dataset.
        // 400 = invalid value selection — same effect (year not yet published).
        // PX-Web's behaviour varies; we treat both as "year missing".
        throw new PxwebMissingYearError(`PX-Web returned ${res.status} for ${url}`);
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`PX-Web ${url} HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as JsonStat2Response;
      writeFileSync(cachePath, JSON.stringify(json));
      return json;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err instanceof PxwebMissingYearError) throw err;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
    }
  }
  throw lastErr ?? new Error(`PX-Web ${url} failed`);
}

class PxwebMissingYearError extends Error {}

/* ---------------------------------------------------------------- *
 * JSON-stat2 → long-form rows
 *
 * The `value` array is a flattened C-order tensor whose dimension order is
 * given by `id`. For our queries this is always:
 *   [Jahr, Kanton|Gemeinde, Wirtschaftsabteilung|Wirtschaftssektor, Beobachtungseinheit]
 *
 * Per JSON-stat2 spec, the rightmost dimension varies fastest. We index from
 * each dimension's `category.index` (which gives the position in the tensor).
 * ---------------------------------------------------------------- */

function dimEntries(d: JsonStatDimension): { code: string; label: string; pos: number }[] {
  return Object.entries(d.category.index)
    .map(([code, pos]) => ({ code, label: d.category.label[code] ?? code, pos }))
    .sort((a, b) => a.pos - b.pos);
}

function parseCantonDivision(json: JsonStat2Response, year: number): StatentCantonDivisionRow[] {
  const dimYear = dimEntries(json.dimension.Jahr);
  const dimCanton = dimEntries(json.dimension.Kanton);
  const dimDivision = dimEntries(json.dimension.Wirtschaftsabteilung);
  const dimUnit = dimEntries(json.dimension.Beobachtungseinheit);

  const sizeYear = dimYear.length;
  const sizeCanton = dimCanton.length;
  const sizeDivision = dimDivision.length;
  const sizeUnit = dimUnit.length;

  // C-order: idx = ((y * C + c) * D + d) * U + u
  const out: StatentCantonDivisionRow[] = [];
  for (let y = 0; y < sizeYear; y++) {
    for (let c = 0; c < sizeCanton; c++) {
      const cantonCode = dimCanton[c].code;
      // Drop national aggregate (999) — we join on canton-level data only.
      if (cantonCode === "999") continue;
      const cantonId = Number(cantonCode);
      if (!Number.isFinite(cantonId)) continue;
      for (let d = 0; d < sizeDivision; d++) {
        const divCode = dimDivision[d].code;
        // Drop "all divisions" aggregate.
        if (divCode === "999") continue;
        const divPadded = divCode.padStart(2, "0");
        for (let u = 0; u < sizeUnit; u++) {
          const obs = OBS_UNIT_MAP[dimUnit[u].code];
          if (!obs) continue;
          const idx = ((y * sizeCanton + c) * sizeDivision + d) * sizeUnit + u;
          out.push({
            year,
            canton_bfs_id: cantonId,
            canton_label: dimCanton[c].label,
            noga_division: divPadded,
            noga_division_label: dimDivision[d].label,
            observation_unit: obs,
            value: json.value[idx] ?? null,
          });
        }
      }
    }
  }
  void sizeYear;
  return out;
}

const SECTOR_BY_CODE: Record<string, { key: StatentCommuneSectorRow["sector"]; label: string }> = {
  // The PX-Web codes for sectors are positional (1..4) but we keep the labels
  // to map them back to canonical English keys.
};

function mapSectorLabel(label: string): {
  key: StatentCommuneSectorRow["sector"];
  label: string;
} {
  const lower = label.toLowerCase();
  if (lower.includes("total")) return { key: "total", label };
  if (lower.includes("primaire") || lower.includes("primär") || lower.includes("primario"))
    return { key: "primary", label };
  if (lower.includes("secondaire") || lower.includes("sekundär") || lower.includes("secondario"))
    return { key: "secondary", label };
  if (lower.includes("tertiaire") || lower.includes("tertiär") || lower.includes("terziario"))
    return { key: "tertiary", label };
  // Fall back to "total" for the leading aggregate row; the BFS uses the very
  // first label as the total.
  return { key: "total", label };
}

function parseCommuneSector(json: JsonStat2Response, year: number): StatentCommuneSectorRow[] {
  const dimYear = dimEntries(json.dimension.Jahr);
  const dimCommune = dimEntries(json.dimension.Gemeinde);
  const dimSector = dimEntries(json.dimension.Wirtschaftssektor);
  const dimUnit = dimEntries(json.dimension.Beobachtungseinheit);

  const sizeYear = dimYear.length;
  const sizeCommune = dimCommune.length;
  const sizeSector = dimSector.length;
  const sizeUnit = dimUnit.length;

  // Pre-compute sector labels.
  const sectorMeta = dimSector.map((s) => mapSectorLabel(s.label));

  const out: StatentCommuneSectorRow[] = [];
  for (let y = 0; y < sizeYear; y++) {
    for (let cm = 0; cm < sizeCommune; cm++) {
      const communeCode = dimCommune[cm].code;
      if (communeCode === "99999") continue; // CH total — drop
      const communeId = Number(communeCode);
      if (!Number.isFinite(communeId)) continue;
      // Strip the "<id> " prefix BFS prepends to the label, e.g. "261 Zürich" → "Zürich".
      const rawLabel = dimCommune[cm].label;
      const cleanLabel = rawLabel.replace(/^\d+\s+/, "");
      for (let s = 0; s < sizeSector; s++) {
        const meta = sectorMeta[s];
        for (let u = 0; u < sizeUnit; u++) {
          const obs = OBS_UNIT_MAP[dimUnit[u].code];
          if (!obs) continue;
          const idx = ((y * sizeCommune + cm) * sizeSector + s) * sizeUnit + u;
          out.push({
            year,
            commune_bfs_id: communeId,
            commune_label: cleanLabel,
            sector: meta.key,
            sector_label: meta.label,
            observation_unit: obs,
            value: json.value[idx] ?? null,
          });
        }
      }
    }
  }
  void SECTOR_BY_CODE;
  void sizeYear;
  return out;
}

/* ---------------------------------------------------------------- *
 * Public ingest function
 * ---------------------------------------------------------------- */

export async function ingestStatent(opts: IngestStatentOptions): Promise<IngestStatentResult> {
  const years = opts.years ?? DEFAULT_YEARS;
  if (!existsSync(opts.cacheDir)) mkdirSync(opts.cacheDir, { recursive: true });

  const start = Date.now();
  const cantonDivision: StatentCantonDivisionRow[] = [];
  const communeSector: StatentCommuneSectorRow[] = [];
  const yearsIngested: number[] = [];
  const yearsMissing: number[] = [];
  let suppressedCells = 0;

  for (const year of years) {
    let yearOk = true;

    // _101 : canton × NOGA division
    try {
      const cachePath101 = join(opts.cacheDir, `statent_101_${year}.json`);
      const json = await pxwebFetch(
        TABLE_CANTON_DIVISION,
        {
          query: [
            { code: "Jahr", selection: { filter: "item", values: [String(year)] } },
            { code: "Kanton", selection: { filter: "all", values: ["*"] } },
            { code: "Wirtschaftsabteilung", selection: { filter: "all", values: ["*"] } },
            { code: "Beobachtungseinheit", selection: { filter: "all", values: ["*"] } },
          ],
          response: { format: "json-stat2" },
        },
        cachePath101,
      );
      const rows = parseCantonDivision(json, year);
      cantonDivision.push(...rows);
      suppressedCells += rows.filter((r) => r.value === null).length;
      console.log(
        `[statent] _101 year=${year} rows=${rows.length} (cumulative=${cantonDivision.length})`,
      );
    } catch (err) {
      if (err instanceof PxwebMissingYearError) {
        yearOk = false;
      } else {
        throw err;
      }
    }

    // _102 : commune × sector
    if (!opts.skipCommune) {
      try {
        const cachePath102 = join(opts.cacheDir, `statent_102_${year}.json`);
        const json = await pxwebFetch(
          TABLE_COMMUNE_SECTOR,
          {
            query: [
              { code: "Jahr", selection: { filter: "item", values: [String(year)] } },
              { code: "Gemeinde", selection: { filter: "all", values: ["*"] } },
              { code: "Wirtschaftssektor", selection: { filter: "all", values: ["*"] } },
              { code: "Beobachtungseinheit", selection: { filter: "all", values: ["*"] } },
            ],
            response: { format: "json-stat2" },
          },
          cachePath102,
        );
        const rows = parseCommuneSector(json, year);
        communeSector.push(...rows);
        suppressedCells += rows.filter((r) => r.value === null).length;
        console.log(
          `[statent] _102 year=${year} rows=${rows.length} (cumulative=${communeSector.length})`,
        );
      } catch (err) {
        if (err instanceof PxwebMissingYearError) {
          yearOk = false;
        } else {
          throw err;
        }
      }
    }

    if (yearOk) yearsIngested.push(year);
    else yearsMissing.push(year);
  }

  return {
    cantonDivision,
    communeSector,
    source: {
      table_canton_division: TABLE_CANTON_DIVISION,
      table_commune_sector: TABLE_COMMUNE_SECTOR,
      api_base: PXWEB_BASE,
      license: "terms_by_ask (CH Open Data ToU): free non-commercial; commercial use requires BFS authorisation (statent@bfs.admin.ch)",
      attribution: "OFS — Statistique structurelle des entreprises (STATENT)",
      permission_status:
        "Public re-publication of official BFS data. Commercial redistribution within Classifications Pro requires a written waiver from BFS.",
    },
    stats: {
      canton_division_rows: cantonDivision.length,
      commune_sector_rows: communeSector.length,
      suppressed_cells: suppressedCells,
      years_ingested: yearsIngested,
      years_missing: yearsMissing,
      fetch_seconds: (Date.now() - start) / 1000,
    },
  };
}
