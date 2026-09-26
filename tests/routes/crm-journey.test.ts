import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../src/index.js';
import {getDb,closeDb} from '../../src/lib/db.js';
import {crmPeriod} from '../../src/lib/crm-period.js';
import {realCustomerSql} from '../../src/routes/crm.js';
import {readOrderJourney} from '../../src/lib/order-journey.js';

describe('Preuves après achat, sans attribution inventée',()=>{
 let temp:string,serial:number;const now=Date.parse('2026-10-26T00:30:00Z'),day=86400000;
 const headers={cookie:'osd_session='+'D'.repeat(43)};
 beforeEach(()=>{
  vi.spyOn(Date,'now').mockReturnValue(now);serial=0;temp=mkdtempSync(join(tmpdir(),'osd-journey-'));
  vi.stubEnv('DATABASE_PATH',join(temp,'fictif.sqlite'));vi.stubEnv('ADMIN_EMAILS','OWNER@example.test');vi.stubEnv('CRM_INTERNAL_EMAILS','interne@example.test');vi.stubEnv('BASE_URL','https://www.openswissdata.com');
  const db=getDb();for(const [id,email] of [[1,'owner@example.test'],[2,'buyer@example.test'],[3,'other@example.test'],[4,'Interne@example.test'],[5,'marque@example.test']] as const)db.prepare('INSERT INTO customers(id,email,created_at) VALUES(?,?,?)').run(id,email,now-day);
  db.prepare('INSERT INTO crm_profiles(customer_id,internal,updated_at) VALUES(5,1,?)').run(now);
  for(const [token,id] of [['D'.repeat(43),1],['E'.repeat(43),2]])db.prepare('INSERT INTO sessions(token,customer_id,created_at,expires_at) VALUES(?,?,?,?)').run(token,id,now,now+day);
  for(const id of ['finma','tares','classifications'])db.prepare('INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES(?,?,?,29900,?,?)').run(id,id,id,'price_fictif',now-day);
 });
 afterEach(()=>{closeDb();rmSync(temp,{recursive:true,force:true});vi.restoreAllMocks();vi.unstubAllEnvs()});
 function order(at=now-day,customer=2,status='paid',prefix='cs_live_'){
  return Number(getDb().prepare('INSERT INTO orders(customer_id,stripe_session_id,amount_chf,items_json,status,created_at) VALUES(?,?,29900,?,?,?)').run(customer,prefix+(++serial),'["finma"]',status,at).lastInsertRowid);
 }
 function grant(id:number,dataset='finma'){getDb().prepare('INSERT INTO order_grants(order_id,dataset_id,created_at) VALUES(?,?,?)').run(id,dataset,now-day)}
 function delivery(id:number,dataset='finma',state='sent',sent:number|null=now-1000,created=now-2000){getDb().prepare('INSERT INTO order_deliveries(order_id,dataset_id,state,next_attempt_at,sent_at,created_at) VALUES(?,?,?,?,?,?)').run(id,dataset,state,now,sent,created)}
 function access(id:number|null,customer=2,created=now-1000,authorized:number|null=now,source='email',dataset='finma'){getDb().prepare('INSERT INTO download_activity(order_id,customer_id,dataset_id,version,source,created_at,authorized_at) VALUES(?,?,?,\'fictive\',?,?,?)').run(id,customer,dataset,source,created,authorized)}
 const read=(days=30)=>readOrderJourney(getDb(),crmPeriod(days,now),realCustomerSql(),now);
 it('reste privé, sans email, référence de paiement, identifiant individuel ni lien',async()=>{
  const app=createApp(),path='/api/admin/crm/audience';expect((await app.request(path)).status).toBe(401);expect((await app.request(path,{headers:{cookie:'osd_session='+'E'.repeat(43)}})).status).toBe(403);
  grant(order());const response=await app.request(path,{headers}),body=await response.json();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(body.journey.orders).toBe(1);expect(JSON.stringify(body.journey)).not.toMatch(/@|cs_live_|customer_id|order_id|token|https:/);
 });
 it('compte seulement les commandes payées réelles hors comptes internes et donne les clients distincts',()=>{
  order();order();order(now-day,3);for(const id of [1,4,5])order(now-day,id);for(const status of ['refunded','disputed','dispute_lost','financial_pending','manual'])order(now-day,2,status);for(const prefix of ['cs_test_','csXlive_','prefix_cs_live_'])order(now-day,2,'paid',prefix);
  const j=read();expect(j.orders).toBe(3);expect(j.customers).toBe(2);expect(j.no_item_detail).toBe(3);
 });
 it('réconcilie cinq catégories exclusives et exige tous les fichiers du bundle',()=>{
  const complete=order(),partial=order(),waiting=order(),legacy=order(),unknown=order();
  for(const id of [complete,partial])for(const dataset of ['finma','tares','classifications']){grant(id,dataset);if(id===complete||dataset==='finma')delivery(id,dataset);else delivery(id,dataset,'pending',null)}
  grant(waiting);delivery(waiting,'finma','review',null);grant(legacy);expect(unknown).toBeGreaterThan(legacy);
  for(let i=0;i<5;i++)access(complete);access(partial);
  const j=read();expect(j).toMatchObject({orders:5,customers:1,complete_mail:1,partial_mail:1,no_mail_acceptance:1,no_delivery_tracking:1,no_item_detail:1,expected_files:8,accepted_files:4,email_access_orders:2,email_access_customers:1,invalid_acceptances:0});
  expect(j.complete_mail+j.partial_mail+j.no_mail_acceptance+j.no_delivery_tracking+j.no_item_detail).toBe(j.orders);
 });
 it('les preuves mail et accès sont indépendantes, sans déduire une réception',()=>{
  const id=order();grant(id);access(id);expect(read()).toMatchObject({orders:1,complete_mail:0,no_delivery_tracking:1,email_access_orders:1});
 });
 it('ignore les accès du compte, prévisualisations, autre client et fichier étranger à la commande',()=>{
  const id=order();grant(id);access(id,2,now-1000,null);access(null,2,now-1000,now,'account');access(id,2,now-1000,now,'account');access(id,3);access(id,2,now-1000,now,'email','tares');
  expect(read().email_access_orders).toBe(0);access(id);expect(read().email_access_orders).toBe(1);
 });
 it('refuse les chronologies impossibles des accès et limite la conservation par création de trace',()=>{
  const cutoff=now-180*day,id=order(now-200*day);grant(id);
  access(id,2,cutoff-1,now);access(id,2,now-500,now-501);access(id,2,now,now+1);access(id,2,now-201*day,now);access(id,2,now+1,now+2);
  expect(read(365)).toMatchObject({email_access_orders:0,older_than_retention:1,retained_since:cutoff,retention_days:180});
  access(id,2,cutoff,cutoff);expect(read(365).email_access_orders).toBe(1);
 });
 it('une date d’acceptation incohérente n’apparaît jamais comme un succès',()=>{
  const before=order(),future=order(),missing=order(),wrongState=order(),valid=order();for(const id of [before,future,missing,wrongState,valid])grant(id);
  delivery(before,'finma','sent',now-3000,now-2000);delivery(future,'finma','sent',now+1);delivery(missing,'finma','sent',null);delivery(wrongState,'finma','cancelled',now);delivery(valid,'finma','sent',now);
  expect(read()).toMatchObject({orders:5,complete_mail:1,accepted_files:1,invalid_acceptances:2,later_acceptances:1,no_mail_acceptance:4});
 });
 it('respecte les bornes suisses, le changement d’heure et la milliseconde du relevé',()=>{
  const from=crmPeriod(7,now).start_at;expect(from).toBe(Date.parse('2026-10-19T22:00:00Z'));order(from-1);order(from);order(Date.parse('2026-10-25T00:30:00Z'));order(Date.parse('2026-10-25T01:30:00Z'));order(now);order(now+1);expect(read(7).orders).toBe(4);
 });
 it('ne transforme pas les événements publics ni un montant remboursé partiellement en preuve de livraison',()=>{
  const id=order();getDb().prepare('UPDATE orders SET refunded_chf=5000 WHERE id=?').run(id);
  getDb().prepare("INSERT INTO events(kind,name,origin,ts) VALUES('conversion','purchase','client',?)").run(now);expect(read()).toMatchObject({orders:1,complete_mail:0,email_access_orders:0});
  getDb().prepare("UPDATE orders SET status='refunded' WHERE id=?").run(id);expect(read().orders).toBe(0);
 });
 it('reste strictement en lecture et ne crée pas un suivi pour les anciens achats',()=>{
  order();const db=getDb(),before=db.prepare('SELECT total_changes() n').get();read();expect(db.prepare('SELECT total_changes() n').get()).toEqual(before);expect(db.prepare('SELECT COUNT(*) n FROM order_deliveries').get()).toEqual({n:0});
 });
 it('conserve le reste de l’audience si les preuves après achat sont indisponibles',async()=>{
  const spy=vi.spyOn(console,'error').mockImplementation(()=>{});getDb().exec('DROP TABLE order_grants');
  const r=await createApp().request('/api/admin/crm/audience',{headers}),body=await r.json();expect(r.status).toBe(200);expect(body.journey).toBeNull();expect(body.web).toMatchObject({pageviews:0});expect(spy).toHaveBeenCalledWith('[crm] lecture des preuves après achat indisponible',{category:'SQLITE_ERROR'});
 });
 it('les clés de la base refusent un doublon de fichier ou de livraison',()=>{
  const id=order();grant(id);delivery(id);expect(()=>grant(id)).toThrow(/UNIQUE/);expect(()=>delivery(id)).toThrow(/UNIQUE/);expect(read()).toMatchObject({expected_files:1,accepted_files:1});
 });
 it('écarte une livraison antérieure à sa commande',()=>{
  const id=order();grant(id);delivery(id,'finma','sent',now,now-2*day);expect(read()).toMatchObject({complete_mail:0,invalid_acceptances:1,later_acceptances:0});
 });
 it('une période passée et l’instant du relevé restent deux bornes distinctes',()=>{
  const end=now-day,id=order(now-2*day);grant(id);delivery(id);access(id);
  const j=readOrderJourney(getDb(),crmPeriod(7,end),realCustomerSql(),now);
  expect(j).toMatchObject({orders:1,complete_mail:1,email_access_orders:1,invalid_acceptances:0,later_acceptances:0,retained_since:now-180*day});
 });
 it('parcourt les accès et livraisons par leurs index, sans balayage des traces pour chaque achat',()=>{
  const db=getDb(),period=crmPeriod(30,now),real=realCustomerSql(),spy=vi.spyOn(db,'prepare');read();
  const sql=spy.mock.calls.map(args=>args[0]).find(sql=>sql.startsWith('WITH cohort'))!;spy.mockRestore();
  const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(period.start_at,period.end_at,...real.params,now+1,now+1,now-180*day,now+1,now-180*day) as Array<{detail:string}>;
  const details=plan.map(row=>row.detail).join('\n');expect(details).toContain('idx_download_activity_order');expect(details).toContain('sqlite_autoindex_order_deliveries_1');expect(details).not.toMatch(/SCAN a\b/);
 });
 it('donne des zéros explicites pour une sélection vide, avec sa frontière de conservation',()=>{expect(read()).toEqual({orders:0,customers:0,complete_mail:0,partial_mail:0,no_mail_acceptance:0,no_delivery_tracking:0,no_item_detail:0,expected_files:0,accepted_files:0,invalid_acceptances:0,later_acceptances:0,email_access_orders:0,email_access_customers:0,older_than_retention:0,retained_since:now-180*day,retention_days:180})});
});
