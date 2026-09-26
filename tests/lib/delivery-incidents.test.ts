import {runCleanup,runFullCleanup,readCleanupProof} from '../../src/lib/cleanup.js';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getDb,closeDb} from '../../src/lib/db.js';
import {observeDeliveryIncident,safelyObserveDeliveryIncident,scanDeliveryIncidents,readIncidentScan} from '../../src/lib/delivery-incidents.js';
const now=Date.parse('2026-09-26T12:00:00Z');
describe('Registre minimal des incidents de livraison',()=>{
 let root:string;
 beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),'osd-incidents-'));vi.stubEnv('DATABASE_PATH',join(root,'fictive.sqlite'));vi.spyOn(Date,'now').mockReturnValue(now);
  const db=getDb();db.prepare("INSERT INTO customers(id,email,created_at) VALUES(1,'fictif@example.test',?)").run(now);db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,current_version,created_at) VALUES('fictif','Exemple fictif','fictif',100,'price_fictif','v1',?)").run(now);db.prepare("INSERT INTO orders(id,customer_id,stripe_session_id,amount_chf,items_json,created_at) VALUES(1,1,'cs_test_fictif',100,'[]',?)").run(now);db.prepare("INSERT INTO order_deliveries(id,order_id,dataset_id,next_attempt_at,created_at) VALUES(1,1,'fictif',?,?)").run(now,now);
 });
 afterEach(()=>{closeDb();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true})});
 const incident=()=>getDb().prepare('SELECT * FROM delivery_incidents WHERE delivery_id=1').get() as Record<string,unknown>|undefined;
 const events=()=>getDb().prepare('SELECT * FROM delivery_incident_events ORDER BY id').all() as Record<string,unknown>[];
 const failure=()=>getDb().prepare("UPDATE order_deliveries SET attempts=1,last_error='resend_error' WHERE id=1").run();
 it('ne transforme ni une commande jamais tentée ni une acceptation normale en incident',()=>{
  observeDeliveryIncident(getDb(),1,now);expect(incident()).toBeUndefined();getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(now);observeDeliveryIncident(getDb(),1,now);expect(events()).toHaveLength(0);
 });
 it('ouvre un dossier unique et ne compte pas les simples relectures',()=>{
  failure();observeDeliveryIncident(getDb(),1,now);for(let i=1;i<=10;i++)observeDeliveryIncident(getDb(),1,now+i);
  expect(incident()).toMatchObject({state:'open',reason:'resend_error',observations:1,first_seen_at:now,last_seen_at:now,last_checked_at:now+10});expect(events()).toHaveLength(1);
 });
 it('compte les observations distinctes sans inventer les tentatives non observées',()=>{
  failure();observeDeliveryIncident(getDb(),1,now);getDb().prepare('UPDATE order_deliveries SET attempts=12 WHERE id=1').run();observeDeliveryIncident(getDb(),1,now+1);expect(incident()).toMatchObject({observations:2,last_attempts:12});expect(events().map(e=>e.kind)).toEqual(['opened','changed']);
 });
 it('conserve le blocage pendant une tentative en cours et ne ferme que sur une date d’acceptation valide',()=>{
  failure();observeDeliveryIncident(getDb(),1,now);getDb().prepare("UPDATE order_deliveries SET state='processing',attempts=2 WHERE id=1").run();observeDeliveryIncident(getDb(),1,now+1);expect(incident()).toMatchObject({state:'open',observations:1,last_checked_at:now+1});
  getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=?,last_error=NULL WHERE id=1").run(now+2);observeDeliveryIncident(getDb(),1,now+3);expect(incident()).toMatchObject({state:'accepted',accepted_at:now+2,closed_at:now+3,observations:1});expect(events().at(-1)).toMatchObject({kind:'accepted',accepted_at:now+2});
 });
 it.each([null,0,now+1000,now-0.5])('la preuve d’acceptation %s ne ferme pas un incident',sent=>{
  failure();observeDeliveryIncident(getDb(),1,now);getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(sent);observeDeliveryIncident(getDb(),1,now+1);expect(incident()).toMatchObject({state:'open',reason:'proof_missing',closed_at:null});
 });
 it('sépare l’annulation financière d’un envoi accepté puis rouvre le même dossier',()=>{
  failure();observeDeliveryIncident(getDb(),1,now);const id=incident()!.id;
  getDb().prepare("UPDATE order_deliveries SET state='cancelled',last_error='financial_access_suspended' WHERE id=1").run();observeDeliveryIncident(getDb(),1,now+1);expect(incident()).toMatchObject({state:'open',reason:'proof_missing'});
  getDb().prepare("UPDATE orders SET status='disputed' WHERE id=1").run();observeDeliveryIncident(getDb(),1,now+2);expect(incident()).toMatchObject({state:'cancelled',accepted_at:null});
  getDb().prepare("UPDATE orders SET status='paid' WHERE id=1").run();getDb().prepare("UPDATE order_deliveries SET state='review',last_error='delivery_confirmation_required' WHERE id=1").run();observeDeliveryIncident(getDb(),1,now+3);expect(incident()).toMatchObject({id,state:'open',closed_at:null,reason:'delivery_confirmation_required'});expect(events().at(-1)?.kind).toBe('reopened');
 });
 it('ne copie jamais un message brut ou un statut inconnu dans le registre',()=>{
  const secret='secret-client@example.test https://invalid.test/token-secret';getDb().prepare("UPDATE order_deliveries SET attempts=1,last_error=? WHERE id=1").run(secret);getDb().prepare('UPDATE orders SET status=? WHERE id=1').run(secret);observeDeliveryIncident(getDb(),1,now);expect(incident()).toMatchObject({state:'open',reason:'unknown',last_order_state:'unknown'});expect(JSON.stringify([incident(),events()])).not.toContain('secret');
 });
 it('annule ensemble le dossier et son événement si le journal ne peut pas être écrit',()=>{
  failure();getDb().exec("CREATE TRIGGER incident_log_failure BEFORE INSERT ON delivery_incident_events BEGIN SELECT RAISE(ABORT,'fictif'); END");expect(()=>observeDeliveryIncident(getDb(),1,now)).toThrow();expect(incident()).toBeUndefined();expect(events()).toHaveLength(0);
 });
 it('n’écrase pas une observation plus récente après un recul d’horloge',()=>{
  failure();observeDeliveryIncident(getDb(),1,now);expect(()=>observeDeliveryIncident(getDb(),1,now-1)).toThrow('incident_clock_reversed');expect(incident()!.last_checked_at).toBe(now);
 });
 it('reste idempotent après réouverture de la base et migration répétée',()=>{
  failure();observeDeliveryIncident(getDb(),1,now);closeDb();observeDeliveryIncident(getDb(),1,now+1);expect(events()).toHaveLength(1);expect(incident()!.observations).toBe(1);
 });
 it('le garde-fou ne propage pas une panne vers la livraison et ne révèle pas le message SQL',()=>{
  failure();getDb().exec("CREATE TRIGGER incident_failure BEFORE INSERT ON delivery_incidents BEGIN SELECT RAISE(ABORT,'secret@example.test'); END");const log=vi.spyOn(console,'error').mockImplementation(()=>{});expect(()=>safelyObserveDeliveryIncident(getDb(),1)).not.toThrow();expect(log).toHaveBeenCalledOnce();expect(JSON.stringify(log.mock.calls)).not.toContain('secret@example.test');
 });
 it('relève les dossiers courants par lots bornés sans gonfler les répétitions',()=>{
  const db=getDb();db.transaction(()=>{for(let id=2;id<=205;id++){db.prepare("INSERT INTO orders(id,customer_id,stripe_session_id,amount_chf,items_json,created_at) VALUES(?,1,?,100,'[]',?)").run(id,'cs_test_lot_'+id,now);db.prepare("INSERT INTO order_deliveries(order_id,dataset_id,state,attempts,next_attempt_at,last_error,created_at) VALUES(?,'fictif','pending',1,?,'resend_error',?)").run(id,now,now)}})();failure();
  expect(scanDeliveryIncidents(db,now)).toMatchObject({ok:true,eligible:205,processed:200,limit:200});expect((db.prepare('SELECT COUNT(*) n FROM delivery_incidents').get() as {n:number}).n).toBe(200);
  expect(scanDeliveryIncidents(db,now+1).ok).toBe(true);expect((db.prepare('SELECT COUNT(*) n FROM delivery_incidents').get() as {n:number}).n).toBe(205);expect((db.prepare('SELECT MAX(observations) n FROM delivery_incidents').get() as {n:number}).n).toBe(1);expect(readIncidentScan(db)?.checked_at).toBe(now+1);
 });
 it('rattrape une acceptation enregistrée alors que le journal était indisponible',()=>{
  failure();observeDeliveryIncident(getDb(),1,now);getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(now+1);scanDeliveryIncidents(getDb(),now+2);expect(incident()).toMatchObject({state:'accepted',accepted_at:now+1});
 });
 it('signale un passage incomplet et refuse un témoin altéré',()=>{
  failure();getDb().exec("CREATE TRIGGER incident_panne BEFORE INSERT ON delivery_incidents BEGIN SELECT RAISE(ABORT,'fictif'); END");expect(scanDeliveryIncidents(getDb(),now)).toMatchObject({ok:false,errors:1,processed:0});expect(readIncidentScan(getDb())?.ok).toBe(false);
  getDb().prepare("UPDATE operation_checks SET details_json=? WHERE name='delivery_incident_scan'").run(JSON.stringify({checked_at:now,ok:true,errors:0,processed:999,eligible:1,limit:200}));expect(readIncidentScan(getDb())).toBeNull();
 });
 it('conserve les incidents ouverts, purge les événements de plus de 180 jours et les dossiers clos anciens',async()=>{
  const db=getDb(),day=86400000;failure();observeDeliveryIncident(db,1,now-181*day);runCleanup(db,now);expect(incident()?.state).toBe('open');expect(events()).toHaveLength(0);
  db.prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(now-180*day);observeDeliveryIncident(db,1,now-180*day);runCleanup(db,now);expect(incident()?.state).toBe('accepted');expect(events()).toHaveLength(1);
  const result=await runFullCleanup(db,now+1);expect(result.ok).toBe(true);expect(incident()).toBeUndefined();expect(events()).toHaveLength(0);expect(readCleanupProof(db)).toEqual(result);
  const old={...result,entries:result.entries.filter(e=>!e.name.startsWith('delivery_incident'))};old.totalDeleted=old.entries.reduce((n,e)=>n+e.deleted,0);db.prepare("UPDATE operation_checks SET details_json=? WHERE name='cleanup'").run(JSON.stringify(old));expect(readCleanupProof(db)).toBeNull();
 });
 it('ne purge pas des incidents clos dont la date est incohérente',()=>{
  failure();observeDeliveryIncident(getDb(),1,now);getDb().prepare("UPDATE delivery_incidents SET state='accepted',closed_at=12 WHERE delivery_id=1").run();expect(runCleanup(getDb(),now).entries.find(e=>e.name==='delivery_incidents')).toMatchObject({status:'error',error:'timestamp_format',deleted:0});expect(incident()).toBeDefined();
 });

 it('détecte une preuve devenue incohérente et garde un ancien dossier si l’envoi est remis en file',()=>{
  const db=getDb(),day=86400000;failure();observeDeliveryIncident(db,1,now-182*day);db.prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(now-181*day);observeDeliveryIncident(db,1,now-181*day);
  db.prepare("UPDATE order_deliveries SET state='pending',last_error=NULL WHERE id=1").run();runCleanup(db,now);expect(incident()).toBeDefined();scanDeliveryIncidents(db,now);expect(incident()).toMatchObject({state:'open',reason:'resumption_pending'});
  db.prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(now);scanDeliveryIncidents(db,now+1);expect(incident()?.state).toBe('accepted');db.prepare('UPDATE order_deliveries SET sent_at=0 WHERE id=1').run();scanDeliveryIncidents(db,now+2);expect(incident()).toMatchObject({state:'open',reason:'proof_missing'});
 });

 it('propage une annulation de la transaction englobante au lieu de poursuivre en autocommit',()=>{
  const db=getDb();failure();db.exec("CREATE TRIGGER incident_rollback BEFORE INSERT ON delivery_incidents BEGIN SELECT RAISE(ROLLBACK,'fictif'); END");
  expect(()=>db.transaction(()=>{db.prepare("UPDATE orders SET status='disputed' WHERE id=1").run();safelyObserveDeliveryIncident(db,1);db.prepare("UPDATE orders SET status='refunded' WHERE id=1").run()})()).toThrow();
  expect(db.inTransaction).toBe(false);expect(db.prepare('SELECT status FROM orders WHERE id=1').get()).toEqual({status:'paid'});expect(incident()).toBeUndefined();
 });
 it('rattrape aussi une annulation incohérente et une preuve absente sans dossier préalable',()=>{
  const db=getDb();db.prepare("UPDATE orders SET status='financial_pending' WHERE id=1").run();db.prepare("UPDATE order_deliveries SET state='cancelled',last_error='order_not_paid' WHERE id=1").run();scanDeliveryIncidents(db,now);expect(incident()).toMatchObject({state:'open',reason:'order_not_paid'});
  db.exec('DELETE FROM delivery_incidents');db.prepare("UPDATE orders SET status='paid' WHERE id=1").run();db.prepare("UPDATE order_deliveries SET state='sent',sent_at=NULL WHERE id=1").run();scanDeliveryIncidents(db,now+1);expect(incident()).toMatchObject({state:'open',reason:'proof_missing'});
 });
 it('un changement financier après acceptation ne simule pas un second envoi ni une nouvelle clôture',()=>{
  const db=getDb();failure();observeDeliveryIncident(db,1,now);db.prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(now+1);observeDeliveryIncident(db,1,now+2);const before=incident();
  db.prepare("UPDATE orders SET status='refunded' WHERE id=1").run();db.prepare('UPDATE order_deliveries SET attempts=2 WHERE id=1').run();scanDeliveryIncidents(db,now+3);expect(incident()).toMatchObject({state:'accepted',closed_at:before!.closed_at,last_seen_at:before!.last_seen_at,observations:before!.observations,last_order_state:'refunded',last_attempts:2});expect(events().filter(e=>e.kind==='accepted')).toHaveLength(1);
 });
 it('garde ouverte et dédoublonnée une acceptation hors état malgré les relectures d’annulation',()=>{
  const db=getDb();db.prepare("UPDATE orders SET status='refunded' WHERE id=1").run();db.prepare("UPDATE order_deliveries SET state='cancelled',attempts=1 WHERE id=1").run();observeDeliveryIncident(db,1,now,1);observeDeliveryIncident(db,1,now+1,1);scanDeliveryIncidents(db,now+2);expect(incident()).toMatchObject({state:'open',reason:'acceptance_after_state_change',accepted_at:now,closed_at:null});expect(events()).toHaveLength(1);expect(events()[0].kind).toBe('acceptance_uncertain');
 });

 it('conserve une acceptation hors état malgré un recul de quelques millisecondes',()=>{
  failure();observeDeliveryIncident(getDb(),1,now+10);observeDeliveryIncident(getDb(),1,now,1);expect(incident()).toMatchObject({state:'open',reason:'acceptance_after_state_change',accepted_at:now,last_checked_at:now+10});expect(events().at(-1)).toMatchObject({kind:'acceptance_uncertain',recorded_at:now+10,accepted_at:now});
 });
 it('identifie la livraison et la tentative dans le seul signal disponible si l’alerte ne peut pas être écrite',()=>{
  getDb().exec("CREATE TRIGGER incident_alerte_perdue BEFORE INSERT ON delivery_incidents BEGIN SELECT RAISE(ABORT,'secret@example.test'); END");const log=vi.spyOn(console,'error').mockImplementation(()=>{});safelyObserveDeliveryIncident(getDb(),1,1);expect(log.mock.calls[0][0]).toContain('ACCEPTATION HORS TRAITEMENT RÉSERVÉ');expect(log.mock.calls[0][0]).toContain('livraison 1 · tentative 1');expect(JSON.stringify(log.mock.calls)).not.toContain('secret@example.test');
 });
 it('ne purge pas une observation récente attachée à une ancienne clôture',()=>{
  const db=getDb(),day=86400000;failure();observeDeliveryIncident(db,1,now-182*day);db.prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(now-181*day);observeDeliveryIncident(db,1,now-181*day);const closed=incident()!.closed_at;
  db.prepare('UPDATE order_deliveries SET sent_at=? WHERE id=1').run(now);scanDeliveryIncidents(db,now);expect(incident()!.closed_at).toBe(closed);runCleanup(db,now);expect(incident()).toBeDefined();expect(events()).toHaveLength(1);expect(events()[0].recorded_at).toBe(now);
 });

});
