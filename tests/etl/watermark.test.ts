import { describe, it, expect, beforeAll } from "vitest";
import {
  buildManifest,
  verifyWatermark,
  buildCanarySeed,
  computeWatermarkHmac,
} from "../../etl/shared/watermark.js";

beforeAll(() => {
  process.env.WATERMARK_SECRET =
    "test-watermark-secret-must-be-at-least-32-chars-long";
});

describe("buildManifest", () => {
  it("produces a manifest with all required fields", () => {
    const m = buildManifest({
      licenseId: "lic_abc",
      datasetId: "tares",
      version: "2026.04.30.1",
    });
    expect(m.license_id).toBe("lic_abc");
    expect(m.dataset_id).toBe("tares");
    expect(m.version).toBe("2026.04.30.1");
    expect(m.manifest_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.issued_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(m.hmac).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyWatermark", () => {
  it("accepts an unmodified manifest", () => {
    const m = buildManifest({
      licenseId: "lic_abc",
      datasetId: "finma",
      version: "2026.04.30.2",
    });
    expect(verifyWatermark(m)).toBe(true);
  });

  it("rejects a manifest with a tampered license_id", () => {
    const m = buildManifest({
      licenseId: "lic_abc",
      datasetId: "finma",
      version: "2026.04.30.2",
    });
    const tampered = { ...m, license_id: "lic_other" };
    expect(verifyWatermark(tampered)).toBe(false);
  });

  it("rejects a manifest with a tampered hmac", () => {
    const m = buildManifest({
      licenseId: "lic_abc",
      datasetId: "finma",
      version: "2026.04.30.2",
    });
    const tampered = { ...m, hmac: "0".repeat(64) };
    expect(verifyWatermark(tampered)).toBe(false);
  });

  it("produces deterministic hmac for same inputs", () => {
    const a = computeWatermarkHmac({
      license_id: "lic_x",
      dataset_id: "tares",
      version: "v1",
      manifest_id: "abc",
      issued_at: "2026-04-30T12:00:00Z",
    });
    const b = computeWatermarkHmac({
      license_id: "lic_x",
      dataset_id: "tares",
      version: "v1",
      manifest_id: "abc",
      issued_at: "2026-04-30T12:00:00Z",
    });
    expect(a).toBe(b);
  });
});

describe("buildCanarySeed", () => {
  it("produces N seeds", () => {
    const seeds = buildCanarySeed("lic_abc", 5);
    expect(seeds).toHaveLength(5);
    for (const s of seeds) {
      expect(s).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("produces deterministic seeds for the same license", () => {
    const a = buildCanarySeed("lic_abc", 3);
    const b = buildCanarySeed("lic_abc", 3);
    expect(a).toEqual(b);
  });

  it("produces different seeds for different licenses", () => {
    const a = buildCanarySeed("lic_abc", 3);
    const b = buildCanarySeed("lic_def", 3);
    expect(a).not.toEqual(b);
  });
});
