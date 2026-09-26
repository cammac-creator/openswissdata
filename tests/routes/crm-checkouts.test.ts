import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/index.js';
import { getDb, closeDb } from '../../src/lib/db.js';
import { crmPeriod } from '../../src/lib/crm-period.js';
import * as checkouts from '../../src/lib/checkout-measures.js';

describe('Agrégats privés des créations Checkout', () => {
  const now=Date.parse('2026-10-26T00:30:00Z'),day=86400000,hash='v2:'+'a'.repeat(24),other='v2:'+'b'.repeat(24);
  const headers={cookie:'osd_session='+'D'.repeat(43)};let temp:string;
  beforeEach(()=>{
    vi.spyOn(Date,'now').mockReturnValue(now);temp=mkdtempSync(join(tmpdir(),'osd-crm-checkouts-'));
    vi.stubEnv('DATABASE_PATH',join(temp,'fictif.sqlite'));vi.stubEnv('ADMIN_EMAILS','owner@example.test');
    const db=getDb();for(const [id,email] of [[1,'owner@example.test'],[2,'buyer@example.test']] as const)db.prepare('INSERT INTO customers(id,email,created_at) VALUES(?,?,?)').run(id,email,now-day);
    for(const [id,token] of [[1,'D'.repeat(43)],[2,'E'.repeat(43)]] as const)db.prepare('INSERT INTO sessions(token,customer_id,created_at,expires_at) VALUES(?,?,?,?)').run(token,id,now,now+day);
  });
  afterEach(async()=>{await new Promise(r=>setImmediate(r));closeDb();rmSync(temp,{recursive:true,force:true});vi.restoreAllMocks();vi.unstubAllEnvs()});
  function event(overrides:Partial<{basket:string;locale:string;entry:string;kind:string;origin:string;status:number;at:number|string;ua:string|null;hash:string|null;meta:string|null}>={}){
    const e={basket:'finma',locale:'fr',entry:'form',kind:'conversion',origin:'server',status:303,at:now,ua:'desktop',hash,...overrides};
    getDb().prepare('INSERT INTO events(kind,origin,name,status,ts,ua_class,visitor_hash,meta_json) VALUES(?,?,\'checkout_started\',?,?,?,?,?)')
      .run(e.kind,e.origin,e.status,e.at,e.ua,e.hash,e.meta===undefined?JSON.stringify({schema:1,livemode:true,basket:e.basket,locale:e.locale,entry:e.entry}):e.meta);
  }
  const read=(days=30)=>checkouts.readCheckoutMeasures(getDb(),crmPeriod(days,now),now);
  it('reste réservé à l’administrateur, sans URL, client ni identifiant de session dans la sortie',async()=>{
    event();const app=createApp(),path='/api/admin/crm/audience';expect((await app.request(path)).status).toBe(401);expect((await app.request(path,{headers:{cookie:'osd_session='+'E'.repeat(43)}})).status).toBe(403);
    const r=await app.request(path,{headers});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');const b=await r.json();expect(b.checkouts.total.sessions).toBe(1);expect(JSON.stringify(b.checkouts)).not.toMatch(/@|cs_live_|https:|visitor_hash|customer_id|v2:|token/);
  });
  it('réconcilie paniers, langues et points d’entrée sans compter les lignes comme des sessions',()=>{
    event();event();event({basket:'bundle',locale:'de',entry:'api',status:200});event({basket:'mixed',locale:'en',hash:other});
    const m=read();expect(m.total).toMatchObject({sessions:4,browser_sessions:4,browser_visitor_days:2,unidentified_browser_sessions:0});
    expect(m.baskets.map(p=>p.sessions)).toEqual([2,0,0,1,1]);expect(m.locales.map(p=>p.sessions)).toEqual([2,1,1]);expect(m.entries.map(p=>p.sessions)).toEqual([3,1]);
    for(const group of [m.baskets,m.locales,m.entries])expect(group.reduce((sum,row)=>sum+row.sessions,0)).toBe(m.total.sessions);
  });
  it('sépare agents techniques et inconnus, sans leur attribuer des visiteurs humains',()=>{
    for(const ua of ['desktop','mobile','bot','automation','other',null])event({ua});
    expect(read().total).toEqual({sessions:6,browser_sessions:2,browser_visitor_days:1,unidentified_browser_sessions:0,bot_sessions:1,automation_sessions:1,unclassified_sessions:2});
  });
  it('signale la couverture des identifiants au lieu de fabriquer des visiteurs',()=>{
    for(const invalid of [null,'ancien','v2:'+'z'.repeat(24),'v2:'+'a'.repeat(25),'v2:'+'A'.repeat(24)])event({hash:invalid});
    expect(read().total).toMatchObject({sessions:5,browser_visitor_days:null,unidentified_browser_sessions:5});event();expect(read().total).toMatchObject({browser_visitor_days:1,unidentified_browser_sessions:5});
  });
  it('écarte les mauvaises origines, statuts, paniers, langues et voies de création',()=>{
    for(const origin of ['client','legacy'])event({origin});event({kind:'custom'});event({status:200});event({entry:'api'});event({status:503});event({basket:'mcp_standalone'});event({locale:'auto'});event({entry:'client'});
    for(const meta of ['{','null','[]','{"schema":1,"livemode":false,"basket":"finma","locale":"fr","entry":"form"}','{"schema":1,"livemode":1,"basket":"finma","locale":"fr","entry":"form"}','{"schema":"1","livemode":true,"basket":"finma","locale":"fr","entry":"form"}'])event({meta});
    expect(read().total.sessions).toBe(0);event();expect(read().total.sessions).toBe(1);
  });
  it('borne la lecture à 180 jours et au relevé, première trace valide seulement',()=>{
    const cutoff=now-180*day;event({at:cutoff-1});event({at:cutoff,meta:'{'});event({at:cutoff+1});event({at:now+1});event({at:'futur'});
    expect(read(365)).toMatchObject({first_retained_event:cutoff+1,effective_since:cutoff,retention_days:180,total:{sessions:1}});
    expect(read(7)).toMatchObject({first_retained_event:cutoff+1,total:{sessions:0}});
  });
  it('respecte le calendrier suisse et les deux occurrences de l’heure d’hiver',()=>{
    const from=crmPeriod(7,now).start_at;expect(from).toBe(Date.parse('2026-10-19T22:00:00Z'));
    for(const at of [from-1,from,Date.parse('2026-10-25T00:30:00Z'),Date.parse('2026-10-25T01:30:00Z'),now,now+1])event({at});expect(read(7).total.sessions).toBe(4);
  });
  it('conserve la borne réelle de rétention quand une période passée est lue',()=>{
    event({at:now-day});event();expect(checkouts.readCheckoutMeasures(getDb(),crmPeriod(7,now-day),now).total.sessions).toBe(1);
  });
  it('un historique absent reste explicite avec des agrégats vides fermés',()=>{
    const m=read();expect(m.first_retained_event).toBeNull();expect(m.total.sessions).toBe(0);expect(m.total.browser_visitor_days).toBe(0);expect(m.baskets).toHaveLength(5);expect(m.locales).toHaveLength(3);expect(m.entries).toHaveLength(2);
  });
  it('isole une panne de lecture sans exposer le SQL ni masquer les autres panneaux',async()=>{
    vi.spyOn(checkouts,'readCheckoutMeasures').mockImplementation(()=>{throw new Error('SELECT prive@example.test')});const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    const r=await createApp().request('/api/admin/crm/audience',{headers});expect(r.status).toBe(200);const b=await r.json();expect(b.checkouts).toBeNull();expect(b.samples.total.requests).toBe(0);expect(b.journey.orders).toBe(0);
    expect(log).toHaveBeenCalledWith('[crm] lecture des créations de paiement indisponible',{category:'unknown'});expect(JSON.stringify(log.mock.calls)).not.toMatch(/SELECT|@/);
  });
});
