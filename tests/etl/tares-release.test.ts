import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock r2.js uploadZip before importing the orchestrator
const uploadMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/lib/r2.js", () => ({
  uploadZip: uploadMock,
  signedDownloadUrl: vi.fn().mockResolvedValue("https://example.com/signed"),
}));

describe("etl/tares/release orchestration", () => {
  let tmp: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-release-"));
    uploadMock.mockClear();
    process.env.BASE_URL = "http://localhost:3000";
    process.env.ADMIN_SECRET = "test-secret-1234567890";
    process.env.USE_FIXTURE = "1";
    process.env.TARES_VERSION = "2026.04.22";
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, dataset_id: "tares", version: "2026.04.22" }),
      text: async () => "",
    });
    // @ts-expect-error overriding global fetch
    global.fetch = fetchMock;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.USE_FIXTURE;
    delete process.env.TARES_VERSION;
  });

  it("end-to-end: ingest → bundle → upload → admin release", async () => {
    const { runRelease } = await import("../../etl/tares/release.js");

    const result = await runRelease({
      useFixture: true,
      version: "2026.04.22",
      outDir: tmp,
    });

    // Verify result shape
    expect(result.version).toBe("2026.04.22");
    expect(result.r2_key).toBe("tares/2026.04.22/tares.zip");
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.size_bytes).toBeGreaterThan(100);
    expect(result.row_count).toBe(5);
    expect(result.registered).toBe(true);

    // Verify uploadZip was called with expected R2 key
    expect(uploadMock).toHaveBeenCalledOnce();
    const [, r2Key] = uploadMock.mock.calls[0];
    expect(r2Key).toBe("tares/2026.04.22/tares.zip");

    // Verify fetch POST to admin endpoint
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/admin/release");
    expect(opts.method).toBe("POST");
    expect(opts.headers["x-admin-secret"]).toBe("test-secret-1234567890");
    const body = JSON.parse(opts.body);
    expect(body.dataset_id).toBe("tares");
    expect(body.version).toBe("2026.04.22");
    expect(body.r2_key).toBe("tares/2026.04.22/tares.zip");
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.size_bytes).toBeGreaterThan(100);
  }, 15000);

  it("throws if BASE_URL is missing", async () => {
    delete process.env.BASE_URL;
    const { runRelease } = await import("../../etl/tares/release.js");
    await expect(runRelease({ useFixture: true, version: "2026.04.22", outDir: tmp })).rejects.toThrow("BASE_URL");
  });

  it("throws if ADMIN_SECRET is missing", async () => {
    delete process.env.ADMIN_SECRET;
    const { runRelease } = await import("../../etl/tares/release.js");
    await expect(runRelease({ useFixture: true, version: "2026.04.22", outDir: tmp })).rejects.toThrow("ADMIN_SECRET");
  });

  it("throws if USE_FIXTURE=0 and no real scraper", async () => {
    const { runRelease } = await import("../../etl/tares/release.js");
    await expect(runRelease({ useFixture: false, version: "2026.04.22", outDir: tmp })).rejects.toThrow("Task 2.4");
  });

  it("propagates admin endpoint HTTP errors", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
      json: async () => ({}),
    });
    const { runRelease } = await import("../../etl/tares/release.js");
    await expect(runRelease({ useFixture: true, version: "2026.04.22", outDir: tmp })).rejects.toThrow("HTTP 403");
  });
});
