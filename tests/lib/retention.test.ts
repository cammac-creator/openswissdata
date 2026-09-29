import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { closeDb, getDb } from '../../src/lib/db.js';
import { readCleanupProof, runCleanup, runFullCleanup } from '../../src/lib/cleanup.js';
import { applyAccountRetention, applyCrmRetention, applyPurchaseRetention, purchaseBoundary, yearsBefore } from '../../src/lib/retention-rules.js';
import { ErasureRegistryError, readErasureMirror, replayErasureRegistry } from '../../src/lib/erasure-registry.js';
import { swissMidnight } from '../../src/lib/crm-period.js';
import { refreshOrderRights } from '../../src/lib/order-rights.js';
import { renderCleanupStatus } from '../../web/src/lib/cleanup-status.js';

// Personnes, achats et identifiants entièrement fictifs ; aucune base réelle ni appel réseau.
const DAY = 86_400_000;
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
    delete process.env.DATABASE_PATH; delete process.env.ADMIN_EMAILS; delete process.env.CRM_INTERNAL_EMAILS;
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

  describe('Règle 1 : commandes et preuves, dix ans après la fin de l’année civile suisse', () => {
    const firstKept = swissMidnight('2026-01-01'), at2036 = swissMidnight('2036-01-01');
    it('efface l’achat de 2025 à la première milliseconde de 2036 (heure suisse), garde celui de 2026', () => {
      expect(purchaseBoundary(at2036)).toBe(firstKept);
      expect(purchaseBoundary(at2036 - 1)).toBe(swissMidnight('2025-01-01'));
      const admin = customer('bureau@example.test', firstKept - 500 * DAY), c = customer('acheteur@example.test', firstKept - 400 * DAY);
      const old = order(c, firstKept - 1, { intent: 'pi_fictif_ancien' }), kept = order(c, firstKept, { intent: 'pi_fictif_garde' });
      const closed = incident(old.delivery, 'accepted', firstKept - 1), followUp = task(c, firstKept - 1, firstKept);
      resolution(closed, old.delivery, admin, firstKept - 1); link(closed, followUp, admin, firstKept - 1); note(c, firstKept - 1, admin);
      db.prepare("INSERT INTO download_activity(customer_id,dataset_id,version,order_id,source,created_at) VALUES(?,'finma','2025.12.31',?,'email',?)").run(c, old.order, firstKept - 1);
      for (const [charge, intent] of [['ch_fictif_ancien', 'pi_fictif_ancien'], ['ch_fictif_garde', 'pi_fictif_garde']]) {
        db.prepare('INSERT INTO stripe_charge_states(charge_id,payment_intent,amount_chf,refunded_chf,dispute_status,livemode,checked_at) VALUES(?,?,29900,0,NULL,1,?)').run(charge, intent, firstKept);
        db.prepare("INSERT INTO stripe_financial_jobs(charge_id,payment_intent,livemode,revision,checked_revision,state,next_attempt_at,checked_at) VALUES(?,?,1,1,1,'synced',?,?)").run(charge, intent, firstKept, firstKept);
        db.prepare('INSERT INTO stripe_financial_events(id,charge_id,created_at) VALUES(?,?,?)').run(`evt_${charge}`, charge, firstKept);
      }
      const alone = customer('seul@example.test', firstKept - 400 * DAY), lonely = order(alone, firstKept - DAY);

      expect(applyPurchaseRetention(db, at2036 - 1)).toEqual({ deleted: 0 });
      expect(applyPurchaseRetention(db, at2036)).toEqual({ deleted: 2 });
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

  describe('Règle 2 : suivi client, trois ans après le dernier achat ou échange connu', () => {
    const NOW = Date.UTC(2031, 5, 15, 12), cutoff = yearsBefore(NOW, 3);
    it('efface notes, actions, fiche et langue à la milliseconde près, sans toucher aux achats ni aux preuves', () => {
      expect(cutoff).toBe(Date.UTC(2028, 5, 15, 12));
      const admin = customer('bureau@example.test', cutoff - 900 * DAY);
      const gone = customer('ancien@example.test', cutoff - 800 * DAY), purchase = order(gone, cutoff - 700 * DAY);
      note(gone, cutoff - 1, admin); task(gone, cutoff - 500 * DAY, cutoff - 400 * DAY); profile(gone, cutoff - 300 * DAY); language(gone, cutoff - 300 * DAY);
      const kept = customer('recent@example.test', cutoff - 800 * DAY); order(kept, cutoff - 700 * DAY); note(kept, cutoff, admin); profile(kept, cutoff - 300 * DAY);
      expect(applyCrmRetention(db, NOW)).toEqual({ deleted: 1 });
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
      expect(applyAccountRetention(db, NOW)).toEqual({ deleted: 1 });
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
    it('rejoue le registre après restauration d’une sauvegarde antérieure : rien de ce qui a été effacé ne revient', async () => {
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
      const replay = replayErasureRegistry(db, NOW + DAY);
      expect(replay).toEqual({ entries: 3, merged: 3, newer: 0, reapplied: { purchase_order: 1, crm_records: 1, customer_account: 1 }, mirror: 'unchanged' });
      expect(db.prepare('SELECT id FROM customers ORDER BY id').all()).toEqual([{ id: admin }, { id: recent }]);
      for (const table of ['orders', 'order_legal', 'order_grants', 'order_deliveries', 'crm_notes', 'crm_profiles', 'sessions']) expect(count(table, `${table === 'orders' ? 'customer_id' : table.startsWith('order_') ? 'order_id' : 'customer_id'}=?`, table.startsWith('order_') ? purchase.order : c)).toBe(0);
      expect([count('orders', 'customer_id=?', recent), count('crm_notes', 'customer_id=?', recent)]).toEqual([1, 1]);
      foreignKeysIntact();
      const witness = db.prepare("SELECT checked_at,details_json FROM operation_checks WHERE name='erasure_replay'").get() as { checked_at: number; details_json: string };
      expect(witness.checked_at).toBe(NOW + DAY);
      expect(witness.details_json).not.toContain('example.test');
      expect(replayErasureRegistry(db, NOW + 2 * DAY)).toEqual({ entries: 3, merged: 0, newer: 0, reapplied: { purchase_order: 0, crm_records: 0, customer_account: 0 }, mirror: 'unchanged' });
    });
    it('garde les lignes postérieures à l’effacement et un identifiant réattribué après restauration', () => {
      const erasedAt = Date.UTC(2031, 0, 1), admin = customer('bureau@example.test', erasedAt - 900 * DAY);
      const returning = customer('revenu@example.test', erasedAt - 800 * DAY);
      note(returning, erasedAt - DAY, admin); note(returning, erasedAt + DAY, admin); profile(returning, erasedAt + DAY);
      const reused = customer('nouvel@example.test', erasedAt + DAY), later = order(reused, erasedAt + DAY);
      const insert = db.prepare('INSERT INTO retention_erasures(category,subject_id,erased_at) VALUES(?,?,?)');
      insert.run('crm_records', returning, erasedAt); insert.run('purchase_order', later.order, erasedAt); insert.run('customer_account', reused, erasedAt);
      expect(replayErasureRegistry(db, erasedAt + 2 * DAY)).toMatchObject({ entries: 3, newer: 2, reapplied: { purchase_order: 0, crm_records: 1, customer_account: 0 } });
      expect(db.prepare('SELECT created_at FROM crm_notes').all()).toEqual([{ created_at: erasedAt + DAY }]);
      expect([count('crm_profiles'), count('orders'), count('customers', 'id=?', reused)]).toEqual([1, 1, 1]);
    });
    it('démarre normalement sans copie ni effacement, et crée la copie vide', () => {
      expect(replayErasureRegistry(db, Date.UTC(2031, 0, 1))).toEqual({ entries: 0, merged: 0, newer: 0, reapplied: { purchase_order: 0, crm_records: 0, customer_account: 0 }, mirror: 'created' });
      expect(readErasureMirror(join(dir, 'retention', 'erasures.json'))).toEqual([]);
    });
    it('refuse une copie illisible ou remplacée par un lien, sans rien effacer', () => {
      const admin = customer('bureau@example.test', Date.UTC(2026, 0, 1)), c = customer('client@example.test', Date.UTC(2026, 0, 1));
      note(c, Date.UTC(2026, 0, 2), admin);
      mkdirSync(join(dir, 'retention'));
      writeFileSync(join(dir, 'retention', 'erasures.json'), '{');
      let failure: unknown;
      try { replayErasureRegistry(db); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: 'mirror_unreadable' });
      rmSync(join(dir, 'retention', 'erasures.json'));
      writeFileSync(join(dir, 'ailleurs.json'), JSON.stringify({ version: 1, entries: [{ category: 'crm_records', subject_id: c, erased_at: Date.UTC(2031, 0, 1) }] }));
      symlinkSync(join(dir, 'ailleurs.json'), join(dir, 'retention', 'erasures.json'));
      expect(() => replayErasureRegistry(db)).toThrow(ErasureRegistryError);
      expect([count('crm_notes'), count('retention_erasures')]).toEqual([1, 0]);
    });
    it('refuse le démarrage si un compte à effacer garde un achat, annule tout le rejeu et ne nomme que l’identifiant interne', () => {
      const admin = customer('bureau@example.test', Date.UTC(2026, 0, 1)), c = customer('client@example.test', Date.UTC(2026, 0, 1));
      note(c, Date.UTC(2026, 0, 2), admin); order(c, Date.UTC(2026, 0, 3));
      const erasedAt = Date.UTC(2037, 0, 1);
      mkdirSync(join(dir, 'retention'));
      writeFileSync(join(dir, 'retention', 'erasures.json'), JSON.stringify({ version: 1, entries: [
        { category: 'crm_records', subject_id: c, erased_at: erasedAt }, { category: 'customer_account', subject_id: c, erased_at: erasedAt },
      ] }));
      let failure: unknown;
      try { replayErasureRegistry(db, erasedAt + DAY); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(ErasureRegistryError);
      expect(failure).toMatchObject({ code: 'replay_failed', entry: { category: 'customer_account', subject_id: c } });
      expect(JSON.stringify(failure)).not.toContain('example.test');
      expect([count('crm_notes'), count('orders'), count('retention_erasures')]).toEqual([1, 1, 0]);
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
