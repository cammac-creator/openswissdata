/**
 * Tool: statent_lookup
 *
 * Returns Swiss enterprise statistics (BFS STATENT) for a given NOGA division
 * (2-digit code) and an optional canton. Source: BFS PX-Web table
 * px-x-0602010000_101 (year × canton × NOGA division × observation unit).
 *
 * Why this is irreplicable in client code:
 *   - The PX-Web JSON-stat2 API is paginated, has confidentiality suppression
 *     for small cells, and returns multidimensional arrays — not joinable with
 *     NOGA codes without ETL work.
 *   - We pre-aggregate it to a flat (canton × division → etablissements,
 *     emplois, FTE) so a single lookup returns the answer.
 *
 * License: BFS data is `terms_by_ask` (CH Open Data ToU). Commercial
 * redistribution required formal authorisation — see Classifications Pro tier
 * EULA. Anyone with `statent:read` scope is by definition an authorised
 * customer.
 */

import { z } from "zod";
import { getStatent } from "../data-loader.js";

export const statentLookupSchema = {
  type: "object",
  properties: {
    noga_division: {
      type: "string",
      description:
        "NOGA 2-digit division code (e.g. '62' = Programmation, conseil et autres activités informatiques). Returns all cantons if no canton_code is given.",
    },
    canton_code: {
      type: "string",
      description:
        "Optional canton code 1-26 (FSO numbering: 1=ZH, 2=BE, ..., 26=JU). Use '999' for Switzerland-wide totals.",
    },
  },
  required: ["noga_division"],
} as const;

const InputZ = z.object({
  noga_division: z.string().regex(/^\d{1,2}$/, "noga_division must be 1-2 digits"),
  canton_code: z
    .string()
    .regex(/^(\d{1,2}|999)$/, "canton_code must be 1-26 or 999")
    .optional(),
});

export interface StatentLookupResult {
  noga_division: string;
  noga_label: string | null;
  year: string;
  results: Array<{
    canton_code: string;
    canton_name: string;
    etablissements: number | null;
    emplois: number | null;
    emplois_eq_plein_temps: number | null;
  }>;
  source: "BFS · STATENT (px-x-0602010000_101)";
  disclaimer: string;
}

const DISCLAIMER =
  "Données STATENT (BFS) republiées sous Clauses BFS terms_by_ask. Cellules avec 1-4 établissements supprimées par confidentialité statistique. Source autoritative : opendata.swiss / bfs.admin.ch.";

function toNumber(s: string): number | null {
  if (!s || s === "..." || s === "...") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function statentLookupCore(input: unknown): StatentLookupResult {
  const args = InputZ.parse(input);
  const all = getStatent();

  // Strip leading zero from input (data uses '1' not '01' for division 01)
  const div = args.noga_division.replace(/^0+/, "") || "0";

  let rows = all.filter((r) => r.noga_division === div);
  if (rows.length === 0) {
    throw new Error(`No STATENT row found for noga_division="${args.noga_division}"`);
  }

  if (args.canton_code) {
    rows = rows.filter((r) => r.canton_code === args.canton_code);
    if (rows.length === 0) {
      throw new Error(
        `No STATENT row found for noga_division="${args.noga_division}" canton_code="${args.canton_code}"`,
      );
    }
  }

  const first = rows[0];
  return {
    noga_division: div,
    noga_label: first.noga_label || null,
    year: first.year,
    results: rows.map((r) => ({
      canton_code: r.canton_code,
      canton_name: r.canton_name,
      etablissements: toNumber(r.etablissements),
      emplois: toNumber(r.emplois),
      emplois_eq_plein_temps: toNumber(r.emplois_eq_plein_temps),
    })),
    source: "BFS · STATENT (px-x-0602010000_101)",
    disclaimer: DISCLAIMER,
  };
}

function statentLookupHandler(input: unknown): {
  content: { type: "text"; text: string }[];
  structured: StatentLookupResult;
} {
  const result = statentLookupCore(input);
  const lines = [
    DISCLAIMER,
    "",
    `STATENT ${result.year} — NOGA division ${result.noga_division}${result.noga_label ? `: ${result.noga_label}` : ""}`,
    "",
    ...result.results.map((r) => {
      const etab = r.etablissements?.toLocaleString("fr-CH") ?? "n/a";
      const emp = r.emplois?.toLocaleString("fr-CH") ?? "n/a";
      const fte = r.emplois_eq_plein_temps?.toLocaleString("fr-CH") ?? "n/a";
      return `${r.canton_code.padStart(3, " ")} ${r.canton_name.padEnd(28, " ")} · ${etab.padStart(8, " ")} étab. · ${emp.padStart(10, " ")} emplois · ${fte.padStart(10, " ")} EPT`;
    }),
    "",
    `Source: ${result.source}`,
  ];
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structured: result,
  };
}

export const statentLookupTool = {
  name: "statent_lookup",
  description:
    "Swiss enterprise statistics (STATENT, BFS) for a NOGA 2-digit division and optional canton. Returns count of establishments, jobs, and full-time equivalents (FTE). 2023 data. Always inlines a BFS attribution disclaimer.",
  inputSchema: statentLookupSchema,
  handler: statentLookupHandler,
} as const;
