import { describe, it, expect } from "vitest";
import { parseNaceCsv } from "../../etl/classifications/ingest-nace.js";
import { parseIsicCsv } from "../../etl/classifications/ingest-isic.js";
import { join } from "node:path";

const fixtureDir = join(process.cwd(), "etl/classifications/fixtures");

describe("parseNaceCsv", () => {
  it("parses NACE 2.0 with English labels", () => {
    const rows = parseNaceCsv(join(fixtureDir, "nace-2.0-sample.csv"), "NACE_2.0");
    expect(rows.length).toBeGreaterThan(5);
    const k = rows.find(r => r.code === "K");
    expect(k?.level).toBe("section");
    expect(k?.label_en).toContain("Financial");
  });

  it("parses NACE 2.1 with hierarchy", () => {
    const rows = parseNaceCsv(join(fixtureDir, "nace-2.1-sample.csv"), "NACE_2.1");
    const c = rows.find(r => r.code === "6411");
    expect(c?.parent).toBe("641");
    expect(c?.level).toBe("class");
    expect(c?.scheme).toBe("NACE_2.1");
  });

  it("marks section codes (single uppercase letter) correctly", () => {
    const rows = parseNaceCsv(join(fixtureDir, "nace-2.1-sample.csv"), "NACE_2.1");
    const sections = rows.filter(r => r.level === "section");
    expect(sections.length).toBeGreaterThan(0);
    sections.forEach(s => {
      expect(/^[A-Z]$/.test(s.code)).toBe(true);
      expect(s.parent).toBe(null);
    });
  });
});

describe("parseIsicCsv", () => {
  it("parses ISIC 4 with English labels", () => {
    const rows = parseIsicCsv(join(fixtureDir, "isic-4-sample.csv"));
    expect(rows.length).toBeGreaterThan(5);
    const k = rows.find(r => r.code === "K");
    expect(k?.scheme).toBe("ISIC_4");
    expect(k?.label_en).toContain("Financial");
  });

  it("resolves hierarchy — 6411 child of 641", () => {
    const rows = parseIsicCsv(join(fixtureDir, "isic-4-sample.csv"));
    const r = rows.find(x => x.code === "6411");
    expect(r?.parent).toBe("641");
  });
});
