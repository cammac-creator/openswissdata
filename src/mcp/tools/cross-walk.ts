/**
 * Tool: cross_walk
 *
 * Translate an industry classification code from one scheme to another using
 * the bundled crosswalks table (NOGA 2008/2025, NACE 2.0/2.1, ISIC 4).
 *
 * NAICS 2022 from the original spec is not yet shipped — restricted to the
 * five schemes actually present in `crosswalks.csv`. V2 will add NAICS once
 * the source mapping is curated.
 */

import { z } from "zod";
import { getCrosswalks } from "../data-loader.js";

const SCHEMES = ["NOGA_2008", "NOGA_2025", "NACE_2.0", "NACE_2.1", "ISIC_4"] as const;
type Scheme = (typeof SCHEMES)[number];

const SCHEME_TO_COLUMN: Record<Scheme, "noga_2008" | "noga_2025" | "nace_2_0" | "nace_2_1" | "isic_4"> = {
  NOGA_2008: "noga_2008",
  NOGA_2025: "noga_2025",
  "NACE_2.0": "nace_2_0",
  "NACE_2.1": "nace_2_1",
  ISIC_4: "isic_4",
};

export const crossWalkSchema = {
  type: "object",
  properties: {
    code: { type: "string", description: "Source classification code (e.g. '01', '6201', '47.91')" },
    source: { type: "string", enum: [...SCHEMES] },
    target: { type: "string", enum: [...SCHEMES] },
  },
  required: ["code", "source", "target"],
} as const;

const InputZ = z.object({
  code: z.string().min(1),
  source: z.enum(SCHEMES),
  target: z.enum(SCHEMES),
});

export interface CrossWalkMapping {
  source_code: string;
  target_code: string;
  mapping_type: string;
  notes: string;
}

export interface CrossWalkResult {
  source_scheme: Scheme;
  target_scheme: Scheme;
  source_code: string;
  mappings: CrossWalkMapping[];
  count: number;
}

export function crossWalkHandler(args: unknown): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: CrossWalkResult;
} {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const { code, source, target } = parsed.data;
  const sourceCol = SCHEME_TO_COLUMN[source];
  const targetCol = SCHEME_TO_COLUMN[target];

  if (source === target) {
    return {
      content: [{ type: "text", text: `Source and target schemes are identical (${source}). No translation needed.` }],
      isError: true,
    };
  }

  const rows = getCrosswalks();
  const matches = rows.filter((r) => r[sourceCol] === code && r[targetCol]);

  const seen = new Set<string>();
  const mappings: CrossWalkMapping[] = [];
  for (const r of matches) {
    const tgt = r[targetCol];
    const key = `${tgt}|${r.mapping_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mappings.push({
      source_code: code,
      target_code: tgt,
      mapping_type: r.mapping_type,
      notes: r.notes || "",
    });
  }

  const result: CrossWalkResult = {
    source_scheme: source,
    target_scheme: target,
    source_code: code,
    mappings,
    count: mappings.length,
  };

  if (mappings.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No mapping found from ${source}:${code} to ${target}. The code may be invalid in the source scheme, or no equivalent exists.`,
        },
      ],
      structured: result,
    };
  }

  const lines = [
    `${source}:${code} → ${target} (${mappings.length} mapping${mappings.length > 1 ? "s" : ""}):`,
    ...mappings.map((m) => `  ${m.target_code} [${m.mapping_type}]${m.notes ? ` — ${m.notes}` : ""}`),
    "",
    "Source: OpenSwissData Classifications bundle (NOGA/NACE/ISIC normalised crosswalks).",
  ];

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structured: result,
  };
}

export const crossWalkTool = {
  name: "cross_walk",
  description:
    "Translate an industry classification code between schemes (NOGA 2008/2025, NACE 2.0/2.1, ISIC 4). Returns all mappings with their type (exact, partial, aggregated, derived) and notes.",
  inputSchema: crossWalkSchema,
  handler: crossWalkHandler,
} as const;
