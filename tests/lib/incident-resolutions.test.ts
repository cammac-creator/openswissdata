import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, closeDb, SQLITE_BUSY_TIMEOUT_MS } from '../../src/lib/db.js';
import { observeDeliveryIncident, readDeliveryIncidentEvents, readDeliveryIncidentPage, scanDeliveryIncidents, DELIVERY_INCIDENT_STATUSES } from '../../src/lib/delivery-incidents.js';
import { resolveDeliveryIncident, isRegistryLocked, type ResolutionExpectation } from '../../src/lib/incident-resolutions.js';
import { createIncidentTask, readIncidentTask } from '../../src/lib/incident-tasks.js';
import { runCleanup } from '../../src/lib/cleanup.js';

const now = Date.parse('2026-09-29T12:00:00Z'), day = 86_400_000;
// Chaîne exacte de la purge des dossiers au SHA 36ce84c : un retour arrière la rejoue sur une base contenant des preuves.
const PREVIOUS_INCIDENT_PURGE = "DELETE FROM delivery_incidents WHERE state<>'open' AND MAX(closed_at,last_seen_at) < ? AND EXISTS(SELECT 1 FROM order_deliveries d WHERE d.id=delivery_incidents.delivery_id AND ((delivery_incidents.state='accepted' AND d.state='sent') OR (delivery_incidents.state='cancelled' AND d.state='cancelled')))";

