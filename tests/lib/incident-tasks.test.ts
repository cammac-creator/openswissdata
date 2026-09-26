import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, closeDb } from '../../src/lib/db.js';
import { observeDeliveryIncident, readDeliveryIncidentPage, scanDeliveryIncidents } from '../../src/lib/delivery-incidents.js';
import { createIncidentTask, readIncidentTask } from '../../src/lib/incident-tasks.js';
import { runCleanup } from '../../src/lib/cleanup.js';

const now = Date.parse('2026-09-26T12:00:00Z');
describe('Action interne unique par incident', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'osd-incident-task-')); vi.stubEnv('DATABASE_PATH', join(root, 'fictif.sqlite')); vi.spyOn(Date, 'now').mockReturnValue(now);
    const db = getDb();
    db.prepare("INSERT INTO customers(id,email,created_at) VALUES(1,'admin@example.test',?),(2,'client@example.test',?)").run(now, now);
    db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES('fictif','Fictif','fictif',100,'fictif',?)").run(now);
    db.prepare("INSERT INTO orders(id,customer_id,stripe_session_id,amount_chf,items_json,created_at) VALUES(1,2,'cs_test_fictif',100,'[]',?)").run(now);
    db.prepare("INSERT INTO order_deliveries(id,order_id,dataset_id,state,attempts,next_attempt_at,last_error,created_at) VALUES(1,1,'fictif','pending',1,?,'resend_error',?)").run(now,now);
    observeDeliveryIncident(db, 1, now);
  });
  afterEach(() => { closeDb(); vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
  it('relie l’action au client exact et conserve le créateur authentifié', () => {
    const result = createIncidentTask(getDb(), 1, 1, '2026-09-28', now);
    expect(result).toMatchObject({ status: 'ok', created: true, task: { id: 1, customer_id: 2, due_on: '2026-09-28', done_at: null } });
    expect(getDb().prepare('SELECT * FROM delivery_incident_tasks').get()).toEqual({ incident_id: 1, task_id: 1, created_by: 1, created_at: now });
    expect(readDeliveryIncidentPage(getDb(), 'open', 1, now).incidents[0].task).toEqual(readIncidentTask(getDb(), 1));
  });
  it('retrouve le suivi sans changer son échéance ou rouvrir une action clôturée', () => {
    createIncidentTask(getDb(), 1, 1, null, now);
    getDb().prepare('UPDATE crm_tasks SET done_at=?,due_on=? WHERE id=1').run(now, '2026-09-29');
    expect(createIncidentTask(getDb(), 1, 2, '2026-10-01', now+1)).toMatchObject({ status: 'ok', created: false, task: { id: 1, done_at: now, due_on: '2026-09-29' } });
    expect(getDb().prepare('SELECT COUNT(*) n FROM crm_tasks').get()).toEqual({ n: 1 });
    expect(getDb().prepare('SELECT created_by FROM delivery_incident_tasks').get()).toEqual({ created_by: 1 });
    expect(getDb().prepare('SELECT state FROM delivery_incidents').get()).toEqual({ state: 'open' });
  });
  it('ne crée rien pour un incident absent ou déjà accepté entre deux relèves', () => {
    expect(createIncidentTask(getDb(), 99, 1, null, now)).toEqual({ status: 'not_found' });
    getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(now);
    expect(createIncidentTask(getDb(), 1, 1, null, now)).toEqual({ status: 'closed' });
    expect(getDb().prepare('SELECT state FROM delivery_incidents').get()).toEqual({ state: 'accepted' });
    expect(getDb().prepare('SELECT COUNT(*) n FROM crm_tasks').get()).toEqual({ n: 0 });
  });
  it('le rejeu après résolution conserve l’action déjà créée', () => {
    const first = createIncidentTask(getDb(), 1, 1, null, now);
    getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(now+1); observeDeliveryIncident(getDb(), 1, now+2);
    expect(createIncidentTask(getDb(), 1, 1, '2026-09-27', now+3)).toEqual({ ...first, created: false });
    expect(readIncidentTask(getDb(), 1)?.done_at).toBeNull();
  });
  it('une acceptation hors état reste à suivre sans renvoi ni rétablissement financier', () => {
    getDb().prepare("UPDATE orders SET status='refunded' WHERE id=1").run(); getDb().prepare("UPDATE order_deliveries SET state='cancelled' WHERE id=1").run(); observeDeliveryIncident(getDb(), 1, now, 1);
    expect(createIncidentTask(getDb(), 1, 1, null, now).status).toBe('ok');
    expect(getDb().prepare('SELECT status FROM orders').get()).toEqual({ status: 'refunded' });
    expect(getDb().prepare('SELECT state FROM order_deliveries').get()).toEqual({ state: 'cancelled' });
    expect(getDb().prepare('SELECT state,reason FROM delivery_incidents').get()).toEqual({ state: 'open', reason: 'acceptance_after_state_change' });
  });
  it('annule création et liaison ensemble si la liaison ne peut être enregistrée', () => {
    getDb().exec("CREATE TRIGGER lien_en_panne BEFORE INSERT ON delivery_incident_tasks BEGIN SELECT RAISE(ABORT,'fictif'); END");
    expect(() => createIncidentTask(getDb(), 1, 1, null, now)).toThrow();
    expect(getDb().prepare('SELECT COUNT(*) n FROM crm_tasks').get()).toEqual({ n: 0 });
    expect(readIncidentTask(getDb(), 1)).toBeNull();
  });
  it('ne laisse pas d’action orpheline si le créateur est invalide', () => {
    expect(() => createIncidentTask(getDb(), 1, 99, null, now)).toThrow();
    expect(getDb().prepare('SELECT COUNT(*) n FROM crm_tasks').get()).toEqual({ n: 0 });
  });
  it('la purge d’un incident clos conserve l’action et la commande', () => {
    createIncidentTask(getDb(), 1, 1, null, now); const task = readIncidentTask(getDb(), 1);
    getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(now+1); observeDeliveryIncident(getDb(), 1, now+2);
    const result = runCleanup(getDb(), now+182*86400000);
    expect(result.entries.find(e => e.name === 'delivery_incidents')?.status).toBe('ok');
    expect(getDb().prepare('SELECT COUNT(*) n FROM delivery_incidents').get()).toEqual({ n: 0 });
    expect(getDb().prepare('SELECT COUNT(*) n FROM delivery_incident_tasks').get()).toEqual({ n: 0 });
    expect(getDb().prepare('SELECT id,customer_id,title,due_on,done_at,created_at FROM crm_tasks').get()).toEqual(task);
    expect(getDb().prepare('SELECT COUNT(*) n FROM orders').get()).toEqual({ n: 1 });
  });
  it('aucune relève ou consultation ne crée une action automatiquement', () => {
    scanDeliveryIncidents(getDb(), now); readDeliveryIncidentPage(getDb(), 'open', 1, now);
    expect(getDb().prepare('SELECT COUNT(*) n FROM crm_tasks').get()).toEqual({ n: 0 });
  });
  it('refuse une date impossible et accepte une échéance absente', () => {
    expect(() => createIncidentTask(getDb(), 1, 1, '2026-02-31', now)).toThrow('incident_task_input_invalid');
    expect(createIncidentTask(getDb(), 1, 1, null, now)).toMatchObject({ created: true, task: { due_on: null } });
  });
  it('signale un recul d’horloge sans laisser de création partielle',()=>{
    observeDeliveryIncident(getDb(),1,now+1000);
    expect(createIncidentTask(getDb(),1,1,null,now)).toEqual({status:'clock'});
    expect(getDb().prepare('SELECT COUNT(*) n FROM crm_tasks').get()).toEqual({n:0});
    expect(createIncidentTask(getDb(),1,1,null,now+1000).status).toBe('ok');
  });
});
