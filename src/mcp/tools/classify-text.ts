/**
 * Tool: classify_text
 *
 * Free-text → top-K NOGA 2025 codes with confidence scores.
 *
 * The killer feature for the Classifications Pro pack: a buyer types
 *   "vente de café en grain et torréfaction"
 * and gets back the most likely NOGA 2025 codes (e.g. 47.29 retail food,
 * 10.83 coffee processing) ranked by cosine similarity.
 *
 * Implementation:
 *   - Mirrors `etl/classifications/classify.ts` but reads embeddings from
 *     the bundled Parquet (via `data-loader.getNogaEmbeddings()`) instead of
 *     the ETL-time JSON cache.
 *   - Same model as `tariff_semantic_search` (mpnet 768d FR), reused
 *     through `embedder.embedQuery()` so the model loads once per process.
 *   - Cosine over ~1 845 vectors → sub-millisecond after the embed call.
 *
 * NACE 2.1 mode (`scheme: "NACE_2.1"`) is accepted in the schema but not yet
 * implemented in the underlying embeddings: NACE codes are derived through
 * the crosswalks table at ETL time, not embedded directly. v1 keeps it
 * "best-effort" — we mark the response with `degraded: true` if the user
 * requests NACE so they know we returned NOGA codes.
 *
 * Disclaimer note: NOGA codes are administrative — there is no "official"
 * answer for free-text classification. We surface a similarity score so the
 * user can judge confidence.
 */

import { z } from "zod";
import { getNogaEmbeddings } from "../data-loader.js";
import { embedQuery, cosineSimilarity, EMBEDDING_MODEL } from "../embedder.js";

export const classifyTextSchema = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 5, maxLength: 500, description: "Free-text business description (FR)" },
    top_k: { type: "integer", minimum: 1, maximum: 10, default: 3 },
    lang: { type: "string", enum: ["fr"], default: "fr" },
    scheme: { type: "string", enum: ["NOGA_2025", "NACE_2.1"], default: "NOGA_2025" },
  },
  required: ["text"],
} as const;

const InputZ = z.object({
  text: z.string().min(5).max(500),
  top_k: z.number().int().min(1).max(10).default(3),
  lang: z.enum(["fr"]).default("fr"),
  scheme: z.enum(["NOGA_2025", "NACE_2.1"]).default("NOGA_2025"),
});

export interface ClassifyHit {
  code: string;
  label: string;
  score: number;
  scheme: "NOGA_2025";
}

export interface ClassifyTextResult {
  query: string;
  scheme_requested: "NOGA_2025" | "NACE_2.1";
  scheme_returned: "NOGA_2025";
  hits: ClassifyHit[];
  count: number;
  model: string;
  /** True if the user requested a scheme other than NOGA_2025 (we still returned NOGA). */
  degraded?: boolean;
}

export async function classifyTextHandler(args: unknown): Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: ClassifyTextResult;
}> {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const { text, top_k, lang, scheme } = parsed.data;

  let embeddings: Awaited<ReturnType<typeof getNogaEmbeddings>>;
  let queryVec: Float32Array;
  try {
    [embeddings, queryVec] = await Promise.all([getNogaEmbeddings(), embedQuery(text)]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text", text: `Embedding pipeline failed: ${msg}` }],
      isError: true,
    };
  }

  const candidates = embeddings.filter((e) => e.lang === lang);
  if (candidates.length === 0) {
    return {
      content: [{ type: "text", text: `No embeddings available for lang="${lang}".` }],
      isError: true,
    };
  }

  const scored: ClassifyHit[] = candidates.map((e) => ({
    code: e.code,
    label: e.description,
    score: Number(cosineSimilarity(queryVec, e.vector).toFixed(4)),
    scheme: "NOGA_2025" as const,
  }));
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.slice(0, top_k);

  const degraded = scheme !== "NOGA_2025";
  const result: ClassifyTextResult = {
    query: text,
    scheme_requested: scheme,
    scheme_returned: "NOGA_2025",
    hits,
    count: hits.length,
    model: EMBEDDING_MODEL,
    ...(degraded ? { degraded: true } : {}),
  };

  const lines: string[] = [];
  if (degraded) {
    lines.push(
      `NOTE: scheme="${scheme}" requested but only NOGA_2025 embeddings are bundled in v1. Returned NOGA_2025 codes — use cross_walk to translate them to NACE_2.1 if needed.`,
    );
    lines.push("");
  }
  lines.push(`NOGA 2025 classification of "${text}" — top ${hits.length}:`);
  for (const h of hits) {
    lines.push(`  ${h.score.toFixed(3)}  ${h.code} — ${h.label}`);
  }
  lines.push("");
  lines.push(`Model: ${EMBEDDING_MODEL} (768d, mean-pooled + L2-normalised)`);
  lines.push("Source: OpenSwissData Classifications bundle — based on OFS NOGA 2025 nomenclature.");

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structured: result,
  };
}

export const classifyTextTool = {
  name: "classify_text",
  description:
    "Classify a free-text business description into top-K NOGA 2025 codes with confidence scores. Uses pre-computed Xenova/paraphrase-multilingual-mpnet-base-v2 embeddings (768d, FR). NACE 2.1 mode falls back to NOGA 2025 in v1 — combine with cross_walk for translation.",
  inputSchema: classifyTextSchema,
  handler: classifyTextHandler,
} as const;
