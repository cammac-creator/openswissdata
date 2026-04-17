import { describe, it, expect } from "vitest";
import { normalizeHsCode, buildHierarchyMap } from "../../etl/tares/normalize.js";

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
  });
});
