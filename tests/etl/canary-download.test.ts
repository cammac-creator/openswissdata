import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {fetchAndHash,type SourceCanary} from "../../scripts/monitor-sources.js";
describe("Sources archivées avant contrôle",()=>{
  let temp:string;const source:SourceCanary={id:'source.fictive',url:'https://example.test/donnees',mode:'json-shape',description:'Source de test'};
  const files=()=>{const folder=join(temp,new Date().toISOString().slice(0,10));return readdirSync(folder).map(name=>readFileSync(join(folder,name)))};
  beforeEach(()=>{temp=mkdtempSync(join(tmpdir(),'osd-canary-'));vi.stubEnv('CANARY_BRONZE_DIR',temp)});
  afterEach(()=>{rmSync(temp,{recursive:true,force:true});vi.unstubAllEnvs();vi.unstubAllGlobals()});
  it("conserve les octets originaux et dédoublonne la même source du jour",async()=>{
    const raw=' {"data": [ {"code": "01"} ] }\n';vi.stubGlobal('fetch',vi.fn(async()=>new Response(raw)));
    const first=await fetchAndHash(source);expect(first.size).toBe(Buffer.byteLength(raw));
    expect(await fetchAndHash(source)).toEqual(first);expect(files()).toHaveLength(1);expect(files()[0].toString()).toBe(raw);
  });
  it("archive une page d’erreur HTML mais refuse d’en faire une référence",async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('<!doctype html><h1>Indisponible</h1>')));
    await expect(fetchAndHash({...source,mode:'csv-shape'})).rejects.toThrow('page HTML');expect(files()).toHaveLength(1);
  });
  it("refuse un faux fichier Excel renvoyé avec HTTP 200",async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('texte inattendu')));
    await expect(fetchAndHash({...source,mode:'raw'})).rejects.toThrow('archive XLSX');expect(files()[0].toString()).toBe('texte inattendu');
  });
  it("échoue si le bronze ne peut pas être écrit, avant l’analyse JSON",async()=>{
    const path=join(temp,'fichier');writeFileSync(path,'fictif');vi.stubEnv('CANARY_BRONZE_DIR',path);
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('JSON invalide')));
    await expect(fetchAndHash(source)).rejects.toThrow(/ENOTDIR|EEXIST/);
  });
  it("borne les téléchargements avant leur analyse",async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array(50_000_001))));
    await expect(fetchAndHash(source)).rejects.toThrow('50 Mo');expect(readdirSync(temp)).toHaveLength(0);
  });
});

describe("Sources des classifications surveillées",()=>{
  let temp:string;
  beforeEach(()=>{temp=mkdtempSync(join(tmpdir(),'osd-canary-doc-'));vi.stubEnv('CANARY_BRONZE_DIR',temp)});
  afterEach(()=>{rmSync(temp,{recursive:true,force:true});vi.unstubAllEnvs();vi.unstubAllGlobals()});
  it("empreinte les octets d’un document et refuse une page d’erreur HTML",async()=>{
    const doc:SourceCanary={id:'document.fictif',url:'https://example.test/structure.txt',mode:'document',description:'Document de test'};
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('"0111","Culture de céréales"\n')));
    const {hash,size}=await fetchAndHash(doc);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);expect(size).toBe(Buffer.byteLength('"0111","Culture de céréales"\n'));
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html><body>Azure WAF</body></html>')));
    await expect(fetchAndHash({...doc,id:'document.bloque'})).rejects.toThrow('page HTML');
  });
  it("suit exactement les adresses de la publication",async()=>{
    const {CANARIES}=await import("../../scripts/monitor-sources.js");
    const {ISIC_CSV_BY_LANG,NACE_2_1_RDF_URL}=await import("../../etl/classifications/ingest-real.js");
    const {NACE2_URL}=await import("../../etl/classifications/nace-official.js");
    const {NACE_ISIC_URL,OFS_METHODOLOGY_URL}=await import("../../etl/classifications/links.js");
    const urls=new Set(CANARIES.map(c=>c.url));
    for(const url of [NACE_2_1_RDF_URL,NACE2_URL,NACE_ISIC_URL,OFS_METHODOLOGY_URL,...Object.values(ISIC_CSV_BY_LANG)])expect(urls.has(url)).toBe(true);
    const baseline=JSON.parse(readFileSync(join(process.cwd(),'etl/canary-baseline.json'),'utf8'));
    expect(Object.keys(baseline).sort()).toEqual(CANARIES.map(c=>c.id).sort());
  });
});
