/**
 * Minimal ambient typings for `@xenova/transformers` (transformers.js).
 *
 * The package ships its own typings via `@xenova/transformers/types/...`
 * but they're not auto-resolved when we do `await import('@xenova/transformers')`
 * in NodeNext / strict mode. We declare just the surface we use in the MCP
 * embedder (feature-extraction pipeline + env flags). Loose typings — the
 * strict signature of the pipeline factory is generic over task names which
 * adds no safety value here.
 */
declare module "@xenova/transformers" {
  export const env: {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    [k: string]: unknown;
  };
  // The pipeline returns a callable; we use it as `extractor(text, opts)`.
  // We type the return as a function returning a Tensor-like with `.data`.
  export interface PipelineOutputTensor {
    data: Float32Array;
    [k: string]: unknown;
  }
  export type Pipeline = (
    input: string | string[],
    options?: { pooling?: "mean" | "cls" | "none"; normalize?: boolean },
  ) => Promise<PipelineOutputTensor>;
  export function pipeline(
    task: string,
    model: string,
    options?: { quantized?: boolean; [k: string]: unknown },
  ): Promise<Pipeline>;
}
