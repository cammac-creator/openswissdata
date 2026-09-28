// Chaque archive vendue porte la notice générale et les conditions propres à ses sources.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { datasetLicense } from "../../etl/shared/dataset-license.js";
import { withTestSignature } from "../helpers/signature.js";
import { buildBundle as buildTares } from "../../etl/tares/bundle.js";
import { ingestFromFixture } from "../../etl/tares/ingest.js";
import { buildBundle as buildFinma } from "../../etl/finma/bundle.js";
import { ingestOneSource } from "../../etl/finma/ingest.js";
import { FINMA_SOURCES } from "../../etl/finma/sources.js";
import { buildBundle as buildClassifications } from "../../etl/classifications/bundle.js";
import { parseNogaXlsx } from "../../etl/classifications/ingest-noga.js";
import { parseNaceCsv } from "../../etl/classifications/ingest-nace.js";
import { parseIsicCsv } from "../../etl/classifications/ingest-isic.js";
import { buildCrossWalks } from "../../etl/classifications/crosswalks.js";

const REQUIRED: Record<"tares" | "finma" | "classifications", string[]> = {
  tares: ["Ceci n’est pas une publication officielle", "Only publications of the Federal Chancellery", "https://xtares.admin.ch/",
    "must not be altered", "Erläuterungen", "Jurisdiction for TARES-related disputes: Bern"],
  finma: ["https://www.finma.ch/en/terms-and-conditions/", "6 May 2026", "CC0 1.0", "does not replace consultation of the official current register"],
  classifications: ["Bundesamt für Statistik", "Eurostat", "United Nations Statistics Division",
    "public availability alone does not grant unrestricted redistribution", "No STATENT data"],
};
const licenseIn = (zip: string) => execFileSync("unzip", ["-p", zip, "LICENSE.txt"], { encoding: "utf8" });

describe("Notices de licence des archives", () => {
  for (const dataset of ["tares", "finma", "classifications"] as const) {
    it(`${dataset} : notice trilingue et conditions de ses sources`, () => {
      const text = datasetLicense(dataset);
      for (const part of ["FR — ", "DE — ", "EN — ", "CONDITIONS DE SOURCE", "resale or republication of our compilation is not included"]) expect(text).toContain(part);
      for (const part of REQUIRED[dataset]) expect(text).toContain(part);
    });
  }

  describe("jointes telles quelles à chaque archive", () => {
    let workDir: string;
    beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), "osd-licence-")); });
    afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });

    it("TARES", async () => {
      const rows = ingestFromFixture(join(process.cwd(), "etl/tares/fixtures/sample-5-rows.json"));
      const result = await withTestSignature(buildTares)(rows, "2026.04.17", workDir);
      expect(licenseIn(result.zipPath)).toBe(datasetLicense("tares"));
    });

    it("FINMA", async () => {
      const banks = ingestOneSource(join(process.cwd(), "etl/finma/fixtures/finma-banks-sample.xlsx"), FINMA_SOURCES.find(s => s.entity_type === "bank")!);
      const result = await withTestSignature(buildFinma)({ entities: banks }, "2026.04.17", workDir);
      expect(licenseIn(result.zipPath)).toBe(datasetLicense("finma"));
    });

    it("classifications", async () => {
      const dir = join(process.cwd(), "etl/classifications/fixtures");
      const rows = [
        ...parseNogaXlsx(join(dir, "noga-2008-sample.xlsx"), "NOGA_2008"), ...parseNogaXlsx(join(dir, "noga-2025-sample.xlsx"), "NOGA_2025"),
        ...parseNaceCsv(join(dir, "nace-2.0-sample.csv"), "NACE_2.0"), ...parseNaceCsv(join(dir, "nace-2.1-sample.csv"), "NACE_2.1"),
        ...parseIsicCsv(join(dir, "isic-4-sample.csv")),
      ];
      const crossWalks = buildCrossWalks(rows, { nace20to21Path: join(dir, "bridge-nace-2.0-to-2.1.csv"), nace21toIsic4Path: join(dir, "bridge-nace-2.1-to-isic-4.csv") });
      const result = await withTestSignature(buildClassifications)({ rows, crossWalks }, "2026.04.17", workDir);
      expect(licenseIn(result.zipPath)).toBe(datasetLicense("classifications"));
    });
  });
});
