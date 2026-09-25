import { createEmbeddingExtractor, EMBEDDING_REVISION } from "../../src/lib/embedding-model.js";
/**
 * TARES embeddings — pre-computed multilingual semantic vectors per HS8 code.
 *
 * Why: a buyer (often an AI agent integrating customs data) cannot afford to
 * recompute 7500+ embeddings at session boot. We ship pre-baked vectors so
 * `cosine(query_emb, tares_emb)` is instant. Goal: enable semantic search on
 * customs descriptions in <50 ms client-side without GPU.
 *
 * v1 strategy (Phase 1 / T1 — first cut):
 *   - One vector per row, FR description only (most-used language)
 *   - Model: `Xenova/paraphrase-multilingual-mpnet-base-v2` (sentence-transformers,
 *     768 dimensions, mean-pooled + L2-normalised)
 *   - Local inference via `@huggingface/transformers` (ONNX/WASM, runs in Node)
 *   - Resumable cache (`embeddings-cache-fr.json`) so a crashed run resumes
 *     instead of recomputing 4-6 minutes of CPU work
 *
 * Future (Phase 1 / T1.1+):
 *   - Add lang='de' / 'it' / 'en' rows (schema already supports it — just
 *     extend the `langs` array)
 *   - Optionally swap to `BAAI/bge-m3` (1024d) once local benchmarks confirm
 *     ONNX availability + acceptable CPU latency
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { TaresRow } from "./types.js";

export interface TaresEmbedding {
  hs_code: string;
  lang: "de" | "fr" | "it" | "en";
  description: string;
  embedding: number[];
  model: string;
  model_version: string;
}

export interface GenerateEmbeddingsOptions {
  /** Cache file used to resume a crashed run (defaults to `<outDir>/embeddings-cache-fr.json`). */
  cachePath?: string;
  /** Languages to embed. Default: `['fr']` (Option C — FR only, fastest first cut). */
  langs?: ReadonlyArray<TaresEmbedding["lang"]>;
  /** Batch size for the pipeline. Default 32 (good CPU/RAM trade-off on M-series). */
  batchSize?: number;
  /** Logger. Default `console.log`. */
  log?: (msg: string) => void;
  /** Force re-generation even if cache exists. */
  noCache?: boolean;
}

export const TARES_EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-mpnet-base-v2";
/** La reprise exige la même révision de poids et le même moteur de calcul. */
export const TARES_EMBEDDING_MODEL_VERSION = `${TARES_EMBEDDING_MODEL}@${EMBEDDING_REVISION}:transformers-3.8.1:q8:mean-l2`;
export const TARES_EMBEDDING_DIMENSIONS = 768;

/** Pick the description for the requested language, with a fallback so we never emit empty text. */
function descriptionFor(row: TaresRow, lang: TaresEmbedding["lang"]): string {
  switch (lang) {
    case "fr":
      return row.designation_fr;
    case "de":
      return row.designation_de;
    case "it":
      return row.designation_it;
    case "en":
      return row.designation_en ?? row.designation_en ?? row.designation_fr;
  }
}

/** Cosine similarity between two equal-length vectors. Exposed for tests + sanity checks. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

interface CacheShape {
  model: string;
  model_version: string;
  dimensions: number;
  // Map "<hs_code>:<lang>" → embedding vector
  entries: Record<string, number[]>;
}

function loadCache(path: string): CacheShape | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as CacheShape;
    if (
      raw &&
      typeof raw === "object" &&
      raw.model === TARES_EMBEDDING_MODEL &&
      raw.model_version === TARES_EMBEDDING_MODEL_VERSION &&
      raw.dimensions === TARES_EMBEDDING_DIMENSIONS &&
      raw.entries &&
      typeof raw.entries === "object"
    ) {
      return raw;
    }
  } catch {
    // Corrupted cache — start over.
  }
  return null;
}

function saveCache(path: string, cache: CacheShape): void {
  writeFileSync(path, JSON.stringify(cache), "utf8");
}

/**
 * Generate one embedding per (row × lang) tuple.
 *
 * Uses a resumable JSON cache keyed on `<hs_code>:<lang>`: if the run crashes,
 * the next invocation picks up where it left off.
 */