describe('Clôture manuelle des incidents avec preuve', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'osd-incident-resolution-')); vi.stubEnv('DATABASE_PATH', join(root, 'fictif.sqlite')); vi.spyOn(Date, 'now').mockReturnValue(now);
    const db = getDb();
    db.prepare("INSERT INTO customers(id,email,created_at) VALUES(1,'admin@example.test',?),(2,'client@example.test',?),(3,'second-admin@example.test',?)").run(now, now, now);
    db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES('fictif','Fictif','fictif',100,'fictif',?)").run(now);
    addDelivery(1, { at: now });
  });
  afterEach(() => { closeDb(); vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

  /** Commande et livraison fictives ; par défaut une livraison en vérification humaine après 23 h d'incertitude. */
  function addDelivery(id: number, { at = now, state = 'review', error = 'delivery_confirmation_required', attempts = 1, order = 'paid', observe = true }: { at?: number; state?: string; error?: string | null; attempts?: number; order?: string; observe?: boolean } = {}) {
    const db = getDb();
    db.prepare("INSERT INTO orders(id,customer_id,stripe_session_id,amount_chf,items_json,status,created_at) VALUES(?,2,?,100,'[]',?,?)").run(id, 'cs_test_fictif_' + id, order, at);
    db.prepare("INSERT INTO order_deliveries(id,order_id,dataset_id,state,attempts,next_attempt_at,last_error,payload_json,download_token,provider_message_id,created_at) VALUES(?,?,'fictif',?,?,?,?,'corps-secret','jeton-secret','prestataire-secret',?)").run(id, id, state, attempts, at, error, at);
    if (observe) observeDeliveryIncident(db, id, at);
    return (db.prepare('SELECT id FROM delivery_incidents WHERE delivery_id=?').get(id) as { id: number } | undefined)?.id;
  }
  const expectedOf = (incidentId: number): ResolutionExpectation => getDb().prepare('SELECT observations,reason,last_delivery_state delivery_state,last_order_state order_state FROM delivery_incidents WHERE id=?').get(incidentId) as ResolutionExpectation;
  const resolve = (incidentId = 1, at = now + 1000, kind: 'provider_delivery_verified' | 'customer_contacted' | 'manual_resend' | 'no_action' = 'provider_delivery_verified', note = 'Remise confirmée dans le journal du prestataire le 29.09.', admin = 1, expected = expectedOf(incidentId)) =>
    resolveDeliveryIncident(getDb(), incidentId, admin, { kind, note, expected }, at);
  const count = (table: string) => (getDb().prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
  const statusOf = (incidentId: number) => DELIVERY_INCIDENT_STATUSES.find(status => readDeliveryIncidentPage(getDb(), status, 1, now).incidents.some(row => row.id === incidentId));

  it('clôt un dossier ouvert avec preuve, auteur de la session et heure du serveur, sans changer le registre machine', () => {
    const before = getDb().prepare('SELECT * FROM delivery_incidents WHERE id=1').get() as Record<string, unknown>;
    const result = resolve(1, now + 1000, 'provider_delivery_verified', '  Remise confirmée dans le journal du prestataire le 29.09.\r\nRien à renvoyer.  ');
    expect(result).toMatchObject({ status: 'ok', created: true, resolution: { kind: 'provider_delivery_verified', note: 'Remise confirmée dans le journal du prestataire le 29.09.\nRien à renvoyer.', resolved_at: now + 1000, resolved_by: 1, by_viewer: true, reason: 'delivery_confirmation_required', observations: 1, attempts: 1, delivery_state: 'review', order_state: 'paid', in_force: true } });
    const after = getDb().prepare('SELECT * FROM delivery_incidents WHERE id=1').get() as Record<string, unknown>;
    expect({ ...after, last_checked_at: before.last_checked_at }).toEqual(before);
    expect(after).toMatchObject({ state: 'open', closed_at: null });
    expect(count('delivery_incident_events')).toBe(1);
    expect(getDb().prepare('SELECT incident_id,delivery_id FROM delivery_incident_resolutions').get()).toEqual({ incident_id: 1, delivery_id: 1 });
    const resolved = readDeliveryIncidentPage(getDb(), 'resolved', 1, now, 1);
    expect(resolved.summary).toEqual({ open: 0, resolved: 1, accepted: 0, cancelled: 0 });
    expect(resolved.incidents).toHaveLength(1);
    expect(resolved.incidents[0]).toMatchObject({ id: 1, state: 'open', status: 'resolved', resolutions: 1, resolution: { in_force: true, by_viewer: true } });
    expect(readDeliveryIncidentPage(getDb(), 'open', 1, now).incidents).toHaveLength(0);
    expect(readDeliveryIncidentPage(getDb(), 'resolved', 1, now, 3).incidents[0].resolution?.by_viewer).toBe(false);
  });

  it('le rejeu garde la première clôture sans la remplacer', () => {
    const first = resolve();
    const again = resolve(1, now + 2000, 'no_action', 'Autre texte envoyé par un second onglet.');
    expect(again).toEqual({ ...first, created: false });
    expect(count('delivery_incident_resolutions')).toBe(1);
  });

  it.each([
    ['une nouvelle observation', { observations: 2 }],
    ['une autre raison', { reason: 'resend_error' }],
    ['un autre état de livraison', { delivery_state: 'pending' }],
    ['un autre état de commande', { order_state: 'refunded' }],
  ])('refuse une clôture fondée sur %s que l’écran ne montrait pas', (_label, change) => {
    expect(resolve(1, now + 1000, 'no_action', 'Commande de test interne.', 1, { ...expectedOf(1), ...change })).toEqual({ status: 'changed' });
    expect(count('delivery_incident_resolutions')).toBe(0);
  });

  it('refuse une clôture après un changement silencieux de la commande, même sans nouvelle observation', () => {
    const shown = expectedOf(1);
    getDb().prepare("UPDATE orders SET status='refunded' WHERE id=1").run();
    expect(resolve(1, now + 1000, 'no_action', 'Commande remboursée.', 1, shown)).toEqual({ status: 'changed' });
    expect(getDb().prepare('SELECT observations,last_order_state FROM delivery_incidents WHERE id=1').get()).toEqual({ observations: 1, last_order_state: 'refunded' });
    expect(count('delivery_incident_resolutions')).toBe(0);
  });

  it('relit la livraison avant de clore : un envoi accepté entre-temps n’est pas clos à la main', () => {
    const shown = expectedOf(1);
    getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=1").run(now + 500);
    expect(resolve(1, now + 1000, 'provider_delivery_verified', 'Remise vérifiée.', 1, shown)).toEqual({ status: 'closed' });
    expect(getDb().prepare('SELECT state,accepted_at FROM delivery_incidents WHERE id=1').get()).toEqual({ state: 'accepted', accepted_at: now + 500 });
    expect(count('delivery_incident_resolutions')).toBe(0);
  });

  it('signale un dossier absent et un recul d’horloge sans rien écrire', () => {
    expect(resolve(99, now + 1000, 'no_action', 'Sans objet.', 1, expectedOf(1))).toEqual({ status: 'not_found' });
    observeDeliveryIncident(getDb(), 1, now + 5000);
    expect(resolve(1, now + 1000)).toEqual({ status: 'clock' });
    expect(count('delivery_incident_resolutions')).toBe(0);
    expect(resolve(1, now + 5000).status).toBe('ok');
  });

  it('une nouvelle observation après la clôture rouvre le dossier sans effacer la preuve, puis une seconde clôture est possible', () => {
    resolve(1, now + 1000, 'customer_contacted', 'Client joint par téléphone : fichier bien reçu.');
    getDb().prepare('UPDATE order_deliveries SET attempts=2 WHERE id=1').run();
    scanDeliveryIncidents(getDb(), now + 2000);
    expect(statusOf(1)).toBe('open');
    const reopened = readDeliveryIncidentPage(getDb(), 'open', 1, now, 1).incidents[0];
    expect(reopened).toMatchObject({ status: 'open', observations: 2, resolutions: 1, resolution: { kind: 'customer_contacted', observations: 1, in_force: false } });
    expect((getDb().prepare('SELECT kind FROM delivery_incident_events ORDER BY id').all() as Array<{ kind: string }>).map(e => e.kind)).toEqual(['opened', 'changed']);
    expect(count('delivery_incident_resolutions')).toBe(1);
    expect(resolve(1, now + 3000, 'no_action', 'Nouvelle tentative sans effet, client déjà servi.')).toMatchObject({ status: 'ok', created: true, resolution: { observations: 2, in_force: true } });
    const history = readDeliveryIncidentEvents(getDb(), 1, undefined, 1)!;
    expect(history.resolution_total).toBe(2);
    expect(history.resolutions!.map(r => [r.kind, r.in_force])).toEqual([['no_action', true], ['customer_contacted', false]]);
    expect(statusOf(1)).toBe('resolved');
    // Les pages suivantes de l'historique restent sur le curseur des observations, sans répéter les clôtures.
    expect(readDeliveryIncidentEvents(getDb(), 1, 999_999, 1)).not.toHaveProperty('resolutions');
  });

  it('un changement d’état enregistré après la clôture remet la preuve en question', () => {
    resolve();
    getDb().prepare("UPDATE orders SET status='refunded' WHERE id=1").run();
    scanDeliveryIncidents(getDb(), now + 2000);
    expect(getDb().prepare('SELECT observations,last_order_state FROM delivery_incidents WHERE id=1').get()).toEqual({ observations: 1, last_order_state: 'refunded' });
    expect(readDeliveryIncidentPage(getDb(), 'open', 1, now).incidents[0]).toMatchObject({ status: 'open', resolution: { order_state: 'paid', in_force: false } });
  });

  it('la relève ne crée ni ne ferme de clôture et garde un dossier clos tel quel', () => {
    resolve();
    for (let i = 2; i <= 5; i++) scanDeliveryIncidents(getDb(), now + i * 1000);
    expect(statusOf(1)).toBe('resolved');
    expect(count('delivery_incident_events')).toBe(1);
    expect(count('delivery_incident_resolutions')).toBe(1);
    expect(count('crm_tasks')).toBe(0);
  });

  it('une acceptation hors traitement réservé peut être close ; une nouvelle acceptation incertaine la rouvre', () => {
    addDelivery(2, { state: 'cancelled', error: 'financial_access_suspended', order: 'refunded', observe: false });
    observeDeliveryIncident(getDb(), 2, now, 1);
    const id = (getDb().prepare('SELECT id FROM delivery_incidents WHERE delivery_id=2').get() as { id: number }).id;
    expect(resolve(id, now + 1000, 'no_action', 'Mail accepté après le remboursement ; client prévenu, rien à rétablir.')).toMatchObject({ status: 'ok', created: true, resolution: { reason: 'acceptance_after_state_change' } });
    scanDeliveryIncidents(getDb(), now + 2000);
    expect(statusOf(id)).toBe('resolved');
    getDb().prepare('UPDATE order_deliveries SET attempts=2 WHERE id=2').run();
    observeDeliveryIncident(getDb(), 2, now + 3000, 2);
    expect(statusOf(id)).toBe('open');
    expect(getDb().prepare('SELECT status FROM orders WHERE id=2').get()).toEqual({ status: 'refunded' });
  });

  it('« nouvel envoi manuel » reste une déclaration : livraison, commande, droits et action reliée inchangés', () => {
    const db = getDb();
    db.prepare('INSERT INTO entitlements(customer_id,dataset_id,order_id,created_at) VALUES(2,?,1,?)').run('fictif', now);
    createIncidentTask(db, 1, 1, '2026-10-01', now);
    const snapshot = () => JSON.stringify(['order_deliveries', 'orders', 'entitlements', 'order_grants', 'crm_tasks', 'delivery_incident_tasks', 'crm_notes'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
    const before = snapshot();
    expect(resolve(1, now + 1000, 'manual_resend', 'Fichier transmis à la main le 29.09, réception confirmée par le client.').status).toBe('ok');
    expect(snapshot()).toBe(before);
    expect(readIncidentTask(db, 1)?.done_at).toBeNull();
  });

  it('refuse une nouvelle action sur un dossier clos manuellement et retrouve l’action existante', () => {
    addDelivery(2);
    const withTask = (getDb().prepare('SELECT id FROM delivery_incidents WHERE delivery_id=2').get() as { id: number }).id;
    const task = createIncidentTask(getDb(), withTask, 1, null, now);
    resolve(1); resolve(withTask);
    expect(createIncidentTask(getDb(), 1, 1, null, now + 2000)).toEqual({ status: 'resolved' });
    expect(createIncidentTask(getDb(), withTask, 1, null, now + 2000)).toEqual({ ...task, created: false });
    expect(count('crm_tasks')).toBe(1);
  });

  it('classe chaque dossier de la même façon dans le résumé, les sélections et la création d’action', () => {
    addDelivery(2); addDelivery(3); addDelivery(4);
    const ids = [1, 2, 3, 4].map(delivery => (getDb().prepare('SELECT id FROM delivery_incidents WHERE delivery_id=?').get(delivery) as { id: number }).id);
    resolve(ids[1]);
    getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=3").run(now); observeDeliveryIncident(getDb(), 3, now + 10);
    getDb().prepare("UPDATE orders SET status='disputed' WHERE id=4").run(); getDb().prepare("UPDATE order_deliveries SET state='cancelled' WHERE id=4").run(); observeDeliveryIncident(getDb(), 4, now + 10);
    const pages = Object.fromEntries(DELIVERY_INCIDENT_STATUSES.map(status => [status, readDeliveryIncidentPage(getDb(), status, 1, now)]));
    for (const status of DELIVERY_INCIDENT_STATUSES) {
      expect(pages[status].page.total).toBe(pages.open.summary[status]);
      expect(pages[status].incidents.every(row => row.status === status)).toBe(true);
    }
    expect(DELIVERY_INCIDENT_STATUSES.map(status => pages[status].incidents.map(row => row.id))).toEqual([[ids[0]], [ids[1]], [ids[2]], [ids[3]]]);
    expect(createIncidentTask(getDb(), ids[1], 1, null, now + 2000).status).toBe('resolved');
    expect(createIncidentTask(getDb(), ids[2], 1, null, now + 2000).status).toBe('closed');
    expect(createIncidentTask(getDb(), ids[0], 1, null, now + 2000).status).toBe('ok');
  });

  it('conserve un dossier clos manuellement à la purge, laisse expirer son journal et la relève ne le recrée pas', () => {
    const id = addDelivery(5, { at: now - 200 * day })!;
    expect(resolve(id, now - 199 * day, 'customer_contacted', 'Client informé, fichier reçu.').status).toBe('ok');
    const result = runCleanup(getDb(), now);
    expect(result.ok).toBe(true);
    expect(getDb().prepare('SELECT id FROM delivery_incidents WHERE delivery_id=5').all()).toEqual([{ id }]);
    expect(getDb().prepare('SELECT COUNT(*) n FROM delivery_incident_events WHERE incident_id=?').get(id)).toEqual({ n: 0 });
    expect(getDb().prepare('SELECT incident_id FROM delivery_incident_resolutions WHERE delivery_id=5').all()).toEqual([{ incident_id: id }]);
    scanDeliveryIncidents(getDb(), now);
    expect(getDb().prepare('SELECT id FROM delivery_incidents WHERE delivery_id=5').all()).toEqual([{ id }]);
    expect(statusOf(id)).toBe('resolved');
  });

  it('une clôture suivie d’une acceptation machine : la purge détache la preuve sans la supprimer, sans recréation', () => {
    const id = addDelivery(6, { at: now - 200 * day })!;
    resolve(id, now - 199 * day, 'provider_delivery_verified', 'Remise vérifiée chez le prestataire.');
    getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=6").run(now - 198 * day);
    observeDeliveryIncident(getDb(), 6, now - 198 * day);
    expect(runCleanup(getDb(), now).entries.find(entry => entry.name === 'delivery_incidents')).toMatchObject({ status: 'ok', deleted: 1 });
    expect(getDb().prepare('SELECT COUNT(*) n FROM delivery_incidents WHERE delivery_id=6').get()).toEqual({ n: 0 });
    expect(getDb().prepare('SELECT incident_id,delivery_id,note FROM delivery_incident_resolutions').all()).toEqual([{ incident_id: null, delivery_id: 6, note: 'Remise vérifiée chez le prestataire.' }]);
    expect(getDb().prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    scanDeliveryIncidents(getDb(), now);
    expect(getDb().prepare('SELECT COUNT(*) n FROM delivery_incidents WHERE delivery_id=6').get()).toEqual({ n: 0 });
  });

  it('l’ancienne purge, rejouée après un retour arrière, s’exécute sans erreur sur une base contenant des preuves', () => {
    const id = addDelivery(7, { at: now - 200 * day })!;
    resolve(id, now - 199 * day, 'no_action', 'Commande de test.');
    getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=7").run(now - 198 * day);
    observeDeliveryIncident(getDb(), 7, now - 198 * day);
    expect(getDb().prepare(PREVIOUS_INCIDENT_PURGE).run(now - 180 * day).changes).toBe(1);
    expect(getDb().prepare('SELECT incident_id,delivery_id FROM delivery_incident_resolutions').all()).toEqual([{ incident_id: null, delivery_id: 7 }]);
    expect(getDb().prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('les contraintes de la table refusent une note hors borne, une date invalide ou un type mal formé', () => {
    const insert = (kind: string, note: string, resolvedAt: unknown) => getDb().prepare(`INSERT INTO delivery_incident_resolutions(incident_id,delivery_id,kind,note,resolved_at,resolved_by,reason,observations,attempts,delivery_state,order_state)
      VALUES(1,1,?,?,?,1,'unknown',1,1,'review','paid')`).run(kind, note, resolvedAt);
    expect(() => insert('no_action', 'x'.repeat(281), now)).toThrow();
    expect(() => insert('no_action', '', now)).toThrow();
    expect(() => insert('no_action', 'Note', 12)).toThrow();
    expect(() => insert('no_action', 'Note', '2026-09-29T12:00:00Z')).toThrow();
    expect(() => insert('Sans suite', 'Note', now)).toThrow();
    expect(() => insert('no_action;', 'Note', now)).toThrow();
    expect(() => insert('no_action', 'é'.repeat(280), now)).not.toThrow();
  });

  it('refuse sans attendre un verrou tenu par une autre connexion, n’écrit rien et restaure le délai habituel', () => {
    const other = new Database(getDb().name);
    try {
      other.exec('BEGIN IMMEDIATE');
      const started = performance.now();
      let error: unknown;
      try { resolve(); } catch (caught) { error = caught; }
      expect(isRegistryLocked(error)).toBe(true);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(getDb().pragma('busy_timeout', { simple: true })).toBe(SQLITE_BUSY_TIMEOUT_MS);
      other.exec('ROLLBACK');
      expect(count('delivery_incident_resolutions')).toBe(0);
      expect(resolve().status).toBe('ok');
    } finally { if (other.inTransaction) other.exec('ROLLBACK'); other.close(); }
  });

  it('annule ensemble la relecture de la livraison et la clôture si l’écriture échoue', () => {
    getDb().prepare('UPDATE order_deliveries SET attempts=2 WHERE id=1').run();
    getDb().exec("CREATE TRIGGER preuve_en_panne BEFORE INSERT ON delivery_incident_resolutions BEGIN SELECT RAISE(ABORT,'fictif'); END");
    // L'écran montrerait déjà la deuxième observation ; elle n'est enregistrée qu'avec la clôture.
    expect(() => resolve(1, now + 1000, 'no_action', 'Commande de test.', 1, { ...expectedOf(1), observations: 2 })).toThrow();
    expect(getDb().prepare('SELECT observations FROM delivery_incidents WHERE id=1').get()).toEqual({ observations: 1 });
    expect(count('delivery_incident_events')).toBe(1);
    expect(count('delivery_incident_resolutions')).toBe(0);
    expect(getDb().pragma('busy_timeout', { simple: true })).toBe(SQLITE_BUSY_TIMEOUT_MS);
    expect(getDb().inTransaction).toBe(false);
  });

  it('refuse une entrée invalide avant toute écriture', () => {
    expect(() => resolveDeliveryIncident(getDb(), 1, 1, { kind: 'autre' as never, note: 'Note', expected: expectedOf(1) }, now)).toThrow('incident_resolution_input_invalid');
    expect(() => resolveDeliveryIncident(getDb(), 1, 0, { kind: 'no_action', note: 'Note', expected: expectedOf(1) }, now)).toThrow('incident_resolution_input_invalid');
    expect(() => resolveDeliveryIncident(getDb(), 1, 1, { kind: 'no_action', note: 'Note', expected: { ...expectedOf(1), observations: 0 } }, now)).toThrow('incident_resolution_input_invalid');
    expect(() => resolveDeliveryIncident(getDb(), 1, 1, { kind: 'no_action', note: 'écrire à client@example.test', expected: expectedOf(1) }, now)).toThrow('incident_resolution_note_invalid');
    expect(() => resolveDeliveryIncident(getDb(), 1, 99, { kind: 'no_action', note: 'Note', expected: expectedOf(1) }, now + 1000)).toThrow();
    expect(count('delivery_incident_resolutions')).toBe(0);
  });
});
