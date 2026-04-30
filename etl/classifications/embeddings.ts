/**
 * NOGA 2025 embeddings — pre-computed multilingual semantic vectors per code.
 *
 * Why: a buyer (typically integrating a "free-text → NOGA code" feature in
 * onboarding flow, CRM enrichment, etc.) cannot afford to recompute 1845+
 * embeddings at session boot. We ship pre-baked vectors so cosine similarity
 * is instant. Goal: enable semantic classification on Swiss economic
 * activities in <50 ms client-side without GPU.
 *
 * v1 strategy (Phase 1 / C3 — first cut):
 *   - One vector per NOGA 2025 code, FR description only (most-used language)
 *   - Model: `Xenova/paraphrase-multilingual-mpnet-base-v2` (sentence-transformers,
 *     768 dimensions, mean-pooled + L2-normalised, 50+ langues including FR/DE/IT/EN)
 *   - Local inference via `@xenova/transformers` (ONNX/WASM, runs in Node)
 *   - Resumable cache (`embeddings-cache-fr.json`) so a crashed run resumes
 *     instead of recomputing 4-6 minutes of CPU work
 *   - Reuses the exact setup proven in `etl/tares/embeddings.ts` (T1)
 *
 * Future (Phase 1+):
 *   - Add lang='de' / 'it' / 'en' rows (schema already supports it — just
 *     extend the `langs` array)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { NomenclatureRow } from "./types.js";

export interface NogaEmbedding {
  code: string;
  lang: "de" | "fr" | "it" | "en";
  description: string;
  embedding: number[];
  model: string;
  model_version: string;
}

export interface GenerateEmbeddingsOptions {
  /** Cache file used to resume a crashed run (defaults to `./data/classifications/embeddings-cache-fr.json`). */
  cachePath?: string;
  /** Languages to embed. Default: `['fr']` (FR only — fastest first cut). */
  langs?: ReadonlyArray<NogaEmbedding["lang"]>;
  /** Batch size for the pipeline. Default 32 (good CPU/RAM trade-off on M-series). */
  batchSize?: number;
  /** Logger. Default `console.log`. */
  log?: (msg: string) => void;
  /** Force re-generation even if cache exists. */
  noCache?: boolean;
}

export const NOGA_EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-mpnet-base-v2";
/**
 * Model "version" — short fingerprint that lets buyers detect when we change models.
 * NOT a cryptographic hash of the weights; just "<repo>@<readable-tag>" so consumers
 * can compare across releases. Bumped manually whenever we change the model.
 */
export const NOGA_EMBEDDING_MODEL_VERSION = "Xenova/paraphrase-multilingual-mpnet-base-v2@2024-04";
export const NOGA_EMBEDDING_DIMENSIONS = 768;

