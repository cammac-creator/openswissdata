import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import archiver from "archiver";
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("../../src/lib/r2.js", () => ({ getObjectBuffer: download, signedDownloadUrl: vi.fn() }));
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
let tmp: string;
let counter = 0;
beforeEach(() => {
 tmp = mkdtempSync(join(tmpdir(), "osd-catalog-")); process.env.DATABASE_PATH = join(tmp,"test.sqlite");
 getDb().prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES('finma','FINMA','finma',29900,'price',?)").run(Date.now());
 download.mockReset();
});
afterEach(() => { closeDb(); rmSync(tmp,{recursive:true,force:true}); delete process.env.DATABASE_PATH; });
async function publish() {
 const zip = archiver("zip"); const chunks: Buffer[] = [];
 const ready = new Promise<Buffer>((resolve,reject) => { zip.on("data", c => chunks.push(c)); zip.on("error",reject); zip.on("end",() => resolve(Buffer.concat(chunks))); });
 zip.append(JSON.stringify({registry_rows:25,unique_uids:24,warning_rows:10,populated_fields:{lei:3},history:{gaps:[]}}),{name:"quality.json"});
 zip.append(JSON.stringify(Array.from({length:25},(_,i) => ({name:`Institution ${i}`,entity_type:"bank",uid:`UID${i}`,lei:null,is_warning_listed:null}))),{name:"finma_registry.json"});
 await zip.finalize(); const bytes=await ready; const version=`2026.09.25.${++counter}`;
 getDb().prepare("INSERT INTO versions(dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES('finma',?,'finma/test.zip',?,?,?)").run(version,createHash("sha256").update(bytes).digest("hex"),bytes.length,Date.now());
 getDb().prepare("UPDATE datasets SET current_version=? WHERE id='finma'").run(version); download.mockResolvedValue(bytes); return bytes;
}
describe("Qualité publique FINMA", () => {
 it("refuse de présenter une version absente comme disponible", async () => { expect((await createApp().request("/api/catalog/finma")).status).toBe(503); });
 it("publie les contrôles et un échantillon limité, sans données clients", async () => {
  await publish(); const res=await createApp().request("/api/catalog/finma"); expect(res.status).toBe(200); const body=await res.json();
  expect(body.registry_rows).toBe(25); expect(body.sample).toHaveLength(20); expect(body.sample[0].is_warning_listed).toBeNull();
  expect(Object.keys(body).sort()).toEqual(["collected_on","history","populated_fields","registry_rows","sample","unique_uids","version","warning_rows"].sort());
 });
 it("refuse une archive altérée", async () => { await publish(); download.mockResolvedValue(Buffer.from("archive modifiée")); expect((await createApp().request("/api/catalog/finma")).status).toBe(503); });
 it("sert un CSV daté sans cache permanent", async () => { await publish(); const res=await createApp().request("/api/catalog/finma?format=csv"); expect(res.status).toBe(200); expect(res.headers.get("content-disposition")).toContain("2026.09.25"); expect(res.headers.get("cache-control")).toBe("no-store"); expect(await res.text()).toContain("Institution 0"); });
 it("signale les données anciennes séparément de la disponibilité du serveur", async () => {
  getDb().prepare("UPDATE datasets SET current_version='2026.01.01' WHERE id='finma'").run();
  expect((await createApp().request("/api/health/freshness")).status).toBe(503);
  getDb().prepare("UPDATE datasets SET current_version=? WHERE id='finma'").run(new Date().toISOString().slice(0,10).replaceAll("-","."));
  expect((await createApp().request("/api/health/freshness")).status).toBe(200);
 });
});
