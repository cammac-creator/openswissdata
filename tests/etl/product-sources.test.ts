import { describe, expect, it } from "vitest";
import { PRODUCT_SOURCES, provenanceFieldsFor } from "../../etl/shared/sources/products.js";
import { getSource } from "../../etl/shared/sources/registry.js";
import { PERMISSION_PROFILES } from "../../etl/shared/provenance.js";
import { buildBundle as buildFinmaBundle } from "../../etl/finma/bundle.js";
import { ingestOneSource } from "../../etl/finma/ingest.js";
import { FINMA_SOURCES } from "../../etl/finma/sources.js";
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
});
