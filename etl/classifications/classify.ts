/**
 * NOGA 2025 free-text classifier — Phase 1 / C3.
 *
 * Killer feature for the Classifications Pro pack:
 *   `classifyText("vente de café en grain et torréfaction")`
 *   → top-3 NOGA codes with cosine similarity scores.
 *
 * Implementation:
 *   - Reuses the same multilingual mpnet model (`@xenova/transformers`,
 *     768-d, mean-pooled + L2-normalised) used to pre-compute the dataset
 *     embeddings — see `etl/classifications/embeddings.ts`.
 *   - Loads the embeddings from the JSON cache produced at ETL time
 *     (`./data/classifications/embeddings-cache-fr.json`). We do NOT re-read
 *     the parquet here: the JSON cache is the source of truth at training time.
 *   - Cosine similarity is computed in pure JS in-memory (1 845 vectors × 768d
 *     = ~5.6 M floats; fits in 22 MB; sub-millisecond per query on M1).
 *
 * CLI:
 *   tsx etl/classifications/classify.ts "boulangerie pâtisserie"
 *   → prints JSON top-3 to stdout.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOGA_EMBEDDING_DIMENSIONS,
  NOGA_EMBEDDING_MODEL,
  cosineSimilarity,
} from "./embeddings.js";
import { ingestRealClassifications } from "./ingest-real.js";

export interface NogaClassification {
  code: string;
  label: string;
  score: number; // cosine similarity 0-1
  parent_section?: string;
  scheme: "NOGA_2025";
}

export interface ClassifyOptions {
  topK?: number;
  /** Currently unused (FR-only embeddings in v1). Kept for API forward-compat. */
  lang?: "fr" | "de" | "it" | "en";
  /** Override path to the embeddings JSON cache produced at ETL time. */
  cachePath?: string;
  /** Override path to the classifications dir (used to locate the cache + label lookup). */
  classificationsDir?: string;
}

interface IndexEntry {
  code: string;
  embedding: Float32Array;
  label: string;
  section?: string;
}

interface CachedIndex {
  entries: IndexEntry[];
  model: string;
}

let _indexPromise: Promise<CachedIndex> | null = null;
// Reuse the loaded extractor across queries so a long-running CLI / API stays
// snappy. Loading the ONNX model from disk costs ~500 ms.
let _extractorPromise: Promise<unknown> | null = null;

interface CacheShape {
  model: string;
  model_version: string;
  dimensions: number;
  entries: Record<string, number[]>; // key "<code>:<lang>"
}

/**
 * Build a code → section letter map by walking the NOGA hierarchy.
 * We anchor on `level==='section'` rows (where `code` is a letter A..U) and
 * resolve every code's section via repeated parent lookups.
 */
function buildSectionMap(
  rows: { scheme: string; code: string; level: string; parent: string | null }[],
): Map<string, string> {
  const noga = rows.filter((r) => r.scheme === "NOGA_2025");
  const byCode = new Map<string, { code: string; level: string; parent: string | null }>();
  for (const r of noga) byCode.set(r.code, r);
  const sectionOf = new Map<string, string>();
  for (const r of noga) {
    if (r.level === "section") {
      sectionOf.set(r.code, r.code);
      continue;
    }
    let cur = r.parent;
    let guard = 0;
    while (cur && guard < 8) {
      const p = byCode.get(cur);
      if (!p) break;
      if (p.level === "section") {
        sectionOf.set(r.code, p.code);
        break;
      }
      cur = p.parent;
      guard++;
    }
  }
  return sectionOf;
}

