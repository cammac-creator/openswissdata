import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildNaicsCrosswalk,
  parseCensusXlsx,
  naicsCrosswalkToCsvRow,
} from "../../etl/classifications/naics-crosswalk.js";
import type { NomenclatureRow } from "../../etl/classifications/types.js";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import XLSX from "xlsx";

/* ------------------------------------------------------------------ *
 * Fixture builders
 * ------------------------------------------------------------------ */

interface RawCensusFixtureRow {
  partOfNaics?: string;
  naics: number | string;
  naicsTitle: string;
  partOfIsic?: string;
  isic: number | string;
  isicTitle: string;
  notes?: string;
}

/** Synthesize a Census-shaped XLSX matching the real file's layout. */
function writeFixtureXlsx(path: string, rows: RawCensusFixtureRow[]): void {
  const sheetData: unknown[][] = [
    [
      "Part of NAICS US",
      "2022\r\nNAICS\r\nUS  ",
      "2022 NAICS US TITLE",
      "Part of ISIC",
      "ISIC 4.0",
      "ISIC Revision 4.0 Title",
      "Notes:  link content based on NAICS definition, entire NAICS industry if blank",
    ],
  ];
  for (const r of rows) {
    sheetData.push([
      r.partOfNaics ?? null,
      r.naics,
      r.naicsTitle,
      r.partOfIsic ?? null,
      r.isic,
      r.isicTitle,
      r.notes ?? " ",
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "NAICS 22 to ISIC 4 technical");
  XLSX.writeFile(wb, path);
}

function nomenclatureFixture(): NomenclatureRow[] {
  return [
    // ISIC: group 111 has classes 1111, 1112, 1113. Group 112 has only 1120 (single child).
    { scheme: "ISIC_4", code: "111", level: "group", parent: "11", label_en: "Cereals" },
    { scheme: "ISIC_4", code: "1111", level: "class", parent: "111", label_en: "Cereals etc" },
    { scheme: "ISIC_4", code: "1112", level: "class", parent: "111", label_en: "Other cereals" },
    { scheme: "ISIC_4", code: "1113", level: "class", parent: "111", label_en: "Pulses" },
    { scheme: "ISIC_4", code: "112", level: "group", parent: "11", label_en: "Rice" },
    { scheme: "ISIC_4", code: "1120", level: "class", parent: "112", label_en: "Growing of rice" },
    // NACE 2.1 codes — used for join.
    { scheme: "NACE_2.1", code: "1111", level: "class", parent: "111", label_en: "NACE 1111" },
    { scheme: "NACE_2.1", code: "1120", level: "class", parent: "112", label_en: "NACE 1120" },
    // NOGA 2025 — same identity at class level.
    { scheme: "NOGA_2025", code: "1111", level: "class", parent: "111", label_en: "NOGA 1111" },
    { scheme: "NOGA_2025", code: "1120", level: "class", parent: "112", label_en: "NOGA 1120" },
  ];
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("parseCensusXlsx", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "osd-naics-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("parses the synthetic Census-shaped XLSX with expected fields", () => {
    const path = join(workDir, "fixture.xlsx");
    writeFixtureXlsx(path, [
      { naics: 111110, naicsTitle: "Soybean", isic: 111, isicTitle: "Cereals", partOfIsic: "*" },
      { naics: 111160, naicsTitle: "Rice farming", isic: 112, isicTitle: "Rice" },
    ]);
    const links = parseCensusXlsx(path);
    expect(links.length).toBe(2);
    expect(links[0].naics).toBe("111110");
    expect(links[0].isic_group).toBe("111");
    expect(links[0].partial).toBe(true);
    expect(links[1].naics).toBe("111160");
    expect(links[1].isic_group).toBe("112");
    expect(links[1].partial).toBe(false);
  });

  it("skips placeholder rows (NAICS=0)", () => {
    const path = join(workDir, "fixture.xlsx");
    writeFixtureXlsx(path, [
      { naics: 0, naicsTitle: "Multiple NAICS", isic: 9810, isicTitle: "Goods" },
      { naics: 111110, naicsTitle: "Soybean", isic: 111, isicTitle: "Cereals" },
    ]);
    const links = parseCensusXlsx(path);
    expect(links.length).toBe(1);
    expect(links[0].naics).toBe("111110");
  });

  it("throws on a missing expected sheet", () => {
    const path = join(workDir, "fixture.xlsx");
    const ws = XLSX.utils.aoa_to_sheet([["a", "b"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Wrong sheet name");
    XLSX.writeFile(wb, path);
    expect(() => parseCensusXlsx(path)).toThrow(/expected sheet/);
  });
});

describe("buildNaicsCrosswalk", () => {
  it("expands ISIC group → all child classes and joins NACE/NOGA", () => {
    const rawLinks = [
      { naics: "111110", naics_title: "Soybean", isic_group: "111", isic_title: "Cereals", partial: true, notes: "" },
    ];
    const out = buildNaicsCrosswalk(rawLinks, nomenclatureFixture());
    // Group 111 has 3 child classes → 3 rows
    expect(out.length).toBe(3);
    expect(out.every((r) => r.naics_2022 === "111110")).toBe(true);
    const isicCodes = out.map((r) => r.isic_4).sort();
    expect(isicCodes).toEqual(["1111", "1112", "1113"]);
    // NACE 2.1 join: only 1111 has a NACE entry in the fixture.
    const r1111 = out.find((r) => r.isic_4 === "1111");
    expect(r1111?.nace_2_1).toBe("1111");
    expect(r1111?.noga_2025).toBe("1111");
    // mapping_type = partial because fan-out > 1.
    expect(out.every((r) => r.mapping_type === "partial")).toBe(true);
  });

  it("emits exact mapping when ISIC group has exactly one class and Census link is not partial", () => {
    const rawLinks = [
      { naics: "111160", naics_title: "Rice farming", isic_group: "112", isic_title: "Rice", partial: false, notes: "" },
    ];
    const out = buildNaicsCrosswalk(rawLinks, nomenclatureFixture());
    expect(out.length).toBe(1);
    expect(out[0].isic_4).toBe("1120");
    expect(out[0].nace_2_1).toBe("1120");
    expect(out[0].mapping_type).toBe("exact");
  });

  it("anchors on the group when no child class is in the table", () => {
    const rawLinks = [
      { naics: "999999", naics_title: "Unknown", isic_group: "999", isic_title: "Unknown ISIC", partial: false, notes: "" },
    ];
    const out = buildNaicsCrosswalk(rawLinks, nomenclatureFixture());
    expect(out.length).toBe(1);
    expect(out[0].isic_4).toBe("999"); // anchored on group
    expect(out[0].nace_2_1).toBeNull();
    expect(out[0].mapping_type).toBe("partial");
    expect(out[0].notes).toContain("no ISIC 4-digit class");
  });

  it("produces deterministic output (sorted by naics_2022, then isic_4)", () => {
    const rawLinks = [
      { naics: "111160", naics_title: "Rice", isic_group: "112", isic_title: "Rice", partial: false, notes: "" },
      { naics: "111110", naics_title: "Soybean", isic_group: "111", isic_title: "Cereals", partial: false, notes: "" },
    ];
    const a = buildNaicsCrosswalk(rawLinks, nomenclatureFixture());
    const b = buildNaicsCrosswalk(rawLinks, nomenclatureFixture());
    expect(a).toEqual(b);
    // First row should be naics 111110 (sorted ascending)
    expect(a[0].naics_2022).toBe("111110");
  });

  it("naicsCrosswalkToCsvRow flattens nulls to empty strings", () => {
    const rawLinks = [
      { naics: "999999", naics_title: "X", isic_group: "999", isic_title: "Y", partial: false, notes: "" },
    ];
    const out = buildNaicsCrosswalk(rawLinks, nomenclatureFixture());
    const csv = naicsCrosswalkToCsvRow(out[0]);
    expect(csv.nace_2_1).toBe("");
    expect(csv.noga_2025).toBe("");
    // notes contains the warning string (not null)
    expect(typeof csv.notes).toBe("string");
  });
});
