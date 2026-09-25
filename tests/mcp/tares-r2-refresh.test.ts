import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import archiver from "archiver";
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("../../src/lib/r2.js", () => ({ getObjectBuffer: download }));
import { getDb, closeDb } from "../../src/lib/db.js";
import { getTares, _resetDataLoaderCache } from "../../src/mcp/data-loader.js";
import { refreshTaresFromR2, getMcpFreshness, _resetFreshnessForTest, extractCsvFromZip } from "../../src/mcp/r2-refresh.js";
let temp: string;
function zip(content: string): Promise<Buffer> { return new Promise((resolve, reject) => { const archive = archiver("zip"), parts: Buffer[] = []; archive.on("data", b => parts.push(b)); archive.on("error", reject); archive.on("end", () => resolve(Buffer.concat(parts))); archive.append(content, { name: "tares.csv" }); void archive.finalize(); }); }
const csv = (count = 6_000, label = "Fictif") => "hs8,designation_fr,duty_mfn_value,duty_mfn_unit,duty_mfn_currency,valid_from,duty_rates_count\n" + Array.from({ length: count }, (_, i) => `${String(1000000 + i).padStart(8, "0")},${label},0,par pièce,CHF,2026-01-01,10`).join("\n");
function record(bytes: Buffer, version = "2026.09.25") { const db = getDb(); db.prepare("UPDATE datasets SET current_version=? WHERE id='tares'").run(version); db.prepare("INSERT INTO versions(dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES('tares',?,?,?,?,?)").run(version, `tares/${version}/tares.zip`, createHash("sha256").update(bytes).digest("hex"), bytes.length, Date.now()); }
beforeEach(() => { temp = mkdtempSync(join(tmpdir(), "osd-tares-refresh-")); vi.stubEnv("DATABASE_PATH", join(temp, "test.db")); vi.stubEnv("R2_ACCOUNT_ID", "fictif"); vi.stubEnv("R2_BUCKET", "fictif"); getDb().prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES('tares','TARES','tares',0,'fictif',?)").run(Date.now()); download.mockReset(); _resetDataLoaderCache(); _resetFreshnessForTest(); });
afterEach(() => { closeDb(); rmSync(temp, { recursive: true, force: true }); vi.unstubAllEnvs(); });
describe("TARES réellement servi par le MCP", () => {
  it("archive avant analyse puis remplace les lignes et la version", async () => { const bytes = await zip(csv()); record(bytes); download.mockResolvedValue(bytes); await refreshTaresFromR2(); expect(getTares().version).toBe("2026.09.25"); expect(getTares().rows).toHaveLength(6_000); expect(getMcpFreshness().tares.stale).toBe(false); expect((getDb().prepare("SELECT count(*) AS n FROM dataset_snapshots WHERE dataset_id='tares'").get() as {n:number}).n).toBe(30_000); expect(readdirSync(join(temp, "bronze/tares", new Date().toISOString().slice(0, 10)))).toHaveLength(1); await refreshTaresFromR2(); expect(download).toHaveBeenCalledOnce(); });
  it("garde la dernière version complète si la suivante est tronquée", async () => { const good = await zip(csv()), bad = await zip(csv(10)); record(good); download.mockResolvedValue(good); await refreshTaresFromR2(); record(bad, "2026.09.25.2"); download.mockResolvedValue(bad); await refreshTaresFromR2(); expect(getTares().version).toBe("2026.09.25"); expect(getMcpFreshness().tares.stale).toBe(true); expect(getMcpFreshness().tares.lastError).toContain("6000"); });
  it("refuse les doublons", async () => { const bytes = await zip(csv().replace("01000001", "01000000")); record(bytes); download.mockResolvedValue(bytes); await refreshTaresFromR2(); expect(getTares().version).toBeNull(); expect(getMcpFreshness().tares.lastError).toContain("invalides"); });
  it("refuse une empreinte distante différente", async () => { const bytes = await zip(csv()); record(bytes); download.mockResolvedValue(Buffer.from("altéré")); await refreshTaresFromR2(); expect(getMcpFreshness().tares.lastError).toContain("Empreinte"); });
  it("ne charge pas une ancienne version si une nouvelle arrive pendant la lecture", async () => { const old = await zip(csv()), latest = await zip(csv(6_000, "Nouveau")); record(old); let resolve!: (bytes: Buffer) => void; download.mockImplementationOnce(() => new Promise<Buffer>(r => { resolve = r; })).mockResolvedValue(latest); const loading = refreshTaresFromR2(); await vi.waitFor(() => expect(download).toHaveBeenCalledOnce()); record(latest, "2026.09.25.2"); resolve(old); await loading; expect(getTares().version).toBe("2026.09.25.2"); expect(getTares().rows[0].designation_fr).toBe("Nouveau"); });
  it("borne aussi la taille décompressée du fichier lu", async () => { const bytes = await zip("x".repeat(200)); await expect(extractCsvFromZip(bytes, "tares.csv", 100)).rejects.toThrow("volumineux"); });
});