async function loadIndex(opts: ClassifyOptions): Promise<CachedIndex> {
  if (_indexPromise) return _indexPromise;
  _indexPromise = (async () => {
    const dir = opts.classificationsDir ?? "./data/classifications";
    const cachePath = opts.cachePath ?? join(dir, "embeddings-cache-fr.json");
    if (!existsSync(cachePath)) {
      throw new Error(
        `[classify] embeddings cache not found at ${cachePath}. Run \`CLASSIFICATIONS_TIER=pro npm run etl:classifications\` first to generate it.`,
      );
    }
    const cache = JSON.parse(readFileSync(cachePath, "utf8")) as CacheShape;
    if (cache.model !== NOGA_EMBEDDING_MODEL) {
      throw new Error(
        `[classify] cache model mismatch: ${cache.model} vs expected ${NOGA_EMBEDDING_MODEL}`,
      );
    }
    if (cache.dimensions !== NOGA_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `[classify] cache dim mismatch: ${cache.dimensions} vs expected ${NOGA_EMBEDDING_DIMENSIONS}`,
      );
    }

    // Pull labels (and section parents) from the live ingest pipeline. We rely
    // on the ingest-real cache (TTL 7d) so this is fast on warm cache.
    const cacheDir = join(dir, "classifications-cache");
    const ingest = await ingestRealClassifications({ cacheDir });
    const labelOf = new Map<string, string>();
    for (const r of ingest.rows) {
      if (r.scheme !== "NOGA_2025") continue;
      labelOf.set(r.code, r.label_fr ?? r.label_de ?? r.label_it ?? r.label_en ?? r.code);
    }
    const sectionMap = buildSectionMap(ingest.rows);

    const entries: IndexEntry[] = [];
    for (const [key, vec] of Object.entries(cache.entries)) {
      const [code, lang] = key.split(":");
      if (lang !== "fr") continue; // v1: FR-only index
      entries.push({
        code,
        embedding: new Float32Array(vec),
        label: labelOf.get(code) ?? code,
        section: sectionMap.get(code),
      });
    }
    return { entries, model: cache.model };
  })();
  return _indexPromise;
}

async function getExtractor(): Promise<unknown> {
  if (_extractorPromise) return _extractorPromise;
  _extractorPromise = (async () => {
    // @ts-expect-error — package exports CJS named exports without bundled types
    const { pipeline, env } = await import("@xenova/transformers");
    // @ts-expect-error
    env.allowRemoteModels = true;
    // @ts-expect-error
    env.allowLocalModels = true;
    // @ts-expect-error
    return pipeline("feature-extraction", NOGA_EMBEDDING_MODEL, { quantized: true });
  })();
  return _extractorPromise;
}

/**
 * Embed `text` with the same model used for the dataset, then return the top-K
 * NOGA 2025 codes ranked by cosine similarity.
 *
 * Latency budget on M1: ~70 ms (embed) + <5 ms (cosine over 1 845 vectors).
 */
export async function classifyText(
  text: string,
  opts: ClassifyOptions = {},
): Promise<NogaClassification[]> {
  const topK = opts.topK ?? 3;
  if (!text || text.trim() === "") {
    throw new Error("[classify] empty text");
  }

  const [index, extractor] = await Promise.all([loadIndex(opts), getExtractor()]);
  // @ts-expect-error — extractor is a callable pipeline
  const tensor = await extractor(text, { pooling: "mean", normalize: true });
  const flat = tensor.data as Float32Array;
  if (flat.length !== NOGA_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `[classify] unexpected query embedding shape: ${flat.length} (expected ${NOGA_EMBEDDING_DIMENSIONS})`,
    );
  }
  const queryVec = Array.from(flat);

  // Score every entry. Vectors are L2-normalised at generation time, so cosine
  // reduces to a dot product, but we keep the explicit cosineSimilarity()
  // helper for safety + symmetry with the test surface.
  const scored: NogaClassification[] = index.entries.map((e) => ({
    code: e.code,
    label: e.label,
    score: cosineSimilarity(queryVec, Array.from(e.embedding)),
    parent_section: e.section,
    scheme: "NOGA_2025" as const,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/** CLI entry: `tsx etl/classifications/classify.ts "<text>" [topK]` */
if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv[2];
  const topK = process.argv[3] ? Number(process.argv[3]) : 3;
  if (!text) {
    console.error('Usage: tsx etl/classifications/classify.ts "<text>" [topK]');
    process.exit(1);
  }
  classifyText(text, { topK })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error("[classify] ERROR:", err);
      process.exit(1);
    });
}
