import XLSX from "xlsx";
const { readFile, utils } = XLSX;
import { readFileSync } from "node:fs";
import type { FinmaEntity, FinmaSource } from "./types.js";
import { unifyRow } from "./unify-schema.js";
import {
  AUTH_TYPE_TO_ENTITY_TYPE,
  FINMA_UID_CSV_SOURCE,
  downloadUidCsv,
} from "./sources.js";

/**
 * Parse one FINMA XLSX file with the given source config.
 * The first row is treated as header.
 */
export function ingestOneSource(path: string, source: FinmaSource): FinmaEntity[] {
  const wb = readFile(path);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const out: FinmaEntity[] = [];
  for (const raw of rows) {
    const unified = unifyRow(raw, source);
    if (unified) out.push(unified);
  }
  return out;
}

/**
 * Parse the official FINMA uid.csv (semicolon-separated).
 * Columns: Name; City; AuthorisationTypeDE; AuthorisationTypeFR; AuthorisationTypeIT; AuthorisationTypeEN; UID
 */
export function parseUidCsv(path: string): FinmaEntity[] {
  let content = readFileSync(path, "utf8");
  // Strip UTF-8 BOM if present (FINMA's uid.csv ships with a BOM that would
  // otherwise corrupt the first header name).
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const out: FinmaEntity[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < headers.length) continue;
    const raw: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) raw[headers[j]] = cells[j];
    const unified = unifyRow(raw, FINMA_UID_CSV_SOURCE);
    if (!unified) continue;
    // Override entity_type using AuthorisationTypeEN mapping (the source's
    // placeholder "bank" gets replaced by the real type).
    const authEn = String(raw["AuthorisationTypeEN"] ?? "").trim();
    unified.entity_type = AUTH_TYPE_TO_ENTITY_TYPE[authEn] ?? "other";
    out.push(unified);
  }
  return out;
}

/**
 * Minimal RFC-4180-ish CSV parser tuned for the FINMA uid.csv (semicolon-separated,
 * double-quoted, no embedded newlines in observed data).
 */
function parseCsvLine(line: string, sep = ";"): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (line[i + 1] === "\"") { cur += "\""; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === "\"") inQuotes = true;
      else if (ch === sep) { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Ingest from official FINMA uid.csv (downloads + parses).
 */
export async function ingestFromFinmaCsv(opts: { cacheDir: string }): Promise<{
  entities: FinmaEntity[];
  stats: { total: number; unmappedTypes: Record<string, number> };
}> {
  const path = await downloadUidCsv(opts.cacheDir);
  const entities = parseUidCsv(path);
  const unmappedTypes: Record<string, number> = {};
  for (const e of entities) {
    if (e.entity_type === "other" && e.licence_type) {
      unmappedTypes[e.licence_type] = (unmappedTypes[e.licence_type] ?? 0) + 1;
    }
  }
  return { entities, stats: { total: entities.length, unmappedTypes } };
}
