import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb,closeDb } from '../../src/lib/db.js';
import { createApp } from '../../src/index.js';
const now=Date.parse('2026-09-25T22:30:00Z');
const headers={cookie:'osd_session='+'D'.repeat(43),origin:'https://www.openswissdata.com','content-type':'application/json','x-osd-csrf':'dashboard'};
describe('Parcours complet des tâches ouvertes et clôturées',()=>{
 let root:string;
 beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'osd-taches-pages-'));vi.stubEnv('DATABASE_PATH',join(root,'fictive.sqlite'));vi.stubEnv('ADMIN_EMAILS','owner@example.test');vi.stubEnv('BASE_URL','https://www.openswissdata.com');vi.spyOn(Date,'now').mockReturnValue(now);const db=getDb();db.prepare("INSERT INTO customers(id,email,created_at) VALUES(1,'owner@example.test',?),(2,'client@example.test',?)").run(now,now);db.prepare('INSERT INTO sessions(token,customer_id,expires_at,created_at) VALUES(?,1,?,?)').run('D'.repeat(43),now+86400000,now)});
 afterEach(()=>{closeDb();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true})});
 const add=(title:string,due:string|null=null,done:number|null=null,cid:number|null=null)=>Number(getDb().prepare('INSERT INTO crm_tasks(title,due_on,done_at,customer_id,created_at) VALUES(?,?,?,?,?)').run(title,due,done,cid,now).lastInsertRowid);
 const search=(body:unknown={},custom=headers)=>createApp().request('/api/admin/crm/tasks/search',{method:'POST',headers:custom,body:JSON.stringify(body)});
 it('parcourt plus de cent tâches sans omission ni doublon à dates identiques',async()=>{
  for(let i=0;i<123;i++)add('Suivi fictif '+i,'2026-09-26');const ids:number[]=[];
  for(let page=1;page<=3;page++){const r=await search({page});expect(r.status).toBe(200);const d=await r.json();expect(d.page).toMatchObject({total:123,total_pages:3,number:page,returned:page===3?23:50});ids.push(...d.tasks.map((t:{id:number})=>t.id))}
  expect(ids).toEqual(Array.from({length:123},(_,i)=>123-i));expect(new Set(ids).size).toBe(123);
 });
 it('sépare chaque échéance réelle, date invalide et clôture selon le jour suisse',async()=>{
  const late=add('Retard','2026-09-25'),today=add('Du jour','2026-09-26'),later=add('Suite','2026-09-27'),undated=add('Sans date'),invalid=add('Impossible','2026-02-31'),done=add('Clôturée','2026-09-25',now),epoch=add('Clôture ancienne',null,0);
  const expected:Record<string,number[]>={open:[invalid,late,today,later,undated],due:[invalid,late,today],overdue:[late],today:[today],later:[later],undated:[undated],invalid:[invalid],done:[done,epoch]};
  for(const [status,ids] of Object.entries(expected)){const d=await(await search({status})).json();expect(d.today).toBe('2026-09-26');expect(d.tasks.map((t:{id:number})=>t.id)).toEqual(ids);expect(d.page.total).toBe(ids.length);expect(d.task_summary).toEqual({open:5,overdue:1,today:1,later:1,undated:1,invalid:1})}
 });
 it('cherche titre, personne, entreprise et mail sans accent, littéralement',async()=>{
  getDb().prepare("INSERT INTO crm_profiles(customer_id,display_name,company,updated_at) VALUES(2,'Élodie Fictive','Société Straße',?)").run(now);const id=add("Répondre _100% <img> O'Connor",null,null,2);add('Autre');
  for(const q of ['REPONDRE','elodie','STRASSE','client@example.test','_100%',"O'Connor",'<img>'])expect((await(await search({q})).json()).tasks.map((t:{id:number})=>t.id)).toEqual([id]);
  expect((await(await search({q:"' OR 1=1 --"})).json()).page.total).toBe(0);
 });
 it('borne les pages sur les résultats filtrés et ne prend pas les clôtures pour des tâches ouvertes',async()=>{
  for(let i=0;i<62;i++)add('Terminée '+i,null,now+i);for(let i=0;i<5;i++)add('Ouverte '+i);
  let d=await(await search({status:'done',page:99})).json();expect(d.page).toMatchObject({number:2,total_pages:2,total:62,returned:12,has_next:false});expect(d.task_summary.open).toBe(5);
  d=await(await search({status:'done',q:'introuvable',page:99})).json();expect(d.page).toMatchObject({number:1,total:0,returned:0,has_next:false,has_previous:false});
 });
 it('relit une réouverture explicite sans recréer une tâche ni changer son échéance',async()=>{
  const id=add('À reprendre','2026-09-26',now,2);const r=await createApp().request('/api/admin/crm/tasks/'+id,{method:'PATCH',headers,body:JSON.stringify({done:false})});expect(r.status).toBe(200);
  expect((await(await search({status:'done'})).json()).page.total).toBe(0);const d=await(await search({status:'today'})).json();expect(d.tasks).toHaveLength(1);expect(d.tasks[0]).toMatchObject({id,done_at:null,due_on:'2026-09-26'});
 });
 it('date la fiche client avec le jour suisse de sa propre lecture',async()=>{
  add('Jour de la fiche','2026-09-26',null,2);const r=await createApp().request('/api/admin/crm/customers/2',{headers});expect(r.status).toBe(200);const d=await r.json();expect(d.today).toBe('2026-09-26');expect(d.tasks).toHaveLength(1);
 });
 it('combine le filtre et le texte, y compris les actions des comptes internes',async()=>{
  const internal=add('Rapport annuel','2026-09-26',null,1),closed=add('Rapport annuel','2026-09-25',now,2);add('Rapport futur','2026-09-27');add('Autre clôture',null,now);
  expect((await(await search({q:'rapport',status:'due'})).json()).tasks.map((t:{id:number})=>t.id)).toEqual([internal]);
  expect((await(await search({q:'rapport',status:'done'})).json()).tasks.map((t:{id:number})=>t.id)).toEqual([closed]);
 });
 it('refuse un état devenu obsolète sans modifier la clôture ni la date',async()=>{
  const id=add('Concurrence','2026-09-26');const patch=(body:unknown)=>createApp().request('/api/admin/crm/tasks/'+id,{method:'PATCH',headers,body:JSON.stringify(body)});
  const expected_state={done_at:null,due_on:'2026-09-26'};
  let r=await patch({due_on:'2026-10-01',expected_state});expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true,changed:true});
  r=await patch({done:true,due_on:null,expected_state});expect(r.status).toBe(409);expect(await r.json()).toEqual({error:'task_conflict'});
  expect(getDb().prepare('SELECT done_at,due_on FROM crm_tasks WHERE id=?').get(id)).toEqual({done_at:null,due_on:'2026-10-01'});
  r=await patch({done:true,expected_state:{done_at:null,due_on:'2026-10-01'}});expect(r.status).toBe(200);
  r=await patch({due_on:'2026-10-02',expected_state:{done_at:null,due_on:'2026-10-01'}});expect(r.status).toBe(409);
  expect(getDb().prepare('SELECT done_at,due_on FROM crm_tasks WHERE id=?').get(id)).toEqual({done_at:now,due_on:'2026-10-01'});
 });
 it('signale les répétitions sans réécrire et accepte un ancien état à zéro',async()=>{
  const id=add('Ancienne clôture','2026-02-31',0);const patch=(body:unknown)=>createApp().request('/api/admin/crm/tasks/'+id,{method:'PATCH',headers,body:JSON.stringify(body)});
  let r=await patch({done:true,expected_state:{done_at:0,due_on:'2026-02-31'}});expect(await r.json()).toEqual({ok:true,changed:false});
  r=await patch({due_on:'2026-09-26',expected_state:{done_at:0,due_on:'2026-02-31'}});expect(await r.json()).toEqual({ok:true,changed:true});
  expect(getDb().prepare('SELECT done_at FROM crm_tasks WHERE id=?').get(id)).toEqual({done_at:0});
  r=await patch({done:false,expected_state:{done_at:0,due_on:'2026-09-26'}});expect(await r.json()).toEqual({ok:true,changed:true});
  r=await patch({done:false,expected_state:{done_at:null,due_on:'2026-09-26'}});expect(await r.json()).toEqual({ok:true,changed:false});
  r=await patch({done:true,expected_state:{done_at:null,due_on:'2026-09-26',unknown:1}});expect(r.status).toBe(400);
 });
 it.each([{page:0},{page:1000001},{page:2.4},{page:'2'},{status:'all'},{q:'x'.repeat(181)},{q:'\u0301'},{q:'x\u0000y'},{unknown:true}])('refuse un filtre non prévu %j',async body=>expect((await search(body)).status).toBe(400));
 it('garde les contrôles administrateur, JSON, origine, CSRF, taille et annulation',async()=>{
  expect((await search({}, {...headers,cookie:''})).status).toBe(401);getDb().prepare('INSERT INTO sessions(token,customer_id,created_at,expires_at) VALUES(?,2,?,?)').run('E'.repeat(43),now,now+1000);let r=await search({}, {...headers,cookie:'osd_session='+'E'.repeat(43)});expect(r.status).toBe(403);expect(await r.json()).toEqual({error:'forbidden'});
  for(const custom of [{...headers,origin:''},{...headers,'x-osd-csrf':''},{...headers,'content-type':'text/plain'}]){r=await search({},custom);expect(r.status).toBe(403);expect(await r.json()).toEqual({error:'origin_forbidden'})}
  expect((await search({q:'x'.repeat(17000)})).status).toBe(413);r=await createApp().request('/api/admin/crm/tasks/search',{method:'POST',headers,body:'{invalide'});expect(r.status).toBe(400);
  const controller=new AbortController();controller.abort();expect((await createApp().fetch(new Request('https://www.openswissdata.com/api/admin/crm/tasks/search',{method:'POST',headers,body:'{}',signal:controller.signal}))).status).toBe(499);
  r=await search();expect(r.headers.get('cache-control')).toBe('private, no-store');
 });
});
