import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), read: vi.fn(), ingest: vi.fn(), build: vi.fn(), quality: vi.fn(), verify: vi.fn(), extract: vi.fn() }));
vi.mock("../../src/lib/r2.js", () => ({ uploadZip: mocks.upload, getObjectBuffer: mocks.read }));
vi.mock("../../src/mcp/r2-refresh.js", () => ({ extractCsvFromZip: mocks.extract }));
vi.mock("../../etl/classifications/ingest-real.js", () => ({ ingestRealClassifications: mocks.ingest }));
vi.mock("../../etl/classifications/bundle.js", () => ({ buildBundle: mocks.build }));
vi.mock("../../etl/classifications/quality.js", () => ({ validateClassifications: mocks.quality }));
vi.mock("../../etl/shared/verify-provenance.js", () => ({ verifyProvenanceZip: mocks.verify }));
import { runRelease } from "../../etl/classifications/release.js";

describe("Publication classifications protégée", () => {
  let temp: string; let http: ReturnType<typeof vi.fn>;
  const today = new Date().toISOString().slice(0, 10), version = today.replaceAll("-", ".");
  const bytes = Buffer.from("archive de test"), sha = createHash("sha256").update(bytes).digest("hex");
  const metadata = () => ({ dataset: { current_version: "2026.01.01" }, versions: [{ version: "2026.01.01", r2_key: "classifications/2026.01.01/classifications.zip", sha256: sha, size_bytes: bytes.length }] });
  beforeEach(() => {
    vi.resetAllMocks(); temp = mkdtempSync(join(tmpdir(), "osd-classifications-release-"));
    vi.stubEnv("BASE_URL", "https://example.test"); vi.stubEnv("ADMIN_SECRET", "fictif"); vi.stubEnv("SKIP_EMBEDDINGS", "1"); vi.stubEnv("USE_FIXTURE", "0");
    vi.stubEnv("classifications_DRY_RUN", "0"); vi.stubEnv("classifications_CACHE_DIR", join(temp, "cache"));
    http = vi.fn(async (_url, init) => init?.method === "POST" ? Response.json({ ok: true, version }) : Response.json(metadata())); vi.stubGlobal("fetch", http);
    mocks.read.mockResolvedValue(bytes); mocks.extract.mockResolvedValue(JSON.stringify([{ code: "1811" }]));
    mocks.ingest.mockResolvedValue({ rows: [{ code: "1811" }], crossWalks: [], links: [], sources: [{ fetched_at: `${today}T00:00:00Z` }] }); mocks.quality.mockReturnValue({ rows: 1 });
    mocks.build.mockResolvedValue({ zipPath: join(temp, "archive.zip"), sha256: sha, sizeBytes: bytes.length });
    mocks.verify.mockResolvedValue({ ok: true, fileChecks: ["noga_2008.json", "noga_2025.json", "nace_2_0.json", "nace_2_1.json", "isic_4.json", "nomenclatures.parquet", "crosswalks.csv", "classification_links.json", "classification_links.csv", "classification_links.parquet", "classification_sources.csv", "quality.json", "sources.json"].map(name => ({ name, ok: true })) });
  });
  afterEach(() => { rmSync(temp, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const run = (opts = {}) => runRelease({ version, outDir: temp, ...opts });
  it("interdit toute publication de fixture avant réseau", async () => {
    await expect(run({ useFixture: true })).rejects.toThrow("fixture"); expect(http).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("bloque la publication Pro non validée", async () => { vi.stubEnv("CLASSIFICATIONS_TIER", "pro"); await expect(run()).rejects.toThrow("Pro suspendue"); expect(http).not.toHaveBeenCalled(); });
  it("une simulation contrôle les sources et l’archive sans écriture distante", async () => {
    expect((await run({ dryRun: true })).registered).toBe(false); expect(mocks.quality).toHaveBeenCalledOnce(); expect(mocks.verify).toHaveBeenCalledOnce(); expect(mocks.upload).not.toHaveBeenCalled(); expect(http).toHaveBeenCalledOnce();
  });
  it("refuse une date artificielle", async () => { await expect(run({ version: "2020.01.01" })).rejects.toThrow("date réelle"); expect(http).not.toHaveBeenCalled(); });
  it("refuse une version déjà enregistrée avant toute écriture", async () => {
    http.mockResolvedValue(Response.json({ ...metadata(), versions: [...metadata().versions, { ...metadata().versions[0], version }] }));
    await expect(run()).rejects.toThrow("déjà publiée"); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("refuse une archive précédente altérée", async () => { mocks.read.mockResolvedValue(Buffer.from("altérée")); await expect(run()).rejects.toThrow("précédente altérée"); expect(mocks.ingest).not.toHaveBeenCalled(); });
  it("un échec qualité empêche même la construction", async () => { mocks.quality.mockImplementation(() => { throw Error("Volume incomplet"); }); await expect(run()).rejects.toThrow("Volume"); expect(mocks.build).not.toHaveBeenCalled(); });
  it("une signature invalide empêche l’envoi", async () => { mocks.verify.mockResolvedValue({ ok: false }); await expect(run()).rejects.toThrow("signature"); expect(mocks.upload).not.toHaveBeenCalled(); });
  it("un fichier détaillé absent empêche l’envoi", async () => { mocks.verify.mockResolvedValue({ ok: true, fileChecks: [] }); await expect(run()).rejects.toThrow("contenu"); expect(mocks.upload).not.toHaveBeenCalled(); });
  it("une collision de clé immuable empêche l’enregistrement", async () => { mocks.upload.mockRejectedValue(Error("PreconditionFailed")); await expect(run()).rejects.toThrow("Precondition"); expect(http).toHaveBeenCalledOnce(); });
  it("une relecture distante différente empêche l’enregistrement", async () => { mocks.read.mockResolvedValueOnce(bytes).mockResolvedValueOnce(Buffer.from("autre")); await expect(run()).rejects.toThrow("distante"); expect(http).toHaveBeenCalledOnce(); });
  it("envoie une archive immuable et conditionne la publication à la version précédente", async () => {
    expect((await run()).registered).toBe(true);
    expect(mocks.upload).toHaveBeenCalledWith(join(temp, "archive.zip"), `classifications/${version}/classifications.zip`, { immutable: true });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    const body = JSON.parse(http.mock.calls[1][1].body); expect(body.expected_previous_version).toBe("2026.01.01"); expect(body.changelog).not.toContain("fixture");
  });
  it("une course à la publication remonte le refus sans écraser", async () => { http.mockImplementation(async (_url, init) => init?.method === "POST" ? new Response("conflit", { status: 409 }) : Response.json(metadata())); await expect(run()).rejects.toThrow("HTTP 409"); expect(mocks.upload).toHaveBeenCalledOnce(); });
});
