import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateMultilingualNogaEmbeddings,
  SECONDARY_LANGS,
  type SecondaryLang,
} from "../../etl/classifications/embeddings-multilingual.js";
import {
  NOGA_EMBEDDING_DIMENSIONS,
  NOGA_EMBEDDING_MODEL,
  NOGA_EMBEDDING_MODEL_VERSION,
} from "../../etl/classifications/embeddings.js";
import type { NomenclatureRow } from "../../etl/classifications/types.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function nogaRowsFixture(): NomenclatureRow[] {
  // Three NOGA 2025 codes covering 4 langs each (en + de + it + fr).
  return [
    {
      scheme: "NOGA_2025",
      code: "0111",
      level: "class",
      parent: "011",
      label_fr: "Culture de céréales",
      label_de: "Getreidebau",
      label_it: "Coltivazione di cereali",
      label_en: "Growing of cereals",
    },
    {
      scheme: "NOGA_2025",
      code: "6411",
      level: "class",
      parent: "641",
      label_fr: "Activités de banque centrale",
      label_de: "Zentralbankgeschäfte",
      label_it: "Attività della banca centrale",
      label_en: "Central banking",
    },
    {
      scheme: "NOGA_2025",
      code: "8610",
      level: "class",
      parent: "861",
      label_fr: "Activités hospitalières",
      label_de: "Krankenhäuser",
      label_it: "Servizi ospedalieri",
      label_en: "Hospital activities",
    },
    // NACE row — must be ignored.
    {
      scheme: "NACE_2.1",
      code: "0111",
      level: "class",
      parent: "011",
      label_en: "DO NOT EMBED",
    },
  ];
}

function makeFakeVector(seed: number): number[] {
  // Deterministic L2-normalised pseudo-vector of NOGA_EMBEDDING_DIMENSIONS components.
  const v: number[] = [];
  let sum = 0;
  for (let i = 0; i < NOGA_EMBEDDING_DIMENSIONS; i++) {
    const x = Math.sin((seed + 1) * (i + 1) * 0.001);
    v.push(x);
    sum += x * x;
  }
  const norm = Math.sqrt(sum);
  return v.map((x) => x / norm);
}

/**
 * Pre-populate per-language caches so `generateNogaEmbeddings` short-circuits
 * the model loading + inference and returns directly from cache. This lets us
 * test the wrapper logic without depending on the heavy `@xenova/transformers`
 * dependency at runtime.
 */
function primeCacheFiles(cacheDir: string, rows: NomenclatureRow[], langs: SecondaryLang[]): void {
  const noga2025 = rows.filter((r) => r.scheme === "NOGA_2025");
  for (const lang of langs) {
    const entries: Record<string, number[]> = {};
    for (let i = 0; i < noga2025.length; i++) {
      const r = noga2025[i];
      // Seed varies per code + lang so vectors aren't identical across langs.
      entries[`${r.code}:${lang}`] = makeFakeVector(i * 13 + lang.charCodeAt(0));
    }
    writeFileSync(
      join(cacheDir, `embeddings-cache-${lang}.json`),
      JSON.stringify({
        model: NOGA_EMBEDDING_MODEL,
        model_version: NOGA_EMBEDDING_MODEL_VERSION,
        dimensions: NOGA_EMBEDDING_DIMENSIONS,
        entries,
      }),
    );
  }
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("generateMultilingualNogaEmbeddings", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "osd-emb-multi-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("emits one embedding per (code × lang) when all caches are warm", async () => {
    const rows = nogaRowsFixture();
    primeCacheFiles(workDir, rows, ["de", "it", "en"]);

    const result = await generateMultilingualNogaEmbeddings(rows, {
      cacheDir: workDir,
      langs: ["de", "it", "en"],
      log: () => {},
    });

    expect(result.byLang.de.length).toBe(3);
    expect(result.byLang.it.length).toBe(3);
    expect(result.byLang.en.length).toBe(3);
    // Consistent metadata
    expect(result.model).toBe(NOGA_EMBEDDING_MODEL);
    expect(result.model_version).toBe(NOGA_EMBEDDING_MODEL_VERSION);
    expect(result.dimensions).toBe(NOGA_EMBEDDING_DIMENSIONS);
  });

  it("each embedding has the expected shape (768 dims, L2-normalised)", async () => {
    const rows = nogaRowsFixture();
    primeCacheFiles(workDir, rows, ["de", "it", "en"]);

    const result = await generateMultilingualNogaEmbeddings(rows, {
      cacheDir: workDir,
      langs: ["de"],
      log: () => {},
    });

    for (const e of result.byLang.de) {
      expect(e.embedding.length).toBe(NOGA_EMBEDDING_DIMENSIONS);
      const norm = Math.sqrt(e.embedding.reduce((s, x) => s + x * x, 0));
      expect(norm).toBeCloseTo(1, 5);
      expect(e.lang).toBe("de");
      expect(e.model).toBe(NOGA_EMBEDDING_MODEL);
    }
  });

  it("produces idempotent output on repeated calls (warm cache)", async () => {
    const rows = nogaRowsFixture();
    primeCacheFiles(workDir, rows, ["de"]);

    const a = await generateMultilingualNogaEmbeddings(rows, {
      cacheDir: workDir,
      langs: ["de"],
      log: () => {},
    });
    const b = await generateMultilingualNogaEmbeddings(rows, {
      cacheDir: workDir,
      langs: ["de"],
      log: () => {},
    });
    expect(JSON.stringify(a.byLang.de)).toBe(JSON.stringify(b.byLang.de));
  });

  it("filters non-NOGA rows (NACE rows are not embedded even if they share a code)", async () => {
    const rows = nogaRowsFixture(); // includes one NACE row at code 0111
    primeCacheFiles(workDir, rows, ["de"]);

    const result = await generateMultilingualNogaEmbeddings(rows, {
      cacheDir: workDir,
      langs: ["de"],
      log: () => {},
    });
    // Only 3 NOGA codes, no NACE row leaked in.
    expect(result.byLang.de.length).toBe(3);
    const codes = new Set(result.byLang.de.map((e) => e.code));
    expect(codes.size).toBe(3);
    // descriptions must come from label_de (German), not label_en or fr.
    const r6411 = result.byLang.de.find((e) => e.code === "6411");
    expect(r6411?.description).toBe("Zentralbankgeschäfte");
  });

  it("respects the `langs` option (only generates requested subset)", async () => {
    const rows = nogaRowsFixture();
    primeCacheFiles(workDir, rows, ["de", "it", "en"]);

    const result = await generateMultilingualNogaEmbeddings(rows, {
      cacheDir: workDir,
      langs: ["it"],
      log: () => {},
    });
    expect(result.byLang.it.length).toBe(3);
    // de + en were not requested → still empty in the byLang map.
    expect(result.byLang.de.length).toBe(0);
    expect(result.byLang.en.length).toBe(0);
  });

  it("writes per-language cache files alongside one another", async () => {
    const rows = nogaRowsFixture();
    primeCacheFiles(workDir, rows, ["de", "it", "en"]);

    const result = await generateMultilingualNogaEmbeddings(rows, {
      cacheDir: workDir,
      langs: ["de", "it", "en"],
      log: () => {},
    });
    for (const lang of ["de", "it", "en"] as const) {
      expect(result.stats[lang].cache_path).toMatch(new RegExp(`embeddings-cache-${lang}\\.json$`));
    }
  });
});

describe("SECONDARY_LANGS constant", () => {
  it("contains exactly de + it + en (FR is the v1 default and lives elsewhere)", () => {
    expect([...SECONDARY_LANGS]).toEqual(["de", "it", "en"]);
  });
});
