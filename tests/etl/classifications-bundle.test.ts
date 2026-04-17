import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildBundle } from "../../etl/classifications/bundle.js";
import { parseNogaXlsx } from "../../etl/classifications/ingest-noga.js";
import { parseNaceCsv } from "../../etl/classifications/ingest-nace.js";
import { parseIsicCsv } from "../../etl/classifications/ingest-isic.js";
import { buildCrossWalks } from "../../etl/classifications/crosswalks.js";
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
});
