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
import { foldName, MATCH_RANKS, nameMatcher, rankedMatches } from "../name-match.js";

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
  const needle = foldName(name);

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

  // tâche osd.S10 : seul un nom identique (rang "exact" de name-match.ts, après repliement) déclenche
  // la ligne WARNING ; un nom seulement proche est montré à part, sans jamais dire "WARNING" ni "match".
  const warningRank = nameMatcher(needle);
  const warningAllRanks = warningAll.map((w) => warningRank(foldName(w.name)));
  const exactWarningTotal = warningAllRanks.filter((r) => r === 0).length;
  const nearWarningTotal = warningAll.length - exactWarningTotal;
  // warningAll (et donc warningMatches) est déjà trié par rang croissant : les égalités, s'il y en a,
  // sont toujours en tête de la tranche affichée — aucun changement de tri ni de nombre ici.
  const shownRanks = warningAllRanks.slice(0, top_k);
  const splitAt = shownRanks.findIndex((r) => r !== 0);
  const exactSplit = splitAt === -1 ? warningMatches.length : splitAt;
  const exactWarnings = warningMatches.slice(0, exactSplit);
  const nearWarnings = warningMatches.slice(exactSplit);

  const lines: string[] = [];
  const shown = (count: number, total: number) => (total > count ? ` (closest ${count} shown)` : "");
  if (exactWarningTotal > 0) {
    lines.push(`WARNING: ${exactWarningTotal} FINMA warning entry/entries match "${name}" exactly${shown(exactWarnings.length, exactWarningTotal)}.`);
    for (const w of exactWarnings) {
      lines.push(`  - ${w.name} (${w.warning_type}, added ${w.date_added})`);
    }
    lines.push("");
  }
  if (nearWarningTotal > 0 && nearWarnings.length === 0) {
    // Les noms identiques occupent déjà tout top_k : dire combien de noms proches restent, sans titre vide.
    lines.push(`Similar name(s) on the FINMA warnings list, to verify: ${nearWarningTotal} not shown (raise top_k to list them).`);
    lines.push("");
  } else if (nearWarningTotal > 0) {
    lines.push(`Similar name(s) on the FINMA warnings list, to verify${shown(nearWarnings.length, nearWarningTotal)}:`);
    for (let i = 0; i < nearWarnings.length; i++) {
      const w = nearWarnings[i];
      // Les entrées de warningAll ont déjà passé rankedMatches : leur rang n'est jamais `null` ici.
      const rankValue = shownRanks[exactSplit + i];
      const rankLabel = rankValue === null ? "substring" : MATCH_RANKS[rankValue];
      lines.push(`  - ${w.name} (${w.warning_type}, added ${w.date_added}) — rank: ${rankLabel}`);
    }
    lines.push("A similar name is not an identification; compare against the FINMA detail page before concluding anything.");
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
    "Search the FINMA register of supervised institutions and the FINMA warnings list by name (case- and accent-insensitive). Returns the closest top_k authorised entities and warning entries (exact name, then whole word, then substring; all words in any order as a fallback) with the total number of matches. Only an identical name is reported as a FINMA warning-list match; a merely similar name is listed separately, to verify, and is never called a match. Use it for basic counterparty screening; no result is not a compliance certificate.",
  inputSchema: kycCheckSchema,
  handler: kycCheckHandler,
} as const;