export async function generateTaresEmbeddings(
  rows: TaresRow[],
  opts: GenerateEmbeddingsOptions = {},
): Promise<TaresEmbedding[]> {
  const langs = opts.langs ?? (["fr"] as const);
  const batchSize = opts.batchSize ?? 32;
  const log = opts.log ?? ((m) => console.log(m));
  const cachePath = opts.cachePath ?? "./data/tares/embeddings-cache-fr.json";

  const cache = (opts.noCache ? null : loadCache(cachePath)) ?? {
    model: TARES_EMBEDDING_MODEL,
    model_version: TARES_EMBEDDING_MODEL_VERSION,
    dimensions: TARES_EMBEDDING_DIMENSIONS,
    entries: {},
  };

  // Build the work list: every (row, lang) pair NOT yet in the cache.
  type Work = { row: TaresRow; lang: TaresEmbedding["lang"]; key: string; text: string };
  const todo: Work[] = [];
  for (const row of rows) {
    for (const lang of langs) {
      const key = `${row.hs8}:${lang}`;
      if (cache.entries[key]) continue;
      const text = descriptionFor(row, lang);
      if (!text || text.trim() === "") continue; // skip empty descriptions defensively
      todo.push({ row, lang, key, text });
    }
  }

  const cachedCount = Object.keys(cache.entries).length;
  const totalExpected = rows.length * langs.length;
  log(`[embeddings] ${cachedCount} cached, ${todo.length} to compute (target ${totalExpected})`);

  if (todo.length === 0) {
    log(`[embeddings] all embeddings cached, skipping inference`);
  } else {
    const extractor = await createEmbeddingExtractor();
    const startedAt = Date.now();
    let processed = 0;
    let lastFlush = Date.now();
    for (let i = 0; i < todo.length; i += batchSize) {
      const batch = todo.slice(i, i + batchSize);
      const texts = batch.map((b) => b.text);
      // The pipeline call returns a `Tensor` whose `.data` is a Float32Array of
      // shape [batch, seq_len, hidden]. We pass `pooling: 'mean'` + `normalize: true`
      // so we get [batch, hidden] L2-normalised vectors.
      const tensor = await extractor(texts, { pooling: "mean", normalize: true });
      const flat = tensor.data as Float32Array;
      const dim = TARES_EMBEDDING_DIMENSIONS;
      if (flat.length !== batch.length * dim) {
        throw new Error(
          `[embeddings] unexpected output shape: got ${flat.length} floats for batch=${batch.length}, expected ${batch.length * dim}`,
        );
      }
      for (let b = 0; b < batch.length; b++) {
        const vec = Array.from(flat.subarray(b * dim, (b + 1) * dim));
        cache.entries[batch[b].key] = vec;
      }
      processed += batch.length;

      // Flush cache every ~10 seconds — cheap insurance against crashes.
      const now = Date.now();
      if (now - lastFlush > 10_000) {
        saveCache(cachePath, cache);
        lastFlush = now;
      }

      if (processed % (batchSize * 10) === 0 || i + batchSize >= todo.length) {
        const elapsed = (now - startedAt) / 1000;
        const rate = processed / Math.max(elapsed, 0.001);
        const eta = (todo.length - processed) / Math.max(rate, 0.001);
        log(
          `[embeddings] ${processed}/${todo.length} (${rate.toFixed(1)} emb/s, eta ${eta.toFixed(0)}s)`,
        );
      }
    }
    saveCache(cachePath, cache);
    const elapsed = (Date.now() - startedAt) / 1000;
    log(
      `[embeddings] computed ${todo.length} embeddings in ${elapsed.toFixed(1)}s (${(todo.length / Math.max(elapsed, 0.001)).toFixed(1)} emb/s)`,
    );
  }

  // Materialise the final array, preserving row + lang order so downstream
  // consumers can rely on a stable iteration order.
  const out: TaresEmbedding[] = [];
  for (const row of rows) {
    for (const lang of langs) {
      const key = `${row.hs8}:${lang}`;
      const vec = cache.entries[key];
      if (!vec) continue; // empty description was skipped
      out.push({
        hs_code: row.hs8,
        lang,
        description: descriptionFor(row, lang),
        embedding: vec,
        model: TARES_EMBEDDING_MODEL,
        model_version: TARES_EMBEDDING_MODEL_VERSION,
      });
    }
  }
  return out;
}
