import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/index.js';
import { getDb, closeDb } from '../../src/lib/db.js';
import { crmPeriod } from '../../src/lib/crm-period.js';
import * as samples from '../../src/lib/sample-measures.js';

describe('Mesures des échantillons dans le CRM', () => {
  const now=Date.parse('2026-10-26T00:30:00Z'), day=86400000;
  const hash='v2:'+'a'.repeat(24), other='v2:'+'b'.repeat(24);
  const headers={cookie:'osd_session='+'D'.repeat(43)};
  let temp:string;
  beforeEach(() => {
    vi.spyOn(Date,'now').mockReturnValue(now);temp=mkdtempSync(join(tmpdir(),'osd-samples-'));
    vi.stubEnv('DATABASE_PATH',join(temp,'fictif.sqlite'));vi.stubEnv('ADMIN_EMAILS','owner@example.test');
    const db=getDb();
    for(const [id,email] of [[1,'owner@example.test'],[2,'buyer@example.test']] as const)db.prepare('INSERT INTO customers(id,email,created_at) VALUES(?,?,?)').run(id,email,now-day);
    for(const [id,token] of [[1,'D'.repeat(43)],[2,'E'.repeat(43)]] as const)db.prepare('INSERT INTO sessions(token,customer_id,created_at,expires_at) VALUES(?,?,?,?)').run(token,id,now,now+day);
  });
  afterEach(async () => {await new Promise(r=>setImmediate(r));closeDb();rmSync(temp,{recursive:true,force:true});vi.restoreAllMocks();vi.unstubAllEnvs()});
  function event(overrides:Partial<{dataset:string;kind:string;origin:string;status:number;at:number|string;ua:string|null;hash:string|null;meta:string|null}>={}) {
    const e={dataset:'finma',kind:'conversion',origin:'server',status:200,at:now,ua:'desktop',hash,...overrides};
    getDb().prepare('INSERT INTO events(kind,origin,name,status,ts,ua_class,visitor_hash,meta_json) VALUES(?,?,\'sample_served\',?,?,?,?,?)')
      .run(e.kind,e.origin,e.status,e.at,e.ua,e.hash,e.meta===undefined?JSON.stringify({schema:1,dataset:e.dataset}):e.meta);
  }
  const read=(days=30)=>samples.readSampleMeasures(getDb(),crmPeriod(days,now),now);
  it('reste privé et expose seulement des agrégats sans identifiant individuel',async()=>{
    event();const app=createApp(),path='/api/admin/crm/audience?days=7';expect((await app.request(path)).status).toBe(401);
    expect((await app.request(path,{headers:{cookie:'osd_session='+'E'.repeat(43)}})).status).toBe(403);
    const r=await app.request(path,{headers});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');
    const b=await r.json();expect(b.samples.total.requests).toBe(1);expect(JSON.stringify(b.samples)).not.toMatch(/@|v2:|cookie|customer_id|visitor_hash|token/);
  });
  it('compte les répétitions et déduplique les identifiants entre produits',()=>{
    event();event();event({dataset:'tares'});event({dataset:'classifications',hash:other,ua:'mobile'});
    const m=read();expect(m.total).toMatchObject({requests:4,browser_requests:4,browser_visitor_days:2,unidentified_browser_requests:0});
    expect(m.products.map(p=>[p.requests,p.browser_visitor_days])).toEqual([[2,1],[1,1],[1,1]]);
  });
  it('sépare robots, automatismes et agents absents ou inconnus des navigateurs',()=>{
    for(const ua of ['desktop','mobile','bot','automation','other','inconnu',null])event({ua});
    expect(read().total).toEqual({requests:7,browser_requests:2,browser_visitor_days:1,unidentified_browser_requests:0,bot_requests:1,automation_requests:1,unclassified_requests:3});
  });
  it('ne remplace pas les identifiants absents, historiques ou malformés par de faux visiteurs',()=>{
    for(const invalid of [null,'','ancien','v2:'+'A'.repeat(24),'v2:'+'z'.repeat(24),'v2:'+'a'.repeat(23),'v2:'+'a'.repeat(25)])event({hash:invalid});
    expect(read().total).toMatchObject({browser_requests:7,browser_visitor_days:null,unidentified_browser_requests:7});
    event();expect(read().total).toMatchObject({browser_requests:8,browser_visitor_days:1,unidentified_browser_requests:7});
  });
  it('ignore les déclarations externes, historiques et les mauvais statuts ou schémas',()=>{
    event({origin:'client'});event({origin:'legacy'});event({kind:'custom'});event({status:503});event({dataset:'inconnu'});
    for(const meta of [null,'{','null','[]','1','{"schema":"1","dataset":"finma"}','{"schema":1.0,"dataset":"finma"}','{"schema":2,"dataset":"finma"}','{"schema":1,"dataset":["finma"]}'])event({meta});
    expect(read().total.requests).toBe(0);event();expect(read().total.requests).toBe(1);
  });
  it('borne les traces à 180 jours et au relevé, sans rebaptiser la première trace en activation',()=>{
    const cutoff=now-180*day;event({at:cutoff-1});event({at:cutoff});event({at:now+1});event({at:'futur'});
    expect(read(365)).toMatchObject({first_retained_event:cutoff,retained_since:cutoff,effective_since:cutoff,retention_days:180,total:{requests:1}});
    expect(read(7)).toMatchObject({first_retained_event:cutoff,total:{requests:0}});
  });
  it('respecte la période suisse, ses deux heures répétées et la milliseconde présente',()=>{
    const from=crmPeriod(7,now).start_at;expect(from).toBe(Date.parse('2026-10-19T22:00:00Z'));
    for(const at of [from-1,from,Date.parse('2026-10-25T00:30:00Z'),Date.parse('2026-10-25T01:30:00Z'),now,now+1])event({at});
    expect(read(7).total.requests).toBe(4);
  });
  it('une période passée ne déplace pas la rétention calculée au moment de la lecture',()=>{
    event({at:now-day});event({at:now});const m=samples.readSampleMeasures(getDb(),crmPeriod(7,now-day),now);
    expect(m.total.requests).toBe(1);expect(m.retained_since).toBe(now-180*day);
  });
  it('une absence de trace reste explicite, avec les trois produits à zéro',()=>{
    const m=read();expect(m.first_retained_event).toBeNull();expect(m.products).toHaveLength(3);expect(m.total.requests).toBe(0);expect(m.total.browser_visitor_days).toBe(0);
  });
  it('une erreur du panneau ne masque pas les autres mesures et ne journalise pas le SQL',async()=>{
    vi.spyOn(samples,'readSampleMeasures').mockImplementation(()=>{throw new Error('prive@example.test SELECT secret')});const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    const r=await createApp().request('/api/admin/crm/audience',{headers});expect(r.status).toBe(200);const b=await r.json();expect(b.samples).toBeNull();expect(b.journey.orders).toBe(0);expect(b.web.pageviews).toBe(0);
    expect(log).toHaveBeenCalledWith('[crm] lecture des mesures d’échantillons indisponible',{category:'unknown'});expect(JSON.stringify(log.mock.calls)).not.toMatch(/prive|SELECT|secret/);
  });
});
