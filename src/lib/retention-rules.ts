// Durées de conservation décidées par Claude-Alain le 29.09.2026, appliquées par le nettoyage périodique.
// Achats et preuves : dix ans après la fin de l'année civile suisse de l'achat. Suivi client : trois ans après
// le dernier achat ou échange connu de la base. Compte : dix ans sans achat, une fois achats et suivi effacés.
// Chaque effacement est inscrit dans retention_erasures dans la même transaction, sans réseau.
// Les mêmes fonctions d'effacement servent à la règle et au rejeu après restauration (erasure-registry.ts).
import type Database from 'better-sqlite3';
import { swissDay, swissMidnight } from './crm-period.js';
import { refreshOrderRights } from './order-rights.js';
import { emailKey, internalEmails } from './crm-customers.js';

export const PURCHASE_RETENTION_YEARS = 10;
export const CRM_RETENTION_YEARS = 3;
export const ACCOUNT_RETENTION_YEARS = 10;
/** Ordre du rejeu à date égale : achats, puis suivi, puis compte (même ordre que le nettoyage). */
export const ERASURE_CATEGORIES = ['purchase_order', 'crm_records', 'customer_account'] as const;
export type ErasureCategory = typeof ERASURE_CATEGORIES[number];
export type EraseOutcome = 'erased' | 'absent' | 'newer';
export type RuleOutcome = { deleted: number; error?: 'timestamp_format' };

/** Refus explicite : une date illisible ou un compte qui garde des achats n'est jamais effacé par cascade. */
export class RetentionError extends Error {
  constructor(readonly code: 'timestamp_format' | 'account_has_records') { super(code); }
}

const MS_FLOOR = 1_000_000_000_000;
const isMs = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= MS_FLOOR;

