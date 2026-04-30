import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildBundle } from "../../etl/classifications/bundle.js";
import { parseNaceCsv } from "../../etl/classifications/ingest-nace.js";
import type { IngestStatentResult } from "../../etl/classifications/ingest-statent.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const fixtureDir = join(process.cwd(), "etl/classifications/fixtures");

function makeStatentSample(): IngestStatentResult {
  return {
    cantonDivision: [
      {
        year: 2023,
        canton_bfs_id: 1,
        canton_label: "Zürich",
        noga_division: "47",
        noga_division_label: "47 Commerce de détail",
        observation_unit: "establishments",
        value: 7500,
      },
      {
        year: 2023,
        canton_bfs_id: 1,
        canton_label: "Zürich",
        noga_division: "47",
        noga_division_label: "47 Commerce de détail",
        observation_unit: "fte_total",
        value: 42648,
      },
      {
        year: 2023,
        canton_bfs_id: 22,
        canton_label: "Vaud",
        noga_division: "47",
        noga_division_label: "47 Commerce de détail",
        observation_unit: "establishments",
        value: null, // suppressed
      },
    ],
    communeSector: [
      {
        year: 2023,
        commune_bfs_id: 261,
        commune_label: "Zürich",
        sector: "total",
        sector_label: "Secteur économique - total",
        observation_unit: "establishments",
        value: 47000,
      },
      {
        year: 2023,
        commune_bfs_id: 6621,
        commune_label: "Lausanne",
        sector: "tertiary",
        sector_label: "Secteur tertiaire",
        observation_unit: "fte_total",
        value: null, // suppressed
      },
    ],
    source: {
      table_canton_division: "px-x-0602010000_101",
      table_commune_sector: "px-x-0602010000_102",
      api_base: "https://www.pxweb.bfs.admin.ch/api/v1/fr",
      license: "terms_by_ask",
      attribution: "OFS — STATENT",
      permission_status: "test fixture",
    },
    stats: {
      canton_division_rows: 3,
      commune_sector_rows: 2,
      suppressed_cells: 2,
      years_ingested: [2023],
      years_missing: [],
      fetch_seconds: 0,
    },
  };
}

describe("classifications buildBundle (Pro tier with STATENT)", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "osd-cb-statent-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("includes statent_*.{csv,parquet,sql} files when statent input is provided", async () => {
    const nace21 = parseNaceCsv(join(fixtureDir, "nace-2.1-sample.csv"), "NACE_2.1");
    const result = await buildBundle(
      { rows: nace21, crossWalks: [], statent: makeStatentSample() },
      "2026.04.30.test",
      workDir,
      { withTimestamp: false },
    );
    expect(existsSync(result.zipPath)).toBe(true);
    expect(result.statentRowCount).toEqual({ canton_division: 3, commune_sector: 2 });

    const contents = execSync(`unzip -l "${result.zipPath}"`, { encoding: "utf8" });
    for (const f of [
      "statent_canton_division.csv",
      "statent_canton_division.parquet",
      "statent_canton_division.sql",
      "statent_commune_sector.csv",
      "statent_commune_sector.parquet",
      "statent_commune_sector.sql",
      "statent_source.json",
    ]) {
      expect(contents).toContain(f);
    }
  });

  it("omits statent files in the standard tier (no statent input)", async () => {
    const nace21 = parseNaceCsv(join(fixtureDir, "nace-2.1-sample.csv"), "NACE_2.1");
    const result = await buildBundle(
      { rows: nace21, crossWalks: [] },
      "2026.04.30.test-std",
      workDir,
      { withTimestamp: false },
    );
    expect(result.statentRowCount).toBeUndefined();

    const contents = execSync(`unzip -l "${result.zipPath}"`, { encoding: "utf8" });
    expect(contents).not.toContain("statent_");
  });

  it("preserves nulls (confidentiality-suppressed cells) end-to-end", async () => {
    const nace21 = parseNaceCsv(join(fixtureDir, "nace-2.1-sample.csv"), "NACE_2.1");
    const sample = makeStatentSample();
    const result = await buildBundle(
      { rows: nace21, crossWalks: [], statent: sample },
      "2026.04.30.test-null",
      workDir,
      { withTimestamp: false },
    );
    // Extract and inspect the CSV: a null `value` must be an empty cell.
    const ext = join(workDir, "ext");
    execSync(`unzip -o "${result.zipPath}" -d "${ext}"`, { stdio: "ignore" });
    const csv = execSync(`cat "${join(ext, "statent_canton_division.csv")}"`, {
      encoding: "utf8",
    });
    // Vaud row has a null value → trailing comma + empty cell.
    expect(csv).toMatch(/Vaud,47,.*establishments,\s*\n/);
  });
});
