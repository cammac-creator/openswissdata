import { authRequestIp } from '../../src/lib/auth-limits.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { canonicalIp, abuseIp, trustedRequestIp } from '../../src/lib/request-ip.js';
import { visitorHashFromRequest } from '../../src/lib/visitor-identity.js';
import { trackPageView } from '../../src/lib/track.js';
import { getDb, closeDb } from '../../src/lib/db.js';
import { crmPeriod, swissDay } from '../../src/lib/crm-period.js';
import { readCrmAudience } from '../../src/lib/crm-audience.js';
import { renderVisitorCoverage } from '../../web/src/lib/visitor-coverage.js';
import { trackMcpToolCall } from '../../src/mcp/track-mcp.js';

const now = Date.parse('2026-09-26T12:00:00Z'), ua = 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36';
const secret = 'cle-fictive-visiteurs-uniquement';
async function hash(ip = '192.0.2.10', time = now, extra: Record<string,string> = {}): Promise<string|null> {
  const app = new Hono(); app.get('/', c => c.json({ hash: visitorHashFromRequest(c, time) }));
  return (await (await app.request('/', { headers: { 'user-agent': ua, 'x-real-ip': ip, ...extra } })).json()).hash;
}

describe('Adresse réseau canonique', () => {
  it.each(['example.test','192.0.2.1:80','[2001:db8::1]','192.0.2.1,198.51.100.1','fe80::1%en0','010.0.0.1','127.1','0x7f000001','1'.repeat(100),''])('refuse une adresse ambiguë : %s', value => expect(canonicalIp(value)).toBeNull());
  it.each([['2001:0db8:1:2::9','2001:db8:1:2::/64'],['::ffff:192.0.2.10','192.0.2.10'],['::1','0:0:0:0::/64'],['x','unknown']])('conserve la clé réseau historique %s', (ip, expected) => expect(abuseIp(ip)).toBe(expected));
  it('unifie les IPv6 équivalentes et les IPv4 mappées sans agréger les visiteurs en /64', () => {
    expect(canonicalIp('2001:0DB8:0001:0002:0000:0000:0000:0001')).toBe('2001:db8:1:2::1');
    expect(canonicalIp('2001:db8:1:2::2')).not.toBe(canonicalIp('2001:db8:1:2::1'));
    expect(abuseIp('2001:db8:1:2::2')).toBe(abuseIp('2001:db8:1:2::1'));
    expect(canonicalIp('::ffff:c000:20a')).toBe('192.0.2.10');expect(canonicalIp('::ffff:192.0.2.10')).toBe('192.0.2.10');
  });
});

