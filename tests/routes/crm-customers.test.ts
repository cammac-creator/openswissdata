import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb,closeDb } from '../../src/lib/db.js';
import { createApp } from '../../src/index.js';
const now=Date.parse('2026-09-26T10:00:00Z');
const headers={cookie:'osd_session'+'='+ 'D'.repeat(43),origin:'https://www.openswissdata.com','content-type':'application/json','x-osd-csrf':'dashboard'};
describe('Recherche exhaustive des fiches clients privées',()=>{
 let root:string;
 beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),'osd-clients-'));vi.stubEnv('DATABASE_PATH',join(root,'fictive.sqlite'));vi.stubEnv('ADMIN_EMAILS','OWNER@example.test');vi.stubEnv('CRM_INTERNAL_EMAILS','staff@example.test');vi.stubEnv('BASE_URL','https://www.openswissdata.com');vi.spyOn(Date,'now').mockReturnValue(now);
  const db=getDb();db.prepare("INSERT INTO customers(id,email,created_at) VALUES(1,'owner@example.test',?)").run(now);db.prepare('INSERT INTO sessions(token,customer_id,expires_at,created_at) VALUES(?,1,?,?)').run('D'.repeat(43),now+86400000,now);
 });
 afterEach(()=>{closeDb();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true})});
 const search=(body:unknown={},custom=headers)=>createApp().request('/api/admin/crm/customers/search',{method:'POST',headers:custom,body:JSON.stringify(body)});
 const add=(email:string,at=now)=>Number(getDb().prepare('INSERT INTO customers(email,created_at) VALUES(?,?)').run(email,at).lastInsertRowid);
 const order=(id:number,mode='live',at=now)=>getDb().prepare("INSERT INTO orders(customer_id,stripe_session_id,amount_chf,items_json,status,created_at) VALUES(?,?,29900,'[]','paid',?)").run(id,`cs_${mode}_fictif_${id}_${at}`,at);
 it('permet de parcourir plus de mille fiches sans doublon ni omission, à classement égal',async()=>{
  getDb().transaction(()=>{for(let i=0;i<1003;i++)add(`personne${i}@example.test`)})();const ids:number[]=[];
  for(let page=1;page<=21;page++){
   const response=await search({page});expect(response.status).toBe(200);const d=await response.json();expect(d.page.total).toBe(1003);expect(d.page.number).toBe(page);expect(d.page.total_pages).toBe(21);expect(d.customers.length).toBe(page===21?3:50);ids.push(...d.customers.map((c:{id:number})=>c.id));
  }
  expect(ids).toHaveLength(1003);expect(new Set(ids).size).toBe(1003);expect(ids).toEqual(Array.from({length:1003},(_,i)=>1004-i));
 });
 it('retrouve une ancienne fiche absente des mille fiches de l’aperçu',async()=>{
  const old=add('ancienne@example.test',now-1);getDb().transaction(()=>{for(let i=0;i<1001;i++)add(`recent${i}@example.test`)})();
  const overview=await(await createApp().request('/api/admin/crm/overview',{headers})).json();expect(overview.customers.some((c:{id:number})=>c.id===old)).toBe(false);
  const d=await(await search({q:'ancienne'})).json();expect(d.page.total).toBe(1);expect(d.customers[0].id).toBe(old);
 });
 it('cherche nom, entreprise et état sans tenir compte des accents ni des majuscules',async()=>{
  const id=add('accent@example.test');getDb().prepare("INSERT INTO crm_profiles(customer_id,display_name,company,stage,updated_at) VALUES(?,'Élodie Démonstration','Société Écureuil Straße','a_recontacter',?)").run(id,now);
  for(const q of ['ELODIE','elodie','éLoDiE','societe ecureuil','STRASSE','STRAẞE','straße','À RECONTACTER','  accent@EXAMPLE.test  ']){
   const r=await search({q});expect(r.status).toBe(200);expect((await r.json()).customers.map((c:{id:number})=>c.id)).toEqual([id]);
  }
 });
 it('traite les caractères SQL et HTML comme du texte littéral',async()=>{
  const id=add('literal@example.test');getDb().prepare("INSERT INTO crm_profiles(customer_id,display_name,updated_at) VALUES(?,?,?)").run(id,"A_100% <img> O'Connor",now);
  for(const q of ['_','%','<img>',"O'Connor"])expect((await(await search({q})).json()).page.total).toBe(1);
  expect((await(await search({q:"' OR 1=1 --"})).json()).page.total).toBe(0);
 });
 it('sépare propriétaire, équipe, marquage interne et achats uniquement en mode test',async()=>{
  const staff=add('staff@example.test'),flagged=add('interne@example.test'),test=add('test@example.test'),mixed=add('mixte@example.test'),real=add('client@example.test');
  getDb().prepare('INSERT INTO crm_profiles(customer_id,internal,updated_at) VALUES(?,1,?)').run(flagged,now);order(test,'test');order(mixed,'test');order(mixed,'live');order(real);
  const normal=await(await search()).json();expect(normal.customers.map((c:{id:number})=>c.id).sort()).toEqual([mixed,real].sort());
  const all=await(await search({include_internal:true})).json();expect(all.page.total).toBe(6);for(const id of [1,staff,flagged,test])expect(all.customers.find((c:{id:number})=>c.id===id).internal).toBe(true);
 });
 it('préserve les montants et langues de la fiche consultable individuellement',async()=>{
  const id=add('achat@example.test');order(id);getDb().prepare('UPDATE orders SET refunded_chf=900 WHERE customer_id=?').run(id);
  const page=await(await search()).json(),detail=await(await createApp().request('/api/admin/crm/customers/'+id,{headers})).json();expect(page.customers[0]).toEqual(detail.customer);expect(page.customers[0].revenue_cents).toBe(29000);expect(page.customers[0].language.source).toBe('unknown');
 });
 it('classe selon le dernier achat puis la création et enfin l’identifiant',async()=>{
  const noOrder=add('sans@example.test',now+10),oldOrder=add('ancien-achat@example.test',now+20),newOrder=add('nouvel-achat@example.test',now-20);order(oldOrder,'live',now-1000);order(newOrder,'live',now-100);
  expect((await(await search()).json()).customers.map((c:{id:number})=>c.id)).toEqual([newOrder,oldOrder,noOrder]);
 });
 it('ramène une page devenue vide à la dernière page disponible',async()=>{
  for(let i=0;i<53;i++)add(`page${i}@example.test`);
  let d=await(await search({page:999})).json();expect(d.page).toMatchObject({number:2,total_pages:2,total:53,returned:3,has_next:false,has_previous:true});
  d=await(await search({page:999,q:'aucun-resultat'})).json();expect(d.page).toMatchObject({number:1,total_pages:1,total:0,returned:0,has_next:false,has_previous:false});
 });
 it.each([{page:0},{page:-1},{page:1.5},{page:1000001},{page:'2'},{q:'x'.repeat(181)},{q:'a\u0000b'},{q:'\u0301'},{include_internal:'true'},{unexpected:true}])('refuse les paramètres non prévus %j',async body=>expect((await search(body)).status).toBe(400));
 it('compare les adresses internes en casse Unicode sans confondre leurs accents',async()=>{
  vi.stubEnv('CRM_INTERNAL_EMAILS','e\u0301quipe@example.test,STAFF@example.test');const unicode=add('ÉQUIPE@example.test'),ascii=add('STAFF@example.test'),different=add('equipe@example.test');order(unicode);order(ascii);order(different);
  const d=await(await search()).json();expect(d.customers.map((c:{id:number})=>c.id)).toEqual([different]);
  expect((await(await search({q:'equipe'})).json()).page.total).toBe(1);const all=await(await search({q:'equipe',include_internal:true})).json();expect(all.page.total).toBe(2);expect(all.customers.find((c:{id:number})=>c.id===unicode).internal).toBe(true);
  const overview=await(await createApp().request('/api/admin/crm/overview',{headers})).json();expect(overview.revenue.customers).toBe(1);expect(overview.revenue.revenue_cents).toBe(29900);
 });
 it('pagine le résultat filtré et conserve la séparation des commandes de test',async()=>{
  getDb().transaction(()=>{for(let i=0;i<120;i++)add((i<60?'correspondance':'autre')+i+'@example.test')})();
  const d=await(await search({q:'correspondance',page:2})).json();expect(d.page).toMatchObject({number:2,total_pages:2,total:60,returned:10,has_previous:true,has_next:false});
  const id=add('test-seul@example.test');order(id,'test');expect((await(await search({q:'test-seul'})).json()).page.total).toBe(0);expect((await(await search({q:'test-seul',include_internal:true})).json()).page.total).toBe(1);
 });
 it('recherche tous les libellés de suivi et une ancienne valeur conservée',async()=>{
  for(const [stage,q] of [['nouveau','NOUVEAU'],['actif','ACTIF'],['en_attente','EN ATTENTE'],['clos','CLOS'],['historique','HISTORIQUE']]){
   const id=add(stage+'@example.test');getDb().prepare('INSERT INTO crm_profiles(customer_id,stage,updated_at) VALUES(?,?,?)').run(id,stage,now);
   expect((await(await search({q})).json()).customers.some((c:{id:number})=>c.id===id)).toBe(true);
  }
 });
 it('ne confond pas un préfixe Stripe voisin avec un mode réel',async()=>{
  const id=add('prefixe@example.test');order(id,'test');getDb().prepare("INSERT INTO orders(customer_id,stripe_session_id,amount_chf,items_json,status,created_at) VALUES(?,'csXliveXfictif',29900,'[]','paid',?)").run(id,now);
  expect((await(await search()).json()).page.total).toBe(0);const all=await(await search({include_internal:true,q:'prefixe'})).json();expect(all.customers[0]).toMatchObject({internal:true,live_orders:0,test_orders:1,paid_orders:0});
  const overview=await(await createApp().request('/api/admin/crm/overview',{headers})).json();expect(overview.revenue.customers).toBe(0);
 });
 it('refuse client non administrateur, session expirée, mauvaise origine et format',async()=>{
  const id=add('sans-role@example.test'),db=getDb();db.prepare('INSERT INTO sessions(token,customer_id,created_at,expires_at) VALUES(?,?,?,?)').run('E'.repeat(43),id,now,now+1000);
  let r=await search({}, {...headers,cookie:'osd_session='+'E'.repeat(43)});expect(r.status).toBe(403);expect(await r.json()).toEqual({error:'forbidden'});
  db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(now-1,'E'.repeat(43));expect((await search({}, {...headers,cookie:'osd_session='+'E'.repeat(43)})).status).toBe(401);
  for(const custom of [{...headers,origin:''},{...headers,'content-type':'text/plain'},{...headers,'x-osd-csrf':''}]){r=await search({},custom);expect(r.status).toBe(403);expect(await r.json()).toEqual({error:'origin_forbidden'})}
  r=await createApp().request('/api/admin/crm/customers/search',{method:'POST',headers,body:'{invalide'});expect(r.status).toBe(400);
  expect((await search({q:'x'.repeat(17000)})).status).toBe(413);
 });
 it('écarte une recherche dont le signal est déjà annulé',async()=>{
  const controller=new AbortController();controller.abort();const request=new Request('https://www.openswissdata.com/api/admin/crm/customers/search',{method:'POST',headers,body:'{}',signal:controller.signal});
  expect((await createApp().fetch(request)).status).toBe(499);
 });
 it('garde session, origine, CSRF et réponses privées sur une recherche en lecture seule',async()=>{
  for(const [custom,status] of [[{...headers,cookie:''},401],[{...headers,origin:'https://invalide.test'},403],[{...headers,'x-osd-csrf':''},403]] as const)expect((await search({},custom)).status).toBe(status);
  const r=await search();expect(r.headers.get('cache-control')).toBe('private, no-store');expect(JSON.stringify(await r.json())).not.toContain('D'.repeat(43));
 });
});
