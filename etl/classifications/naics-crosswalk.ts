/**
 * NAICS 2022 ↔ ISIC Rev 4 ↔ NACE Rev 2.1 / NOGA 2025 cross-walk (Pro tier add-on).
 *
 * Why: any buyer with US-side reporting (Salesforce instance with NAICS, Census
 * filings, North-American consolidation, etc.) needs to bridge between the
 * European/Swiss classifications and NAICS. We use ISIC Rev 4 as the pivot:
 *
 *     NOGA 2025 ──identity── NACE 2.1 ──XX── ISIC 4 ──Census── NAICS 2022
 *
 * The only authoritative concordance we ship is the **US Census Bureau**
 * `2022 NAICS to ISIC Rev 4` XLSX (public domain — US Government work).
 *
 * Source URL (verified 2026-04-30, HTTP 200):
 *   https://www.census.gov/naics/concordances/2022_NAICS_to_ISIC_Rev_4.xlsx
 *
 * Sheet layout (single sheet "NAICS 22 to ISIC 4 technical"):
 *   col A: "Part of NAICS US"  → '*' if the NAICS code is split across multiple ISIC,
 *                                otherwise null/empty (whole-NAICS link)
 *   col B: 2022 NAICS US        → 6-digit numeric (e.g. 111110), occasional 0 (placeholder)
 *   col C: 2022 NAICS US TITLE  → English label
 *   col D: "Part of ISIC"       → '*' if partial match
 *   col E: ISIC 4.0             → 3-digit numeric ISIC (the file uses ISIC GROUPS, not classes)
 *   col F: ISIC 4.0 TITLE       → English label
 *   col G: Notes                → free text (often empty / single space)
 *
 * Important quirk: the Census file binds NAICS-6 to **ISIC GROUPS (3-digit)**,
 * not ISIC classes. We therefore expand each link to all ISIC 4-digit classes
 * under that group when joining with NACE/NOGA. The mapping_type reflects
 * the precision lost: `partial` whenever group→class fan-out > 1, `exact`
 * when there's a single class under the group.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import XLSX from "xlsx";
import type { NomenclatureRow } from "./types.js";

/* ------------------------------------------------------------------ *
 * Public types
 * ------------------------------------------------------------------ */

export interface NaicsCrosswalkRow {
  naics_2022: string;
  naics_2022_title: string;
  isic_4: string;
  isic_4_title: string;
  nace_2_1: string | null;
  noga_2025: string | null;
  mapping_type: "exact" | "partial";
  notes: string | null;
}

export interface IngestNaicsResult {
  rows: NaicsCrosswalkRow[];
  source: {
    url: string;
    fetched_at: string;
    sheet_name: string;
    license: "Public Domain (US Government Work)";
    attribution: "U.S. Census Bureau — 2022 NAICS to ISIC Rev 4 concordance";
  };
  stats: {
    raw_links: number;
    emitted_rows: number;
    exact: number;
    partial: number;
    naics_unique: number;
    isic_unique: number;
    fetch_seconds: number;
  };
}

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

export const CENSUS_NAICS_ISIC_URL =
  "https://www.census.gov/naics/concordances/2022_NAICS_to_ISIC_Rev_4.xlsx";
export const CACHE_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
const SHEET_NAME = "NAICS 22 to ISIC 4 technical";

/* ------------------------------------------------------------------ *
 * Cache fetch
 * ------------------------------------------------------------------ */

async function downloadIfStale(url: string, path: string): Promise<void> {
  if (existsSync(path) && Date.now() - statSync(path).mtimeMs < CACHE_TTL_MS) return;
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
}

/* ------------------------------------------------------------------ *
 * Parse
 * ------------------------------------------------------------------ */

interface RawCensusLink {
  naics: string;
  naics_title: string;
  isic_group: string; // 3-digit ISIC
  isic_title: string;
  partial: boolean;
  notes: string;
}

