import type Database from 'better-sqlite3';
import { observeDeliveryIncident, readIncidentResolution, INCIDENT_STATUS_SQL, LATEST_RESOLUTION_JOIN, type IncidentResolution } from './delivery-incidents.js';
import { isResolutionKind, normalizeResolutionNote, resolutionNoteProblem, type ResolutionKind } from './incident-resolution-rules.js';

/** L'état exact affiché au moment du geste : la clôture ne porte jamais sur une observation que la personne n'a pas vue. */
export type ResolutionExpectation = { observations: number; reason: string; delivery_state: string; order_state: string };
export type ResolutionRequest = { kind: ResolutionKind; note: string; expected: ResolutionExpectation };
export type ResolutionResult =
  | { status: 'ok'; created: boolean; resolution: IncidentResolution }
  | { status: 'not_found' } | { status: 'clock' } | { status: 'closed' } | { status: 'changed' };

/** Verrou SQLite tenu par une autre écriture : refus immédiat, aucune attente dans la boucle HTTP. */
export function isRegistryLocked(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED'));
}

function writeWithoutWaiting<T>(db: Database.Database, work: () => T): T {
  const timeout = db.pragma('busy_timeout', { simple: true }) as number;
  try {
    db.pragma('busy_timeout = 0');
    return db.transaction(work).immediate();
  } finally {
    // Le délai habituel revient même après un refus, une erreur ou un retour anticipé.
    if (db.open) db.pragma(`busy_timeout = ${timeout}`);
  }
}

const validExpectation = (value: ResolutionExpectation) => Number.isSafeInteger(value?.observations) && value.observations >= 1 &&
  [value.reason, value.delivery_state, value.order_state].every(text => typeof text === 'string' && text.length > 0 && text.length <= 64);

/**
 * Clôture humaine d'un dossier ouvert, en ajout seul. Aucun envoi, aucune écriture sur la livraison, la commande,
 * les droits ou la tâche reliée : le registre machine garde son état et continue d'observer la livraison.
 */
export function resolveDeliveryIncident(db: Database.Database, incidentId: number, adminId: number, request: ResolutionRequest, now = Date.now()): ResolutionResult {
  if (![incidentId, adminId].every(id => Number.isSafeInteger(id) && id > 0) || !Number.isSafeInteger(now) || now < 1_000_000_000_000 ||
    !isResolutionKind(request?.kind) || !validExpectation(request.expected)) throw new Error('incident_resolution_input_invalid');
  const note = normalizeResolutionNote(String(request.note ?? ''));
  if (resolutionNoteProblem(note)) throw new Error('incident_resolution_note_invalid');
  return writeWithoutWaiting(db, () => {
    const incident = db.prepare('SELECT delivery_id,last_checked_at FROM delivery_incidents WHERE id=?').get(incidentId) as { delivery_id: number; last_checked_at: number } | undefined;
    if (!incident) return { status: 'not_found' } as const;
    if (now < incident.last_checked_at) return { status: 'clock' } as const;
    // La clôture porte sur l'état enregistré à cet instant, relu dans la même transaction, pas sur l'écran du bureau.
    observeDeliveryIncident(db, incident.delivery_id, now);
    const current = db.prepare(`SELECT i.state,i.reason,i.observations,i.last_attempts,i.last_delivery_state,i.last_order_state,${INCIDENT_STATUS_SQL} status,r.id resolution_id
      FROM delivery_incidents i ${LATEST_RESOLUTION_JOIN} WHERE i.id=?`).get(incidentId) as {
      state: string; reason: string; observations: number; last_attempts: number; last_delivery_state: string; last_order_state: string; status: string; resolution_id: number | null };
    if (current.state !== 'open') return { status: 'closed' } as const;
    const expected = request.expected;
    if (expected.observations !== current.observations || expected.reason !== current.reason ||
      expected.delivery_state !== current.last_delivery_state || expected.order_state !== current.last_order_state) return { status: 'changed' } as const;
    // Rejeu ou double geste : la clôture en vigueur est conservée telle quelle, jamais remplacée.
    if (current.status === 'resolved') return { status: 'ok', created: false, resolution: readIncidentResolution(db, current.resolution_id!, adminId)! } as const;
    const inserted = db.prepare(`INSERT INTO delivery_incident_resolutions(incident_id,delivery_id,kind,note,resolved_at,resolved_by,reason,observations,attempts,delivery_state,order_state)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(incidentId, incident.delivery_id, request.kind, note, now, adminId, current.reason, current.observations, current.last_attempts, current.last_delivery_state, current.last_order_state);
    return { status: 'ok', created: true, resolution: readIncidentResolution(db, Number(inserted.lastInsertRowid), adminId)! } as const;
  });
}
