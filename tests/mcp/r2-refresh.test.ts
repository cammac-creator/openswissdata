import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import archiver from "archiver";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the R2 GET so no network/creds are needed; each test sets its behaviour.
const { getObjectBufferMock } = vi.hoisted(() => ({ getObjectBufferMock: vi.fn() }));
vi.mock("../../src/lib/r2.js", () => ({
  getObjectBuffer: getObjectBufferMock,
  uploadZip: vi.fn(),
  signedDownloadUrl: vi.fn(),
}));

import { getDb, closeDb } from "../../src/lib/db.js";
import { getFinmaRegistry, getFinmaWarnings, _resetDataLoaderCache } from "../../src/mcp/data-loader.js";
import { refreshFinmaFromR2, getMcpFreshness, _resetFreshnessForTest } from "../../src/mcp/r2-refresh.js";

const ORACLE = "The Singularity Group AG";
const V1 = "2026.06.18";

/** Build a ZIP buffer in memory from { filename: content }. */
function makeZip(files: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 1 } });
    const chunks: Buffer[] = [];
    archive.on("data", (d: Buffer) => chunks.push(d));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    for (const [name, content] of Object.entries(files)) archive.append(content, { name });
    void archive.finalize();
  });
}

function shaOf(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function registryCsv(rows: number, withOracle = true): string {
  const header =
    "entity_type,name,uid,lei,licence_type,licence_type_de,licence_type_fr,licence_type_it,licence_date,status,canton,city,address,source_list,source_url,is_warning_listed";
  const lines = [header];
  if (withOracle) {
    lines.push(`bank,${ORACLE},CHE-300.711.284,,Manager of collective assets,,,,2026-01-01,,ZH,Zurich,Bahnhofstrasse 1,finma_registry,https://finma.ch,false`);
  }
  for (let i = lines.length - 1; i < rows; i++) {
    lines.push(`bank,Entity ${i},CHE-${100000000 + i},,Bank,,,,2025-01-01,,VD,Lausanne,Rue 1,finma_registry,https://finma.ch,false`);
  }
  return lines.join("\n") + "\n";
}

function warningsCsv(rows: number): string {
  const header = "name,country,date_added,category,source_url,source_list,warning_type,additional_info";
  const lines = [header];
  for (let i = 0; i < rows; i++) {
    lines.push(`Bad Actor ${i},CH,2026-06-01,unauthorised,https://finma.ch,warning_list,warning,`);
  }
  return lines.join("\n") + "\n";
}

/** Make `getObjectBuffer` return `zip` and seed the DB version row with a sha256
 *  that matches it (the engine verifies sha256 before unzipping). */
function armDownload(zip: Buffer, version = V1): void {
  getObjectBufferMock.mockResolvedValue(zip);
  const db = getDb();
  db.prepare("UPDATE versions SET sha256=?, size_bytes=? WHERE dataset_id='finma' AND version=?").run(
    shaOf(zip),
    zip.length,
    version,
  );
}

describe("MCP R2 data refresh (C2)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-r2refresh-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_BUCKET = "test-bucket";
    const db = getDb();
    db.prepare(
      "INSERT INTO datasets (id,name,slug,price_chf,stripe_price_id,current_version,created_at) VALUES ('finma','FINMA','finma',0,'price_x',?,?)",
    ).run(V1, Date.now());
    db.prepare(
      "INSERT INTO versions (dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES ('finma',?,?,?,?,?)",
    ).run(V1, `finma/${V1}/finma.zip`, "a".repeat(64), 1000, Date.now());
    getObjectBufferMock.mockReset();
    _resetDataLoaderCache();
    _resetFreshnessForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_BUCKET;
  });

  it("swaps in fresh registry + warnings from the current R2 ZIP", async () => {
    armDownload(await makeZip({ "finma_registry.csv": registryCsv(2100), "finma_warnings.csv": warningsCsv(1600) }));

    await refreshFinmaFromR2();

    const registry = getFinmaRegistry();
    expect(registry.length).toBe(2100);
    expect(registry.some((r) => r.name === ORACLE)).toBe(true); // present in fresh, absent from April seed
    expect(getFinmaWarnings().length).toBe(1600);

    const f = getMcpFreshness().finma;
    expect(f.loadedVersion).toBe(V1);
    expect(f.currentVersion).toBe(V1);
    expect(f.stale).toBe(false);
    expect(f.onSeed).toBe(false);
    expect(f.lastError).toBeNull();
    expect(f.lastRefreshAt).not.toBeNull();
    expect(getObjectBufferMock).toHaveBeenCalledWith(`finma/${V1}/finma.zip`, expect.anything());
  });

  it("is version-gated: a second call with the same current_version does NOT re-download", async () => {
    armDownload(await makeZip({ "finma_registry.csv": registryCsv(2100), "finma_warnings.csv": warningsCsv(1600) }));
    await refreshFinmaFromR2();
    await refreshFinmaFromR2();
    expect(getObjectBufferMock).toHaveBeenCalledTimes(1);
  });

  it("keeps last-good (seed) and does not throw when the R2 GET fails", async () => {
    getObjectBufferMock.mockRejectedValue(new Error("R2 down"));
    await expect(refreshFinmaFromR2()).resolves.toBeUndefined();
    const f = getMcpFreshness().finma;
    expect(f.loadedVersion).toBeNull();
    expect(f.lastError).toContain("R2 down");
    expect(getFinmaRegistry().length).toBeGreaterThan(0); // still serves committed April seed
  });

  it("refuses to swap a truncated registry (validation floor) — warnings untouched", async () => {
    armDownload(await makeZip({ "finma_registry.csv": registryCsv(5), "finma_warnings.csv": warningsCsv(1600) }));
    await refreshFinmaFromR2();
    const f = getMcpFreshness().finma;
    expect(f.loadedVersion).toBeNull();
    expect(f.lastError).toContain("refusing swap");
    expect(getFinmaRegistry().some((r) => r.name === ORACLE)).toBe(false);
  });

  it("ALL-OR-NOTHING: a valid registry is NOT swapped when warnings are invalid", async () => {
    // registry valid (with ORACLE), warnings truncated → neither must swap.
    armDownload(await makeZip({ "finma_registry.csv": registryCsv(2100), "finma_warnings.csv": warningsCsv(5) }));
    await refreshFinmaFromR2();
    const f = getMcpFreshness().finma;
    expect(f.loadedVersion).toBeNull(); // robust proof: no swap happened at all
    expect(f.lastError).toContain("refusing swap");
    expect(getFinmaRegistry().some((r) => r.name === ORACLE)).toBe(false); // registry stayed on seed
  });

  it("rejects (keeps seed) when a required slice is missing from the ZIP", async () => {
    armDownload(await makeZip({ "finma_registry.csv": registryCsv(2100) })); // no finma_warnings.csv
    await refreshFinmaFromR2();
    const f = getMcpFreshness().finma;
    expect(f.loadedVersion).toBeNull();
    expect(f.lastError).toContain("not found in ZIP");
  });

  it("rejects (keeps seed) when a slice CSV is malformed (parse error)", async () => {
    const header =
      "entity_type,name,uid,lei,licence_type,licence_type_de,licence_type_fr,licence_type_it,licence_date,status,canton,city,address,source_list,source_url,is_warning_listed";
    const malformed = header + "\nbank,Foo,extra,too,many,fields,here,that,break,the,record,length,a,b,c,d,e,f,g\n";
    armDownload(await makeZip({ "finma_registry.csv": malformed, "finma_warnings.csv": warningsCsv(1600) }));
    await refreshFinmaFromR2();
    expect(getMcpFreshness().finma.loadedVersion).toBeNull();
    expect(getMcpFreshness().finma.lastError).not.toBeNull();
  });

  it("rejects (keeps seed) when the ZIP sha256 does not match the DB", async () => {
    const zip = await makeZip({ "finma_registry.csv": registryCsv(2100), "finma_warnings.csv": warningsCsv(1600) });
    getObjectBufferMock.mockResolvedValue(zip);
    // leave the seeded sha256 = "a".repeat(64) (intentionally wrong)
    await refreshFinmaFromR2();
    const f = getMcpFreshness().finma;
    expect(f.loadedVersion).toBeNull();
    expect(f.lastError).toContain("sha256 mismatch");
  });

  it("stale flag is TRUE (not falsely fresh) when stuck on seed after a failed attempt", async () => {
    getObjectBufferMock.mockRejectedValue(new Error("R2 down"));
    await refreshFinmaFromR2();
    const f = getMcpFreshness().finma;
    expect(f.loadedVersion).toBeNull();
    expect(f.onSeed).toBe(true);
    expect(f.stale).toBe(true); // currentVersion exists, never loaded, attempted → honestly stale
  });

  it("does nothing (no crash) when R2 creds are absent", async () => {
    delete process.env.R2_ACCOUNT_ID;
    await expect(refreshFinmaFromR2()).resolves.toBeUndefined();
    expect(getObjectBufferMock).not.toHaveBeenCalled();
    expect(getMcpFreshness().finma.lastError).toContain("credentials");
  });

  it("recovers from a hung R2 download: the timeout releases the in-flight latch", async () => {
    const goodZip = await makeZip({ "finma_registry.csv": registryCsv(2100), "finma_warnings.csv": warningsCsv(1600) });
    armDownload(goodZip); // seeds matching sha; sets mockResolvedValue (overridden below)
    // First attempt: a download that never settles.
    getObjectBufferMock.mockReset();
    getObjectBufferMock.mockReturnValueOnce(new Promise<Buffer>(() => {}));

    vi.useFakeTimers();
    const p = refreshFinmaFromR2();
    await vi.advanceTimersByTimeAsync(61_000); // past the 60s wall-clock ceiling
    await p;
    vi.useRealTimers();

    expect(getMcpFreshness().finma.lastError).toContain("timed out");
    expect(getMcpFreshness().finma.loadedVersion).toBeNull();

    // Latch released → a fresh call re-triggers the download and succeeds.
    getObjectBufferMock.mockResolvedValue(goodZip);
    await refreshFinmaFromR2();
    expect(getObjectBufferMock).toHaveBeenCalledTimes(2);
    expect(getMcpFreshness().finma.loadedVersion).toBe(V1);
  });

  it("trailing-run: a release arriving during an in-flight refresh re-fetches the newer version", async () => {
    const V2 = "2026.06.19";
    const zipV1 = await makeZip({ "finma_registry.csv": registryCsv(2100, false), "finma_warnings.csv": warningsCsv(1600) });
    const zipV2 = await makeZip({ "finma_registry.csv": registryCsv(2100, true), "finma_warnings.csv": warningsCsv(1610) });

    // v1 download is deferred (held in-flight); v2 resolves immediately.
    let releaseV1!: (b: Buffer) => void;
    const deferred = new Promise<Buffer>((res) => { releaseV1 = res; });
    getObjectBufferMock.mockReset();
    getObjectBufferMock.mockReturnValueOnce(deferred).mockResolvedValueOnce(zipV2);

    const db = getDb();
    db.prepare("UPDATE versions SET sha256=?, size_bytes=? WHERE dataset_id='finma' AND version=?").run(shaOf(zipV1), zipV1.length, V1);

    const p1 = refreshFinmaFromR2(); // in-flight on v1 (awaiting deferred)

    // A new release lands while v1 is still downloading.
    db.prepare("INSERT INTO versions (dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES ('finma',?,?,?,?,?)").run(
      V2, `finma/${V2}/finma.zip`, shaOf(zipV2), zipV2.length, Date.now(),
    );
    db.prepare("UPDATE datasets SET current_version=? WHERE id='finma'").run(V2);
    const p2 = refreshFinmaFromR2(); // coalesced → requests a trailing run
    expect(p2).toBe(p1);

    releaseV1(zipV1); // let v1 finish; the trailing run then picks up v2
    await p1;

    expect(getObjectBufferMock).toHaveBeenCalledTimes(2);
    expect(getMcpFreshness().finma.loadedVersion).toBe(V2);
    expect(getFinmaRegistry().some((r) => r.name === ORACLE)).toBe(true); // v2 carries the oracle
  });
});
