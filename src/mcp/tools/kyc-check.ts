/**
 * Tool: kyc_check
 *
 * Search the FINMA registry by name (case-insensitive substring match) and
 * return matching authorised entities + any FINMA warnings whose name matches.
 *
 * MVP: simple substring match — V2 will add fuzzy + cross-source (SECO sanctions,
 * Zefix corporate status, GLEIF LEI) and proper trigram scoring.
 */

import { z } from "zod";
import { getFinmaRegistry, getFinmaWarnings } from "../data-loader.js";

export const kycCheckSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 2, description: "Entity name (or substring)" },
    top_k: { type: "integer", minimum: 1, maximum: 50, default: 10 },
  },
  required: ["name"],
} as const;

const InputZ = z.object({
  name: z.string().min(2),
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
  is_warning_listed: boolean;
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
  match_count: number;
  warning_count: number;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
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

  const registryMatches: KycMatch[] = registry
    .filter((r) => normalize(r.name).includes(needle))
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
      is_warning_listed: r.is_warning_listed === "true",
      source_url: r.source_url,
    }));

  const warningMatches: KycWarning[] = warnings
    .filter((w) => normalize(w.name).includes(needle))
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
  };

  const lines: string[] = [];
  if (warningMatches.length > 0) {
    lines.push(`WARNING: ${warningMatches.length} FINMA warning entry/entries match "${name}".`);
    for (const w of warningMatches.slice(0, 5)) {
      lines.push(`  - ${w.name} (${w.warning_type}, added ${w.date_added})`);
    }
    lines.push("");
  }
  lines.push(`FINMA registry: ${registryMatches.length} authorised entity/entities matching "${name}":`);
  if (registryMatches.length === 0) {
    lines.push("  (none)");
  } else {
    for (const m of registryMatches.slice(0, 5)) {
      const flag = m.is_warning_listed ? " [warning-listed]" : "";
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
    "Search the FINMA registry of supervised entities and the FINMA warnings list by name. Returns up to top_k authorised entities + any matching warning entries. Use this for basic counterparty KYC screening.",
  inputSchema: kycCheckSchema,
  handler: kycCheckHandler,
} as const;
