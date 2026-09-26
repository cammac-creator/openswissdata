import type Database from 'better-sqlite3';
import { isCalendarDate } from './calendar-date.js';
import { observeDeliveryIncident, type IncidentTask } from './delivery-incidents.js';

const taskQuery = `SELECT t.id,t.customer_id,t.title,t.due_on,t.done_at,t.created_at
  FROM delivery_incident_tasks link JOIN crm_tasks t ON t.id=link.task_id WHERE link.incident_id=?`;
export function readIncidentTask(db: Database.Database, incidentId: number): IncidentTask | null {
  return db.prepare(taskQuery).get(incidentId) as IncidentTask | undefined ?? null;
}

/** Le rejeu retrouve l’action d’origine ; aucun renvoi, aucune clôture présumée. */
export function createIncidentTask(db: Database.Database, incidentId: number, creatorId: number, dueOn: string | null, now = Date.now()) {
  if (![incidentId, creatorId].every(id => Number.isSafeInteger(id) && id > 0) || !Number.isSafeInteger(now) || now < 1_000_000_000_000 || (dueOn !== null && !isCalendarDate(dueOn))) throw new Error('incident_task_input_invalid');
  return db.transaction(() => {
    const previous = readIncidentTask(db, incidentId);
    if (previous) return { status: 'ok', created: false, task: previous } as const;
    const incident = db.prepare(`SELECT i.delivery_id,i.last_checked_at,d.order_id,o.customer_id FROM delivery_incidents i
      JOIN order_deliveries d ON d.id=i.delivery_id JOIN orders o ON o.id=d.order_id WHERE i.id=?`).get(incidentId) as { delivery_id: number; last_checked_at:number; order_id: number; customer_id: number } | undefined;
    if (!incident) return { status: 'not_found' } as const;
    if(now<incident.last_checked_at)return {status:'clock'} as const;
    // Une première création relit le résultat actuel, même entre deux passages de la relève.
    observeDeliveryIncident(db, incident.delivery_id, now);
    const current = db.prepare('SELECT state FROM delivery_incidents WHERE id=?').get(incidentId) as { state: string };
    if (current.state !== 'open') return { status: 'closed' } as const;
    const title = `Incident ${incidentId} : vérifier la livraison de la commande ${incident.order_id}`;
    const result = db.prepare('INSERT INTO crm_tasks(customer_id,title,due_on,created_at) VALUES(?,?,?,?)').run(incident.customer_id, title, dueOn, now);
    db.prepare('INSERT INTO delivery_incident_tasks(incident_id,task_id,created_by,created_at) VALUES(?,?,?,?)').run(incidentId, result.lastInsertRowid, creatorId, now);
    return { status: 'ok', created: true, task: readIncidentTask(db, incidentId)! } as const;
  }).immediate();
}