/** Parse the Census concordance XLSX into raw NAICS↔ISIC-group links. */
export function parseCensusXlsx(path: string): RawCensusLink[] {
  const wb = XLSX.readFile(path);
  if (!wb.SheetNames.includes(SHEET_NAME)) {
    throw new Error(
      `[naics-crosswalk] expected sheet "${SHEET_NAME}", got: ${wb.SheetNames.join(", ")}`,
    );
  }
  const sheet = wb.Sheets[SHEET_NAME];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) as unknown[][];
  if (rows.length < 2) return [];

  const out: RawCensusLink[] = [];
  // Skip header row (index 0)
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const partOfNaics = r[0];
    const naicsRaw = r[1];
    const naicsTitle = r[2];
    const partOfIsic = r[3];
    const isicRaw = r[4];
    const isicTitle = r[5];
    const notes = r[6];

    if (naicsRaw === null || naicsRaw === undefined || naicsRaw === "") continue;
    if (isicRaw === null || isicRaw === undefined || isicRaw === "") continue;

    // Skip placeholder rows where NAICS == 0 (Census uses 0 to indicate "Multiple NAICS").
    const naics = String(naicsRaw).trim();
    if (naics === "0") continue;

    const isic = String(isicRaw).trim();
    const partial =
      String(partOfNaics ?? "").trim() === "*" || String(partOfIsic ?? "").trim() === "*";

    out.push({
      naics,
      naics_title: String(naicsTitle ?? "").trim(),
      isic_group: isic,
      isic_title: String(isicTitle ?? "").trim(),
      partial,
      notes: String(notes ?? "").trim(),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Crosswalk build (joining with our existing NACE/NOGA tables)
 * ------------------------------------------------------------------ */

/**
 * Expand a Census ISIC-group link into one row per ISIC 4-digit class under
 * that group (joined with NACE 2.1 / NOGA 2025 codes).
 *
 * For each NAICS↔ISIC-group link, we list the ISIC classes (4-digit codes
 * with parent === group) and emit one cross-walk row per class. This matches
 * the granularity of the rest of the bundle (NACE/NOGA cross-walks are at
 * class level).
 *
 * NACE 2.1 and NOGA 2025 codes are inherited via the existing rule
 * `NACE_2.1.code == NOGA_2025.code at class level` and the ISIC-class side.
 */
export function buildNaicsCrosswalk(
  rawLinks: ReadonlyArray<RawCensusLink>,
  allRows: ReadonlyArray<NomenclatureRow>,
): NaicsCrosswalkRow[] {
  // Index ISIC classes by their 3-digit parent group.
  const isicClassesByGroup = new Map<string, string[]>();
  for (const r of allRows) {
    if (r.scheme !== "ISIC_4") continue;
    if (r.level !== "class") continue;
    if (!r.parent) continue;
    const list = isicClassesByGroup.get(r.parent) ?? [];
    list.push(r.code);
    isicClassesByGroup.set(r.parent, list);
  }

  // Index NACE 2.1 codes (set membership) for join lookup.
  const nace21Set = new Set(
    allRows.filter((r) => r.scheme === "NACE_2.1").map((r) => r.code),
  );
  const noga25Set = new Set(
    allRows.filter((r) => r.scheme === "NOGA_2025").map((r) => r.code),
  );

  const out: NaicsCrosswalkRow[] = [];
  for (const link of rawLinks) {
    const classes = isicClassesByGroup.get(link.isic_group) ?? [];
    if (classes.length === 0) {
      // No ISIC class under this group in our table → emit one "best-effort" row
      // anchored on the group. Still useful to preserve the NAICS↔ISIC-group link.
      out.push({
        naics_2022: link.naics,
        naics_2022_title: link.naics_title,
        isic_4: link.isic_group,
        isic_4_title: link.isic_title,
        nace_2_1: null,
        noga_2025: null,
        mapping_type: "partial",
        notes: link.notes
          ? `${link.notes} [no ISIC 4-digit class under group ${link.isic_group}]`
          : `no ISIC 4-digit class under group ${link.isic_group}`,
      });
      continue;
    }
    const fanOutPartial = classes.length > 1 || link.partial;
    for (const isicClass of classes) {
      const nace = nace21Set.has(isicClass) ? isicClass : null;
      const noga = noga25Set.has(isicClass) ? isicClass : null;
      out.push({
        naics_2022: link.naics,
        naics_2022_title: link.naics_title,
        isic_4: isicClass,
        isic_4_title: link.isic_title,
        nace_2_1: nace,
        noga_2025: noga,
        mapping_type: fanOutPartial ? "partial" : "exact",
        notes: link.notes || null,
      });
    }
  }
  // Stable order so identical inputs produce identical bundles.
  out.sort((a, b) => {
    if (a.naics_2022 !== b.naics_2022) return a.naics_2022.localeCompare(b.naics_2022);
    return a.isic_4.localeCompare(b.isic_4);
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Top-level orchestrator
 * ------------------------------------------------------------------ */

export interface IngestNaicsOptions {
  /** Cache directory for the Census XLSX. Default `data/classifications/naics-cache/`. */
  cacheDir?: string;
  /** Already-ingested rows (used to expand ISIC groups → classes + lookup NACE/NOGA). */
  rows: ReadonlyArray<NomenclatureRow>;
}

/**
 * Top-level entry: download (cached) the Census XLSX, parse it, and join
 * with the existing in-memory rows (ISIC + NACE 2.1 + NOGA 2025).
 */
export async function ingestNaicsCrosswalk(
  opts: IngestNaicsOptions,
): Promise<IngestNaicsResult> {
  const cacheDir = opts.cacheDir ?? "./data/classifications/naics-cache";
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, "2022_NAICS_to_ISIC_Rev_4.xlsx");

  const t0 = Date.now();
  await downloadIfStale(CENSUS_NAICS_ISIC_URL, cachePath);

  const rawLinks = parseCensusXlsx(cachePath);
  const rows = buildNaicsCrosswalk(rawLinks, opts.rows);

  const fetchSeconds = (Date.now() - t0) / 1000;

  const naicsUnique = new Set(rows.map((r) => r.naics_2022)).size;
  const isicUnique = new Set(rows.map((r) => r.isic_4)).size;

  return {
    rows,
    source: {
      url: CENSUS_NAICS_ISIC_URL,
      fetched_at: new Date().toISOString(),
      sheet_name: SHEET_NAME,
      license: "Public Domain (US Government Work)",
      attribution: "U.S. Census Bureau — 2022 NAICS to ISIC Rev 4 concordance",
    },
    stats: {
      raw_links: rawLinks.length,
      emitted_rows: rows.length,
      exact: rows.filter((r) => r.mapping_type === "exact").length,
      partial: rows.filter((r) => r.mapping_type === "partial").length,
      naics_unique: naicsUnique,
      isic_unique: isicUnique,
      fetch_seconds: fetchSeconds,
    },
  };
}

/** CSV row shape used by `bundle.ts` when serialising. */
export function naicsCrosswalkToCsvRow(r: NaicsCrosswalkRow): Record<string, string> {
  return {
    naics_2022: r.naics_2022,
    naics_2022_title: r.naics_2022_title,
    isic_4: r.isic_4,
    isic_4_title: r.isic_4_title,
    nace_2_1: r.nace_2_1 ?? "",
    noga_2025: r.noga_2025 ?? "",
    mapping_type: r.mapping_type,
    notes: r.notes ?? "",
  };
}
