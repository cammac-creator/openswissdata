/**
 * MCP embedder — query-time text embedding with the same model used at ETL.
 *
 * Singleton extractor pipeline (lazy-loaded on first call) so the heavy
 * `@xenova/transformers` model (~120 MB ONNX quantised, downloaded from HF on
 * cold start) is loaded exactly once per process.
 *
 * Design notes:
 *   - The model identifier MUST match the one used to bake the dataset
 *     embeddings, or cosine similarity will be meaningless. We hard-code
 *     `Xenova/paraphrase-multilingual-mpnet-base-v2` (768d) — the same string
 *     used in `etl/tares/embeddings.ts` and `etl/classifications/embeddings.ts`.
 *   - We boot the extractor lazily on first request, NOT at module import:
 *     loading at import-time would block the Hono server from listening
 *     during the ~5-10s model download on a cold Railway deploy and risk
 *     healthcheck timeout. Worst case the very first MCP call pays the
 *     bootstrap latency; subsequent calls are <100 ms.
 *   - Returns a Float32Array (the native ONNX output) — no array copy.
 */

export const EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-mpnet-base-v2";
export const EMBEDDING_DIMENSIONS = 768;

let _extractorPromise: Promise<unknown> | null = null;

async function getExtractor(): Promise<unknown> {
  if (_extractorPromise) return _extractorPromise;
  _extractorPromise = (async () => {
    // Lazy import — `@xenova/transformers` weighs ~30 MB of JS + native WASM
    // and we do not want to pay that cost on every tsx invocation in the repo.
    const { pipeline, env } = await import("@xenova/transformers");
    env.allowRemoteModels = true;
    env.allowLocalModels = true;
    return pipeline("feature-extraction", EMBEDDING_MODEL, { quantized: true });
  })();
  return _extractorPromise;
}

/**
 * Embed a free-text query into a 768-dimensional unit vector.
 *
 * Mean-pooled + L2-normalised so cosine similarity reduces to a dot product
 * against the pre-baked dataset vectors (which were normalised the same way).
 */
export async function embedQuery(text: string): Promise<Float32Array> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("embedQuery: empty input");
  }
  const extractor = await getExtractor();
  // @ts-expect-error — extractor is a callable pipeline
  const tensor = await extractor(trimmed, { pooling: "mean", normalize: true });
  const data = tensor.data as Float32Array;
  if (data.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedQuery: unexpected output shape ${data.length}, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }
  return data;
}

/**
 * Cosine similarity between two equal-length vectors. Both inputs are assumed
 * L2-normalised at generation time, so this is effectively a dot product —
 * but we keep the explicit denominator for safety against future schema
 * changes (e.g. unnormalised vectors slipping in).
 */
export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/** Test helper: clears the cached extractor pipeline. */
export function _resetEmbedderCache(): void {
  _extractorPromise = null;
}
