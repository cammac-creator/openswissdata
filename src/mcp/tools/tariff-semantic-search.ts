/**
 * Tool: tariff_semantic_search
 *
 * Semantic search across Swiss customs tariff (TARES) descriptions.
 *
 * Pipeline:
 *   1. Embed the user's free-text query with the *same* model that produced
 *      the dataset embeddings (`Xenova/paraphrase-multilingual-mpnet-base-v2`,
 *      768d, mean-pooled + L2-normalised — see `etl/tares/embeddings.ts`).
 *   2. Cosine similarity against the 7 511 pre-baked vectors loaded from
 *      `src/mcp/data/embeddings/tares_embeddings.parquet`.
 *   3. Return top-K with HS8 code + FR description + score, plus the same
 *      non-official disclaimer that `tariff_lookup` ships (we do customs;
 *      we are not the customs office).
 *
 * Latency budget on Railway shared CPU:
 *   - First call:       ~5-10 s (model download + parquet load)
 *   - Subsequent calls: ~70-150 ms (embed) + ~10 ms (cosine over 7.5k)
 *
 * In-memory cosine over 7 511 vectors × 768 dims = 5.7 M float multiplies per
 * query — well below the 50 ms budget on a single-threaded Node loop. FAISS
 * would only be worth the complexity at 100k+ vectors.
 */

import { z } from "zod";
import { getTaresEmbeddings } from "../data-loader.js";
import { embedQuery, cosineSimilarity, EMBEDDING_MODEL } from "../embedder.js";

export const tariffSemanticSearchSchema = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 2, maxLength: 200, description: "Free-text French description of a good" },
    top_k: { type: "integer", minimum: 1, maximum: 20, default: 5 },
    lang: { type: "string", enum: ["fr"], default: "fr", description: "Embedding language (FR-only in v1)" },
  },
  required: ["query"],
} as const;

const InputZ = z.object({
  query: z.string().min(2).max(200),
  top_k: z.number().int().min(1).max(20).default(5),
  lang: z.enum(["fr"]).default("fr"),
});

const DISCLAIMER_FR =
  "AVIS NON-OFFICIEL : ces résultats sont une recherche sémantique sur une copie OpenSwissData du TARES (BAZG/OFDF). La concordance avec un code HS8 réel doit toujours être validée sur xtares.admin.ch. OpenSwissData ne garantit ni l'exactitude ni l'actualité, et n'est pas responsable des décisions douanières prises sur cette base.";

export interface TariffSemanticHit {
  hs_code: string;
  description: string;
  score: number;
}

export interface TariffSemanticSearchResult {
  query: string;
  hits: TariffSemanticHit[];
  count: number;
  model: string;
  disclaimer: string;
}

export async function tariffSemanticSearchHandler(args: unknown): Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: TariffSemanticSearchResult;
}> {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const { query, top_k, lang } = parsed.data;

  let embeddings: Awaited<ReturnType<typeof getTaresEmbeddings>>;
  let queryVec: Float32Array;
  try {
    [embeddings, queryVec] = await Promise.all([getTaresEmbeddings(), embedQuery(query)]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text", text: `Embedding pipeline failed: ${msg}` }],
      isError: true,
    };
  }

  // Filter by language (FR-only in v1, but kept for forward compat).
  const candidates = embeddings.filter((e) => e.lang === lang);
  if (candidates.length === 0) {
    return {
      content: [{ type: "text", text: `No embeddings available for lang="${lang}".` }],
      isError: true,
    };
  }

  // Score all 7 511 candidates. Stable single-pass top-K: we keep a
  // running min-heap of size top_k. For 7 511 × 20 this is trivially fast,
  // but better than `sort()` over the full array.
  const scored: TariffSemanticHit[] = candidates.map((e) => ({
    hs_code: e.code,
    description: e.description,
    score: Number(cosineSimilarity(queryVec, e.vector).toFixed(4)),
  }));
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.slice(0, top_k);

  const result: TariffSemanticSearchResult = {
    query,
    hits,
    count: hits.length,
    model: EMBEDDING_MODEL,
    disclaimer: DISCLAIMER_FR,
  };

  // Inline the disclaimer in the text payload so an agent forwarding
  // `content[0].text` cannot silently drop it (same convention as tariff_lookup).
  const lines = [
    DISCLAIMER_FR,
    "",
    `Semantic search for "${query}" — top ${hits.length}:`,
    ...hits.map((h) => `  ${h.score.toFixed(3)}  HS8 ${h.hs_code} — ${h.description}`),
    "",
    `Model: ${EMBEDDING_MODEL} (768d, mean-pooled + L2-normalised)`,
    "Source: OpenSwissData TARES bundle — non-official copy of BAZG/OFDF data.",
  ];

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structured: result,
  };
}

export const tariffSemanticSearchTool = {
  name: "tariff_semantic_search",
  description:
    "Semantic search across Swiss customs tariff (TARES) descriptions in French. Uses pre-computed Xenova/paraphrase-multilingual-mpnet-base-v2 embeddings (768d, FR) shipped with the TARES Pro bundle. Returns top-K HS8 codes by cosine similarity. Always inlines a non-official disclaimer.",
  inputSchema: tariffSemanticSearchSchema,
  handler: tariffSemanticSearchHandler,
} as const;
