import { describe, it, expect } from "vitest";
import { parseNogaXlsx } from "../../etl/classifications/ingest-noga.js";
import { join } from "node:path";

const fixtureDir = join(process.cwd(), "etl/classifications/fixtures");

describe("parseNogaXlsx", () => {
  it("parses NOGA 2025 fixture with 4 languages", () => {
    const rows = parseNogaXlsx(join(fixtureDir, "noga-2025-sample.xlsx"), "NOGA_2025");
    expect(rows.length).toBeGreaterThan(10);
    const k = rows.find(r => r.code === "K");
    expect(k?.level).toBe("section");
    expect(k?.parent).toBe(null);
    expect(k?.label_fr).toContain("financière");
    expect(k?.label_de).toContain("Finanz");
    expect(k?.label_it).toContain("finanziarie");
  });

  it("resolves hierarchy — 6412 child of 641", () => {
    const rows = parseNogaXlsx(join(fixtureDir, "noga-2025-sample.xlsx"), "NOGA_2025");
    const r = rows.find(x => x.code === "6412");
    expect(r?.parent).toBe("641");
    expect(r?.level).toBe("class");
  });

  it("skips empty rows and non-code entries", () => {
    const rows = parseNogaXlsx(join(fixtureDir, "noga-2025-sample.xlsx"), "NOGA_2025");
    // No row should have an empty code
    expect(rows.every(r => r.code.length > 0)).toBe(true);
  });

  it("marks scheme correctly on every row", () => {
    const rows2025 = parseNogaXlsx(join(fixtureDir, "noga-2025-sample.xlsx"), "NOGA_2025");
    const rows2008 = parseNogaXlsx(join(fixtureDir, "noga-2008-sample.xlsx"), "NOGA_2008");
    expect(rows2025.every(r => r.scheme === "NOGA_2025")).toBe(true);
    expect(rows2008.every(r => r.scheme === "NOGA_2008")).toBe(true);
  });
});
