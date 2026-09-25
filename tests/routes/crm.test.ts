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
  expect(partial.revenue.revenue_cents).toBe(24900);expect(partial.daily[0].revenue_cents).toBe(24900);
  expect(partial.customers.find((c:{id:number})=>c.id===buyer).revenue_cents).toBe(24900);
  const detail=await(await app.request(`/api/admin/crm/customers/${buyer}`,{headers})).json();
  expect(detail.orders.find((o:{stripe_session_id:string})=>o.stripe_session_id==='cs_live_buyer').refunded_chf).toBe(5000);
  db.prepare("UPDATE orders SET status='disputed',dispute_status='needs_response' WHERE stripe_session_id='cs_live_buyer'").run();
  const contested=await(await app.request('/api/admin/crm/overview',{headers})).json();
  expect(contested.revenue.revenue_cents).toBe(0);expect(contested.revenue.orders).toBe(0);
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
