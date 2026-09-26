import { describe,it,expect,beforeEach,afterEach,vi } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/index.js';
import { getDb,closeDb } from '../../src/lib/db.js';
import { seal,unseal,clearCrmCache } from '../../src/lib/crm-source.js';

describe('Bureau privé et suivi client',()=>{
 let temp:string;let admin:number;let buyer:number;const token='D'.repeat(43);const other='E'.repeat(43);
 const headers={cookie:`osd_session=${token}`,origin:'https://www.openswissdata.com','content-type':'application/json','x-osd-csrf':'dashboard'};
 beforeEach(()=>{
  temp=mkdtempSync(join(tmpdir(),'osd-crm-'));process.env.DATABASE_PATH=join(temp,'test.sqlite');process.env.ADMIN_EMAILS='owner@example.test';process.env.BASE_URL='https://www.openswissdata.com';process.env.OSD_BACKUP_KEY='a'.repeat(64);delete process.env.GSC_SERVICE_ACCOUNT_JSON;
  const db=getDb(),now=Date.now();admin=Number(db.prepare('INSERT INTO customers(email,created_at) VALUES(?,?)').run('owner@example.test',now).lastInsertRowid);buyer=Number(db.prepare('INSERT INTO customers(email,created_at) VALUES(?,?)').run('buyer@example.test',now).lastInsertRowid);
  for(const [t,id] of [[token,admin],[other,buyer]])db.prepare('INSERT INTO sessions(token,customer_id,expires_at,created_at) VALUES(?,?,?,?)').run(t,id,now+86400000,now);
  for(const [id,session,amount,status] of [[admin,'cs_live_owner',100,'paid'],[buyer,'cs_live_buyer',29900,'paid'],[buyer,'cs_test_buyer',29900,'paid'],[buyer,'cs_live_refunded',29900,'refunded']])db.prepare('INSERT INTO orders(customer_id,stripe_session_id,amount_chf,items_json,status,created_at) VALUES(?,?,?,?,?,?)').run(id,session,amount,'["finma"]',status,now);
 });
 afterEach(()=>{closeDb();rmSync(temp,{recursive:true,force:true});for(const key of ['DATABASE_PATH','ADMIN_EMAILS','BASE_URL','OSD_BACKUP_KEY'])delete process.env[key];clearCrmCache();vi.restoreAllMocks();vi.unstubAllGlobals()});
 it('refuse un visiteur anonyme et un client non administrateur',async()=>{const app=createApp();for(const path of ['/overview','/customers/2','/mail','/operations','/visibility']){expect((await app.request('/api/admin/crm'+path)).status).toBe(401);expect((await app.request('/api/admin/crm'+path,{headers:{cookie:`osd_session=${other}`}})).status).toBe(403)}});
 it('refuse un corps surdimensionné sans Content-Length avant toute création de tâche',async()=>{
  const raw=new TextEncoder().encode(JSON.stringify({title:'Action fictive',padding:'x'.repeat(18000)}));
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(raw.slice(0,8000));controller.enqueue(raw.slice(8000));controller.close();}});
  const request=new Request('https://www.openswissdata.com/api/admin/crm/tasks',{method:'POST',headers,body,duplex:'half'} as RequestInit);
  expect(request.headers.has('content-length')).toBe(false);
  const response=await createApp().fetch(request);
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({error:'body_too_large'});
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM crm_tasks').get()).toEqual({n:0});
 });
 it('exclut propriétaire, tests et remboursements des ventes',async()=>{const r=await createApp().request('/api/admin/crm/overview',{headers});const body=await r.json();expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');expect(body.revenue).toEqual({orders:1,customers:1,revenue_cents:29900});expect(body.customers.find((c:{id:number})=>c.id===admin).internal).toBe(true);expect(JSON.stringify(body)).not.toContain(token)});
 it('déduit les remboursements partiels et sépare une contestation des ventes',async()=>{
  const db=getDb(),app=createApp();db.prepare("UPDATE orders SET refunded_chf=5000 WHERE stripe_session_id='cs_live_buyer'").run();
  const partial=await(await app.request('/api/admin/crm/overview',{headers})).json();
  expect(partial.revenue.revenue_cents).toBe(24900);expect(partial.daily.reduce((sum:number,row:{revenue_cents:number})=>sum+row.revenue_cents,0)).toBe(24900);
  expect(partial.customers.find((c:{id:number})=>c.id===buyer).revenue_cents).toBe(24900);
  const detail=await(await app.request(`/api/admin/crm/customers/${buyer}`,{headers})).json();
  expect(detail.orders.find((o:{stripe_session_id:string})=>o.stripe_session_id==='cs_live_buyer').refunded_chf).toBe(5000);
  db.prepare("UPDATE orders SET status='disputed',dispute_status='needs_response' WHERE stripe_session_id='cs_live_buyer'").run();
  const contested=await(await app.request('/api/admin/crm/overview',{headers})).json();
  expect(contested.revenue.revenue_cents).toBe(0);expect(contested.revenue.orders).toBe(0);
 });
 it('réconcilie chaque achat avec le bon jour suisse et exclut les bornes hors période',async()=>{
  const now=Date.parse('2026-10-26T00:30:00Z');vi.spyOn(Date,'now').mockReturnValue(now);
  const db=getDb();db.prepare('UPDATE sessions SET expires_at=?').run(now+86400000);db.prepare('DELETE FROM orders').run();
  const insert=db.prepare("INSERT INTO orders(customer_id,stripe_session_id,amount_chf,refunded_chf,items_json,status,created_at) VALUES(?,?,?,?,?,'paid',?)");
  const rows=[['avant','2026-10-19T21:59:59.999Z',900,0],['debut','2026-10-19T22:00:00Z',1000,0],['jour25debut','2026-10-24T22:00:00Z',2000,500],['heure_double1','2026-10-25T00:30:00Z',3000,0],['heure_double2','2026-10-25T01:30:00Z',4000,0],['jour25fin','2026-10-25T22:59:59.999Z',5000,0],['jour26','2026-10-25T23:00:00Z',6000,0],['maintenant','2026-10-26T00:30:00Z',7000,0],['futur','2026-10-26T00:30:00.001Z',8000,0]] as const;
  for(const [id,at,amount,refund] of rows)insert.run(buyer,'cs_live_'+id,amount,refund,'["finma"]',Date.parse(at));
  const r=await createApp().request('/api/admin/crm/overview?days=7',{headers}),body=await r.json();
  expect(r.status).toBe(200);expect(body.period).toMatchObject({timezone:'Europe/Zurich',start:'2026-10-20',end:'2026-10-26',end_at:now+1});
  expect(body.daily).toHaveLength(7);expect(body.revenue).toEqual({orders:7,customers:1,revenue_cents:27500});
  expect(body.daily.reduce((sum:number,x:{revenue_cents:number})=>sum+x.revenue_cents,0)).toBe(body.revenue.revenue_cents);
  expect(body.daily.find((x:{day:string})=>x.day==='2026-10-25')).toEqual({day:'2026-10-25',orders:4,revenue_cents:13500});
  expect(body.daily.find((x:{day:string})=>x.day==='2026-10-26')).toEqual({day:'2026-10-26',orders:2,revenue_cents:13000});
  expect(body.daily[1]).toEqual({day:'2026-10-21',orders:0,revenue_cents:0});
  expect(body.all_time.revenue_cents).toBe(28400);
 });
 it('présente une audience cohérente, ses jours absents et la limite de conservation',async()=>{
  const now=Date.parse('2026-09-26T12:00:00Z');vi.spyOn(Date,'now').mockReturnValue(now);
  const db=getDb();db.prepare('UPDATE sessions SET expires_at=?').run(now+86400000);
  const insert=db.prepare("INSERT INTO events(kind,name,visitor_hash,ua_class,ts) VALUES('custom','page_view',?,?,?)");
  // Le même identifiant ancien apparaît de part et d’autre d’un minuit suisse.
  for(const [at,hash,ua] of [['2026-09-24T21:59:00Z','ancien-hash','desktop'],['2026-09-24T22:01:00Z','ancien-hash','desktop'],['2026-09-24T22:02:00Z','ancien-hash','desktop'],['2026-09-24T23:59:00Z','second','mobile'],['2026-09-25T00:01:00Z','robot','bot'],['2026-09-26T12:00:00.001Z','futur','desktop'],['2026-01-01T00:00:00Z','trop-ancien','desktop']])insert.run(hash,ua,Date.parse(at));
  const app=createApp(),a=await(await app.request('/api/admin/crm/audience?days=7',{headers})).json();
  const o=await(await app.request('/api/admin/crm/overview?days=7',{headers})).json();
  expect(a.web).toEqual({pageviews:4,visitor_days:3});expect(o.web).toEqual(a.web);expect(a.daily).toHaveLength(7);
  expect(a.daily.find((x:{day:string})=>x.day==='2026-09-24')).toEqual({day:'2026-09-24',views:1,visitors:1,partial:true});
  expect(a.daily.find((x:{day:string})=>x.day==='2026-09-25')).toEqual({day:'2026-09-25',views:3,visitors:2,partial:false});
  expect(a.daily.at(-1)).toEqual({day:'2026-09-26',views:0,visitors:0,partial:true});
  expect(a.daily[0]).toEqual({day:'2026-09-20',views:null,visitors:null,partial:false});
  expect(a.split.find((x:{label:string})=>x.label==='bot').count).toBe(1);
  expect(a.daily.reduce((sum:number,x:{visitors:number|null})=>sum+(x.visitors??0),0)).toBe(a.web.visitor_days);
  const year=await(await app.request('/api/admin/crm/audience?days=365',{headers})).json();
  expect(year.daily).toHaveLength(365);expect(year.web).toEqual(a.web);expect(year.coverage.retention_days).toBe(180);expect(year.daily[0].visitors).toBeNull();
 });
 it('garde une absence de mesure distincte d’une audience réellement nulle',async()=>{
  const a=await(await createApp().request('/api/admin/crm/audience?days=7',{headers})).json();
  expect(a.coverage.first_event).toBeNull();expect(a.daily).toHaveLength(7);expect(a.daily.every((x:{visitors:number|null})=>x.visitors===null)).toBe(true);expect(a.web).toEqual({pageviews:0,visitor_days:0});
 });
 it.each(['14','abc','-1','100000'])('revient à trente jours pour une période non prévue : %s',async(value)=>{
  const app=createApp();for(const route of ['overview','audience']){const r=await app.request('/api/admin/crm/'+route+'?days='+value,{headers});expect(r.status).toBe(200);expect((await r.json()).period.days).toHaveLength(30)}
 });
 it.each([
  ['2026-03-30T12:00:00Z','2026-03-28T23:00:00Z','2026-03-29T21:59:59.999Z','2026-03-29'],
  ['2026-10-26T12:00:00Z','2026-10-24T22:00:00Z','2026-10-25T22:59:59.999Z','2026-10-25'],
 ])('regroupe les événements du changement d’heure, relevé %s',async(nowText,from,until,day)=>{
  const now=Date.parse(nowText);vi.spyOn(Date,'now').mockReturnValue(now);const db=getDb();db.prepare('UPDATE sessions SET expires_at=?').run(now+86400000);
  const event=db.prepare("INSERT INTO events(kind,name,visitor_hash,ua_class,ts) VALUES('custom','page_view',?,'desktop',?)");
  event.run('fictif-1',Date.parse(from));event.run('fictif-2',Date.parse(until));event.run('jour-suivant',Date.parse(until)+1);
  const a=await(await createApp().request('/api/admin/crm/audience?days=7',{headers})).json();
  expect(a.daily.find((x:{day:string})=>x.day===day)).toMatchObject({views:2,visitors:2});expect(a.web).toEqual({pageviews:3,visitor_days:3});
 });
 it('utilise la frontière de purge réelle même lorsque des traces plus anciennes subsistent',async()=>{
  const now=Date.parse('2026-09-26T12:00:00Z'),cutoff=now-180*86400000;vi.spyOn(Date,'now').mockReturnValue(now);const db=getDb();db.prepare('UPDATE sessions SET expires_at=?').run(now+86400000);
  const event=db.prepare("INSERT INTO events(kind,name,visitor_hash,ua_class,ts) VALUES('custom','page_view',?,'desktop',?)");
  event.run('avant',cutoff-1);event.run('frontiere',cutoff);event.run('apres',cutoff+1);
  const a=await(await createApp().request('/api/admin/crm/audience?days=365',{headers})).json();
  expect(a.coverage).toMatchObject({retained_since:cutoff,effective_since:cutoff,first_event:cutoff,retention_days:180});expect(a.web).toEqual({pageviews:2,visitor_days:2});
  expect(a.daily.find((x:{views:number|null})=>x.views===2).partial).toBe(true);expect(a.daily[0].views).toBeNull();
 });
 it('bloque les écritures provenant d’un autre site, sans origine ou sans en-tête CSRF',async()=>{const app=createApp();for(const h of [{...headers,origin:'https://evil.test'},{cookie:headers.cookie,'content-type':'application/json','x-osd-csrf':'dashboard'},{...headers,'x-osd-csrf':''}]){expect((await app.request('/api/admin/crm/tasks',{method:'POST',headers:h,body:JSON.stringify({title:'Action'})})).status).toBe(403)}});
 it('enregistre une fiche et une note puis relit les valeurs exactes',async()=>{const app=createApp();const content={display_name:'Cliente de démonstration',company:'Entreprise fictive',stage:'en_attente',internal:false};expect((await app.request(`/api/admin/crm/customers/${buyer}`,{method:'PATCH',headers,body:JSON.stringify(content)})).status).toBe(200);const text='<img src=x onerror=alert(1)> Un besoin confirmé';expect((await app.request(`/api/admin/crm/customers/${buyer}/notes`,{method:'POST',headers,body:JSON.stringify({body:text})})).status).toBe(201);const r=await app.request(`/api/admin/crm/customers/${buyer}`,{headers});const body=await r.json();expect(body.customer.company).toBe('Entreprise fictive');expect(body.notes[0].body).toBe(text);expect(body).not.toHaveProperty('sessions')});
 it('enregistre une préférence et relit son effet réel sur les prochains mails',async()=>{const app=createApp(),path=`/api/admin/crm/customers/${buyer}/language`;expect((await app.request(path,{method:'PATCH',headers,body:JSON.stringify({code:'en'})})).status).toBe(200);const body=await(await app.request(`/api/admin/crm/customers/${buyer}`,{headers})).json();expect(body.customer.language).toMatchObject({code:'en',source:'manual',transactional_code:'en'});expect(body.customer.locale).toBe('en');expect((await app.request(path,{method:'PATCH',headers,body:JSON.stringify({code:'xx'})})).status).toBe(400);expect((await app.request(path,{method:'PATCH',headers:{...headers,'x-osd-csrf':''},body:JSON.stringify({code:'fr'})})).status).toBe(403)});
 it('protège aussi la traduction et ne renvoie jamais le texte aux non-administrateurs',async()=>{const app=createApp(),path='/api/admin/crm/mail/translate',body=JSON.stringify({language:'fr',text:'Texte privé fictif.'});for(const [h,status] of [[{},401],[{cookie:`osd_session=${other}`},403],[{...headers,'x-osd-csrf':''},403]] as const){const r=await app.request(path,{method:'POST',headers:h,body});expect(r.status).toBe(status);expect(await r.text()).not.toContain('Texte privé')}const r=await app.request(path,{method:'POST',headers,body});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store, no-transform');expect(await r.text()).toContain('Texte privé fictif.');expect((await app.request(path,{method:'POST',headers,body:JSON.stringify({language:'en',text:'x'.repeat(5001)})})).status).toBe(400)});
 it('crée une action datée et enregistre sa réalisation',async()=>{const app=createApp();const r=await app.request('/api/admin/crm/tasks',{method:'POST',headers,body:JSON.stringify({title:'Vérifier un besoin',customer_id:buyer,due_on:'2026-09-28'})});const task=await r.json();expect(r.status).toBe(201);expect((await app.request('/api/admin/crm/tasks/'+task.id,{method:'PATCH',headers,body:JSON.stringify({done:true})})).status).toBe(200);const o=await(await app.request('/api/admin/crm/overview',{headers})).json();expect(o.tasks).toHaveLength(0);expect(getDb().prepare('SELECT done_at FROM crm_tasks WHERE id=?').get(task.id)).toMatchObject({done_at:expect.any(Number)})});
 it('valide les identifiants, la taille et les données de suivi',async()=>{const app=createApp();expect((await app.request('/api/admin/crm/customers/2%20OR%201=1',{headers})).status).toBe(400);expect((await app.request('/api/admin/crm/tasks',{method:'POST',headers,body:JSON.stringify({title:'x'.repeat(20000)})})).status).toBe(413);expect((await app.request('/api/admin/crm/tasks',{method:'POST',headers,body:JSON.stringify({title:'Test',customer_id:99999})})).status).toBe(404)});
 it('sépare les mesures des pages et des appels API',async()=>{const now=Date.now(),db=getDb();for(const ua of ['desktop','mobile','bot','automation'])db.prepare("INSERT INTO events(kind,name,ua_class,visitor_hash,meta_json,ts) VALUES('custom','page_view',?,?,?,?)").run(ua,ua,'{"path":"/datasets/finma"}',now);db.prepare("INSERT INTO events(kind,name,ua_class,visitor_hash,ts) VALUES('api_request','/api/catalog/finma','desktop','not-a-page',?)").run(now);const body=await(await createApp().request('/api/admin/crm/overview',{headers})).json();expect(body.web.pageviews).toBe(2);expect(body.web.visitor_days).toBe(2);expect(body.traffic.requests).toBe(1)});
 it('ne transforme pas une connexion Google absente en zéro clic',async()=>{const body=await(await createApp().request('/api/admin/crm/visibility',{headers})).json();expect(body.available).toBe(false);expect(body.total).toBeUndefined()});
 it('refuse un JSON mal formé sans provoquer de rapport avec le cookie',async()=>{const r=await createApp().request('/api/admin/crm/tasks',{method:'POST',headers,body:'{'});expect(r.status).toBe(400)});
 it('chiffre les mots de passe et détecte une altération',()=>{const encrypted=seal('mot-de-passe-fictif');expect(encrypted).not.toContain('mot-de-passe');expect(unseal(encrypted)).toBe('mot-de-passe-fictif');const bytes=Buffer.from(encrypted,'base64');bytes[40]^=1;expect(()=>unseal(bytes.toString('base64'))).toThrow()});
 it('refuse une connexion à une boîte non autorisée',async()=>{const r=await createApp().request('/api/admin/crm/mail/connect',{method:'POST',headers,body:JSON.stringify({user:'autre@example.test',pass:'fictif'})});expect(r.status).toBe(400)});
});
