import { describe, it, expect } from "vitest";
import { buildCrossWalks } from "../../etl/classifications/crosswalks.js";
import type { NomenclatureRow } from "../../etl/classifications/types.js";
import { join } from "node:path";

const fixtureDir = join(process.cwd(), "etl/classifications/fixtures");

describe("buildCrossWalks", () => {
  const allRows: NomenclatureRow[] = [
    { scheme: "NOGA_2025", code: "6411", level: "class", parent: "641" },
    { scheme: "NOGA_2025", code: "6412", level: "class", parent: "641" },
    { scheme: "NOGA_2025", code: "6419", level: "class", parent: "641" },
    { scheme: "NOGA_2025", code: "6420", level: "class", parent: "642" },
    { scheme: "NOGA_2025", code: "8411", level: "class", parent: "841" },
  ];
  const opts = {
    nace20to21Path: join(fixtureDir, "bridge-nace-2.0-to-2.1.csv"),
    nace21toIsic4Path: join(fixtureDir, "bridge-nace-2.1-to-isic-4.csv"),
  };

  it("anchors each cross-walk on a NOGA 2025 class", () => {
    const walks = buildCrossWalks(allRows, opts);
    expect(walks.length).toBeGreaterThan(0);
    const walkFor6411 = walks.find(w => w.noga_2025 === "6411");
    expect(walkFor6411).toBeDefined();
    expect(walkFor6411?.nace_2_1).toBe("6411");
  });

  it("links 6411 to ISIC 6411 via bridge", () => {
    const walks = buildCrossWalks(allRows, opts);
    const w = walks.find(x => x.noga_2025 === "6411");
    expect(w?.isic_4).toBe("6411");
  });

  it("marks partial mapping when any step is partial", () => {
    const walks = buildCrossWalks(allRows, opts);
    // 6412 ← 64.19 (partial) in the bridge → partial chain
    const w = walks.find(x => x.noga_2025 === "6412");
    expect(w?.mapping_type).toBe("partial");
  });

  it("equates NOGA_2008 to NACE_2.0 (identity)", () => {
    const walks = buildCrossWalks(allRows, opts);
    for (const w of walks) {
      if (w.noga_2008 !== null && w.nace_2_0 !== null) {
        expect(w.noga_2008).toBe(w.nace_2_0);
      }
    }
  });

  it("equates NOGA_2025 to NACE_2.1 (identity)", () => {
    const walks = buildCrossWalks(allRows, opts);
    for (const w of walks) {
      expect(w.noga_2025).toBe(w.nace_2_1);
    }
  });
});
