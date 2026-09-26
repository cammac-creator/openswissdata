import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getDb,closeDb} from '../../src/lib/db.js';
import {createApp} from '../../src/index.js';
import {observeDeliveryIncident} from '../../src/lib/delivery-incidents.js';
const now=Date.parse('2026-09-26T12:00:00Z'),cookie='osd_session='+'D'.repeat(43);
describe('Consultation privée du registre de livraison',()=>{
 let root:string;
 beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),'osd-crm-incidents-'));vi.stubEnv('DATABASE_PATH',join(root,'fictive.sqlite'));vi.stubEnv('ADMIN_EMAILS','owner@example.test');vi.spyOn(Date,'now').mockReturnValue(now);
  const db=getDb();db.prepare("INSERT INTO customers(id,email,created_at) VALUES(1,'owner@example.test',?),(2,'client@example.test',?)").run(now,now);db.prepare('INSERT INTO sessions(token,customer_id,expires_at,created_at) VALUES(?,1,?,?),(?,2,?,?)').run('D'.repeat(43),now+86400000,now,'E'.repeat(43),now+86400000,now);db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,current_version,created_at) VALUES('fictif','Exemple fictif','fictif',100,'price_fictif','v1',?)").run(now);
 });
 afterEach(()=>{closeDb();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true})});
 const add=(id:number)=>{const db=getDb();db.prepare("INSERT INTO orders(id,customer_id,stripe_session_id,amount_chf,items_json,created_at) VALUES(?,2,?,100,'[]',?)").run(id,'cs_test_fictif_'+id,now);db.prepare("INSERT INTO order_deliveries(id,order_id,dataset_id,state,attempts,next_attempt_at,last_error,payload_json,download_token,provider_message_id,created_at) VALUES(?,?,'fictif','pending',1,?,'resend_error','corps-secret','jeton-secret','prestataire-secret',?)").run(id,id,now,now)};
 const read=(path='/incidents',token=cookie)=>createApp().request('/api/admin/crm'+path,{headers:{cookie:token}});
 it('ne crée aucun incident ni worker lors d’une lecture',async()=>{
  add(1);const r=await read();expect(r.status).toBe(200);expect(await r.json()).toMatchObject({summary:{open:0,accepted:0,cancelled:0},scan:null,page:{total:0}});expect((getDb().prepare('SELECT COUNT(*) n FROM delivery_incidents').get() as {n:number}).n).toBe(0);
 });
 it('parcourt tous les incidents avec un tri stable, sans exposer les secrets de livraison',async()=>{
  for(let id=1;id<=63;id++){add(id);observeDeliveryIncident(getDb(),id,now)}
  const ids:number[]=[];
  for(const page of [1,2,3,4]){const r=await read('/incidents?page='+page);expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');const d=await r.json();expect(d.page).toMatchObject({number:page,total:63,returned:page===4?3:20});ids.push(...d.incidents.map((x:{id:number})=>x.id));expect(JSON.stringify(d)).not.toContain('secret');expect(JSON.stringify(d)).not.toContain('client@example.test')}
  expect(ids).toEqual(Array.from({length:63},(_,i)=>63-i));expect(new Set(ids).size).toBe(63);expect((await(await read('/incidents?page=999')).json()).page.number).toBe(4);
 });
 it('sépare blocage, acceptation et annulation',async()=>{
  for(let id=1;id<=3;id++){add(id);observeDeliveryIncident(getDb(),id,now)}
  getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=2").run(now);observeDeliveryIncident(getDb(),2,now);getDb().prepare("UPDATE orders SET status='refunded' WHERE id=3").run();getDb().prepare("UPDATE order_deliveries SET state='cancelled' WHERE id=3").run();observeDeliveryIncident(getDb(),3,now);
  for(const [state,id] of [['open',1],['accepted',2],['cancelled',3]]){const d=await(await read('/incidents?state='+state)).json();expect(d.summary).toEqual({open:1,accepted:1,cancelled:1});expect(d.incidents.map((i:{delivery_id:number})=>i.delivery_id)).toEqual([id])}
 });
 it('parcourt les observations par curseur sans doublon',async()=>{
  add(1);for(let n=1;n<=63;n++){getDb().prepare('UPDATE order_deliveries SET attempts=? WHERE id=1').run(n);observeDeliveryIncident(getDb(),1,now+n)}
  const first=await(await read('/incidents/1/events')).json();expect(first.events).toHaveLength(50);expect(first.has_more).toBe(true);expect(first.retention_days).toBe(180);const second=await(await read('/incidents/1/events?before='+first.next_before)).json();expect(second.events).toHaveLength(13);expect(second.has_more).toBe(false);expect(new Set([...first.events,...second.events].map(e=>e.id)).size).toBe(63);expect((await read('/incidents/999/events')).status).toBe(404);
 });
 it.each(['/incidents?state=all','/incidents?page=0','/incidents?page=1.5','/incidents?page=1000001','/incidents?extra=true','/incidents/1/events?before=0','/incidents/1/events?before=x','/incidents/1/events?unknown=1','/incidents/abc/events'])('refuse les paramètres invalides %s',async path=>expect((await read(path)).status).toBe(400));
 it('refuse la lecture anonyme et celle d’un client non administrateur',async()=>{
  for(const path of ['/incidents','/incidents/1/events']){expect((await read(path,'')).status).toBe(401);expect((await read(path,'osd_session='+'E'.repeat(43))).status).toBe(403)}
 });
 it('une panne du registre laisse les autres données du bureau accessibles',async()=>{
  getDb().exec('DROP TABLE delivery_incident_events; DROP TABLE delivery_incidents');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:503})));
  try{const r=await read('/operations');expect(r.status).toBe(200);const d=await r.json();expect(d.incidents).toBeNull();expect(d.datasets).toHaveLength(1)}finally{vi.unstubAllGlobals()}
 });
 const write=(id=1,body:unknown={due_on:null},headers:Record<string,string>={})=>createApp().request('/api/admin/crm/incidents/'+id+'/task',{method:'POST',headers:{cookie,origin:'https://www.openswissdata.com','content-type':'application/json','x-osd-csrf':'dashboard',...headers},body:JSON.stringify(body)});
 it('crée une action unique malgré deux demandes simultanées et la retrouve dans la fiche exacte',async()=>{
  vi.stubEnv('BASE_URL','https://www.openswissdata.com');add(1);observeDeliveryIncident(getDb(),1,now);
  const responses=await Promise.all([write(1,{due_on:'2026-09-28'}),write(1,{due_on:'2026-09-28'})]);expect(responses.map(r=>r.status).sort()).toEqual([200,201]);
  const bodies=await Promise.all(responses.map(r=>r.json()));expect(new Set(bodies.map(b=>b.task.id)).size).toBe(1);expect(bodies[0].task.customer_id).toBe(2);
  const detail=await(await read('/customers/2')).json();expect(detail.tasks).toHaveLength(1);expect(detail.tasks[0].due_on).toBe('2026-09-28');
  const page=await(await read()).json();expect(page.incidents[0].task.id).toBe(detail.tasks[0].id);expect(page.incidents[0].state).toBe('open');expect(responses[0].headers.get('cache-control')).toBe('private, no-store');
  expect(getDb().prepare('SELECT created_by FROM delivery_incident_tasks').get()).toEqual({created_by:1});
 });
 it('protège la création par session, origine et CSRF avant toute écriture',async()=>{
  vi.stubEnv('BASE_URL','https://www.openswissdata.com');add(1);observeDeliveryIncident(getDb(),1,now);
  for(const [headers,status] of [[{cookie:''},401],[{cookie:'osd_session='+'E'.repeat(43)},403],[{origin:'https://example.test'},403],[{'x-osd-csrf':''},403]] as const)expect((await write(1,{},headers)).status).toBe(status);
  expect((await write(1,{due_on:'2026-02-31'})).status).toBe(400);expect((await write(1,{created_by:2})).status).toBe(400);expect((await write(999)).status).toBe(404);
  expect(getDb().prepare('SELECT COUNT(*) n FROM crm_tasks').get()).toEqual({n:0});
 });
 it('refuse une nouvelle action si l’envoi est désormais accepté et ne modifie pas un rejeu existant',async()=>{
  vi.stubEnv('BASE_URL','https://www.openswissdata.com');add(1);observeDeliveryIncident(getDb(),1,now);getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(now);expect((await write()).status).toBe(409);
  add(2);observeDeliveryIncident(getDb(),2,now);const first=await(await write(2)).json();getDb().prepare('UPDATE crm_tasks SET done_at=? WHERE id=?').run(now,first.task.id);
  const again=await(await write(2,{due_on:'2026-10-01'})).json();expect(again.created).toBe(false);expect(again.task).toMatchObject({id:first.task.id,done_at:now,due_on:null});expect((await(await read()).json()).incidents.find(i=>i.delivery_id===2).state).toBe('open');
 });
 it('retourne un conflit explicite lors d’un recul d’horloge, sans créer d’action',async()=>{
  vi.stubEnv('BASE_URL','https://www.openswissdata.com');add(1);observeDeliveryIncident(getDb(),1,now+1);
  const response=await write();expect(response.status).toBe(409);expect(await response.json()).toEqual({error:'incident_clock_pending'});expect(getDb().prepare('SELECT COUNT(*) n FROM crm_tasks').get()).toEqual({n:0});
 });

});