describe('Pseudonymes quotidiens des visites', () => {
  let root:string;
  beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'osd-identite-'));vi.stubEnv('DATABASE_PATH',join(root,'fictive.sqlite'));vi.stubEnv('SESSION_SECRET',secret);vi.stubEnv('NODE_ENV','test');vi.stubEnv('RAILWAY_ENVIRONMENT_ID','railway-fictif');});
  afterEach(async()=>{await new Promise(r=>setImmediate(r));closeDb();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});});
  it('utilise un HMAC séparé, versionné, sans adresse brute', async()=>{
    const result=await hash();expect(result).toMatch(/^v2:[a-f0-9]{24}$/);
    expect(result).toBe('v2:'+createHmac('sha256',secret).update('openswissdata:visitor:v2:').update(JSON.stringify([swissDay(now),'192.0.2.10',ua])).digest('hex').slice(0,24));
    expect(result).not.toContain('192.0.2.10');expect(await hash('::ffff:192.0.2.10')).toBe(result);
  });
  it('ignore X-Forwarded-For et sépare les adresses IPv6 complètes',async()=>{
    expect(await hash('192.0.2.10',now,{'x-forwarded-for':'198.51.100.1'})).toBe(await hash('192.0.2.10',now,{'x-forwarded-for':'203.0.113.2'}));
    expect(await hash('2001:db8:1:2::1')).not.toBe(await hash('2001:db8:1:2::2'));
    expect(await hash('2001:0db8:0001:0002:0000:0000:0000:0001')).toBe(await hash('2001:db8:1:2::1'));
  });
  it('ne crée aucun visiteur commun fictif quand le proxy ne fournit pas une adresse valable',async()=>{
    expect(await hash('',now,{'x-forwarded-for':'192.0.2.10'})).toBeNull();expect(await hash('192.0.2.10,198.51.100.2')).toBeNull();
  });
  it('refuse deux en-têtes d’adresse du proxy sans les utiliser comme identité ni clé distincte',async()=>{
    const headers=new Headers({'user-agent':ua});headers.append('x-real-ip','192.0.2.1');headers.append('x-real-ip','198.51.100.2');
    const app=new Hono();app.get('/',c=>c.json({hash:visitorHashFromRequest(c,now),limit:authRequestIp(c)}));
    expect(await(await app.request('/',{headers})).json()).toEqual({hash:null,limit:'unknown'});
  });
  it('hors Railway ignore tous les en-têtes et utilise la connexion réelle',async()=>{
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID','');expect(await hash()).toBeNull();
    const app=new Hono();app.get('/',c=>c.json({ip:trustedRequestIp(c),hash:visitorHashFromRequest(c,now)}));
    const r=await app.fetch(new Request('http://localhost/',{headers:{'user-agent':ua,'x-real-ip':'198.51.100.4','x-forwarded-for':'203.0.113.5'}}),{incoming:{socket:{remoteAddress:'::ffff:192.0.2.10',remoteFamily:'IPv6',remotePort:1}}});
    const d=await r.json();expect(d.ip).toBe('192.0.2.10');vi.stubEnv('RAILWAY_ENVIRONMENT_ID','fictif');expect(d.hash).toBe(await hash());
  });
  it.each(['production','','development'])('ne remplace pas une clé réelle manquante en environnement Railway (%s)',async mode=>{
    vi.stubEnv('NODE_ENV',mode);vi.stubEnv('SESSION_SECRET','');expect(await hash()).toBeNull();vi.stubEnv('SESSION_SECRET','trop-court');expect(await hash()).toBeNull();
  });
  it('réserve le sel de développement aux environnements locaux explicitement déclarés',async()=>{
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID','');vi.stubEnv('SESSION_SECRET','');const app=new Hono();app.get('/',c=>c.json({hash:visitorHashFromRequest(c,now)}));
    const req=()=>app.fetch(new Request('http://localhost/',{headers:{'user-agent':ua}}),{incoming:{socket:{remoteAddress:'192.0.2.10'}}});
    expect((await(await req()).json()).hash).toMatch(/^v2:/);vi.stubEnv('NODE_ENV','production');expect((await(await req()).json()).hash).toBeNull();
  });
  it('borne le navigateur et refuse les dates impossibles sans interrompre la page',async()=>{
    expect(await hash('192.0.2.10',now,{'user-agent':''})).toBeNull();expect(await hash('192.0.2.10',now,{'user-agent':'x'.repeat(1025)})).toBeNull();
    for(const at of [NaN,Infinity,-1,9e15])expect(await hash('192.0.2.10',at)).toBeNull();
  });
  it('change de pseudonyme à minuit suisse, pas à minuit UTC',async()=>{
    const before=Date.parse('2026-09-25T21:59:59.999Z'),after=before+1;
    expect(await hash('192.0.2.10',before)).not.toBe(await hash('192.0.2.10',after));
    expect(await hash('192.0.2.10',Date.parse('2026-09-25T22:30:00Z'))).toBe(await hash('192.0.2.10',Date.parse('2026-09-26T00:30:00Z')));
  });
  it.each(['2026-03-29T22:00:00Z','2026-10-25T23:00:00Z'])('respecte minuit après un changement d’heure (%s)',async iso=>{
    const t=Date.parse(iso);expect(await hash('192.0.2.10',t-1)).not.toBe(await hash('192.0.2.10',t));
    expect(await hash('192.0.2.10',t-1)).toBe(await hash('192.0.2.10',t-3600000));
  });
  it('distingue une clé ou un navigateur différent sans cookie ajouté',async()=>{
    const original=await hash();expect(await hash('192.0.2.10',now,{'user-agent':ua+' autre'})).not.toBe(original);
    vi.stubEnv('SESSION_SECRET',secret+' autre');expect(await hash()).not.toBe(original);
  });
  it('capture la journée du hash et celle de l’événement ensemble, sans IP ni navigateur brut conservé',async()=>{
    vi.spyOn(Date,'now').mockReturnValue(now);const app=new Hono();app.use('*',trackPageView);app.get('/',c=>c.html('<p>Fictif</p>'));
    const r=await app.request('/',{headers:{'user-agent':ua,'x-real-ip':'192.0.2.10'}});expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toBeNull();
    await new Promise(r=>setImmediate(r));const row=getDb().prepare('SELECT * FROM events').get() as {visitor_hash:string;ts:number};
    expect(row.visitor_hash).toBe(await hash());expect(row.ts).toBe(now);expect(JSON.stringify(row)).not.toContain('192.0.2.10');expect(JSON.stringify(row)).not.toContain(ua);
  });
  it('prépare les mesures MCP avant la file bornée, sans retenir navigateur brut ni date ultérieure',async()=>{
    const clock=vi.spyOn(Date,'now').mockReturnValue(now);getDb();const app=new Hono();
    app.get('/',c=>{trackMcpToolCall(c,{method:'tools/call',params:{name:'x'.repeat(500)}},undefined,null,2);clock.mockReturnValue(now+86400000);return c.text('Fictif')});
    await app.request('/',{headers:{'user-agent':ua,'x-real-ip':'192.0.2.10'}});await new Promise(r=>setImmediate(r));
    const row=getDb().prepare('SELECT ts,visitor_hash,meta_json FROM events').get() as {ts:number;visitor_hash:string;meta_json:string};
    expect(row.ts).toBe(now);expect(row.visitor_hash).toBe(await hash());const meta=JSON.parse(row.meta_json);expect(meta.tool).toHaveLength(128);expect(meta).not.toHaveProperty('ua');expect(row.meta_json).not.toContain(ua);
  });
  it('sépare les formats actuels, historiques et absents sans réécrire les anciennes traces',async()=>{
    const db=getDb(),insert=db.prepare("INSERT INTO events(kind,name,origin,visitor_hash,ua_class,ts) VALUES('custom','page_view',?,?,'desktop',?)");
    const current=await hash();for(const [origin,value] of [['server',current],['server',current],['legacy','ancien-fictif'],['legacy','v2:'+ 'f'.repeat(24)],['server',null],['server','']])insert.run(origin,value,now);
    const a=readCrmAudience(db,crmPeriod(7,now));expect(a.identity).toEqual({current_pages:2,historical_pages:2,unidentified_pages:2});expect(a.web).toEqual({pageviews:6,visitor_days:3});expect(a.daily.at(-1)?.unidentified_views).toBe(2);
    expect(db.prepare("SELECT visitor_hash FROM events WHERE origin='legacy' ORDER BY id").all()).toEqual([{visitor_hash:'ancien-fictif'},{visitor_hash:'v2:'+ 'f'.repeat(24)}]);
    expect(renderVisitorCoverage(a.identity!)).toContain('Certaines pages ont été enregistrées');
  });
  it('ne prétend pas estimer zéro visiteur quand toutes les pages sont sans identifiant',()=>{
    const db=getDb();db.prepare("INSERT INTO events(kind,name,origin,ua_class,ts) VALUES('custom','page_view','server','desktop',?)").run(now);
    const a=readCrmAudience(db,crmPeriod(7,now));expect(a.web).toEqual({pageviews:1,visitor_days:null});expect(a.daily.at(-1)).toMatchObject({visitors:null,unidentified_views:1});
    expect(a.identity).toEqual({current_pages:0,historical_pages:0,unidentified_pages:1});
  });
});