/** Pick the description for the requested language, with a fallback so we never emit empty text. */
function descriptionFor(row: NomenclatureRow, lang: NogaEmbedding["lang"]): string | null {
  switch (lang) {
    case "fr":
      return row.label_fr ?? row.label_de ?? row.label_it ?? row.label_en ?? null;
    case "de":
      return row.label_de ?? row.label_fr ?? row.label_it ?? row.label_en ?? null;
    case "it":
      return row.label_it ?? row.label_fr ?? row.label_de ?? row.label_en ?? null;
    case "en":
      return row.label_en ?? row.label_fr ?? row.label_de ?? row.label_it ?? null;
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
  // Map "<code>:<lang>" → embedding vector
  entries: Record<string, number[]>;
}

function loadCache(path: string): CacheShape | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as CacheShape;
    if (
      raw &&
      typeof raw === "object" &&
      raw.model === NOGA_EMBEDDING_MODEL &&
      raw.dimensions === NOGA_EMBEDDING_DIMENSIONS &&
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
 * Generate one embedding per (NOGA 2025 code × lang) tuple.
 *
 * Filters the input rows to `scheme === 'NOGA_2025'` internally so callers
 * can pass the full normalized rows array without pre-filtering.
 *
 * Uses a resumable JSON cache keyed on `<code>:<lang>`: if the run crashes,
 * the next invocation picks up where it left off.
 */
export async function generateNogaEmbeddings(
  allRows: NomenclatureRow[],
  opts: GenerateEmbeddingsOptions = {},
): Promise<NogaEmbedding[]> {
  const langs = opts.langs ?? (["fr"] as const);
  const batchSize = opts.batchSize ?? 32;
  const log = opts.log ?? ((m) => console.log(m));
  const cachePath = opts.cachePath ?? "./data/classifications/embeddings-cache-fr.json";

  // Filter to NOGA 2025 only (the only scheme we embed in v1).
  const rows = allRows.filter((r) => r.scheme === "NOGA_2025");
  log(`[noga-embeddings] ${rows.length} NOGA 2025 rows (out of ${allRows.length} total)`);

  const cache = (opts.noCache ? null : loadCache(cachePath)) ?? {
    model: NOGA_EMBEDDING_MODEL,
    model_version: NOGA_EMBEDDING_MODEL_VERSION,
    dimensions: NOGA_EMBEDDING_DIMENSIONS,
    entries: {},
  };

  // Build the work list: every (row, lang) pair NOT yet in the cache.
  type Work = { row: NomenclatureRow; lang: NogaEmbedding["lang"]; key: string; text: string };
  const todo: Work[] = [];
  for (const row of rows) {
    for (const lang of langs) {
      const key = `${row.code}:${lang}`;
      if (cache.entries[key]) continue;
      const text = descriptionFor(row, lang);
      if (!text || text.trim() === "") continue; // skip empty descriptions defensively
      todo.push({ row, lang, key, text });
    }
  }

  const cachedCount = Object.keys(cache.entries).length;
  const totalExpected = rows.length * langs.length;
  log(`[noga-embeddings] ${cachedCount} cached, ${todo.length} to compute (target ${totalExpected})`);

  if (todo.length === 0) {
    // Skip the heavyweight model load entirely when everything is cached.
    log(`[noga-embeddings] all embeddings cached, skipping inference (no model load)`);
  } else {
    // Lazy import: @xenova/transformers is a heavyweight dependency we only need
    // at ETL time, never at server runtime. Importing it eagerly would slow down
    // every tsx invocation in the repo. We also keep it INSIDE the inference branch
    // so warm-cache runs (and tests that prime the cache) don't pay the model load.
    // @ts-expect-error — package exports CJS named exports without bundled types
    const { pipeline, env } = await import("@xenova/transformers");
    // @ts-expect-error — env shape exposed by transformers.js at runtime
    env.allowRemoteModels = true;
    // @ts-expect-error — env shape exposed by transformers.js at runtime
    env.allowLocalModels = true;

    log(`[noga-embeddings] loading model ${NOGA_EMBEDDING_MODEL}...`);
    // `feature-extraction` returns the last hidden state; we ask for mean-pooling
    // + L2 normalisation so the output is directly comparable with cosine.
    // @ts-expect-error — pipeline() typing relaxed in @xenova/transformers v2
    const extractor = await pipeline("feature-extraction", NOGA_EMBEDDING_MODEL, {
      quantized: true, // quantised ONNX is ~4x faster on CPU and quality is fine for our use case
    });
    log(`[noga-embeddings] model loaded`);

    const startedAt = Date.now();
    let processed = 0;
    let lastFlush = Date.now();
    for (let i = 0; i < todo.length; i += batchSize) {
      const batch = todo.slice(i, i + batchSize);
      const texts = batch.map((b) => b.text);
      const tensor = await extractor(texts, { pooling: "mean", normalize: true });
      const flat = tensor.data as Float32Array;
      const dim = NOGA_EMBEDDING_DIMENSIONS;
      if (flat.length !== batch.length * dim) {
        throw new Error(
          `[noga-embeddings] unexpected output shape: got ${flat.length} floats for batch=${batch.length}, expected ${batch.length * dim}`,
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
          `[noga-embeddings] ${processed}/${todo.length} (${rate.toFixed(1)} emb/s, eta ${eta.toFixed(0)}s)`,
        );
      }
    }
    saveCache(cachePath, cache);
    const elapsed = (Date.now() - startedAt) / 1000;
    log(
      `[noga-embeddings] computed ${todo.length} embeddings in ${elapsed.toFixed(1)}s (${(todo.length / Math.max(elapsed, 0.001)).toFixed(1)} emb/s)`,
    );
  }

  // Materialise the final array, preserving row + lang order so downstream
  // consumers can rely on a stable iteration order.
  const out: NogaEmbedding[] = [];
  for (const row of rows) {
    for (const lang of langs) {
      const key = `${row.code}:${lang}`;
      const vec = cache.entries[key];
      if (!vec) continue; // empty description was skipped
      const desc = descriptionFor(row, lang);
      if (!desc) continue;
      out.push({
        code: row.code,
        lang,
        description: desc,
        embedding: vec,
        model: NOGA_EMBEDDING_MODEL,
        model_version: NOGA_EMBEDDING_MODEL_VERSION,
      });
    }
  }
  return out;
}
