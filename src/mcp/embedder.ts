/** Requêtes et index partagent les mêmes poids q8, chargés localement à la demande. */
import { createEmbeddingExtractor } from "../lib/embedding-model.js";
export { EMBEDDING_MODEL } from "../lib/embedding-model.js";
export const EMBEDDING_DIMENSIONS = 768;
let _extractorPromise: ReturnType<typeof createEmbeddingExtractor> | null = null;
async function getExtractor() {
  if (!_extractorPromise) _extractorPromise=createEmbeddingExtractor().catch(error=>{_extractorPromise=null;throw error;});
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
