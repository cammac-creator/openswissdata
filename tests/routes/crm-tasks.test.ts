import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb,closeDb } from '../../src/lib/db.js';
import { createApp } from '../../src/index.js';
import { isCalendarDate } from '../../src/lib/calendar-date.js';
import { readTaskOverview } from '../../src/lib/crm-tasks.js';

const headers={cookie:'osd_session='+ 'D'.repeat(43),origin:'https://www.openswissdata.com','content-type':'application/json','x-osd-csrf':'dashboard'};
const now=Date.parse('2026-09-25T22:30:00Z');
const dates:Array<[string,boolean]>=[['2026-02-31',false],['2026-02-29',false],['2024-02-29',true],['2000-02-29',true],['1900-02-29',false],['2100-02-29',false],['2026-04-31',false],['2026-13-01',false],['2026-00-01',false],['2026-09-00',false],['2026-9-2',false],['0000-01-01',false],['0001-01-01',true],['9999-12-31',true],['10000-01-01',false],['<img src=x>',false],['',false],['2026-09-26T00:00:00Z',false]];

describe('Actions complètes et échéances du bureau',()=>{
 let root:string;
 beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),'osd-actions-'));vi.stubEnv('DATABASE_PATH',join(root,'fictive.sqlite'));vi.stubEnv('ADMIN_EMAILS','owner@example.test');vi.stubEnv('BASE_URL','https://www.openswissdata.com');vi.spyOn(Date,'now').mockReturnValue(now);
  const db=getDb();db.prepare("INSERT INTO customers(id,email,created_at) VALUES(1,'owner@example.test',?)").run(now);db.prepare('INSERT INTO sessions(token,customer_id,expires_at,created_at) VALUES(?,1,?,?)').run('D'.repeat(43),now+86400000,now);
 });
 afterEach(()=>{closeDb();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true})});
 const insert=(due:string|null,done=false)=>Number(getDb().prepare('INSERT INTO crm_tasks(title,due_on,done_at,created_at) VALUES(?,?,?,?)').run('Action fictive',due,done?now:null,now).lastInsertRowid);
 const patch=(id:number,body:unknown,custom=headers)=>createApp().request('/api/admin/crm/tasks/'+id,{method:'PATCH',headers:custom,body:JSON.stringify(body)});
 it.each(dates)('valide réellement %s (%s) et classe de la même façon les anciennes données SQL',async(value,valid)=>{
  expect(isCalendarDate(value)).toBe(valid);const r=await createApp().request('/api/admin/crm/tasks',{method:'POST',headers,body:JSON.stringify({title:'Fictif',due_on:value})});expect(r.status).toBe(valid?201:400);
  getDb().prepare('DELETE FROM crm_tasks').run();insert(value);expect(readTaskOverview(getDb(),'2026-09-26').task_summary.invalid).toBe(valid?0:1);
 });
 it('calcule tous les totaux même si plus de cent tâches restent ouvertes',()=>{
  for(let i=0;i<101;i++)insert('2026-09-25');insert('2026-09-26');insert('2026-09-27');insert(null);const invalid=insert('2026-02-31');insert('2026-09-20',true);
  const result=readTaskOverview(getDb(),'2026-09-26');expect(result.task_summary).toEqual({open:105,overdue:101,today:1,later:1,undated:1,invalid:1});
  expect(result.tasks).toHaveLength(100);expect(result.tasks.some(t=>(t as {due_on:string}).due_on==='2026-09-26')).toBe(false);expect(result.tasks[0]).toMatchObject({id:invalid});expect(result.task_list).toEqual({returned:100,total:105,limit:100,truncated:true});
 });
 it('définit aujourd’hui par le calendrier suisse même avant minuit UTC',async()=>{
  insert('2026-09-25');insert('2026-09-26');insert('2026-09-27');const r=await createApp().request('/api/admin/crm/overview?days=7',{headers});expect(r.status).toBe(200);const body=await r.json();
  expect(body.period.end).toBe('2026-09-26');expect(body.task_summary).toMatchObject({overdue:1,today:1,later:1,open:3});
 });
 it('permet de corriger une échéance impossible ou de la retirer sans clôturer la tâche',async()=>{
  const id=insert('2026-02-31');expect((await patch(id,{due_on:'2026-09-28'})).status).toBe(200);expect(getDb().prepare('SELECT due_on,done_at FROM crm_tasks WHERE id=?').get(id)).toEqual({due_on:'2026-09-28',done_at:null});
  expect((await patch(id,{due_on:null})).status).toBe(200);expect(getDb().prepare('SELECT due_on,done_at FROM crm_tasks WHERE id=?').get(id)).toEqual({due_on:null,done_at:null});
 });
 it('modifier une échéance ne rouvre pas une tâche terminée',async()=>{
  const id=insert('2026-09-25',true);expect((await patch(id,{due_on:'2026-09-30'})).status).toBe(200);expect(getDb().prepare('SELECT due_on,done_at FROM crm_tasks WHERE id=?').get(id)).toEqual({due_on:'2026-09-30',done_at:now});
 });
 it('refuse un changement vide, impossible ou non prévu sans altérer la date',async()=>{
  const id=insert('2026-09-25');for(const body of [{},{due_on:'2026-02-31'},{due_on:12},{due_on:'2026-09-28',title:'autre'}])expect((await patch(id,body)).status).toBe(400);
  expect(getDb().prepare('SELECT due_on FROM crm_tasks WHERE id=?').get(id)).toEqual({due_on:'2026-09-25'});expect((await patch(99999,{due_on:null})).status).toBe(404);
 });
 it('conserve les contrôles de session et de même origine sur les modifications d’échéance',async()=>{
  const id=insert('2026-09-25');expect((await patch(id,{due_on:null},{...headers,cookie:''})).status).toBe(401);expect((await patch(id,{due_on:null},{...headers,origin:'https://exemple-invalide.test'})).status).toBe(403);expect((await patch(id,{due_on:null},{...headers,'x-osd-csrf':''})).status).toBe(403);
  expect(getDb().prepare('SELECT due_on FROM crm_tasks WHERE id=?').get(id)).toEqual({due_on:'2026-09-25'});
 });
 it('garde la clôture et la réouverture explicites compatibles',async()=>{
  const id=insert(null);expect((await patch(id,{done:true})).status).toBe(200);expect(readTaskOverview(getDb(),'2026-09-26').task_summary.open).toBe(0);
  expect((await patch(id,{done:false,due_on:'2026-09-26'})).status).toBe(200);expect(readTaskOverview(getDb(),'2026-09-26').task_summary.today).toBe(1);
 });
 it('garde la première clôture lors d’une nouvelle demande, y compris avec une échéance',async()=>{
  const id=insert(null);expect((await patch(id,{done:true,due_on:'2026-09-26'})).status).toBe(200);
  vi.mocked(Date.now).mockReturnValue(now+1000);expect((await patch(id,{done:true,due_on:'2026-09-28'})).status).toBe(200);
  expect(getDb().prepare('SELECT due_on,done_at FROM crm_tasks WHERE id=?').get(id)).toEqual({due_on:'2026-09-28',done_at:now});
 });
 it('refuse les valeurs non textuelles et classe un ancien nombre converti par SQLite',()=>{
  expect(isCalendarDate(20260926)).toBe(false);expect(isCalendarDate(null)).toBe(false);expect(isCalendarDate({})).toBe(false);
  getDb().prepare('INSERT INTO crm_tasks(title,due_on,created_at) VALUES(?,?,?)').run('Date numérique',20260926,now);
  expect(getDb().prepare('SELECT typeof(due_on) type FROM crm_tasks').get()).toEqual({type:'text'});expect(readTaskOverview(getDb(),'2026-09-26').task_summary.invalid).toBe(1);
 });
 it('présente les tâches de la fiche client dans le même ordre que la liste globale',async()=>{
  const undated=insert(null),later=insert('2026-09-27'),today=insert('2026-09-26'),late=insert('2026-09-25'),invalid=insert('2026-02-31'),done=insert('2026-01-01',true);
  getDb().prepare('UPDATE crm_tasks SET customer_id=1').run();
  const r=await createApp().request('/api/admin/crm/customers/1',{headers});expect(r.status).toBe(200);
  expect((await r.json()).tasks.map((t:{id:number})=>t.id)).toEqual([invalid,late,today,later,undated,done]);
 });
 it('distingue le total de clients payants de la liste limitée à mille fiches',async()=>{
  const db=getDb(),customer=db.prepare('INSERT INTO customers(id,email,created_at) VALUES(?,?,?)'),order=db.prepare("INSERT INTO orders(customer_id,stripe_session_id,amount_chf,items_json,status,created_at) VALUES(?,?,100,'[]','paid',?)");
  db.transaction(()=>{for(let i=2;i<=1003;i++){customer.run(i,'fictif'+i+'@example.test',now-i);order.run(i,'cs_live_fictive_'+i,now-1)}})();
  const r=await createApp().request('/api/admin/crm/overview',{headers});expect(r.status).toBe(200);const d=await r.json();expect(d.customers).toHaveLength(1000);expect(d.customer_list).toEqual({returned:1000,total:1003,limit:1000,truncated:true});expect(d.all_time.customers).toBe(1002);
 });
});
