import { describe, it, expect } from "vitest";
import { cosineSimilarity, TARES_EMBEDDING_DIMENSIONS, TARES_EMBEDDING_MODEL } from "../../etl/tares/embeddings.js";

describe("TARES embeddings — cosineSimilarity", () => {
  it("returns 1 for two identical L2-normalised vectors", () => {
    const v = Array.from({ length: 8 }, (_, i) => (i + 1) / 10);
    // L2-normalise so the function operates on unit vectors (matches our actual pipeline output).
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    const u = v.map((x) => x / norm);
    expect(cosineSimilarity(u, u)).toBeCloseTo(1, 6);
  });

  it("returns ~0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10);
  });

  it("returns -1 for anti-parallel vectors", () => {
    expect(cosineSimilarity([0.6, 0.8], [-0.6, -0.8])).toBeCloseTo(-1, 6);
  });

  it("throws on length mismatch", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/length mismatch/);
  });

  it("returns 0 if either vector is the zero vector (no NaN)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });
});

describe("TARES embeddings — model constants", () => {
  it("dimensions is 768 (sentence-transformers MPNet base output size)", () => {
    expect(TARES_EMBEDDING_DIMENSIONS).toBe(768);
  });

  it("model is the multilingual paraphrase MPNet ONNX port", () => {
    expect(TARES_EMBEDDING_MODEL).toBe("Xenova/paraphrase-multilingual-mpnet-base-v2");
  });
});
