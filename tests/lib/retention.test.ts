import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { closeDb, getDb } from '../../src/lib/db.js';
import { readCleanupProof, runCleanup, runFullCleanup } from '../../src/lib/cleanup.js';
import { applyAccountRetention, applyCrmRetention, applyPurchaseRetention, previewRetention, purchaseBoundary, RETENTION_DATE_FLOOR, yearsBefore } from '../../src/lib/retention-rules.js';
import { readErasureMirror, readErasureReplay, reapplyErasures } from '../../src/lib/erasure-registry.js';
import { swissMidnight } from '../../src/lib/crm-period.js';
import { refreshOrderRights } from '../../src/lib/order-rights.js';
import { renderCleanupStatus } from '../../web/src/lib/cleanup-status.js';

// Personnes, achats et identifiants entièrement fictifs ; aucune base réelle ni appel réseau.
const DAY = 86_400_000, HOUR = 3_600_000;
describe('Durées de conservation du 29.09.2026 et registre des effacements', () => {
  let dir: string, dbPath: string, db: Database.Database, sessions = 0;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'osd-retention-'));
    dbPath = join(dir, 'fictive.sqlite');
    process.env.DATABASE_PATH = dbPath;
    db = getDb();
    db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES('finma','FINMA fictif','finma',29900,'price_fictif',?)").run(Date.UTC(2026, 0, 1));
  });
  afterEach(() => {
    closeDb(); rmSync(dir, { recursive: true, force: true });
    delete process.env.DATABASE_PATH; delete process.env.ADMIN_EMAILS; delete process.env.CRM_INTERNAL_EMAILS; delete process.env.OSD_SKIP_ERASURE_REPLAY;
  });

  const count = (table: string, where = '1', ...params: unknown[]) => (db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).get(...params) as { n: number }).n;
  const customer = (email: string, createdAt: number) => Number(db.prepare('INSERT INTO customers(email,created_at) VALUES(?,?)').run(email, createdAt).lastInsertRowid);
  const order = (customerId: number, createdAt: number, options: { intent?: string; status?: string; delivery?: string } = {}) => {
    const id = Number(db.prepare(`INSERT INTO orders(customer_id,stripe_session_id,stripe_payment_intent,amount_chf,items_json,status,created_at)
      VALUES(?,?,?,29900,'["finma"]',?,?)`).run(customerId, `cs_live_fictif_${++sessions}`, options.intent ?? null, options.status ?? 'paid', createdAt).lastInsertRowid);
    db.prepare("INSERT INTO order_legal(order_id,status,terms_version,locale,document_sha256,event_id,event_created_at,recorded_at) VALUES(?,'accepted','2026-09-26','fr',?,?,?,?)")
      .run(id, 'a'.repeat(64), `evt_fictif_${id}`, createdAt, createdAt);
    db.prepare("INSERT INTO order_grants(order_id,dataset_id,updates_until,created_at) VALUES(?,'finma',?,?)").run(id, createdAt + 360 * DAY, createdAt);
    const state = options.delivery ?? 'sent';
    const delivery = Number(db.prepare("INSERT INTO order_deliveries(order_id,dataset_id,state,next_attempt_at,sent_at,created_at) VALUES(?,'finma',?,?,?,?)")
      .run(id, state, createdAt, state === 'sent' ? createdAt : null, createdAt).lastInsertRowid);
    refreshOrderRights(db, customerId);
    return { order: id, delivery };
  };
  const incident = (delivery: number, state: 'open' | 'accepted', at: number) => {
    const id = Number(db.prepare(`INSERT INTO delivery_incidents(delivery_id,state,reason,first_seen_at,last_seen_at,last_checked_at,closed_at,observations,last_attempts,last_delivery_state,last_order_state)
      VALUES(?,?,'fictif',?,?,?,?,1,1,'sent','paid')`).run(delivery, state, at, at, at, state === 'open' ? null : at).lastInsertRowid);
    db.prepare("INSERT INTO delivery_incident_events(incident_id,kind,reason,attempts,recorded_at) VALUES(?,'opened','fictif',1,?)").run(id, at);
    return id;
  };
  const resolution = (incidentId: number, delivery: number, author: number, at: number) => db.prepare(`INSERT INTO delivery_incident_resolutions
    (incident_id,delivery_id,kind,note,resolved_at,resolved_by,reason,observations,attempts,delivery_state,order_state) VALUES(?,?,'no_action','Clôture fictive',?,?,'fictif',1,1,'sent','paid')`)
    .run(incidentId, delivery, at, author);
  const note = (customerId: number, at: number, author: number) => db.prepare("INSERT INTO crm_notes(customer_id,body,author_id,created_at) VALUES(?,'Note fictive',?,?)").run(customerId, author, at);
  const task = (customerId: number, at: number, doneAt: number | null) => Number(db.prepare("INSERT INTO crm_tasks(customer_id,title,done_at,created_at) VALUES(?,'Action fictive',?,?)").run(customerId, doneAt, at).lastInsertRowid);
  const link = (incidentId: number, taskId: number, author: number, at: number) => db.prepare('INSERT INTO delivery_incident_tasks(incident_id,task_id,created_by,created_at) VALUES(?,?,?,?)').run(incidentId, taskId, author, at);
  const profile = (customerId: number, at: number, internal = 0) => db.prepare("INSERT INTO crm_profiles(customer_id,display_name,company,stage,internal,updated_at) VALUES(?,'Personne fictive','Entreprise fictive','clos',?,?)").run(customerId, internal, at);
  const language = (customerId: number, at: number) => db.prepare("INSERT INTO crm_languages(customer_id,code,source,updated_at) VALUES(?,'de','manual',?)").run(customerId, at);
  const session = (customerId: number, createdAt: number, expiresAt: number) => db.prepare("INSERT INTO sessions(token,purpose,customer_id,expires_at,created_at) VALUES(?,'session',?,?,?)").run(`jeton-fictif-${++sessions}`, customerId, expiresAt, createdAt);
  const mcpClient = (customerId: number, at: number, revokedAt: number | null) => db.prepare("INSERT INTO mcp_clients(client_id,client_secret_hash,name,email,tier,scopes,customer_id,created_at,revoked_at) VALUES(?,'empreinte-fictive','Application fictive','appli@example.test','free','',?,?,?)")
    .run(`osd_fictif_${++sessions}`, customerId, at, revokedAt);
  const registry = () => db.prepare('SELECT category,subject_id,erased_at FROM retention_erasures ORDER BY id').all();
  const foreignKeysIntact = () => expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  const writeMirror = (entries: Array<{ category: string; subject_id: number; erased_at: number }>) => {
    mkdirSync(join(dir, 'retention'), { recursive: true });
    writeFileSync(join(dir, 'retention', 'erasures.json'), JSON.stringify({ version: 1, entries }));
  };

  it('n’efface rien aujourd’hui : aucune donnée de 2026 n’atteint l’âge requis', () => {
    const now = Date.now(), admin = customer('bureau@example.test', now - 30 * DAY), c = customer('client@example.test', now - 20 * DAY);
    order(c, now - 20 * DAY); note(c, now - 10 * DAY, admin); task(c, now - 9 * DAY, now - 8 * DAY); profile(c, now - 5 * DAY); language(c, now - 5 * DAY);
    const tables = ['customers', 'orders', 'order_legal', 'order_grants', 'order_deliveries', 'entitlements', 'crm_notes', 'crm_tasks', 'crm_profiles', 'crm_languages'];
    const before = tables.map(table => count(table));
    const result = runCleanup(db, now);
    expect(result.ok).toBe(true);
    for (const name of ['purchase_records', 'crm_records', 'customer_accounts']) expect(result.entries.find(e => e.name === name)).toMatchObject({ status: 'ok', deleted: 0 });
    expect(tables.map(table => count(table))).toEqual(before);
    expect(registry()).toEqual([]);
  });

  it('refuse toute date antérieure à 2025 : rien ne peut être dû avant le 1er janvier 2028', () => {
    expect(RETENTION_DATE_FLOOR).toBe(Date.UTC(2025, 0, 1));
    const admin = customer('bureau@example.test', RETENTION_DATE_FLOOR), c = customer('client@example.test', RETENTION_DATE_FLOOR);
    order(c, RETENTION_DATE_FLOOR); note(c, RETENTION_DATE_FLOOR, admin); profile(c, RETENTION_DATE_FLOOR);
    expect(previewRetention(db, Date.now())).toEqual({ purchase_records: 0, crm_records: 0, customer_accounts: 0 });
    // Première échéance possible : le suivi, trois ans après la plus ancienne date acceptée.
    expect(previewRetention(db, Date.UTC(2028, 0, 1)).crm_records).toBe(0);
    expect(previewRetention(db, Date.UTC(2028, 0, 1) + 1).crm_records).toBe(1);
    // Une date de remplacement (1 000 000 000 000 ms, soit 2001) n'est jamais prise pour un achat ancien.
    db.prepare('UPDATE orders SET created_at=?').run(1_000_000_000_000);
    expect(previewRetention(db, Date.UTC(2040, 0, 1)).purchase_records).toBe('timestamp_format');
    const result = runCleanup(db, Date.UTC(2040, 0, 1));
    expect(result.entries.find(e => e.name === 'purchase_records')).toMatchObject({ status: 'error', error: 'timestamp_format', deleted: 0 });
    expect([count('orders'), count('retention_erasures')]).toEqual([1, 0]);
  });
  it('fournit un inventaire en ligne de commande, en lecture seule et sans adresse', () => {
    const admin = customer('bureau@example.test', Date.UTC(2026, 0, 1)), c = customer('client@example.test', Date.UTC(2026, 0, 1));
    order(c, Date.UTC(2026, 0, 2)); note(c, Date.UTC(2026, 0, 3), admin);
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const run = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'src', 'scripts', 'retention-preview.ts'), dbPath], { cwd: root, env: { NODE_ENV: 'test' }, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ purchase_records: 0, crm_records: 0, customer_accounts: 0 });
    expect(run.stdout).not.toContain('example.test');
    expect([count('customers'), count('crm_notes'), count('retention_erasures')]).toEqual([2, 1, 0]);
  });

  describe('Règle 1 : commandes et preuves, dix ans après la fin de l’année civile suisse', () => {
    const firstKept = swissMidnight('2026-01-01'), at2036 = swissMidnight('2036-01-01');
    it('efface l’achat de 2025 à la première milliseconde de 2036 (heure suisse), garde celui de 2026', () => {
      expect(purchaseBoundary(at2036)).toBe(firstKept);
      expect(purchaseBoundary(at2036 - 1)).toBe(swissMidnight('2025-01-01'));
      const admin = customer('bureau@example.test', firstKept - 300 * DAY), c = customer('acheteur@example.test', firstKept - 200 * DAY);
      const old = order(c, firstKept - 1, { intent: 'pi_fictif_ancien' }), kept = order(c, firstKept, { intent: 'pi_fictif_garde' });
      const closed = incident(old.delivery, 'accepted', firstKept - 1), followUp = task(c, firstKept - 1, firstKept);
      resolution(closed, old.delivery, admin, firstKept - 1); link(closed, followUp, admin, firstKept - 1); note(c, firstKept - 1, admin);
      db.prepare("INSERT INTO download_activity(customer_id,dataset_id,version,order_id,source,created_at) VALUES(?,'finma','2025.12.31',?,'email',?)").run(c, old.order, firstKept - 1);
      // Notification reçue le jour de chaque achat. Depuis le 30.09.2026, une notification de 2026 (remboursement,
      // contestation) garderait l'achat de 2025 jusqu'en 2037 : voir l'ancrage sur le dernier mouvement ci-dessous.
      for (const [charge, intent, movedAt] of [['ch_fictif_ancien', 'pi_fictif_ancien', firstKept - 1], ['ch_fictif_garde', 'pi_fictif_garde', firstKept]] as const) {
        db.prepare('INSERT INTO stripe_charge_states(charge_id,payment_intent,amount_chf,refunded_chf,dispute_status,livemode,checked_at) VALUES(?,?,29900,0,NULL,1,?)').run(charge, intent, firstKept);
        db.prepare("INSERT INTO stripe_financial_jobs(charge_id,payment_intent,livemode,revision,checked_revision,state,next_attempt_at,checked_at) VALUES(?,?,1,1,1,'synced',?,?)").run(charge, intent, firstKept, firstKept);
        db.prepare('INSERT INTO stripe_financial_events(id,charge_id,created_at) VALUES(?,?,?)').run(`evt_${charge}`, charge, movedAt);
      }
      const alone = customer('seul@example.test', firstKept - 200 * DAY), lonely = order(alone, firstKept - DAY);

      // L'inventaire en lecture seule annonce exactement ce que la règle efface, sans rien écrire.
      expect(previewRetention(db, at2036 - 1).purchase_records).toBe(0);
      expect(previewRetention(db, at2036).purchase_records).toBe(2);
      expect([count('orders'), count('retention_erasures')]).toEqual([3, 0]);
      expect(applyPurchaseRetention(db, at2036 - 1)).toEqual({ deleted: 0 });
      expect(applyPurchaseRetention(db, at2036)).toEqual({ deleted: 2 });
      expect(previewRetention(db, at2036).purchase_records).toBe(0);
      for (const table of ['order_legal', 'order_grants', 'order_deliveries', 'download_activity']) expect(count(table, 'order_id IN (?,?)', old.order, lonely.order)).toBe(0);
      expect(count('orders', 'id IN (?,?)', old.order, lonely.order)).toBe(0);
      expect([count('delivery_incidents'), count('delivery_incident_events'), count('delivery_incident_resolutions'), count('delivery_incident_tasks')]).toEqual([0, 0, 0, 0]);
      expect(count('stripe_charge_states', "payment_intent='pi_fictif_ancien'") + count('stripe_financial_jobs', "payment_intent='pi_fictif_ancien'") + count('stripe_financial_events', "charge_id='ch_fictif_ancien'")).toBe(0);
      expect([count('stripe_charge_states'), count('stripe_financial_jobs'), count('stripe_financial_events')]).toEqual([1, 1, 1]);
      // Achat conservé intact, droits recalculés sur lui ; le compte, la note et l'action ne relèvent pas de cette règle.
      for (const table of ['order_legal', 'order_grants', 'order_deliveries']) expect(count(table, 'order_id=?', kept.order)).toBe(1);
      expect(db.prepare('SELECT customer_id,order_id FROM entitlements ORDER BY customer_id').all()).toEqual([{ customer_id: c, order_id: kept.order }]);
      expect([count('customers'), count('crm_notes'), count('crm_tasks')]).toEqual([3, 1, 1]);
      expect(registry()).toEqual([{ category: 'purchase_order', subject_id: old.order, erased_at: at2036 }, { category: 'purchase_order', subject_id: lonely.order, erased_at: at2036 }]);
      foreignKeysIntact();
      expect(applyPurchaseRetention(db, at2036 + DAY)).toEqual({ deleted: 0 });
    });
    it('épargne une commande en litige, en vérification, en livraison ou reliée à un incident ou une action ouverts', () => {
      const old = firstKept - 1, admin = customer('bureau@example.test', old - DAY), c = customer('acheteur@example.test', old - DAY);
      order(c, old, { status: 'disputed' }); order(c, old, { status: 'financial_pending' }); order(c, old, { delivery: 'review' });
      incident(order(c, old).delivery, 'open', old);
      order(c, old, { intent: 'pi_fictif_en_cours' });
      db.prepare("INSERT INTO stripe_financial_jobs(charge_id,payment_intent,livemode,revision,checked_revision,state,next_attempt_at) VALUES('ch_fictif_en_cours','pi_fictif_en_cours',1,2,1,'pending',?)").run(old);
      db.prepare("UPDATE orders SET dispute_status='needs_response' WHERE id=?").run(order(c, old).order);
      const followed = order(c, old), closed = incident(followed.delivery, 'accepted', old);
      link(closed, task(c, old, null), admin, old);
      expect(applyPurchaseRetention(db, at2036)).toEqual({ deleted: 0 });
      expect(count('orders')).toBe(7);
      expect(registry()).toEqual([]);
    });
  });

  describe('Règle 1 : ancrage sur le dernier mouvement de paiement (décision du 30.09.2026)', () => {
    const at2036 = swissMidnight('2036-01-01'), at2037 = swissMidnight('2037-01-01');
    // Paiement réglé et rapproché : état, travail synchronisé et notifications reçues (dates de réception).
    const payment = (intent: string, charge: string, checkedAt: number, movements: number[], refunded = 0, dispute: string | null = null) => {
      db.prepare('INSERT INTO stripe_charge_states(charge_id,payment_intent,amount_chf,refunded_chf,dispute_status,livemode,checked_at) VALUES(?,?,29900,?,?,1,?)').run(charge, intent, refunded, dispute, checkedAt);
      db.prepare("INSERT INTO stripe_financial_jobs(charge_id,payment_intent,livemode,revision,checked_revision,state,next_attempt_at,checked_at) VALUES(?,?,1,1,1,'synced',?,?)").run(charge, intent, checkedAt + 6 * HOUR, checkedAt);
      movements.forEach((at, index) => db.prepare('INSERT INTO stripe_financial_events(id,charge_id,created_at) VALUES(?,?,?)').run(`evt_fictif_${charge}_${index}`, charge, at));
    };
    const orderIds = () => (db.prepare('SELECT id FROM orders ORDER BY id').all() as Array<{ id: number }>).map(row => row.id);

    it('garde un achat du 20.12.2025 remboursé le 10.01.2026 jusqu’au 31.12.2036 à 23 h 59 min 59,999 s (heure suisse), l’efface au premier passage de 2037 ; un achat sans remboursement garde la frontière de 2036', () => {
      const bought = swissMidnight('2025-12-20') + 14 * HOUR, refundedAt = swissMidnight('2026-01-10') + 10 * HOUR;
      const c = customer('rembourse@example.test', bought - DAY), other = customer('simple@example.test', bought - DAY);
      const refunded = order(c, bought, { intent: 'pi_fictif_rembourse', status: 'refunded' });
      db.prepare('UPDATE orders SET refunded_chf=29900 WHERE id=?').run(refunded.order);
      payment('pi_fictif_rembourse', 'ch_fictif_rembourse', refundedAt + 5 * 60_000, [refundedAt, refundedAt + 2_000], 29900);
      const plain = order(other, bought, { intent: 'pi_fictif_simple' });
      payment('pi_fictif_simple', 'ch_fictif_simple', bought + HOUR, []);

      // Sans remboursement : frontière inchangée, première milliseconde de 2036.
      expect(previewRetention(db, at2036 - 1).purchase_records).toBe(0);
      expect(previewRetention(db, at2036).purchase_records).toBe(1);
      expect(applyPurchaseRetention(db, at2036 - 1)).toEqual({ deleted: 0 });
      expect(applyPurchaseRetention(db, at2036)).toEqual({ deleted: 1 });
      expect(orderIds()).toEqual([refunded.order]);

      // Remboursé en 2026 : pièce de l'exercice 2026, gardée jusqu'à la dernière milliseconde de 2036.
      expect(previewRetention(db, at2037 - 1).purchase_records).toBe(0);
      expect(applyPurchaseRetention(db, at2037 - 1)).toEqual({ deleted: 0 });
      expect(orderIds()).toEqual([refunded.order]);
      expect(previewRetention(db, at2037).purchase_records).toBe(1);
      expect(applyPurchaseRetention(db, at2037)).toEqual({ deleted: 1 });
      expect(orderIds()).toEqual([]);
      expect([count('stripe_financial_events'), count('stripe_charge_states'), count('stripe_financial_jobs'), count('order_legal')]).toEqual([0, 0, 0, 0]);
      expect(registry()).toEqual([{ category: 'purchase_order', subject_id: plain.order, erased_at: at2036 }, { category: 'purchase_order', subject_id: refunded.order, erased_at: at2037 }]);
      foreignKeysIntact();
    });

    it.each([
      ['perdue', 'dispute_lost', 'lost'],
      ['gagnée', 'paid', 'won'],
    ])('garde jusqu’à fin 2036 un achat de 2025 dont la contestation est close (%s) en 2026', (_label, status, dispute) => {
      const bought = swissMidnight('2025-11-15') + 9 * HOUR, opened = swissMidnight('2025-12-20') + 11 * HOUR, closed = swissMidnight('2026-02-03') + 16 * HOUR;
      const c = customer('conteste@example.test', bought - DAY), contested = order(c, bought, { intent: 'pi_fictif_conteste', status });
      db.prepare('UPDATE orders SET dispute_status=? WHERE id=?').run(dispute, contested.order);
      payment('pi_fictif_conteste', 'ch_fictif_conteste', closed + HOUR, [opened, closed], 0, dispute);
      expect([previewRetention(db, at2036).purchase_records, previewRetention(db, at2037 - 1).purchase_records]).toEqual([0, 0]);
      expect(applyPurchaseRetention(db, at2037 - 1)).toEqual({ deleted: 0 });
      expect(previewRetention(db, at2037).purchase_records).toBe(1);
      expect(applyPurchaseRetention(db, at2037)).toEqual({ deleted: 1 });
      expect(count('orders')).toBe(0);
    });

    it('compte l’année suisse du mouvement : une notification du 31.12.2026 à 23 h 30 UTC appartient à 2027', () => {
      const c = customer('nouvel-an@example.test', Date.UTC(2026, 4, 1)), late = order(c, Date.UTC(2026, 5, 1), { intent: 'pi_fictif_nouvel_an', status: 'refunded' });
      payment('pi_fictif_nouvel_an', 'ch_fictif_nouvel_an', Date.UTC(2027, 0, 1), [Date.UTC(2026, 11, 31, 23, 30)], 29900);
      expect(previewRetention(db, swissMidnight('2038-01-01') - 1).purchase_records).toBe(0);
      expect(applyPurchaseRetention(db, swissMidnight('2038-01-01') - 1)).toEqual({ deleted: 0 });
      expect(applyPurchaseRetention(db, swissMidnight('2038-01-01'))).toEqual({ deleted: 1 });
      expect(registry()).toEqual([{ category: 'purchase_order', subject_id: late.order, erased_at: swissMidnight('2038-01-01') }]);
    });

    it('ne prolonge jamais une commande par la notification d’un autre paiement, même chez le même client', () => {
      const bought = Date.UTC(2025, 5, 1), c = customer('deux-achats@example.test', bought - DAY);
      const first = order(c, bought, { intent: 'pi_fictif_premier' }), second = order(c, bought, { intent: 'pi_fictif_second', status: 'refunded' });
      payment('pi_fictif_premier', 'ch_fictif_premier', bought + HOUR, []);
      payment('pi_fictif_second', 'ch_fictif_second', Date.UTC(2026, 2, 1), [Date.UTC(2026, 2, 1)], 29900);
      expect(previewRetention(db, at2036).purchase_records).toBe(1);
      expect(applyPurchaseRetention(db, at2036)).toEqual({ deleted: 1 });
      expect(orderIds()).toEqual([second.order]);
      expect([count('stripe_financial_events', "charge_id='ch_fictif_second'"), count('stripe_charge_states', "charge_id='ch_fictif_premier'")]).toEqual([1, 0]);
      expect(registry()).toEqual([{ category: 'purchase_order', subject_id: first.order, erased_at: at2036 }]);
      expect(applyPurchaseRetention(db, at2037)).toEqual({ deleted: 1 });
      expect(orderIds()).toEqual([]);
    });

    it('ignore les relectures du rapprochement toutes les six heures : la frontière ne bouge pas', () => {
      const bought = Date.UTC(2025, 5, 1), refundedAt = Date.UTC(2025, 5, 10), c = customer('relu@example.test', bought - DAY);
      order(c, bought, { intent: 'pi_fictif_relu', status: 'refunded' });
      payment('pi_fictif_relu', 'ch_fictif_relu', refundedAt, [refundedAt], 29900);
      // Mêmes écritures que reconcileCharge à chaque relecture synchronisée, jusqu'à la veille du passage.
      for (let at = swissMidnight('2035-12-30'); at < at2036; at += 6 * HOUR) {
        db.prepare('UPDATE stripe_charge_states SET checked_at=?').run(at);
        db.prepare('UPDATE stripe_financial_jobs SET checked_at=?,next_attempt_at=?').run(at, at + 6 * HOUR);
        db.prepare('UPDATE orders SET financial_checked_at=?').run(at);
      }
      expect(db.prepare('SELECT o.financial_checked_at o, s.checked_at s, j.checked_at j FROM orders o, stripe_charge_states s, stripe_financial_jobs j').get())
        .toEqual({ o: at2036 - 6 * HOUR, s: at2036 - 6 * HOUR, j: at2036 - 6 * HOUR });
      expect(previewRetention(db, at2036 - 1).purchase_records).toBe(0);
      expect(previewRetention(db, at2036).purchase_records).toBe(1);
      expect(applyPurchaseRetention(db, at2036)).toEqual({ deleted: 1 });
    });

    it.each([
      ['en secondes', Math.floor(Date.UTC(2026, 0, 10) / 1000)],
      ['de remplacement (2001)', 1_000_000_000_000],
    ])('refuse une notification financière datée %s : timestamp_format, rien effacé', (_label, badDate) => {
      const bought = Date.UTC(2025, 5, 1), c = customer('date@example.test', bought - DAY);
      order(c, bought);
      order(c, bought, { intent: 'pi_fictif_date', status: 'refunded' });
      payment('pi_fictif_date', 'ch_fictif_date', Date.UTC(2026, 0, 10), [badDate], 29900);
      expect(previewRetention(db, at2037).purchase_records).toBe('timestamp_format');
      const result = runCleanup(db, at2037);
      expect(result.entries.find(e => e.name === 'purchase_records')).toMatchObject({ status: 'error', error: 'timestamp_format', deleted: 0 });
      expect([count('orders'), count('stripe_financial_events'), count('retention_erasures')]).toEqual([2, 1, 0]);
    });

    it('au rejeu, reporte une commande dont une notification reliée est sous le plancher, sans rien effacer', () => {
      const bought = Date.UTC(2025, 5, 1), c = customer('rejeu-date@example.test', bought - DAY);
      const restored = order(c, bought, { intent: 'pi_fictif_rejeu_date', status: 'refunded' });
      payment('pi_fictif_rejeu_date', 'ch_fictif_rejeu_date', Date.UTC(2025, 6, 1), [1_000_000_000_000], 29900);
      writeMirror([{ category: 'purchase_order', subject_id: restored.order, erased_at: at2036 }]);
      expect(reapplyErasures(db, at2036 + DAY, 'startup')).toMatchObject({ status: 'error', issues: ['replay_pending'], deferred: 1,
        reapplied: { purchase_order: 0, crm_records: 0, customer_account: 0 }, deferred_entries: [{ category: 'purchase_order', subject_id: restored.order, reason: 'timestamp_format' }] });
      expect([count('orders'), count('stripe_financial_events'), count('retention_erasures')]).toEqual([1, 1, 0]);
    });

    it('au rejeu, garde une commande dont une notification a été reçue après la date de l’effacement', () => {
      // Effacée le 01.01.2036, base restaurée, puis notification reçue le 11.01.2036 : l'effacement ne l'a jamais couverte.
      const bought = Date.UTC(2025, 5, 1), later = at2036 + 10 * DAY, c = customer('rejeu-recent@example.test', bought - DAY);
      const restored = order(c, bought, { intent: 'pi_fictif_rejeu_recent', status: 'refunded' });
      payment('pi_fictif_rejeu_recent', 'ch_fictif_rejeu_recent', later, [bought + DAY, later], 29900);
      writeMirror([{ category: 'purchase_order', subject_id: restored.order, erased_at: at2036 }]);
      expect(reapplyErasures(db, at2036 + 20 * DAY, 'startup')).toMatchObject({ status: 'ok', pending: 1, deferred: 0, reapplied: { purchase_order: 0, crm_records: 0, customer_account: 0 } });
      expect([count('orders'), count('stripe_financial_events'), count('retention_erasures')]).toEqual([1, 2, 1]);
      // La règle reprend la main : dix ans après la fin de 2036, année du dernier mouvement.
      expect(previewRetention(db, swissMidnight('2047-01-01') - 1).purchase_records).toBe(0);
      expect(previewRetention(db, swissMidnight('2047-01-01')).purchase_records).toBe(1);
    });
  });

  describe('Règle 2 : suivi client, trois ans après le dernier achat ou échange connu', () => {
    const NOW = Date.UTC(2031, 5, 15, 12), cutoff = yearsBefore(NOW, 3);
    it('efface notes, actions, fiche et langue à la milliseconde près, sans toucher aux achats ni aux preuves', () => {
      expect(cutoff).toBe(Date.UTC(2028, 5, 15, 12));
      const admin = customer('bureau@example.test', cutoff - 900 * DAY);
      const gone = customer('ancien@example.test', cutoff - 800 * DAY), purchase = order(gone, cutoff - 700 * DAY);
      note(gone, cutoff - 1, admin); task(gone, cutoff - 500 * DAY, cutoff - 400 * DAY); profile(gone, cutoff - 300 * DAY); language(gone, cutoff - 300 * DAY);
      const kept = customer('recent@example.test', cutoff - 800 * DAY); order(kept, cutoff - 700 * DAY); note(kept, cutoff, admin); profile(kept, cutoff - 300 * DAY);
      expect(previewRetention(db, NOW).crm_records).toBe(1);
      expect(applyCrmRetention(db, NOW)).toEqual({ deleted: 1 });
      expect(previewRetention(db, NOW).crm_records).toBe(0);
      for (const table of ['crm_notes', 'crm_tasks', 'crm_profiles', 'crm_languages']) expect(count(table, 'customer_id=?', gone)).toBe(0);
      expect([count('crm_notes', 'customer_id=?', kept), count('crm_profiles', 'customer_id=?', kept)]).toEqual([1, 1]);
      for (const table of ['order_legal', 'order_grants', 'order_deliveries']) expect(count(table, 'order_id=?', purchase.order)).toBe(1);
      expect([count('orders', 'customer_id=?', gone), count('entitlements', 'customer_id=?', gone), count('customers', 'id=?', gone)]).toEqual([1, 1, 1]);
      expect(registry()).toEqual([{ category: 'crm_records', subject_id: gone, erased_at: NOW }]);
      foreignKeysIntact();
      // Idempotence au même instant : un deuxième passage n'efface rien de plus.
      expect(applyCrmRetention(db, NOW)).toEqual({ deleted: 0 });
    });
    const sources: Array<[string, (c: number, admin: number, at: number) => void]> = [
      ['commande', (c, _admin, at) => { order(c, at); }],
      ['mail de livraison accepté', (c, _admin, at) => { db.prepare('UPDATE order_deliveries SET sent_at=? WHERE id=?').run(at, order(c, at - 10 * DAY).delivery); }],
      ['clôture d’un incident de livraison', (c, admin, at) => { const purchase = order(c, at - 10 * DAY); resolution(incident(purchase.delivery, 'accepted', at - 5 * DAY), purchase.delivery, admin, at); }],
      ['note du bureau', (c, admin, at) => { note(c, at, admin); }],
      ['action terminée', (c, _admin, at) => { task(c, at - 100 * DAY, at); }],
      ['modification de la fiche', (c, _admin, at) => { profile(c, at); }],
      ['préférence de langue', (c, _admin, at) => { language(c, at); }],
      ['demande de lien de connexion', (c, _admin, at) => { session(c, at, at + 15 * 60_000); }],
    ];
    it.each(sources)('compte « %s » comme dernier contact : effacé une milliseconde avant la limite, gardé à la limite', (_label, contact) => {
      const admin = customer('bureau@example.test', cutoff - 900 * DAY);
      const [before, at] = [customer('avant@example.test', cutoff - 800 * DAY), customer('limite@example.test', cutoff - 800 * DAY)];
      for (const c of [before, at]) note(c, cutoff - 700 * DAY, admin);
      contact(before, admin, cutoff - 1); contact(at, admin, cutoff);
      const crmRows = (c: number) => ['crm_notes', 'crm_tasks', 'crm_profiles', 'crm_languages'].reduce((sum, table) => sum + count(table, 'customer_id=?', c), 0);
      const kept = crmRows(at);
      expect(applyCrmRetention(db, NOW)).toEqual({ deleted: 1 });
      expect(registry()).toEqual([{ category: 'crm_records', subject_id: before, erased_at: NOW }]);
      expect([crmRows(before), crmRows(at)]).toEqual([0, kept]);
      foreignKeysIntact();
    });
    const guards: Array<[string, (c: number, admin: number, old: number) => void]> = [
      ['une action ouverte', (c, _admin, old) => { task(c, old, null); }],
      ['un incident clos à la main mais encore ouvert pour la machine', (c, admin, old) => { const purchase = order(c, old); resolution(incident(purchase.delivery, 'open', old), purchase.delivery, admin, old); }],
      ['une vérification financière en attente', (c, _admin, old) => { order(c, old, { status: 'financial_pending' }); }],
      ['un litige ouvert', (c, _admin, old) => { db.prepare("UPDATE orders SET dispute_status='under_review' WHERE id=?").run(order(c, old).order); }],
      ['une fiche interne', (c, _admin, old) => { profile(c, old, 1); }],
      ['une adresse administrateur', () => { process.env.ADMIN_EMAILS = 'autre@example.test, Client@Example.test'; }],
      ['une adresse interne du bureau', () => { process.env.CRM_INTERNAL_EMAILS = 'client@example.test'; }],
      ['une application MCP reliée, même révoquée', (c, _admin, old) => { mcpClient(c, old, old + DAY); }],
      // Toute commande que la règle 1 ne tient pas pour réglée protège aussi le suivi qui l'explique.
      ['un statut de commande manuel', (c, _admin, old) => { order(c, old, { status: 'manual_hold' }); }],
      ['un rapprochement Stripe en attente', (c, _admin, old) => { order(c, old, { intent: 'pi_fictif_suivi' }); db.prepare("INSERT INTO stripe_financial_jobs(charge_id,payment_intent,livemode,revision,checked_revision,state,next_attempt_at) VALUES('ch_fictif_suivi','pi_fictif_suivi',1,2,1,'pending',?)").run(old); }],
      ['une livraison en vérification', (c, _admin, old) => { order(c, old, { delivery: 'review' }); }],
    ];
    it.each(guards)('n’efface jamais le suivi pendant %s', (_label, guard) => {
      const old = cutoff - 800 * DAY, admin = customer('bureau@example.test', old), c = customer('client@example.test', old);
      note(c, old, admin); guard(c, admin, old);
      expect(applyCrmRetention(db, NOW)).toEqual({ deleted: 0 });
      expect(count('crm_notes', 'customer_id=?', c)).toBe(1);
    });
  });

  describe('Règle 3 : compte sans achat depuis dix ans, une fois achats et suivi effacés', () => {
    const NOW = Date.UTC(2040, 1, 29, 8), cutoff = yearsBefore(NOW, 10);
    it('efface adresse, sessions et traces techniques à la milliseconde près ; garde les statistiques sans rattachement', () => {
      expect(cutoff).toBe(Date.UTC(2030, 1, 28, 8));
      const gone = customer('parti@example.test', cutoff - 1), kept = customer('limite@example.test', cutoff);
      for (const c of [gone, kept]) session(c, cutoff - 1, cutoff + 30 * DAY);
      db.prepare("INSERT INTO download_activity(customer_id,dataset_id,version,source,created_at) VALUES(?,'finma','2030.01.01','account',?)").run(gone, cutoff - 1);
      db.prepare("INSERT INTO download_tokens(token,customer_id,dataset_id,version,expires_at,created_at) VALUES('lien-fictif',?,'finma','2030.01.01',?,?)").run(gone, cutoff, cutoff - 1);
      db.prepare("INSERT INTO events(kind,name,customer_id,ts) VALUES('custom','fictif',?,?)").run(gone, NOW - DAY);
      expect(previewRetention(db, NOW)).toEqual({ purchase_records: 0, crm_records: 0, customer_accounts: 1 });
      expect(applyAccountRetention(db, NOW)).toEqual({ deleted: 1 });
      expect(previewRetention(db, NOW).customer_accounts).toBe(0);
      expect(db.prepare('SELECT id FROM customers').all()).toEqual([{ id: kept }]);
      expect([count('sessions', 'customer_id=?', gone), count('download_activity'), count('download_tokens')]).toEqual([0, 0, 0]);
      expect(db.prepare('SELECT customer_id FROM events').all()).toEqual([{ customer_id: null }]);
      expect(count('sessions', 'customer_id=?', kept)).toBe(1);
      expect(registry()).toEqual([{ category: 'customer_account', subject_id: gone, erased_at: NOW }]);
      foreignKeysIntact();
      expect(applyAccountRetention(db, NOW)).toEqual({ deleted: 0 });
    });
    const guards: Array<[string, (c: number, other: number, old: number) => void]> = [
      ['une commande encore conservée', (c, _other, old) => { order(c, old); }],
      ['une note à son sujet', (c, other, old) => { note(c, old, other); }],
      ['une note écrite par lui', (c, other, old) => { note(other, old, c); }],
      ['une clôture d’incident signée par lui', (c, other, old) => { const purchase = order(other, old); resolution(incident(purchase.delivery, 'accepted', old), purchase.delivery, c, old); }],
      ['une action d’incident créée par lui', (c, other, old) => { const purchase = order(other, old); link(incident(purchase.delivery, 'accepted', old), task(other, old, old), c, old); }],
      ['une fiche seule', (c, _other, old) => { profile(c, old); }],
      ['une langue seule', (c, _other, old) => { language(c, old); }],
      ['une application MCP reliée', (c, _other, old) => { mcpClient(c, old, old); }],
      ['une adresse administrateur', () => { process.env.ADMIN_EMAILS = 'client@example.test'; }],
      ['une session en cours', (c, _other, old) => { session(c, old, NOW + 60_000); }],
    ];
    it.each(guards)('n’efface jamais le compte avec %s, ni par cascade ses achats', (_label, guard) => {
      const old = cutoff - DAY, c = customer('client@example.test', old), other = customer('autre@example.test', cutoff + DAY);
      guard(c, other, old);
      const orders = count('orders');
      expect(applyAccountRetention(db, NOW)).toEqual({ deleted: 0 });
      expect(count('customers', 'id=?', c)).toBe(1);
      expect(count('orders')).toBe(orders);
    });
  });

  describe('Passage complet, témoin et registre hors base', () => {
    const NOW = swissMidnight('2037-06-01');
    const scenario = () => {
      process.env.ADMIN_EMAILS = 'bureau@example.test';
      const bought = Date.UTC(2026, 2, 1), admin = customer('bureau@example.test', bought), c = customer('client@example.test', bought);
      const purchase = order(c, bought);
      note(c, bought + DAY, admin); profile(c, bought + DAY); session(c, bought, bought + 30 * DAY);
      const recent = customer('nouveau@example.test', NOW - 10 * DAY); order(recent, NOW - 10 * DAY); note(recent, NOW - 5 * DAY, admin);
      return { admin, c, purchase, recent };
    };
    it('enchaîne achats, suivi puis compte dans un passage, inscrit chaque effacement et reste idempotent', async () => {
      const { admin, c, purchase, recent } = scenario();
      const proof = await runFullCleanup(db, NOW);
      expect(proof.ok).toBe(true);
      expect(proof.entries.filter(e => ['purchase_records', 'crm_records', 'customer_accounts', 'erasure_registry'].includes(e.name)).map(e => [e.name, e.deleted, e.status, e.unit]))
        .toEqual([['purchase_records', 1, 'ok', 'orders'], ['crm_records', 1, 'ok', 'customers'], ['customer_accounts', 1, 'ok', 'customers'], ['erasure_registry', 0, 'ok', 'rows']]);
      const expected = [{ category: 'purchase_order', subject_id: purchase.order, erased_at: NOW }, { category: 'crm_records', subject_id: c, erased_at: NOW }, { category: 'customer_account', subject_id: c, erased_at: NOW }];
      expect(registry()).toEqual(expected);
      expect(readErasureMirror(join(dir, 'retention', 'erasures.json'))).toEqual(expected);
      expect(db.prepare('SELECT id FROM customers ORDER BY id').all()).toEqual([{ id: admin }, { id: recent }]);
      expect([count('orders', 'customer_id=?', recent), count('crm_notes', 'customer_id=?', recent)]).toEqual([1, 1]);
      foreignKeysIntact();
      expect(readCleanupProof(db)).toEqual(proof);
      // Un témoin d'avant ce lot (14 catégories) ne prouve pas la conservation : la minuterie refait un passage.
      const legacy = proof.entries.filter(e => !['purchase_records', 'crm_records', 'customer_accounts', 'erasure_registry'].includes(e.name));
      db.prepare("UPDATE operation_checks SET details_json=? WHERE name='cleanup'").run(JSON.stringify({ ...proof, entries: legacy, totalDeleted: legacy.reduce((n, e) => n + e.deleted, 0) }));
      expect(legacy).toHaveLength(14);
      expect(readCleanupProof(db)).toBeNull();
      const html = renderCleanupStatus(proof, NOW);
      for (const text of ['Commandes et preuves de plus de dix ans', '1 commande retirée', 'Comptes sans achat depuis dix ans', '1 client retiré', 'Copie hors base à jour']) expect(html).toContain(text);
      const again = await runFullCleanup(db, NOW + DAY);
      expect(again.entries.filter(e => ['purchase_records', 'crm_records', 'customer_accounts'].includes(e.name)).every(e => e.deleted === 0 && e.status === 'ok')).toBe(true);
      expect(registry()).toEqual(expected);
    });
    const zero ={ purchase_order: 0, crm_records: 0, customer_account: 0 };
    it('réapplique après restauration d’une sauvegarde antérieure : rien de ce qui a été effacé ne revient', async () => {
      const { admin, c, purchase, recent } = scenario();
      const snapshot = join(dir, 'instantane.sqlite');
      await db.backup(snapshot);
      await runFullCleanup(db, NOW);
      // Restauration : le fichier de base et son registre interne reviennent à l'état de l'instantané.
      closeDb();
      copyFileSync(snapshot, dbPath);
      for (const suffix of ['-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
      db = getDb();
      expect([count('customers', 'id=?', c), count('orders', 'id=?', purchase.order), count('crm_notes', 'customer_id=?', c), count('retention_erasures')]).toEqual([1, 1, 1, 0]);
      expect(reapplyErasures(db, NOW + DAY, 'startup')).toEqual({ status: 'ok', origin: 'startup', checked_at: NOW + DAY, issues: [], mirror_entries: 3, pending: 3, future: 0,
        reapplied: { purchase_order: 1, crm_records: 1, customer_account: 1 }, deferred: 0, deferred_entries: [], mirror: 'unchanged' });
      expect(db.prepare('SELECT id FROM customers ORDER BY id').all()).toEqual([{ id: admin }, { id: recent }]);
      for (const table of ['orders', 'order_legal', 'order_grants', 'order_deliveries', 'crm_notes', 'crm_profiles', 'sessions']) expect(count(table, `${table === 'orders' ? 'customer_id' : table.startsWith('order_') ? 'order_id' : 'customer_id'}=?`, table.startsWith('order_') ? purchase.order : c)).toBe(0);
      expect([count('orders', 'customer_id=?', recent), count('crm_notes', 'customer_id=?', recent), count('retention_erasures')]).toEqual([1, 1, 3]);
      foreignKeysIntact();
      expect(readErasureReplay(db)).toMatchObject({ status: 'ok', origin: 'startup', checked_at: NOW + DAY });
      expect(JSON.stringify(readErasureReplay(db))).not.toContain('example.test');
      // Entrées désormais dans la table : un second démarrage ne réapplique plus rien.
      expect(reapplyErasures(db, NOW + 2 * DAY, 'startup')).toMatchObject({ status: 'ok', pending: 0, reapplied: zero });
    });
    it('garde les lignes postérieures à l’effacement et un identifiant réattribué après restauration', () => {
      const erasedAt = Date.UTC(2031, 0, 1), admin = customer('bureau@example.test', erasedAt - 900 * DAY);
      const returning = customer('revenu@example.test', erasedAt - 800 * DAY);
      note(returning, erasedAt - DAY, admin); note(returning, erasedAt + DAY, admin); profile(returning, erasedAt + DAY);
      const reused = customer('nouvel@example.test', erasedAt + DAY), later = order(reused, erasedAt + DAY);
      writeMirror([{ category: 'crm_records', subject_id: returning, erased_at: erasedAt }, { category: 'purchase_order', subject_id: later.order, erased_at: erasedAt }, { category: 'customer_account', subject_id: reused, erased_at: erasedAt }]);
      expect(reapplyErasures(db, erasedAt + 2 * DAY, 'startup')).toMatchObject({ status: 'ok', pending: 3, reapplied: { purchase_order: 0, crm_records: 1, customer_account: 0 } });
      expect(db.prepare('SELECT created_at FROM crm_notes').all()).toEqual([{ created_at: erasedAt + DAY }]);
      expect([count('crm_profiles'), count('orders'), count('customers', 'id=?', reused), count('retention_erasures')]).toEqual([1, 1, 1, 3]);
    });
    it('ne réapplique jamais une entrée déjà dans la table, ni une entrée datée dans le futur', () => {
      const now = Date.UTC(2031, 0, 1), admin = customer('bureau@example.test', now - 900 * DAY), c = customer('client@example.test', now - 800 * DAY);
      note(c, now - 10 * DAY, admin);
      // Déjà appliquée dans cette base : une note datée avant (horloge, reprise, SQL manuel) n'est pas effacée au redémarrage.
      db.prepare('INSERT INTO retention_erasures(category,subject_id,erased_at) VALUES(?,?,?)').run('crm_records', c, now - DAY);
      writeMirror([{ category: 'crm_records', subject_id: c, erased_at: now - DAY }, { category: 'crm_records', subject_id: c, erased_at: now + 365 * DAY }]);
      expect(reapplyErasures(db, now, 'startup')).toMatchObject({ status: 'error', issues: ['replay_pending'], pending: 1, future: 1, reapplied: zero, deferred: 0 });
      expect([count('crm_notes'), count('retention_erasures')]).toEqual([1, 1]);
    });
    it('démarre normalement sans copie ni effacement, et crée la copie vide', () => {
      expect(reapplyErasures(db, Date.UTC(2031, 0, 1), 'startup')).toMatchObject({ status: 'ok', mirror_entries: 0, pending: 0, reapplied: zero, mirror: 'created' });
      expect(readErasureMirror(join(dir, 'retention', 'erasures.json'))).toEqual([]);
    });
    it.each([
      ['illisible', () => writeFileSync(join(dir, 'retention', 'erasures.json'), '{')],
      ['vide', () => writeFileSync(join(dir, 'retention', 'erasures.json'), '')],
      ['remplacée par un lien', () => { writeFileSync(join(dir, 'ailleurs.json'), JSON.stringify({ version: 1, entries: [] })); symlinkSync(join(dir, 'ailleurs.json'), join(dir, 'retention', 'erasures.json')); }],
    ])('signale une copie %s sans lever d’erreur, sans rien effacer ni la réécrire', async (_label, prepare) => {
      const admin = customer('bureau@example.test', Date.UTC(2026, 0, 1)), c = customer('client@example.test', Date.UTC(2026, 0, 1));
      note(c, Date.UTC(2026, 0, 2), admin);
      mkdirSync(join(dir, 'retention')); prepare();
      const before = lstatSync(join(dir, 'retention', 'erasures.json')).isSymbolicLink() ? 'lien' : readFileSync(join(dir, 'retention', 'erasures.json'), 'utf8');
      expect(reapplyErasures(db, Date.UTC(2031, 0, 1), 'startup')).toMatchObject({ status: 'error', issues: ['mirror_unreadable'], reapplied: zero });
      expect(lstatSync(join(dir, 'retention', 'erasures.json')).isSymbolicLink() ? 'lien' : readFileSync(join(dir, 'retention', 'erasures.json'), 'utf8')).toBe(before);
      expect([count('crm_notes'), count('retention_erasures')]).toEqual([1, 0]);
      const proof = await runFullCleanup(db, Date.UTC(2026, 9, 1));
      expect(proof.entries.find(e => e.name === 'erasure_registry')).toMatchObject({ status: 'error', error: 'storage_error' });
    });
    it('garde le service quand la copie ne peut pas être écrite : témoin rouge, rien d’autre', () => {
      mkdirSync(join(dir, 'retention'), { mode: 0o500 });
      try {
        expect(reapplyErasures(db, Date.UTC(2031, 0, 1), 'startup')).toMatchObject({ status: 'error', issues: ['mirror_write_failed'], mirror: 'failed' });
        expect(readErasureReplay(db)).toMatchObject({ status: 'error', issues: ['mirror_write_failed'] });
      } finally { chmodSync(join(dir, 'retention'), 0o700); }
    });
    it('efface d’abord le suivi résiduel d’un compte restauré, puis le compte', () => {
      // Langue posée le 05.12.2035, sauvegarde le 15.12, langue retirée à la main le 20.12 (hors registre), effacement le 01.01.2036.
      const erasedAt = swissMidnight('2036-01-01'), c = customer('client@example.test', Date.UTC(2025, 5, 1)), purchase = order(c, Date.UTC(2025, 5, 2));
      language(c, Date.UTC(2035, 11, 5));
      writeMirror([{ category: 'purchase_order', subject_id: purchase.order, erased_at: erasedAt }, { category: 'customer_account', subject_id: c, erased_at: erasedAt }]);
      expect(reapplyErasures(db, erasedAt + DAY, 'startup')).toMatchObject({ status: 'ok', deferred: 0, reapplied: { purchase_order: 1, crm_records: 0, customer_account: 1 } });
      expect([count('customers'), count('crm_languages'), count('orders')]).toEqual([0, 0, 0]);
      foreignKeysIntact();
    });
    it('reporte un compte qui garde un achat, sans erreur levée, et le signale au bureau par son seul identifiant interne', async () => {
      const admin = customer('bureau@example.test', Date.UTC(2026, 0, 1)), c = customer('client@example.test', Date.UTC(2026, 0, 1));
      note(c, Date.UTC(2026, 0, 2), admin); order(c, Date.UTC(2026, 0, 3));
      // En 2031, la règle 1 garde encore l'achat de 2026 : le compte reste bloqué au nettoyage suivant.
      const erasedAt = Date.UTC(2031, 0, 1);
      writeMirror([{ category: 'crm_records', subject_id: c, erased_at: erasedAt }, { category: 'customer_account', subject_id: c, erased_at: erasedAt }]);
      const replay = reapplyErasures(db, erasedAt + DAY, 'startup');
      expect(replay).toMatchObject({ status: 'error', issues: ['replay_pending'], deferred: 1, reapplied: { purchase_order: 0, crm_records: 1, customer_account: 0 },
        deferred_entries: [{ category: 'customer_account', subject_id: c, reason: 'account_has_records' }] });
      expect(JSON.stringify(replay)).not.toContain('example.test');
      // Le suivi a été réappliqué ; le compte reste en attente dans la copie, jamais effacé par cascade.
      expect([count('crm_notes'), count('orders'), count('customers', 'id=?', c)]).toEqual([0, 1, 1]);
      expect(registry()).toEqual([{ category: 'crm_records', subject_id: c, erased_at: erasedAt }]);
      expect(readErasureMirror(join(dir, 'retention', 'erasures.json'))).toHaveLength(2);
      const proof = await runFullCleanup(db, erasedAt + 2 * DAY);
      expect(proof.entries.find(e => e.name === 'erasure_registry')).toMatchObject({ status: 'error', error: 'replay_pending' });
      const html = renderCleanupStatus(proof, erasedAt + 2 * DAY, undefined, readErasureReplay(db));
      expect(html).toContain('Registre des effacements à examiner');
      expect(html).toContain(`compte n° ${c}`);
      expect(html).not.toContain('example.test');
    });
    it('suspend la réapplication avec OSD_SKIP_ERASURE_REPLAY=1, sans toucher la copie, et le montre en rouge', async () => {
      const admin = customer('bureau@example.test', Date.UTC(2026, 0, 1)), c = customer('client@example.test', Date.UTC(2026, 0, 1));
      note(c, Date.UTC(2026, 0, 2), admin);
      writeMirror([{ category: 'crm_records', subject_id: c, erased_at: Date.UTC(2030, 0, 1) }]);
      const before = readFileSync(join(dir, 'retention', 'erasures.json'), 'utf8');
      process.env.OSD_SKIP_ERASURE_REPLAY = '1';
      expect(reapplyErasures(db, Date.UTC(2031, 0, 1), 'startup')).toMatchObject({ status: 'suspended', reapplied: zero, mirror: 'skipped' });
      const proof = await runFullCleanup(db, Date.UTC(2026, 9, 1));
      expect(proof.entries.find(e => e.name === 'erasure_registry')).toMatchObject({ status: 'error', error: 'registry_suspended' });
      expect(renderCleanupStatus(proof, Date.UTC(2026, 9, 1), undefined, readErasureReplay(db))).toContain('suspendue par OSD_SKIP_ERASURE_REPLAY');
      expect([count('crm_notes'), readFileSync(join(dir, 'retention', 'erasures.json'), 'utf8')]).toEqual([1, before]);
    });
    it('n’arrête jamais le démarrage à cause du registre', () => {
      const entry = readFileSync(fileURLToPath(new URL('../../src/index.ts', import.meta.url)), 'utf8');
      expect(entry).toContain('reapplyErasures(database, Date.now(), "startup")');
      expect(entry).not.toMatch(/process\.exit\(1\)/);
    });
  });

  describe('Erreurs explicites par catégorie', () => {
    const NOW = Date.UTC(2031, 5, 15, 12);
    it('refuse une date en secondes sans rien effacer et poursuit les autres règles', () => {
      const admin = customer('bureau@example.test', Date.UTC(2026, 0, 1)), c = customer('client@example.test', Date.UTC(2026, 0, 1));
      note(c, Date.UTC(2026, 0, 2), admin);
      db.prepare('INSERT INTO crm_notes(customer_id,body,author_id,created_at) VALUES(?,?,?,?)').run(c, 'Note fictive en secondes', admin, Math.floor(Date.UTC(2026, 0, 2) / 1000));
      const result = runCleanup(db, NOW);
      expect(result.ok).toBe(false);
      expect(result.entries.find(e => e.name === 'crm_records')).toMatchObject({ status: 'error', error: 'timestamp_format', deleted: 0 });
      expect(result.entries.find(e => e.name === 'purchase_records')?.status).toBe('ok');
      expect(count('crm_notes')).toBe(2);
    });
    it('annule la règle entière sur une erreur SQL, sans message brut, et garde le registre cohérent', () => {
      const admin = customer('bureau@example.test', Date.UTC(2026, 0, 1)), c = customer('client@example.test', Date.UTC(2026, 0, 1));
      note(c, Date.UTC(2026, 0, 2), admin); profile(c, Date.UTC(2026, 0, 2));
      db.exec("CREATE TRIGGER stop_notes BEFORE DELETE ON crm_notes BEGIN SELECT RAISE(ABORT, 'chemin privé et message fictif'); END");
      const result = runCleanup(db, NOW);
      expect(result.entries.find(e => e.name === 'crm_records')).toMatchObject({ status: 'error', error: 'database_error', deleted: 0 });
      expect(JSON.stringify(result)).not.toContain('chemin privé');
      expect([count('crm_profiles'), count('retention_erasures')]).toEqual([1, 0]);
    });
    it.each([
      ['un fichier', () => writeFileSync(join(dir, 'retention'), 'pas un dossier')],
      ['un lien symbolique', () => { mkdirSync(join(dir, 'ailleurs')); symlinkSync(join(dir, 'ailleurs'), join(dir, 'retention'), 'dir'); }],
    ])('signale une copie du registre impossible (%s) comme un passage incomplet', async (_label, prepare) => {
      prepare();
      const proof = await runFullCleanup(db, NOW);
      expect(proof.ok).toBe(false);
      expect(proof.entries.find(e => e.name === 'erasure_registry')).toMatchObject({ status: 'error', error: 'storage_error' });
      expect(existsSync(join(dir, 'ailleurs', 'erasures.json'))).toBe(false);
      expect(renderCleanupStatus(proof, NOW)).toContain('Copie hors base à vérifier');
    });
  });
});
