import XLSX from "../shared/xlsx.js";
const { readFile, utils } = XLSX;
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
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
  if (!content.trim()) return [];
  const records = parse(escapeBareQuotes(content), {
    delimiter: ";", skip_empty_lines: true,
    columns: (headers: string[]) => {
      if (!["Name", "City", "UID", "AuthorisationTypeEN"].every(h => headers.includes(h))) throw new Error("Colonnes FINMA inattendues : publication annulée");
      return headers;
    },
  }) as Record<string, string>[];
  const out: FinmaEntity[] = [];
  for (const raw of records) {
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

// Certaines raisons sociales du CSV officiel contiennent des guillemets non doublés.
// Réparer seulement les guillemets intérieurs ; le parseur conserve les contrôles
// de colonnes, les séparateurs dans un champ et les noms sur plusieurs lignes.
function escapeBareQuotes(content: string): string {
  let quoted = false;
  let atStart = true;
  let out = "";
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (atStart && char === '"') { quoted = true; atStart = false; out += char; continue; }
    if (quoted && char === '"') {
      const next = content[i + 1];
      if (next === '"') { out += '""'; i++; continue; }
      if (next === undefined || next === ';' || next === '\r' || next === '\n') quoted = false;
      else { out += '""'; continue; }
    }
    out += char;
    if (!quoted) atStart = char === ';' || char === '\r' || char === '\n';
  }
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
