/**
 * Multilingual NOGA 2025 embeddings (Pro tier add-on, Phase 1 / replaces STATENT).
 *
 * Why: the v1 cache (`embeddings-cache-fr.json`) ships ~1845 FR vectors. Buyers
 * with German / Italian / English UIs need the same semantic-search capability
 * in their language. The model is multilingual (`paraphrase-multilingual-mpnet-base-v2`,
 * 50+ languages) so the vector space is shared — DE/IT/EN queries will already
 * match against FR vectors out-of-the-box, but pre-computed per-language vectors
 * give cleaner near-monolingual matches.
 *
 * Strategy: this module is a *thin wrapper* around `generateNogaEmbeddings`
 * from `embeddings.ts`. We call the existing generator three times (one per
 * language) with a per-language cache file. We do NOT recompute FR — the
 * existing `embeddings-cache-fr.json` is reused.
 *
 * Output:
 *   - `data/classifications/embeddings-cache-de.json` (resumable)
 *   - `data/classifications/embeddings-cache-it.json`
 *   - `data/classifications/embeddings-cache-en.json`
 *   - One `NogaEmbedding[]` per language, ready for `bundle.ts` to write to
 *     `noga_2025_embeddings_{de,it,en}.parquet`.
 */

import { join } from "node:path";
import {
  generateNogaEmbeddings,
  NOGA_EMBEDDING_DIMENSIONS,
  NOGA_EMBEDDING_MODEL,
  NOGA_EMBEDDING_MODEL_VERSION,
  type NogaEmbedding,
  type GenerateEmbeddingsOptions,
} from "./embeddings.js";
import type { NomenclatureRow } from "./types.js";

export type SecondaryLang = "de" | "it" | "en";

export const SECONDARY_LANGS: ReadonlyArray<SecondaryLang> = ["de", "it", "en"] as const;

export interface MultilingualEmbeddingsResult {
  /** Map lang → embeddings array (one vector per NOGA 2025 code). */
  byLang: Record<SecondaryLang, NogaEmbedding[]>;
  /** Per-language stats (count, cache path, took ms). */
  stats: Record<
    SecondaryLang,
    {
      count: number;
      cache_path: string;
      took_ms: number;
    }
  >;
  /** Re-exported metadata so `bundle.ts` can stamp the parquet manifest. */
  model: string;
  model_version: string;
  dimensions: number;
}

export interface GenerateMultilingualOptions {
  /** Directory where per-language caches live. Default `data/classifications/`. */
  cacheDir?: string;
  /** Subset of languages to process. Default = all secondary langs (de/it/en). */
  langs?: ReadonlyArray<SecondaryLang>;
  /** Batch size forwarded to `generateNogaEmbeddings`. Default 32. */
  batchSize?: number;
  /** Logger; defaults to console.log. */
  log?: (msg: string) => void;
  /** Force re-generation even if cache exists. */
  noCache?: boolean;
}

/**
 * Generate one embeddings array per (DE / IT / EN) language for NOGA 2025 codes.
 *
 * Each language gets its own resumable JSON cache file in `cacheDir` so a
 * crashed run resumes per-language without recomputing finished languages.
 *
 * Total expected runtime on M1 CPU (cold cache): ~12-18 minutes (3 × 1845 codes).
 * Warm cache: < 5 seconds (just JSON load + materialisation).
 */
export async function generateMultilingualNogaEmbeddings(
  rows: NomenclatureRow[],
  opts: GenerateMultilingualOptions = {},
): Promise<MultilingualEmbeddingsResult> {
  const cacheDir = opts.cacheDir ?? "./data/classifications";
  const langs = opts.langs ?? SECONDARY_LANGS;
  const log = opts.log ?? ((m) => console.log(m));

  const byLang: Record<SecondaryLang, NogaEmbedding[]> = {
    de: [],
    it: [],
    en: [],
  };
  const stats: MultilingualEmbeddingsResult["stats"] = {
    de: { count: 0, cache_path: "", took_ms: 0 },
    it: { count: 0, cache_path: "", took_ms: 0 },
    en: { count: 0, cache_path: "", took_ms: 0 },
  };

  for (const lang of langs) {
    const cachePath = join(cacheDir, `embeddings-cache-${lang}.json`);
    log(
      `[noga-embeddings-multi] === lang=${lang} (cache=${cachePath}) ===`,
    );
    const t0 = Date.now();
    const embeddings = await generateNogaEmbeddings(rows, {
      cachePath,
      langs: [lang],
      batchSize: opts.batchSize,
      log: opts.log,
      noCache: opts.noCache,
    } satisfies GenerateEmbeddingsOptions);
    const took = Date.now() - t0;
    byLang[lang] = embeddings;
    stats[lang] = { count: embeddings.length, cache_path: cachePath, took_ms: took };
    log(
      `[noga-embeddings-multi] lang=${lang} → ${embeddings.length} vectors (${(took / 1000).toFixed(1)}s)`,
    );
  }

  return {
    byLang,
    stats,
    model: NOGA_EMBEDDING_MODEL,
    model_version: NOGA_EMBEDDING_MODEL_VERSION,
    dimensions: NOGA_EMBEDDING_DIMENSIONS,
  };
}
