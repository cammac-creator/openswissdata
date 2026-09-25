import { describe, it, expect } from "vitest";
import { crossWalkHandler } from "../../src/mcp/tools/cross-walk.js";
import { resolveClassificationLinks, type ClassificationLink } from "../../src/lib/classification-links.js";
import { getClassificationLinks } from "../../src/mcp/data-loader.js";

describe("Correspondances du référentiel contrôlé", () => {
  it("ne qualifie plus l'imprimerie de journaux d'équivalent exact à toute l'imprimerie", () => {
    const result = crossWalkHandler({ code: "18.11", source: "NACE_2.0", target: "ISIC_4" }).structured!;
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]).toMatchObject({ target_code: "1811", relation: "closeMatch", mapping_type: "partial", requires_review: true });
    expect(result.sources[0].source_id).toBe("eurostat-nace2-isic4");
    expect(result.reference_version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
  });
  it("normalise le point et conserve l'identité OFS documentée", () => {
    const result = crossWalkHandler({ code: " 18.11 ", source: "NOGA_2025", target: "NACE_2.1" }).structured!;
    expect(result.source_code).toBe("1811");
    expect(result.mappings[0]).toMatchObject({ target_code: "1811", relation: "exactMatch", requires_review: false });
  });
  it("n'aplatit pas deux closeMatch en une correspondance NACE 2.1/ISIC", () => {
    const result = crossWalkHandler({ code: "1811", source: "NACE_2.1", target: "ISIC_4" }).structured!;
    expect(result.count).toBe(0);
    expect(result.limitations.some(x => x.includes("successifs"))).toBe(true);
  });
  it("transmet une relation approchée à travers une identité documentée", () => {
    const result = crossWalkHandler({ code: "1811", source: "NOGA_2008", target: "ISIC_4" }).structured!;
    expect(result.mappings[0].path).toHaveLength(2);
    expect(result.mappings[0].relation).toBe("closeMatch");
    expect(result.sources).toHaveLength(2);
  });
  it("distingue une classe de ses genres suisses, dans les deux sens", () => {
    const forward = crossWalkHandler({ code: "181100", source: "NOGA_2025", target: "NACE_2.1" }).structured!;
    expect(forward.mappings[0]).toMatchObject({ target_code: "1811", relation: "broadMatch" });
    const reverse = crossWalkHandler({ code: "1811", source: "NACE_2.1", target: "NOGA_2025" }).structured!;
    expect(reverse.mappings.find(m => m.target_code === "181100")?.relation).toBe("narrowMatch");
  });
  it("refuse une écriture de code mal formée", () => expect(crossWalkHandler({code:"18..11",source:"NACE_2.0",target:"ISIC_4"}).isError).toBe(true));
  it("ne contient aucun lien sans source vérifiable", () => {
    const data = getClassificationLinks(), sources = new Set(data.sources.map(s => s.source_id));
    expect(data.links.length).toBeGreaterThan(6000);
    expect(data.links.every(l => sources.has(l.source_id))).toBe(true);
    expect(data.sources.every(s => /^[a-f0-9]{64}$/.test(s.sha256))).toBe(true);
  });
  it("ne parcourt pas un cycle pour fabriquer une correspondance", () => {
    const edges: ClassificationLink[] = [
      { source_scheme:"NOGA_2025",source_code:"1811",target_scheme:"NACE_2.1",target_code:"1811",relation:"exactMatch",source_id:"ofs" },
      { source_scheme:"NACE_2.1",source_code:"1811",target_scheme:"NACE_2.0",target_code:"1811",relation:"closeMatch",source_id:"eurostat" },
      { source_scheme:"NACE_2.0",source_code:"1811",target_scheme:"ISIC_4",target_code:"1811",relation:"closeMatch",source_id:"eurostat" },
    ];
    expect(resolveClassificationLinks(edges,"NOGA_2025","1811","ISIC_4")).toEqual([]);
  });
});
