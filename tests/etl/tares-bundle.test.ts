import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ingestFromFixture } from "../../etl/tares/ingest.js";
import { buildBundle } from "../../etl/tares/bundle.js";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

describe("buildBundle — TARES", () => {
  let workDir: string;
  const fixturePath = join(process.cwd(), "etl/tares/fixtures/sample-5-rows.json");

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "osd-bundle-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("produces a ZIP with expected files and deterministic row count", async () => {
    const rows = ingestFromFixture(fixturePath);
    expect(rows.length).toBe(5);

    const result = await buildBundle(rows, "2026.04.17", workDir);
    expect(existsSync(result.zipPath)).toBe(true);
    expect(result.rowCount).toBe(5);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sizeBytes).toBeGreaterThan(500);
  });

  it("ZIP contains expected internal files", async () => {
    const rows = ingestFromFixture(fixturePath);
    const result = await buildBundle(rows, "2026.04.17", workDir);
    const contents = execSync(`unzip -l "${result.zipPath}"`, { encoding: "utf8" });
    for (const f of ["tares.csv", "tares.parquet", "tares.json", "tares.sql", "schema.json", "README.md", "LICENSE.txt", "checksums.sha256"]) {
      expect(contents).toContain(f);
    }
  });

  it("produces same sha256 on repeated runs (deterministic data payload)", async () => {
    // Note: ZIP itself includes timestamps so its sha will drift, but the csv/json/sql content must be byte-identical.
    // We unzip both runs and compare the csv + sql + schema file contents.
    const rows = ingestFromFixture(fixturePath);
    const r1 = await buildBundle(rows, "2026.04.17", workDir);

    const workDir2 = mkdtempSync(join(tmpdir(), "osd-bundle2-"));
    const r2 = await buildBundle(rows, "2026.04.17", workDir2);

    const extract = (zip: string, out: string) => {
      execSync(`unzip -o "${zip}" -d "${out}"`, { encoding: "utf8" });
    };
    const ext1 = join(workDir, "ext1");
    const ext2 = join(workDir2, "ext2");
    extract(r1.zipPath, ext1);
    extract(r2.zipPath, ext2);

    for (const f of ["tares.csv", "tares.sql", "schema.json"]) {
      expect(readFileSync(join(ext1, f), "utf8")).toBe(readFileSync(join(ext2, f), "utf8"));
    }

    rmSync(workDir2, { recursive: true, force: true });
  });

  it("includes the mandatory BAZG non-official disclaimer in README and LICENSE", async () => {
    const rows = ingestFromFixture(fixturePath);
    const result = await buildBundle(rows, "2026.04.22", workDir);

    const ext = join(workDir, "verify");
    execSync(`unzip -o "${result.zipPath}" -d "${ext}"`);

    const readme = readFileSync(join(ext, "README.md"), "utf8");
    const license = readFileSync(join(ext, "LICENSE.txt"), "utf8");

    // DE disclaimer
    expect(readme).toMatch(/keine offizielle Veröffentlichung/);
    expect(license).toMatch(/keine offizielle Veröffentlichung/);
    // FR disclaimer
    expect(readme).toMatch(/pas une publication officielle/);
    expect(license).toMatch(/pas une publication officielle/);
    // EN disclaimer
    expect(readme).toMatch(/not an official publication/);
    expect(license).toMatch(/not an official publication/);
    // Bern jurisdiction
    expect(license).toMatch(/Bern/);
    // Forbidden content exclusion statement
    expect(license).toMatch(/Erläuterungen/);
  });
});
