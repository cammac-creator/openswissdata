import { describe, it, expect } from "vitest";
import { extractNaceEnLabels, naceEnLabelToCsvRow } from "../../etl/classifications/nace-en-labels.js";
import type { NomenclatureRow } from "../../etl/classifications/types.js";

function rowsFixture(): NomenclatureRow[] {
  return [
    {
      scheme: "NACE_2.1",
      code: "K",
      level: "section",
      parent: null,
      label_en: "Financial and insurance activities",
      label_fr: "Activités financières et d'assurance",
    },
    {
      scheme: "NACE_2.1",
      code: "64",
      level: "division",
      parent: "K",
      label_en: "Financial service activities, except insurance and pension funding",
    },
    {
      scheme: "NACE_2.1",
      code: "6411",
      level: "class",
      parent: "641",
      label_en: "Central banking",
      label_fr: "Activités de banque centrale",
    },
    // Row missing label_en — should still be emitted with empty string.
    {
      scheme: "NACE_2.1",
      code: "9999",
      level: "class",
      parent: "999",
      label_fr: "Aucun label EN",
    },
    // NACE 2.0 row — must be ignored (we only project NACE 2.1).
    {
      scheme: "NACE_2.0",
      code: "K",
      level: "section",
      parent: null,
      label_en: "DO NOT INCLUDE",
    },
    // NOGA 2025 row — must be ignored.
    {
      scheme: "NOGA_2025",
      code: "6411",
      level: "class",
      parent: "641",
      label_en: "DO NOT INCLUDE",
    },
  ];
}

describe("extractNaceEnLabels", () => {
  it("filters to NACE 2.1 only and projects to (code, level, parent, label_en)", () => {
    const result = extractNaceEnLabels(rowsFixture());
    expect(result.rows.length).toBe(4);
    const codes = result.rows.map((r) => r.code);
    expect(codes).toContain("K");
    expect(codes).toContain("6411");
    expect(codes).not.toContain("9999_should_not_appear"); // sanity
    // Must NOT include NACE 2.0 or NOGA rows even though they have code "K" / "6411".
    const kRows = result.rows.filter((r) => r.code === "K");
    expect(kRows.length).toBe(1);
    expect(kRows[0].label_en).toBe("Financial and insurance activities");
  });

  it("emits rows missing label_en as empty string and tracks the count", () => {
    const result = extractNaceEnLabels(rowsFixture());
    const empty = result.rows.find((r) => r.code === "9999");
    expect(empty?.label_en).toBe("");
    expect(result.stats.with_label).toBe(3);
    expect(result.stats.missing_label).toBe(1);
    expect(result.stats.total).toBe(4);
  });

  it("sorts output by code (deterministic for byte-identical bundles)", () => {
    const result = extractNaceEnLabels(rowsFixture());
    const codes = result.rows.map((r) => r.code);
    const sorted = [...codes].sort();
    expect(codes).toEqual(sorted);
  });

  it("is idempotent — calling twice produces structurally identical results", () => {
    const a = extractNaceEnLabels(rowsFixture());
    const b = extractNaceEnLabels(rowsFixture());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("naceEnLabelToCsvRow produces stable string fields (no nulls)", () => {
    const result = extractNaceEnLabels(rowsFixture());
    for (const r of result.rows) {
      const csv = naceEnLabelToCsvRow(r);
      expect(typeof csv.code).toBe("string");
      expect(typeof csv.level).toBe("string");
      expect(typeof csv.parent).toBe("string"); // null parent → empty string
      expect(typeof csv.label_en).toBe("string");
    }
  });

  it("preserves the parent hierarchy (parent of 6411 is 641, parent of K is empty)", () => {
    const result = extractNaceEnLabels(rowsFixture());
    const c = result.rows.find((r) => r.code === "6411");
    expect(c?.parent).toBe("641");
    const csv = naceEnLabelToCsvRow(result.rows.find((r) => r.code === "K")!);
    expect(csv.parent).toBe("");
  });
});