/** Même instant, n années civiles plus tôt (UTC) ; un 29 février devient le 28. */
export function yearsBefore(now: number, years: number): number {
  const at = new Date(now), year = at.getUTCFullYear() - years, month = at.getUTCMonth();
  const day = Math.min(at.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return Date.UTC(year, month, day, at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds());
}

/** Première milliseconde encore conservée : 1er janvier, heure suisse, de l'année courante moins dix. */
export function purchaseBoundary(now: number): number {
  return swissMidnight(`${Number(swissDay(now).slice(0, 4)) - PURCHASE_RETENTION_YEARS}-01-01`);
}

/** Précontrôle : toutes les dates non vides sont des entiers en millisecondes (secondes ou texte → examen humain). */
function datesAreMilliseconds(db: Database.Database, clocks: ReadonlyArray<readonly [string, string]>): boolean {
  return !clocks.some(([table, column]) => db.prepare(`SELECT 1 FROM ${table} WHERE ${column} IS NOT NULL AND (typeof(${column})<>'integer' OR ${column}<${MS_FLOOR}) LIMIT 1`).get());
}

function recordErasure(db: Database.Database, category: ErasureCategory, subjectId: number, erasedAt: number): void {
  db.prepare('INSERT INTO retention_erasures(category,subject_id,erased_at) VALUES(?,?,?)').run(category, subjectId, erasedAt);
}

// Commande réglée : aucun litige, vérification financière, livraison, incident ou action encore ouverts.
const ORDER_SETTLED_SQL = `o.status IN ('paid','refunded','dispute_lost')
  AND COALESCE(o.dispute_status,'') NOT IN ('needs_response','under_review','warning_needs_response','warning_under_review')
  AND NOT EXISTS(SELECT 1 FROM order_deliveries d WHERE d.order_id=o.id AND d.state NOT IN ('sent','cancelled'))
  AND NOT EXISTS(SELECT 1 FROM order_deliveries d JOIN delivery_incidents i ON i.delivery_id=d.id WHERE d.order_id=o.id AND i.state='open')
  AND NOT EXISTS(SELECT 1 FROM order_deliveries d JOIN delivery_incidents i ON i.delivery_id=d.id JOIN delivery_incident_tasks l ON l.incident_id=i.id
    JOIN crm_tasks t ON t.id=l.task_id WHERE d.order_id=o.id AND t.done_at IS NULL)
  AND (o.stripe_payment_intent IS NULL OR NOT EXISTS(SELECT 1 FROM stripe_financial_jobs j WHERE j.payment_intent=o.stripe_payment_intent
    AND (j.state<>'synced' OR j.checked_revision<j.revision)))`;

/**
 * Commande et traces qui en dépendent : livraisons, incidents, preuves de clôture, liaisons d'actions, droits,
 * preuve des CGV, traces de téléchargement et états financiers de son paiement. Jamais le compte, ni les notes
 * et actions du client (règle du suivi). Les droits restants sont recalculés à partir des autres achats.
 */
export function eraseOrder(db: Database.Database, orderId: number, bound: number): EraseOutcome {
  const order = db.prepare('SELECT customer_id,stripe_payment_intent,created_at FROM orders WHERE id=?').get(orderId) as
    { customer_id: number; stripe_payment_intent: string | null; created_at: unknown } | undefined;
  if (!order) return 'absent';
  if (!isMs(order.created_at)) throw new RetentionError('timestamp_format');
  if (order.created_at > bound) return 'newer';
  const deliveries = 'SELECT id FROM order_deliveries WHERE order_id=?';
  const incidents = `SELECT id FROM delivery_incidents WHERE delivery_id IN (${deliveries})`;
  db.prepare(`DELETE FROM delivery_incident_resolutions WHERE delivery_id IN (${deliveries})`).run(orderId);
  db.prepare(`DELETE FROM delivery_incident_tasks WHERE incident_id IN (${incidents})`).run(orderId);
  db.prepare(`DELETE FROM delivery_incident_events WHERE incident_id IN (${incidents})`).run(orderId);
  db.prepare(`DELETE FROM delivery_incidents WHERE delivery_id IN (${deliveries})`).run(orderId);
  db.prepare('DELETE FROM download_tokens WHERE token IN (SELECT download_token FROM order_deliveries WHERE order_id=? AND download_token IS NOT NULL)').run(orderId);
  db.prepare('DELETE FROM download_activity WHERE order_id=?').run(orderId);
  db.prepare('DELETE FROM order_deliveries WHERE order_id=?').run(orderId);
  db.prepare('DELETE FROM order_legal WHERE order_id=?').run(orderId);
  db.prepare('DELETE FROM order_grants WHERE order_id=?').run(orderId);
  const holders = (db.prepare('SELECT DISTINCT customer_id FROM entitlements WHERE order_id=?').all(orderId) as Array<{ customer_id: number }>).map(row => row.customer_id);
  db.prepare('DELETE FROM entitlements WHERE order_id=?').run(orderId);
  const intent = order.stripe_payment_intent;
  if (intent && !db.prepare('SELECT 1 FROM orders WHERE stripe_payment_intent=? AND id<>?').get(intent, orderId)) {
    const charges = (db.prepare('SELECT charge_id FROM stripe_charge_states WHERE payment_intent=? UNION SELECT charge_id FROM stripe_financial_jobs WHERE payment_intent=?')
      .all(intent, intent) as Array<{ charge_id: string }>).map(row => row.charge_id);
    for (const charge of charges) {
      db.prepare('DELETE FROM stripe_financial_events WHERE charge_id=?').run(charge);
      db.prepare('DELETE FROM stripe_financial_jobs WHERE charge_id=?').run(charge);
      db.prepare('DELETE FROM stripe_charge_states WHERE charge_id=?').run(charge);
    }
  }
  db.prepare('DELETE FROM orders WHERE id=?').run(orderId);
  for (const customer of new Set([order.customer_id, ...holders])) refreshOrderRights(db, customer);
  return 'erased';
}

/** Notes, actions, fiche et langue du client antérieures ou égales à la borne ; jamais ses achats ni ses preuves. */
export function eraseCrmRecords(db: Database.Database, customerId: number, bound: number): EraseOutcome {
  const dates = db.prepare(`SELECT created_at d FROM crm_notes WHERE customer_id=@id UNION ALL SELECT created_at FROM crm_tasks WHERE customer_id=@id
    UNION ALL SELECT updated_at FROM crm_profiles WHERE customer_id=@id UNION ALL SELECT updated_at FROM crm_languages WHERE customer_id=@id`)
    .all({ id: customerId }) as Array<{ d: unknown }>;
  if (dates.some(row => !isMs(row.d))) throw new RetentionError('timestamp_format');
  // La liaison d'une action à un incident est retirée explicitement, sans compter sur la cascade.
  db.prepare('DELETE FROM delivery_incident_tasks WHERE task_id IN (SELECT id FROM crm_tasks WHERE customer_id=? AND created_at<=?)').run(customerId, bound);
  let removed = 0;
  for (const sql of [
    'DELETE FROM crm_tasks WHERE customer_id=? AND created_at<=?',
    'DELETE FROM crm_notes WHERE customer_id=? AND created_at<=?',
    'DELETE FROM crm_profiles WHERE customer_id=? AND updated_at<=?',
    'DELETE FROM crm_languages WHERE customer_id=? AND updated_at<=?',
  ]) removed += db.prepare(sql).run(customerId, bound).changes;
  return removed ? 'erased' : 'absent';
}

// Tout ce qui interdit d'effacer un compte : achat, droit, suivi, rôle d'auteur, application MCP reliée.
const ACCOUNT_RECORDS_SQL = `EXISTS(SELECT 1 FROM orders WHERE customer_id=@id) OR EXISTS(SELECT 1 FROM entitlements WHERE customer_id=@id)
  OR EXISTS(SELECT 1 FROM download_activity WHERE customer_id=@id AND order_id IS NOT NULL)
  OR EXISTS(SELECT 1 FROM crm_notes WHERE customer_id=@id OR author_id=@id) OR EXISTS(SELECT 1 FROM crm_tasks WHERE customer_id=@id)
  OR EXISTS(SELECT 1 FROM crm_profiles WHERE customer_id=@id) OR EXISTS(SELECT 1 FROM crm_languages WHERE customer_id=@id)
  OR EXISTS(SELECT 1 FROM delivery_incident_resolutions WHERE resolved_by=@id) OR EXISTS(SELECT 1 FROM delivery_incident_tasks WHERE created_by=@id)
  OR EXISTS(SELECT 1 FROM mcp_clients WHERE customer_id=@id)`;

/** Adresse, sessions et traces techniques d'un compte sans achat ni suivi restants ; refuse toute cascade. */
export function eraseCustomerAccount(db: Database.Database, customerId: number, bound: number): EraseOutcome {
  const customer = db.prepare('SELECT created_at FROM customers WHERE id=?').get(customerId) as { created_at: unknown } | undefined;
  if (!customer) return 'absent';
  if (!isMs(customer.created_at)) throw new RetentionError('timestamp_format');
  if (customer.created_at > bound) return 'newer';
  if (db.prepare(`SELECT 1 WHERE ${ACCOUNT_RECORDS_SQL}`).get({ id: customerId })) throw new RetentionError('account_has_records');
  db.prepare('DELETE FROM sessions WHERE customer_id=?').run(customerId);
  db.prepare('DELETE FROM download_tokens WHERE customer_id=?').run(customerId);
  db.prepare('DELETE FROM download_activity WHERE customer_id=?').run(customerId);
  // Les statistiques n'ont qu'un lien souple : elles restent, sans rattachement au compte effacé.
  db.prepare('UPDATE events SET customer_id=NULL WHERE customer_id=?').run(customerId);
  db.prepare('DELETE FROM customers WHERE id=?').run(customerId);
  return 'erased';
}

const isInternal = (email: string, internal: string[]) => internal.includes(emailKey(email));

/** Règle 1 : commandes réglées dont l'année civile suisse est close depuis dix ans. */
export function applyPurchaseRetention(db: Database.Database, now: number): RuleOutcome {
  if (!datesAreMilliseconds(db, [['orders', 'created_at']])) return { deleted: 0, error: 'timestamp_format' };
  const boundary = purchaseBoundary(now);
  return db.transaction(() => {
    const ids = db.prepare(`SELECT o.id FROM orders o WHERE o.created_at<? AND ${ORDER_SETTLED_SQL} ORDER BY o.id`).all(boundary) as Array<{ id: number }>;
    let deleted = 0;
    for (const { id } of ids) {
      if (eraseOrder(db, id, now) !== 'erased') continue;
      recordErasure(db, 'purchase_order', id, now);
      deleted++;
    }
    return { deleted };
  }).immediate();
}

// Dernier achat ou dernier échange que la base connaît. Elle ne garde pas les courriels : un mail non consigné
// dans une note ne compte pas. Les demandes de lien de connexion ne sont connues que pendant leurs 30 jours.
const LAST_CONTACT_SQL = `MAX(c.created_at,
  COALESCE((SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id=c.id),0),
  COALESCE((SELECT MAX(d.sent_at) FROM order_deliveries d JOIN orders o ON o.id=d.order_id WHERE o.customer_id=c.id),0),
  COALESCE((SELECT MAX(r.resolved_at) FROM delivery_incident_resolutions r JOIN order_deliveries d ON d.id=r.delivery_id
    JOIN orders o ON o.id=d.order_id WHERE o.customer_id=c.id),0),
  COALESCE((SELECT MAX(n.created_at) FROM crm_notes n WHERE n.customer_id=c.id),0),
  COALESCE((SELECT MAX(MAX(t.created_at,COALESCE(t.done_at,0))) FROM crm_tasks t WHERE t.customer_id=c.id),0),
  COALESCE((SELECT p.updated_at FROM crm_profiles p WHERE p.customer_id=c.id),0),
  COALESCE((SELECT l.updated_at FROM crm_languages l WHERE l.customer_id=c.id),0),
  COALESCE((SELECT MAX(s.created_at) FROM sessions s WHERE s.customer_id=c.id),0))`;
// Jamais pendant une action ou un incident ouvert (y compris clos manuellement mais encore ouvert pour la machine),
// une vérification financière ou un litige, ni pour un compte interne ou relié à une application MCP.
const CRM_PROTECTED_SQL = `EXISTS(SELECT 1 FROM crm_tasks t WHERE t.customer_id=c.id AND t.done_at IS NULL)
  OR EXISTS(SELECT 1 FROM orders o JOIN order_deliveries d ON d.order_id=o.id JOIN delivery_incidents i ON i.delivery_id=d.id
    WHERE o.customer_id=c.id AND i.state='open')
  OR EXISTS(SELECT 1 FROM orders o JOIN order_deliveries d ON d.order_id=o.id JOIN delivery_incidents i ON i.delivery_id=d.id
    JOIN delivery_incident_tasks l ON l.incident_id=i.id JOIN crm_tasks t ON t.id=l.task_id WHERE o.customer_id=c.id AND t.done_at IS NULL)
  OR EXISTS(SELECT 1 FROM orders o WHERE o.customer_id=c.id AND (o.status IN ('disputed','financial_pending')
    OR COALESCE(o.dispute_status,'') IN ('needs_response','under_review','warning_needs_response','warning_under_review')))
  OR EXISTS(SELECT 1 FROM crm_profiles p WHERE p.customer_id=c.id AND p.internal<>0)
  OR EXISTS(SELECT 1 FROM mcp_clients m WHERE m.customer_id=c.id)`;
const CRM_CLOCKS = [['customers', 'created_at'], ['orders', 'created_at'], ['order_deliveries', 'sent_at'], ['delivery_incident_resolutions', 'resolved_at'],
  ['crm_notes', 'created_at'], ['crm_tasks', 'created_at'], ['crm_tasks', 'done_at'], ['crm_profiles', 'updated_at'], ['crm_languages', 'updated_at'],
  ['sessions', 'created_at']] as const;

/** Règle 2 : notes, fiche, actions et langue effacées trois ans après le dernier achat ou échange connu. */
export function applyCrmRetention(db: Database.Database, now: number): RuleOutcome {
  if (!datesAreMilliseconds(db, CRM_CLOCKS)) return { deleted: 0, error: 'timestamp_format' };
  const cutoff = yearsBefore(now, CRM_RETENTION_YEARS), internal = internalEmails();
  return db.transaction(() => {
    const candidates = db.prepare(`SELECT c.id,c.email FROM customers c WHERE
      (EXISTS(SELECT 1 FROM crm_notes WHERE customer_id=c.id) OR EXISTS(SELECT 1 FROM crm_tasks WHERE customer_id=c.id)
        OR EXISTS(SELECT 1 FROM crm_profiles WHERE customer_id=c.id) OR EXISTS(SELECT 1 FROM crm_languages WHERE customer_id=c.id))
      AND ${LAST_CONTACT_SQL}<? AND NOT (${CRM_PROTECTED_SQL}) ORDER BY c.id`).all(cutoff) as Array<{ id: number; email: string }>;
    let deleted = 0;
    for (const { id, email } of candidates) {
      if (isInternal(email, internal) || eraseCrmRecords(db, id, now) !== 'erased') continue;
      recordErasure(db, 'crm_records', id, now);
      deleted++;
    }
    return { deleted };
  }).immediate();
}

/** Règle 3 : compte créé il y a plus de dix ans, sans achat ni suivi restants, ni session en cours. */
export function applyAccountRetention(db: Database.Database, now: number): RuleOutcome {
  if (!datesAreMilliseconds(db, [['customers', 'created_at'], ['sessions', 'expires_at']])) return { deleted: 0, error: 'timestamp_format' };
  const cutoff = yearsBefore(now, ACCOUNT_RETENTION_YEARS), internal = internalEmails();
  return db.transaction(() => {
    const candidates = db.prepare(`SELECT c.id,c.email FROM customers c WHERE c.created_at<@cutoff
      AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.customer_id=c.id AND s.expires_at>=@now)
      AND NOT (${ACCOUNT_RECORDS_SQL.replaceAll('@id', 'c.id')}) ORDER BY c.id`).all({ cutoff, now }) as Array<{ id: number; email: string }>;
    let deleted = 0;
    for (const { id, email } of candidates) {
      if (isInternal(email, internal) || eraseCustomerAccount(db, id, now) !== 'erased') continue;
      recordErasure(db, 'customer_account', id, now);
      deleted++;
    }
    return { deleted };
  }).immediate();
}
