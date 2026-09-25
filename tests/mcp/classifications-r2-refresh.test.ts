import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import archiver from "archiver";
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("../../src/lib/r2.js", () => ({ getObjectBuffer: download }));
import { getDb, closeDb } from "../../src/lib/db.js";
import { getClassificationLinks, _resetDataLoaderCache } from "../../src/mcp/data-loader.js";
import { refreshClassificationsFromR2, getMcpFreshness, _resetFreshnessForTest } from "../../src/mcp/r2-refresh.js";
const seed = structuredClone(getClassificationLinks());
let temp: string;
async function zip(version = "2026.09.25", change: (data: typeof seed) => void = () => {}): Promise<Buffer> {
  const data = structuredClone(seed);data.sources.forEach(s => s.version = version);change(data);
  return new Promise((resolve,reject) => {
    const archive=archiver("zip"),parts:Buffer[]=[];archive.on("data",b=>parts.push(b));archive.on("error",reject);archive.on("end",()=>resolve(Buffer.concat(parts)));
    for(const [name,value] of Object.entries({"quality.json":{schema_version:2,orphan_parents:0,links:data.links.length},"classification_links.json":data.links,"sources.json":data.sources}))archive.append(JSON.stringify(value),{name});void archive.finalize();
  });
}
function record(bytes:Buffer,version="2026.09.25") { const db=getDb();db.prepare("UPDATE datasets SET current_version=? WHERE id='classifications'").run(version);db.prepare("INSERT INTO versions(dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES('classifications',?,?,?,?,?)").run(version,`classifications/${version}/classifications.zip`,createHash("sha256").update(bytes).digest("hex"),bytes.length,Date.now()); }
beforeEach(()=>{temp=mkdtempSync(join(tmpdir(),"osd-class-refresh-"));vi.stubEnv("DATABASE_PATH",join(temp,"test.db"));vi.stubEnv("R2_ACCOUNT_ID","fictif");vi.stubEnv("R2_BUCKET","fictif");getDb().prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES('classifications','Classifications','classifications',0,'fictif',?)").run(Date.now());download.mockReset();_resetDataLoaderCache();_resetFreshnessForTest();});
afterEach(()=>{closeDb();rmSync(temp,{recursive:true,force:true});vi.unstubAllEnvs();_resetDataLoaderCache();});
describe("Référentiel réellement servi après publication",()=>{
 it("archive avant lecture et remplace ensemble les relations et leurs sources",async()=>{const bytes=await zip("2026.09.25.2");record(bytes,"2026.09.25.2");download.mockResolvedValue(bytes);await refreshClassificationsFromR2();expect(getClassificationLinks().version).toBe("2026.09.25.2");expect(getMcpFreshness().classifications.stale).toBe(false);expect(readdirSync(join(temp,"bronze/classifications",new Date().toISOString().slice(0,10)))).toHaveLength(1);});
 it("conserve le référentiel contrôlé quand l’archive suivante est tronquée",async()=>{const good=await zip(),bad=await zip("2026.09.25.2",d=>{d.links=(d.links as any[]).slice(0,10);});record(good);download.mockResolvedValue(good);await refreshClassificationsFromR2();record(bad,"2026.09.25.2");download.mockResolvedValue(bad);await refreshClassificationsFromR2();expect(getClassificationLinks().version).toBe("2026.09.25");expect(getMcpFreshness().classifications.stale).toBe(true);});
 it("refuse une fausse identité NACE/ISIC même présentée sous la source OFS",async()=>{const bytes=await zip("2026.09.25",d=>{const link=d.links.find(x=>x.source_id==='eurostat-nace2-isic4')!;link.relation='exactMatch';link.source_id='ofs-methodologie';});record(bytes);download.mockResolvedValue(bytes);await refreshClassificationsFromR2();expect(getMcpFreshness().classifications.loadedVersion).toBeNull();expect(getMcpFreshness().classifications.lastError).toContain('Équivalence');});
 it("refuse une provenance portant une autre version",async()=>{const bytes=await zip("2026.09.25",d=>{d.sources[0].version='2026.01.01';});record(bytes);download.mockResolvedValue(bytes);await refreshClassificationsFromR2();expect(getMcpFreshness().classifications.lastError).toContain('Provenance');});
 it("refuse une archive dont l’empreinte diffère",async()=>{const bytes=await zip();record(bytes);download.mockResolvedValue(Buffer.from('autre'));await refreshClassificationsFromR2();expect(getMcpFreshness().classifications.lastError).toContain('Empreinte');});
 it("reprend la version la plus récente si elle change pendant la lecture",async()=>{const first=await zip(),latest=await zip("2026.09.25.2");record(first);let resolve!:(b:Buffer)=>void;download.mockImplementationOnce(()=>new Promise<Buffer>(r=>{resolve=r;})).mockResolvedValue(latest);const loading=refreshClassificationsFromR2();await vi.waitFor(()=>expect(download).toHaveBeenCalledOnce());record(latest,"2026.09.25.2");resolve(first);await loading;expect(getClassificationLinks().version).toBe("2026.09.25.2");});
});
