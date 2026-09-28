/**
 * Tool: kyc_check
 *
 * Search the FINMA registry by name (case-insensitive, accent-insensitive) and
 * return matching authorised entities + any FINMA warnings whose name matches,
 * closest first (exact, whole word, then substring; all words in any order as a fallback).
 *
 * MVP: simple substring match — V2 will add fuzzy + cross-source (SECO sanctions,
 * Zefix corporate status, GLEIF LEI) and proper trigram scoring.
 */

import { z } from "zod";
import { getFinmaRegistry, getFinmaWarnings } from "../data-loader.js";

export const kycCheckSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 2, maxLength: 200, description: "Entity name (or a distinctive part of it)" },
    top_k: { type: "integer", minimum: 1, maximum: 50, default: 10 },
  },
  required: ["name"],
} as const;

const InputZ = z.object({
  name: z.string().min(2).max(200),
  top_k: z.number().int().min(1).max(50).default(10),
});

export interface KycMatch {
  entity_type: string;
  name: string;
  uid: string | null;
  lei: string | null;
  licence_type: string;
  status: string;
  canton: string | null;
  city: string;
  is_warning_listed: boolean | null;
  source_url: string;
}

export interface KycWarning {
  name: string;
  warning_type: string;
  category: string;
  date_added: string;
  source_url: string;
}

export interface KycCheckResult {
  query: string;
  registry_matches: KycMatch[];
  warning_matches: KycWarning[];
  /** Entrées renvoyées (au plus top_k), classées de la plus proche à la plus lointaine. */
  match_count: number;
  warning_count: number;
  /** Toutes les correspondances trouvées, avant la limite top_k. */
  match_total: number;
  warning_total: number;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rang d'un nom pour la requête (plus petit = meilleur) : égalité, début sur un mot entier,
 * mot entier ailleurs, début de nom, simple sous-chaîne. `null` si aucune correspondance.
 * Sans cela, « UBS » plaçait « Clos du Doubs » avant UBS Switzerland AG, et une requête large
 * gardait les premières lignes du registre au lieu des meilleures.
 */
function matcher(needle: string): (candidate: string) => number | null {
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}])`, "u");
  // Mots distincts, huit au plus : le repli reste borné quelle que soit la requête.
  const tokens = [...new Set(needle.split(/\s+/).filter((t) => t.length >= 2))].slice(0, 8);
  return (candidate) => {
    if (candidate === needle) return 0;
    if (candidate.includes(needle)) {
      if (candidate.startsWith(needle) && word.test(candidate)) return 1;
      if (word.test(candidate)) return 2;
      return candidate.startsWith(needle) ? 3 : 4;
    }
    // Mots dans un autre ordre (« Morges Raiffeisen ») : tous les mots présents.
    if (tokens.length > 1 && tokens.every((t) => candidate.includes(t))) return 5;
    return null;
  };
}

function rankedMatches<T extends { name: string }>(rows: readonly T[], needle: string): T[] {
  const rank = matcher(needle);
  return rows
    .map((row, index) => ({ row, index, score: rank(normalize(row.name)) }))
    .filter((m): m is { row: T; index: number; score: number } => m.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((m) => m.row);
}

export function kycCheckHandler(args: unknown): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: KycCheckResult;
} {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const { name, top_k } = parsed.data;
  const needle = normalize(name);

  const registry = getFinmaRegistry();
  const warnings = getFinmaWarnings();

  const registryAll = rankedMatches(registry, needle);
  const warningAll = rankedMatches(warnings, needle);

  const registryMatches: KycMatch[] = registryAll
    .slice(0, top_k)
    .map((r) => ({
      entity_type: r.entity_type,
      name: r.name,
      uid: r.uid || null,
      lei: r.lei || null,
      licence_type: r.licence_type,
      status: r.status,
      canton: r.canton || null,
      city: r.city,
      is_warning_listed: null,
      source_url: r.source_url,
    }));

  const warningMatches: KycWarning[] = warningAll
    .slice(0, top_k)
    .map((w) => ({
      name: w.name,
      warning_type: w.warning_type,
      category: w.category,
      date_added: w.date_added,
      source_url: w.source_url,
    }));

  const result: KycCheckResult = {
    query: name,
    registry_matches: registryMatches,
    warning_matches: warningMatches,
    match_count: registryMatches.length,
    warning_count: warningMatches.length,
    match_total: registryAll.length,
    warning_total: warningAll.length,
  };

  const lines: string[] = [];
  const shown = (count: number, total: number) => (total > count ? ` (closest ${count} shown)` : "");
  if (warningMatches.length > 0) {
    lines.push(`WARNING: ${warningAll.length} FINMA warning entry/entries match "${name}"${shown(warningMatches.length, warningAll.length)}.`);
    for (const w of warningMatches) {
      lines.push(`  - ${w.name} (${w.warning_type}, added ${w.date_added})`);
    }
    lines.push("");
  }
  lines.push(`FINMA registry: ${registryAll.length} authorised entity/entities matching "${name}"${shown(registryMatches.length, registryAll.length)}:`);
  if (registryMatches.length === 0) {
    lines.push("  (none)");
  } else {
    for (const m of registryMatches) {
      const flag = "";
      lines.push(`  - ${m.name} (${m.entity_type}, ${m.licence_type})${flag} — ${m.city || "?"} — ${m.uid || "no UID"}`);
    }
  }
  lines.push("");
  lines.push("Source: FINMA public registers + warnings list (https://www.finma.ch). Non-official copy.");

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structured: result,
  };
}

export const kycCheckTool = {
  name: "kyc_check",
  description:
    "Search the FINMA register of supervised institutions and the FINMA warnings list by name (case- and accent-insensitive). Returns the closest top_k authorised entities and warning entries (exact name, then whole word, then substring; all words in any order as a fallback) with the total number of matches. Use it for basic counterparty screening; no result is not a compliance certificate.",
  inputSchema: kycCheckSchema,
  handler: kycCheckHandler,
} as const;
