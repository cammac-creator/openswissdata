import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildBundle } from "../../etl/classifications/bundle.js";
import { parseNogaXlsx } from "../../etl/classifications/ingest-noga.js";
import { parseNaceCsv } from "../../etl/classifications/ingest-nace.js";
import { parseIsicCsv } from "../../etl/classifications/ingest-isic.js";
import { buildCrossWalks } from "../../etl/classifications/crosswalks.js";
import {
  NOGA_EMBEDDING_DIMENSIONS,
  NOGA_EMBEDDING_MODEL,
  NOGA_EMBEDDING_MODEL_VERSION,
  type NogaEmbedding,
} from "../../etl/classifications/embeddings.js";
import type { IngestNaicsResult } from "../../etl/classifications/naics-crosswalk.js";
import type { NaceEnLabelRow } from "../../etl/classifications/nace-en-labels.js";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const fixtureDir = join(process.cwd(), "etl/classifications/fixtures");

describe("classifications buildBundle", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "osd-cb-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("produces a ZIP with all 5 schemes + crosswalks + metadata files", async () => {
    const noga2025 = parseNogaXlsx(join(fixtureDir, "noga-2025-sample.xlsx"), "NOGA_2025");
    const noga2008 = parseNogaXlsx(join(fixtureDir, "noga-2008-sample.xlsx"), "NOGA_2008");
    const nace20 = parseNaceCsv(join(fixtureDir, "nace-2.0-sample.csv"), "NACE_2.0");
    const nace21 = parseNaceCsv(join(fixtureDir, "nace-2.1-sample.csv"), "NACE_2.1");
    const isic4 = parseIsicCsv(join(fixtureDir, "isic-4-sample.csv"));
    const allRows = [...noga2008, ...noga2025, ...nace20, ...nace21, ...isic4];

    const crossWalks = buildCrossWalks(allRows, {
      nace20to21Path: join(fixtureDir, "bridge-nace-2.0-to-2.1.csv"),
      nace21toIsic4Path: join(fixtureDir, "bridge-nace-2.1-to-isic-4.csv"),
    });

    const result = await buildBundle({ rows: allRows, crossWalks }, "2026.04.17", workDir);
    expect(existsSync(result.zipPath)).toBe(true);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sizeBytes).toBeGreaterThan(1000);

    // Verify counts
    expect(result.nomenclatureCount["NOGA_2025"]).toBeGreaterThan(5);
    expect(result.nomenclatureCount["NACE_2.1"]).toBeGreaterThan(5);
    expect(result.crossWalkCount).toBeGreaterThan(0);

    // Inspect ZIP contents
    const contents = execSync(`unzip -l "${result.zipPath}"`, { encoding: "utf8" });
    for (const f of [
      "noga_2008.csv",
      "noga_2025.csv",
      "nace_2_0.csv",
      "nace_2_1.csv",
      "isic_4.csv",
      "nomenclatures.parquet",
      "crosswalks.csv",
      "crosswalks.json",
      "crosswalks.parquet",
      "schema.json",
      "README.md",
      "LICENSE.txt",
      "checksums.sha256",
    ]) {
      expect(contents).toContain(f);
    }
  });

  it("produces byte-identical csv/json/sql on repeated runs", async () => {
    const nace21 = parseNaceCsv(join(fixtureDir, "nace-2.1-sample.csv"), "NACE_2.1");
    const crossWalks = buildCrossWalks(
      nace21.filter((r) => r.level === "class").map((r) => ({ ...r, scheme: "NOGA_2025" as const })),
      {
        nace20to21Path: join(fixtureDir, "bridge-nace-2.0-to-2.1.csv"),
        nace21toIsic4Path: join(fixtureDir, "bridge-nace-2.1-to-isic-4.csv"),
      },
    );

    const r1 = await buildBundle({ rows: nace21, crossWalks }, "2026.04.17", workDir);
    const workDir2 = mkdtempSync(join(tmpdir(), "osd-cb2-"));
    const r2 = await buildBundle({ rows: nace21, crossWalks }, "2026.04.17", workDir2);

    const extract = (zip: string, out: string) => execSync(`unzip -o "${zip}" -d "${out}"`);
    const ext1 = join(workDir, "ext1");
    const ext2 = join(workDir2, "ext2");
    extract(r1.zipPath, ext1);
    extract(r2.zipPath, ext2);

    for (const f of ["nace_2_1.csv", "crosswalks.csv", "schema.json"]) {
      expect(readFileSync(join(ext1, f), "utf8")).toBe(readFileSync(join(ext2, f), "utf8"));
    }

    rmSync(workDir2, { recursive: true, force: true });
  });

  it("includes Pro tier artefacts when naics + naceEnLabels + multilingual embeddings are provided", async () => {
    const noga2025 = parseNogaXlsx(join(fixtureDir, "noga-2025-sample.xlsx"), "NOGA_2025");
    const nace21 = parseNaceCsv(join(fixtureDir, "nace-2.1-sample.csv"), "NACE_2.1");
    const allRows = [...noga2025, ...nace21];

    const fakeVector = (seed: number): number[] => {
      const v: number[] = [];
      let sum = 0;
      for (let i = 0; i < NOGA_EMBEDDING_DIMENSIONS; i++) {
        const x = Math.sin((seed + 1) * (i + 1) * 0.001);
        v.push(x);
        sum += x * x;
      }
      const norm = Math.sqrt(sum);
      return v.map((x) => x / norm);
    };

    const embeddings: NogaEmbedding[] = [];
    let s = 0;
    for (const lang of ["fr", "de", "it", "en"] as const) {
      for (const r of noga2025.slice(0, 2)) {
        embeddings.push({
          code: r.code,
          lang,
          description: `${lang} desc ${r.code}`,
          embedding: fakeVector(s++),
          model: NOGA_EMBEDDING_MODEL,
          model_version: NOGA_EMBEDDING_MODEL_VERSION,
        });
      }
    }

    const naics: IngestNaicsResult = {
      rows: [
        {
          naics_2022: "111110",
          naics_2022_title: "Soybean farming",
          isic_4: "0111",
          isic_4_title: "Cereals",
          nace_2_1: "0111",
          noga_2025: "0111",
          mapping_type: "exact",
          notes: null,
        },
      ],
      source: {
        url: "https://www.census.gov/naics/concordances/2022_NAICS_to_ISIC_Rev_4.xlsx",
        fetched_at: new Date().toISOString(),
        sheet_name: "NAICS 22 to ISIC 4 technical",
        license: "Public Domain (US Government Work)",
        attribution: "U.S. Census Bureau — 2022 NAICS to ISIC Rev 4 concordance",
      },
      stats: {
        raw_links: 1,
        emitted_rows: 1,
        exact: 1,
        partial: 0,
        naics_unique: 1,
        isic_unique: 1,
        fetch_seconds: 0.1,
      },
    };

    const naceEnLabels: NaceEnLabelRow[] = [
      { code: "K", level: "section", parent: null, label_en: "Financial and insurance activities" },
      { code: "6411", level: "class", parent: "641", label_en: "Central banking" },
    ];

    const result = await buildBundle(
      { rows: allRows, crossWalks: [], embeddings, naics, naceEnLabels },
      "2026.04.30.test-pro",
      workDir,
      { withTimestamp: false },
    );

    expect(result.embeddingCount).toBe(8);
    expect(result.embeddingCountByLang).toEqual({ fr: 2, de: 2, it: 2, en: 2 });
    expect(result.naicsCrosswalkCount).toBe(1);
    expect(result.naceEnLabelCount).toBe(2);

    const contents = execSync(`unzip -l "${result.zipPath}"`, { encoding: "utf8" });
    for (const f of [
      "noga_2025_embeddings_fr.parquet",
      "noga_2025_embeddings_de.parquet",
      "noga_2025_embeddings_it.parquet",
      "noga_2025_embeddings_en.parquet",
      "naics_nace_crosswalk.csv",
      "naics_nace_crosswalk.parquet",
      "naics_source.json",
      "nace_2_1_en_labels.csv",
      "nace_2_1_en_labels.parquet",
    ]) {
      expect(contents).toContain(f);
    }

    // STATENT files MUST NOT be present in the Pro tier bundle (license blocked).
    expect(contents).not.toContain("statent_");
  });

  it("omits Pro tier artefacts in the standard tier (no naics, no embeddings, no naceEnLabels)", async () => {
    const nace21 = parseNaceCsv(join(fixtureDir, "nace-2.1-sample.csv"), "NACE_2.1");
    const result = await buildBundle(
      { rows: nace21, crossWalks: [] },
      "2026.04.30.test-std-pro",
      workDir,
      { withTimestamp: false },
    );
    expect(result.embeddingCount).toBeUndefined();
    expect(result.embeddingCountByLang).toBeUndefined();
    expect(result.naicsCrosswalkCount).toBeUndefined();
    expect(result.naceEnLabelCount).toBeUndefined();

    const contents = execSync(`unzip -l "${result.zipPath}"`, { encoding: "utf8" });
    expect(contents).not.toContain("naics_");
    expect(contents).not.toContain("nace_2_1_en_labels");
    expect(contents).not.toContain("noga_2025_embeddings_");
  });
});
