import { readFile, utils } from "xlsx";
import type { FinmaEntity, FinmaSource } from "./types.js";
import { unifyRow } from "./unify-schema.js";

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
