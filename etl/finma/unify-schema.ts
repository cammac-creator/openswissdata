import type { FinmaEntity, FinmaSource, FinmaWarning } from "./types.js";

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

// ---------------------------------------------------------------------------
// Warning-list cross-reference
// ---------------------------------------------------------------------------

/**
 * Legal-form suffixes and noise words to strip when normalizing names for
 * fuzzy matching. Keep it conservative: too aggressive and we get false
 * positives between unrelated companies sharing a generic stem.
 */
const NAME_NOISE = [
  "ag", "sa", "sarl", "sàrl", "gmbh", "ltd", "limited", "inc", "incorporated",
  "llc", "llp", "lp", "plc", "kg", "ohg", "se", "ev", "co", "corp", "corporation",
  "company", "holding", "group", "groupe", "and", "the",
];

const NAME_NOISE_SET = new Set(NAME_NOISE);

/**
 * Normalize an entity name for fuzzy matching:
 *   1. Lowercase
 *   2. Replace any non-alphanumeric with a single space
 *   3. Drop legal-form suffixes / noise words
 *   4. Collapse whitespace
 *
 * Example: "Premiere Swiss Trust AG" -> "premiere swiss trust"
 */
export function normalizeNameForMatch(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0 && !NAME_NOISE_SET.has(w))
    .join(" ")
    .trim();
}

/**
 * Levenshtein distance between two strings (iterative DP, O(m*n) time, O(min(m,n)) space).
 * Pure function; used for fuzzy name matching against the warnings list.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Ensure a is the shorter string for memory efficiency.
  if (a.length > b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }
  const prev = new Array<number>(a.length + 1);
  const curr = new Array<number>(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;
  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,    // insertion
        prev[i] + 1,        // deletion
        prev[i - 1] + cost, // substitution
      );
    }
    for (let i = 0; i <= a.length; i++) prev[i] = curr[i];
  }
  return prev[a.length];
}

/**
 * Similarity score in [0, 1]. 1 = identical, 0 = totally different.
 */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / maxLen;
}

/**
 * Mutate `entities` in place, setting `is_warning_listed = true` on rows whose
 * normalized name fuzzy-matches a normalized warning name with score >= threshold.
 *
 * Authorised registries and warning lists are disjoint by definition, so we
 * expect very few (often zero) matches — that's a correct outcome, not a bug.
 *
 * @returns the number of entities flagged.
 */
export function flagWarningsOnRegistry(
  entities: FinmaEntity[],
  warnings: FinmaWarning[],
  threshold = 0.8,
): number {
  if (entities.length === 0 || warnings.length === 0) return 0;
  const normalizedWarnings: string[] = [];
  for (const w of warnings) {
    const n = normalizeNameForMatch(w.name);
    if (n.length >= 3) normalizedWarnings.push(n);
  }
  if (normalizedWarnings.length === 0) return 0;

  let flagged = 0;
  for (const e of entities) {
    const en = normalizeNameForMatch(e.name);
    if (en.length < 3) continue;
    let bestScore = 0;
    for (const wn of normalizedWarnings) {
      // Cheap pre-filter: require a 3-char prefix overlap or substring
      // containment. Skips ~99% of the 1500*2200 = 3.3M pairs.
      if (
        wn[0] !== en[0] ||
        (Math.abs(wn.length - en.length) / Math.max(wn.length, en.length) > 1 - threshold)
      ) {
        continue;
      }
      const score = similarity(en, wn);
      if (score > bestScore) {
        bestScore = score;
        if (bestScore >= 0.999) break;
      }
    }
    if (bestScore >= threshold) {
      e.is_warning_listed = true;
      flagged++;
    }
  }
  return flagged;
}
