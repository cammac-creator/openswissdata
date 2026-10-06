import { describe, expect, it } from "vitest";
import { PRODUCT_SOURCES, provenanceFieldsFor } from "../../etl/shared/sources/products.js";
import { getSource } from "../../etl/shared/sources/registry.js";
import { PERMISSION_PROFILES } from "../../etl/shared/provenance.js";
import { buildBundle as buildFinmaBundle } from "../../etl/finma/bundle.js";
import { ingestOneSource } from "../../etl/finma/ingest.js";
import { FINMA_SOURCES } from "../../etl/finma/sources.js";
import { buildBundle as buildClassificationsBundle } from "../../etl/classifications/bundle.js";
import { parseNaceCsv } from "../../etl/classifications/ingest-nace.js";
import type { IngestNaicsResult } from "../../etl/classifications/naics-crosswalk.js";
import { withTestSignature } from "../helpers/signature.js";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

describe("assembleur par produit", () => {
  it("chaque source citée par un produit existe dans le registre", () => {
    for (const [produit, ids] of Object.entries(PRODUCT_SOURCES)) for (const id of ids) expect(() => getSource(id), `${produit} → ${id}`).not.toThrow();
  });
  it("les champs 1.0 restent ceux d'avant (archives comparables)", () => {
    for (const p of ["tares", "classifications", "finma"] as const) {
      const f = provenanceFieldsFor(p);
      expect(f.sourceUrl).toBe(PERMISSION_PROFILES[p].sourceUrl);
      expect(f.permissionReference).toBe(PERMISSION_PROFILES[p].permissionReference);
      expect(f.permissionAuthority).toBe(PERMISSION_PROFILES[p].permissionAuthority);
      expect(f.jurisdiction).toBe(PERMISSION_PROFILES[p].jurisdiction);
      expect(f.permissionDate).toBe("permissionDate" in PERMISSION_PROFILES[p] ? PERMISSION_PROFILES[p].permissionDate : undefined);
    }
  });
  it("FINMA liste ses six sources, dont GLEIF", () => {
    const ids = provenanceFieldsFor("finma").sources!.map(s => s.id);
    expect(ids).toEqual(expect.arrayContaining(["finma.uid_csv", "finma.warnings_api", "finma.vvtr_xlsx", "finma.sro_xlsx", "finma.ao_xlsx", "gleif.lei_api"]));
    expect(provenanceFieldsFor("finma").sources!.find(s => s.id === "gleif.lei_api")!.permission_reference).toBe("PUBLIC-OFFICIAL-SOURCE-GLEIF-CC0");
  });
  it("un identifiant inconnu fait échouer l'assemblage", () => {
    expect(() => provenanceFieldsFor("finma", ["finma.uid_csv", "inconnu.source"])).toThrow(/source inconnue/);
  });

  it("une archive FINMA construite porte un provenance.json 1.1 avec les 6 sources", async () => {
    const fixtureDir = join(process.cwd(), "etl/finma/fixtures");
    const workDir = mkdtempSync(join(tmpdir(), "osd-finma-product-sources-"));
    try {
      const banks = ingestOneSource(join(fixtureDir, "finma-banks-sample.xlsx"), FINMA_SOURCES.find(s => s.entity_type === "bank")!);
      const buildBundle = withTestSignature(buildFinmaBundle);
      const result = await buildBundle({ entities: banks }, "2026.10.06", workDir);
      const extractDir = join(workDir, "extracted");
      execSync(`unzip -o -q "${result.zipPath}" provenance.json -d "${extractDir}"`);
      const manifest = JSON.parse(readFileSync(join(extractDir, "provenance.json"), "utf8"));
      expect(manifest.manifest_version).toBe("1.1");
      expect(manifest.sources.length).toBe(6);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("classifications SANS NAICS : census.naics_isic absent du manifeste, 9 sources", async () => {
    const fixtureDir = join(process.cwd(), "etl/classifications/fixtures");
    const workDir = mkdtempSync(join(tmpdir(), "osd-classif-product-sources-"));
    try {
      const nace21 = parseNaceCsv(join(fixtureDir, "nace-2.1-sample.csv"), "NACE_2.1");
      const buildBundle = withTestSignature(buildClassificationsBundle);
      const result = await buildBundle({ rows: nace21, crossWalks: [] }, "2026.10.06", workDir);
      const extractDir = join(workDir, "extracted");
      execSync(`unzip -o -q "${result.zipPath}" provenance.json -d "${extractDir}"`);
      const manifest = JSON.parse(readFileSync(join(extractDir, "provenance.json"), "utf8"));
      const ids = manifest.sources.map((s: { id: string }) => s.id);
      expect(ids).not.toContain("census.naics_isic");
      expect(manifest.sources.length).toBe(9);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("classifications AVEC NAICS : census.naics_isic présent, 10 sources", async () => {
    const fixtureDir = join(process.cwd(), "etl/classifications/fixtures");
    const workDir = mkdtempSync(join(tmpdir(), "osd-classif-product-sources-naics-"));
    try {
      const nace21 = parseNaceCsv(join(fixtureDir, "nace-2.1-sample.csv"), "NACE_2.1");
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
        stats: { raw_links: 1, emitted_rows: 1, exact: 1, partial: 0, naics_unique: 1, isic_unique: 1, fetch_seconds: 0.1 },
      };
      const buildBundle = withTestSignature(buildClassificationsBundle);
      const result = await buildBundle({ rows: nace21, crossWalks: [], naics }, "2026.10.06.naics", workDir);
      const extractDir = join(workDir, "extracted");
      execSync(`unzip -o -q "${result.zipPath}" provenance.json -d "${extractDir}"`);
      const manifest = JSON.parse(readFileSync(join(extractDir, "provenance.json"), "utf8"));
      const ids = manifest.sources.map((s: { id: string }) => s.id);
      expect(ids).toContain("census.naics_isic");
      expect(manifest.sources.length).toBe(10);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
