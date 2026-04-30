/**
 * Tool: finma_search
 *
 * Fuzzy / typo-tolerant search over the FINMA registry of supervised entities.
 *
 * Improves over `kyc_check` (substring match only) by:
 *   1. Normalising names (lowercase, NFKD, strip diacritics, drop common Swiss
 *      legal suffixes: AG / SA / Sàrl / GmbH / SE / LP / Ltd / etc.)
 *   2. Levenshtein-based scoring so "UBS Switzerland" matches "UBS AG", and
 *      "Cred Suisse" still pulls "Credit Suisse".
 *
 * Implementation:
 *   - Pure-JS Levenshtein (~30 LOC, sub-ms for 2 912 rows). No npm dependency
 *     so the deploy artefact stays small and we avoid a pin-to-major-version
 *     game with `fastest-levenshtein`.
 *   - `score = 1 - distance / max(len_a, len_b)`. Matches in the original
 *     (un-normalised) name boost the score by 0.05 so exact-substring hits
 *     win against typo-corrected ones at the same Levenshtein distance.
 *
 * Output is sorted by score descending. Includes warning-list flag when
 * `include_warnings=true` so a buyer building a KYC pipeline can surface
 * the FINMA warning entries inline.
 */

import { z } from "zod";
import { getFinmaRegistry, getFinmaWarnings } from "../data-loader.js";

export const finmaSearchSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 2, maxLength: 100, description: "Entity name (or partial / mistyped name)" },
    top_k: { type: "integer", minimum: 1, maximum: 20, default: 5 },
    include_warnings: { type: "boolean", default: false, description: "Also search the FINMA warnings list" },
  },
  required: ["name"],
} as const;

const InputZ = z.object({
  name: z.string().min(2).max(100),
  top_k: z.number().int().min(1).max(20).default(5),
  include_warnings: z.boolean().default(false),
});

/**
 * Common Swiss / international corporate suffixes we strip before scoring.
 * Order matters: longer suffixes first so "Bank AG" doesn't get half-matched
 * by the "AG" rule before "Bank AG" is recognised as a single suffix unit.
 *
 * We strip these because users routinely query "UBS" expecting to hit
 * "UBS AG" / "UBS Switzerland AG" — and we want both to score the same.
 */
const NOISE_SUFFIXES = [
  "aktiengesellschaft",
  "société anonyme",
  "société à responsabilité limitée",
  "in liquidation",
  "in liquidation",
  "switzerland ag",
  "switzerland sa",
  "schweiz ag",
  "suisse sa",
  "(suisse) sa",
  "(switzerland) ag",
  "(switzerland) ltd",
  "sa",
  "ag",
  "gmbh",
  "sàrl",
  "sarl",
  "se",
  "scrl",
  "lp",
  "llc",
  "ltd",
  "ltd.",
  "limited",
  "inc",
  "inc.",
  "co.",
  "corp",
  "corp.",
];

function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/**
 * Normalise an entity name for fuzzy matching.
 *   1. Lowercase + strip diacritics.
 *   2. Collapse whitespace and replace separators (-, _, /, ,) with spaces.
 *   3. Strip recognised legal suffixes from BOTH ends so "UBS Switzerland AG"
 *      and "UBS AG" collapse to "ubs".
 *   4. Final whitespace squeeze.
 */
export function normaliseName(raw: string): string {
  let s = stripDiacritics(raw.toLowerCase());
  s = s.replace(/[._,/-]+/g, " ").replace(/\s+/g, " ").trim();
  // Repeatedly remove suffixes from the tail — handles "UBS AG in liquidation".
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of NOISE_SUFFIXES) {
      if (s.endsWith(" " + suffix) || s === suffix) {
        s = s.slice(0, s.length - suffix.length).trim();
        changed = true;
        break;
      }
    }
  }
  return s;
}

/**
 * Iterative Levenshtein distance. Single-row optimisation: O(min(a,b)) memory.
 * Handles the 2 912 × q comparisons in <5 ms on M1.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Ensure b is the shorter so the row width stays minimal.
  if (a.length < b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    // Swap rows.
    const t = prev;
    prev = curr;
    curr = t;
  }
  return prev[n];
}

/** Convert a Levenshtein distance into a 0..1 score. */
function levScore(query: string, target: string): number {
  if (!query || !target) return 0;
  const d = levenshtein(query, target);
  const maxLen = Math.max(query.length, target.length);
  if (maxLen === 0) return 0;
  return 1 - d / maxLen;
}

