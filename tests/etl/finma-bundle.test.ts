import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildBundle } from "../../etl/finma/bundle.js";
import { ingestOneSource } from "../../etl/finma/ingest.js";
import { FINMA_SOURCES } from "../../etl/finma/sources.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const fixtureDir = join(process.cwd(), "etl/finma/fixtures");

describe("finma buildBundle", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "osd-finma-bundle-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("builds a ZIP with expected files from 4 sources", async () => {
    const banks = ingestOneSource(join(fixtureDir, "finma-banks-sample.xlsx"), FINMA_SOURCES.find(s => s.entity_type === "bank")!);
    const psp = ingestOneSource(join(fixtureDir, "finma-psp-sample.xlsx"), FINMA_SOURCES.find(s => s.entity_type === "payment_institution")!);
    const ins = ingestOneSource(join(fixtureDir, "finma-insurance-sample.xlsx"), FINMA_SOURCES.find(s => s.entity_type === "insurance")!);
    const am = ingestOneSource(join(fixtureDir, "finma-asset-manager-individual-sample.xlsx"), FINMA_SOURCES.find(s => s.entity_type === "asset_manager_individual")!);
    const entities = [...banks, ...psp, ...ins, ...am];

    const result = await buildBundle({ entities }, "2026.04.17", workDir);
    expect(existsSync(result.zipPath)).toBe(true);
    expect(result.entityCount).toBe(entities.length);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);

    const contents = execSync(`unzip -l "${result.zipPath}"`, { encoding: "utf8" });
    for (const f of [
      "finma_registry.csv", "finma_registry.json", "finma_registry.sql", "finma_registry.parquet",
      "finma_bank.csv", "finma_payment_institution.csv", "finma_insurance.csv", "finma_asset_manager_individual.csv",
      "changelog_90d.csv", "changelog_90d.json",
      "schema.json", "README.md", "LICENSE.txt", "checksums.sha256",
    ]) {
      expect(contents).toContain(f);
    }
  });

  it("includes changes count when provided", async () => {
    const banks = ingestOneSource(join(fixtureDir, "finma-banks-sample.xlsx"), FINMA_SOURCES.find(s => s.entity_type === "bank")!);
    const result = await buildBundle({
      entities: banks,
      recentChanges: [{ kind: "added", entity_type: "bank", name: "New AG", source_list: "finma-banks", after: { name: "New AG" } }],
    }, "2026.04.17", workDir);
    expect(result.changeCount).toBe(1);
  });
});
