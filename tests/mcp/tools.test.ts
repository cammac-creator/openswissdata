import { describe, it, expect, beforeAll } from "vitest";
import { tariffLookupHandler } from "../../src/mcp/tools/tariff-lookup.js";
import { kycCheckHandler } from "../../src/mcp/tools/kyc-check.js";
import { crossWalkHandler } from "../../src/mcp/tools/cross-walk.js";
import { _resetDataLoaderCache, getTares, getFinmaRegistry, getCrosswalks } from "../../src/mcp/data-loader.js";

beforeAll(() => {
  // Force a clean load against the bundled CSV slices.
  _resetDataLoaderCache();
});

describe("tariff_lookup", () => {
  it("returns a row + non-official disclaimer for a known HS8", () => {
    const { rows } = getTares();
    expect(rows.length).toBeGreaterThan(0);
    const sample = rows[0];

    const out = tariffLookupHandler({ hs8: sample.hs8, lang: "fr" });
    expect(out.isError).not.toBe(true);
    expect(out.structured).toBeDefined();
    const text = out.content[0].text;
    expect(text).toContain("AVIS NON-OFFICIEL");
    expect(text).toContain(sample.hs8);
  });

  it("returns isError on bad HS8 format", () => {
    const out = tariffLookupHandler({ hs8: "abc" });
    expect(out.isError).toBe(true);
  });

  it("returns isError when the HS8 is well-formed but unknown", () => {
    const out = tariffLookupHandler({ hs8: "99999999" });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("No TARES row");
  });

  it("supports the en lang variant", () => {
    const { rows } = getTares();
    const sample = rows[0];
    const out = tariffLookupHandler({ hs8: sample.hs8, lang: "en" });
    expect(out.content[0].text).toContain("UNOFFICIAL NOTICE");
  });
});

describe("kyc_check", () => {
  it("returns at least one match for a real entity name from the registry", () => {
    const reg = getFinmaRegistry();
    expect(reg.length).toBeGreaterThan(0);
    // Pick a substring of a real name (first word).
    const target = reg[0].name.split(/\s+/)[0];

    const out = kycCheckHandler({ name: target });
    expect(out.isError).not.toBe(true);
    expect(out.structured).toBeDefined();
    const struct = out.structured as { match_count: number };
    expect(struct.match_count).toBeGreaterThan(0);
  });

  it("returns an empty match set for a clearly nonexistent name", () => {
    const out = kycCheckHandler({ name: "ZZZZZ_NONEXISTENT_ENTITY_XYZ_98765" });
    const struct = out.structured as { match_count: number; warning_count: number };
    expect(struct.match_count).toBe(0);
    expect(struct.warning_count).toBe(0);
  });

  it("rejects too-short queries", () => {
    const out = kycCheckHandler({ name: "x" });
    expect(out.isError).toBe(true);
  });
});

describe("cross_walk", () => {
  it("translates a NOGA_2025 code to NACE_2.1", () => {
    const rows = getCrosswalks();
    const sample = rows.find((r) => r.noga_2025 && r.nace_2_1);
    expect(sample).toBeDefined();

    const out = crossWalkHandler({
      code: sample!.noga_2025,
      source: "NOGA_2025",
      target: "NACE_2.1",
    });
    expect(out.isError).not.toBe(true);
    const struct = out.structured as { count: number; mappings: { target_code: string }[] };
    expect(struct.count).toBeGreaterThan(0);
    expect(struct.mappings[0].target_code).toBe(sample!.nace_2_1);
  });

  it("returns 0 mappings for an unknown code (without isError)", () => {
    const out = crossWalkHandler({
      code: "99999999",
      source: "NOGA_2025",
      target: "ISIC_4",
    });
    const struct = out.structured as { count: number };
    expect(struct.count).toBe(0);
  });

  it("rejects identical source/target schemes", () => {
    const out = crossWalkHandler({
      code: "01",
      source: "NOGA_2025",
      target: "NOGA_2025",
    });
    expect(out.isError).toBe(true);
  });

  it("rejects unknown schemes via input validation", () => {
    const out = crossWalkHandler({ code: "01", source: "NAICS_2022", target: "ISIC_4" });
    expect(out.isError).toBe(true);
  });
});
