import type { FinmaEntity, FinmaSource } from "./types.js";

/**
 * Normalize a UID to canonical CHE-xxx.xxx.xxx form, or return undefined if unparseable.
 */
function normalizeUid(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  // Accept "CHE-123.456.789", "CHE123456789", "123456789", etc.
  const digits = s.replace(/[^0-9]/g, "");
  if (digits.length !== 9) return s; // keep original if not clearly a UID; caller may ignore
  return `CHE-${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}`;
}

function normalizeCanton(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(s)) return s;
  return s || undefined;
}

function normalizeDate(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  // Try ISO first
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Try DD.MM.YYYY (common in CH)
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Fallback: Excel date serial (numeric string)
  const asNum = Number(s);
  if (!Number.isNaN(asNum) && asNum > 40000 && asNum < 60000) {
    const msPerDay = 24 * 3600 * 1000;
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + asNum * msPerDay);
    return d.toISOString().slice(0, 10);
  }
  return s;
}

/**
 * Given a raw row (object keyed by column headers) and the FinmaSource config,
 * produce a unified FinmaEntity. Returns null if no name can be resolved.
 */
export function unifyRow(raw: Record<string, unknown>, source: FinmaSource): FinmaEntity | null {
  const mapped: Partial<FinmaEntity> = {
    entity_type: source.entity_type,
    source_list: source.source_list,
    source_url: source.source_url,
  };
  for (const [col, field] of Object.entries(source.headers_map)) {
    if (!field) continue;
    const v = raw[col];
    if (v === null || v === undefined || String(v).trim() === "") continue;
    if (field === "uid") mapped.uid = normalizeUid(v);
    else if (field === "canton") mapped.canton = normalizeCanton(v);
    else if (field === "licence_date") mapped.licence_date = normalizeDate(v);
    else (mapped as Record<string, unknown>)[field] = String(v).trim();
  }
  if (!mapped.name) return null;
  return mapped as FinmaEntity;
}