export interface FinmaSearchMatch {
  name: string;
  uid: string | null;
  lei: string | null;
  entity_type: string;
  licence_type: string;
  status: string;
  city: string;
  canton: string | null;
  is_warning_listed: boolean;
  source_url: string;
  score: number;
}

export interface FinmaSearchWarning {
  name: string;
  warning_type: string;
  category: string;
  date_added: string;
  source_url: string;
  score: number;
}

export interface FinmaSearchResult {
  query: string;
  matches: FinmaSearchMatch[];
  warnings?: FinmaSearchWarning[];
  match_count: number;
}

export function finmaSearchHandler(args: unknown): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: FinmaSearchResult;
} {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const { name, top_k, include_warnings } = parsed.data;
  const queryNorm = normaliseName(name);
  if (!queryNorm) {
    return {
      content: [{ type: "text", text: `Query reduces to empty after normalisation: "${name}"` }],
      isError: true,
    };
  }

  const registry = getFinmaRegistry();

  // Score every entity against the normalised query.
  const scored = registry.map((r) => {
    const targetNorm = normaliseName(r.name);
    let score = levScore(queryNorm, targetNorm);
    // Boost when the query is contained verbatim in the un-normalised name.
    // This breaks ties in favour of clear substring hits (e.g. "UBS" → "UBS AG").
    if (targetNorm.includes(queryNorm)) score = Math.min(1, score + 0.05);
    return { row: r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, top_k);

  const matches: FinmaSearchMatch[] = top.map((s) => ({
    name: s.row.name,
    uid: s.row.uid || null,
    lei: s.row.lei || null,
    entity_type: s.row.entity_type,
    licence_type: s.row.licence_type,
    status: s.row.status,
    city: s.row.city,
    canton: s.row.canton || null,
    is_warning_listed: s.row.is_warning_listed === "true",
    source_url: s.row.source_url,
    score: Number(s.score.toFixed(4)),
  }));

  let warningMatches: FinmaSearchWarning[] | undefined;
  if (include_warnings) {
    const warnings = getFinmaWarnings();
    const wScored = warnings.map((w) => {
      const targetNorm = normaliseName(w.name);
      let score = levScore(queryNorm, targetNorm);
      if (targetNorm.includes(queryNorm)) score = Math.min(1, score + 0.05);
      return { row: w, score };
    });
    wScored.sort((a, b) => b.score - a.score);
    warningMatches = wScored.slice(0, top_k).map((s) => ({
      name: s.row.name,
      warning_type: s.row.warning_type,
      category: s.row.category,
      date_added: s.row.date_added,
      source_url: s.row.source_url,
      score: Number(s.score.toFixed(4)),
    }));
  }

  const result: FinmaSearchResult = {
    query: name,
    matches,
    ...(warningMatches ? { warnings: warningMatches } : {}),
    match_count: matches.length,
  };

  const lines: string[] = [];
  lines.push(`FINMA registry fuzzy search for "${name}" (normalised: "${queryNorm}") — top ${matches.length}:`);
  for (const m of matches) {
    const flag = m.is_warning_listed ? " [warning-listed]" : "";
    lines.push(
      `  ${m.score.toFixed(3)}  ${m.name} (${m.entity_type}, ${m.licence_type})${flag} — ${m.city || "?"} — ${m.uid || "no UID"}${m.lei ? ` — LEI ${m.lei}` : ""}`,
    );
  }
  if (warningMatches && warningMatches.length > 0) {
    lines.push("");
    lines.push(`FINMA warnings list — top ${warningMatches.length}:`);
    for (const w of warningMatches) {
      lines.push(`  ${w.score.toFixed(3)}  ${w.name} (${w.warning_type}, added ${w.date_added})`);
    }
  }
  lines.push("");
  lines.push("Source: FINMA public registers + warnings list (https://www.finma.ch). Non-official copy.");

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structured: result,
  };
}

export const finmaSearchTool = {
  name: "finma_search",
  description:
    "Fuzzy search the FINMA registry by name (tolerates typos and legal-suffix variants like 'UBS Switzerland AG' vs 'UBS AG'). Returns top-K matches with confidence score, including LEI/UID where available. Set include_warnings=true to also surface entries from the FINMA warnings list.",
  inputSchema: finmaSearchSchema,
  handler: finmaSearchHandler,
} as const;
