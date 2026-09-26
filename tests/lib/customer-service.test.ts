import {beforeEach,afterEach,it,expect,describe} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {getDb,closeDb} from "../../src/lib/db.js";
import {orderService,accountDownloadHistory} from "../../src/lib/customer-service.js";
import {runCleanup} from "../../src/lib/cleanup.js";
import {renderOrderService,renderAccountDownloads} from "../../web/src/lib/order-service.js";

describe("Chronologie observable du service",()=>{
 let dir:string;
 beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),"osd-service-"));process.env.DATABASE_PATH=join(dir,"fictive.sqlite");const db=getDb(),now=Date.now();
  for(const id of [1,2])db.prepare("INSERT INTO customers(id,email,created_at) VALUES(?,?,?)").run(id,`personne${id}@example.test`,now);
  db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES('finma','FINMA','finma',29900,'price_fictif',?)").run(now);
  for(const id of [1,2])db.prepare("INSERT INTO orders(id,customer_id,stripe_session_id,amount_chf,items_json,created_at) VALUES(?,?,?,29900,?,?)").run(id,id,'cs_test_'+id,JSON.stringify(["finma"]),now);
 });
 afterEach(()=>{closeDb();rmSync(dir,{recursive:true,force:true});delete process.env.DATABASE_PATH});
 it("refuse le croisement entre les achats et les traces de deux clients",()=>{
  const db=getDb(),now=Date.now();
  db.prepare("INSERT INTO order_deliveries(order_id,dataset_id,next_attempt_at,created_at,payload_json,download_token) VALUES(1,'finma',?,?,'contenu-confidentiel','jeton-confidentiel')").run(now,now);
  for(const customer of [1,2])db.prepare("INSERT INTO download_activity(customer_id,dataset_id,version,order_id,source,created_at) VALUES(?,'finma','2026.09.26',1,'email',?)").run(customer,now);
  const own=orderService(db,1,1);expect(own.downloads).toHaveLength(1);expect(own.deliveries).toHaveLength(1);
  expect(JSON.stringify(own)).not.toMatch(/jeton-confidentiel|contenu-confidentiel/);
  expect(orderService(db,2,1)).toEqual({deliveries:[],downloads:[]});
 });
 it("migre une base antérieure sans attribuer de traces aux anciens accès",()=>{
  const db=getDb(),now=Date.now();
  db.prepare("INSERT INTO download_tokens(token,customer_id,dataset_id,version,expires_at,created_at) VALUES('historique',1,'finma','2026.09.25',?,?)").run(now+60000,now-60000);
  db.prepare("INSERT INTO order_deliveries(order_id,dataset_id,state,next_attempt_at,sent_at,created_at) VALUES(1,'finma','sent',?,?,?)").run(now,now-1000,now-60000);
  db.exec("DROP INDEX idx_download_tokens_activity; ALTER TABLE download_tokens DROP COLUMN activity_id; ALTER TABLE order_deliveries DROP COLUMN provider_message_id; DROP TABLE download_activity;");
  closeDb();const reopened=getDb();
  expect(reopened.prepare('SELECT token,activity_id FROM download_tokens').get()).toEqual({token:'historique',activity_id:null});
  expect(reopened.prepare('SELECT state,provider_message_id FROM order_deliveries').get()).toEqual({state:'sent',provider_message_id:null});
  expect(orderService(reopened,1,1).downloads).toHaveLength(0);
  expect(reopened.pragma('foreign_key_check')).toEqual([]);
 });
 it("purge les traces au-delà de 180 jours sans toucher aux commandes ni aux accès",()=>{
  const db=getDb(),now=Date.now();
  for(const age of [179,181])db.prepare("INSERT INTO download_activity(customer_id,dataset_id,version,source,created_at) VALUES(1,'finma',?,'account',?)").run(String(age),now-age*86400000);
  db.prepare("INSERT INTO download_tokens(token,activity_id,customer_id,dataset_id,version,expires_at,created_at) VALUES('fictif',2,1,'finma','181',?,?)").run(now+60000,now);
  db.prepare("INSERT INTO order_deliveries(order_id,dataset_id,state,next_attempt_at,sent_at,provider_message_id,created_at) VALUES(1,'finma','sent',?,?,'11111111-1111-4111-8111-111111111111',?)").run(now,now-181*86400000,now-181*86400000);
  const result=runCleanup(db);expect(result.entries.find(e=>e.name==='download_activity')?.deleted).toBe(1);
  expect(accountDownloadHistory(db,1).map(d=>d.version)).toEqual(['179']);
  expect(db.prepare('SELECT activity_id FROM download_tokens').get()).toEqual({activity_id:null});
  expect(db.prepare('SELECT COUNT(*) n FROM orders').get()).toEqual({n:2});
  expect(db.prepare('SELECT state,provider_message_id FROM order_deliveries').get()).toEqual({state:'sent',provider_message_id:null});
  expect(runCleanup(db).entries.find(e=>e.name==='download_activity')?.deleted).toBe(0);
 });
 it("n’invente pas de livraison ancienne et échappe le contenu affiché",()=>{
  const html=renderOrderService({id:1,created_at:Date.now(),service:{deliveries:[],downloads:[]}});
  expect(html).toContain('Pas de suivi de livraison conservé');expect(html).not.toContain('Accepté par Resend');
  const rendered=renderAccountDownloads([{dataset_id:'<img src=x onerror=alert(1)>',version:'<script>test</script>',source:'account',created_at:Date.now(),authorized_at:null,order_id:null}]);
  expect(rendered).not.toMatch(/<img|<script>/);expect(rendered).toContain('&lt;script&gt;');expect(rendered).toContain('n’est pas mesurée');
 });
});
