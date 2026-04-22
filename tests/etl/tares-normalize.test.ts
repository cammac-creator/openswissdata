import { describe, it, expect } from "vitest";
import { normalizeHsCode, buildHierarchyMap, assertNoForbiddenFields } from "../../etl/tares/normalize.js";

describe("tares normalize", () => {
  describe("normalizeHsCode", () => {
    it("pads a 4-digit heading to 8 digits", () => {
      expect(normalizeHsCode("8482")).toBe("84820000");
    });

    it("pads a 6-digit subheading to 8 digits", () => {
      expect(normalizeHsCode("848210")).toBe("84821000");
    });

    it("leaves a full 8-digit code unchanged", () => {
      expect(normalizeHsCode("84821000")).toBe("84821000");
    });

    it("strips dots and dashes", () => {
      expect(normalizeHsCode("8482.10.00")).toBe("84821000");
      expect(normalizeHsCode("8482-10")).toBe("84821000");
    });

    it("truncates codes longer than 8 digits", () => {
      expect(normalizeHsCode("848210001234")).toBe("84821000");
    });
  });

  describe("buildHierarchyMap", () => {
    it("sets parent to chapter for heading-level codes", () => {
      const map = buildHierarchyMap([
        { hs8: "84000000" },
        { hs8: "84820000" },
      ]);
      expect(map["84820000"]?.parent).toBe("84000000");
    });

    it("links child codes to their heading parent", () => {
      const map = buildHierarchyMap([
        { hs8: "84000000" },
        { hs8: "84820000" },
        { hs8: "84821000" },
      ]);
      expect(map["84821000"]?.parent).toBe("84820000");
      expect(map["84820000"]?.children).toContain("84821000");
    });

    it("returns null parent for chapter-level codes", () => {
      const map = buildHierarchyMap([
        { hs8: "84000000" },
      ]);
      expect(map["84000000"]?.parent).toBe(null);
    });

    it("links a full 8-digit code to its 6-digit subheading parent when present", () => {
      const map = buildHierarchyMap([
        { hs8: "84000000" },
        { hs8: "84820000" },
        { hs8: "84821000" },
        { hs8: "84821001" },
      ]);
      expect(map["84821001"]?.parent).toBe("84821000");
      expect(map["84821000"]?.children).toContain("84821001");
    });

    it("falls back to heading parent when 6-digit subheading is absent", () => {
      const map = buildHierarchyMap([
        { hs8: "84000000" },
        { hs8: "84820000" },
        { hs8: "84821001" },   // no 84821000 parent
      ]);
      expect(map["84821001"]?.parent).toBe("84820000");
    });

    it("falls back to chapter when no intermediate parent exists", () => {
      const map = buildHierarchyMap([
        { hs8: "84000000" },
        { hs8: "84821001" },
      ]);
      expect(map["84821001"]?.parent).toBe("84000000");
    });
  });

  describe("assertNoForbiddenFields", () => {
    it("returns empty array for compliant row", () => {
      expect(assertNoForbiddenFields({ hs8: "1", designation_fr: "x" })).toEqual([]);
    });
    it("flags Erläuterungen field", () => {
      const v = assertNoForbiddenFields({ hs8: "1", erlauterungen: "banned" });
      expect(v).toContain("erlauterungen");
    });
    it("flags Entscheide field", () => {
      const v = assertNoForbiddenFields({ hs8: "1", entscheide: "banned" });
      expect(v).toContain("entscheide");
    });
    it("flags English equivalents", () => {
      expect(assertNoForbiddenFields({ explanatory_note: "x" })).toContain("explanatory_note");
      expect(assertNoForbiddenFields({ classification_ruling: "x" })).toContain("classification_ruling");
    });
    it("is case-insensitive", () => {
      expect(assertNoForbiddenFields({ Erlaeuterungen: "x" })).toContain("Erlaeuterungen");
    });
  });
});
