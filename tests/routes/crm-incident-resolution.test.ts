import '../helpers/session-origin.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, closeDb, SQLITE_BUSY_TIMEOUT_MS } from '../../src/lib/db.js';
import { createApp } from '../../src/index.js';
import { observeDeliveryIncident } from '../../src/lib/delivery-incidents.js';

const now = Date.parse('2026-09-29T12:00:00Z'), cookie = '__Host-osd_session=' + 'D'.repeat(43), origin = 'https://www.openswissdata.com';
describe('Clôture manuelle depuis le bureau privé', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'osd-crm-resolution-')); vi.stubEnv('DATABASE_PATH', join(root, 'fictive.sqlite')); vi.stubEnv('ADMIN_EMAILS', 'owner@example.test'); vi.spyOn(Date, 'now').mockReturnValue(now);
    const db = getDb();
    db.prepare("INSERT INTO customers(id,email,created_at) VALUES(1,'owner@example.test',?),(2,'client@example.test',?)").run(now, now);
    db.prepare("INSERT INTO sessions(purpose,token,customer_id,expires_at,created_at) VALUES ('session',?,1,?,?),('session',?,2,?,?)").run('D'.repeat(43), now + 86400000, now, 'E'.repeat(43), now + 86400000, now);
    db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,current_version,created_at) VALUES('fictif','Exemple fictif','fictif',100,'price_fictif','v1',?)").run(now);
    add(1);
  });
  afterEach(() => { closeDb(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(root, { recursive: true, force: true }); });
  function add(id: number) {
    const db = getDb();
    db.prepare("INSERT INTO orders(id,customer_id,stripe_session_id,amount_chf,items_json,created_at) VALUES(?,2,?,100,'[]',?)").run(id, 'cs_test_fictif_' + id, now);
    db.prepare("INSERT INTO order_deliveries(id,order_id,dataset_id,state,attempts,next_attempt_at,last_error,payload_json,download_token,provider_message_id,created_at) VALUES(?,?,'fictif','review',1,?,'delivery_confirmation_required','corps-secret','jeton-secret','prestataire-secret',?)").run(id, id, now, now);
    observeDeliveryIncident(db, id, now);
  }
  const read = (path = '/incidents', token = cookie) => createApp().request('/api/admin/crm' + path, { headers: { cookie: token } });
  const shown = async (id = 1) => { const row = (await (await read('/incidents')).json()).incidents.find((i: { id: number }) => i.id === id); return { observations: row.observations, reason: row.reason, delivery_state: row.last_delivery_state, order_state: row.last_order_state }; };
  const post = (id: number, body: unknown, headers: Record<string, string> = {}) => createApp().request(`/api/admin/crm/incidents/${id}/resolution`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', 'x-osd-csrf': 'dashboard', ...headers }, body: JSON.stringify(body) });
  const rows = () => (getDb().prepare('SELECT COUNT(*) n FROM delivery_incident_resolutions').get() as { n: number }).n;
  const note = 'Remise confirmée dans le journal du prestataire le 29.09.';

  it('clôt avec preuve, se retrouve dans « Clos manuellement » et ne révèle aucun secret', async () => {
    const expected = await shown();
    const created = await post(1, { kind: 'provider_delivery_verified', note, expected });
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('private, no-store');
    const body = await created.json();
    expect(body).toMatchObject({ ok: true, created: true, resolution: { kind: 'provider_delivery_verified', note, resolved_at: now, resolved_by: 1, by_viewer: true, in_force: true, delivery_state: 'review', order_state: 'paid' } });
    const resolved = await (await read('/incidents?state=resolved')).json();
    expect(resolved.summary).toEqual({ open: 0, resolved: 1, accepted: 0, cancelled: 0 });
    expect(resolved.incidents).toHaveLength(1);
    expect(resolved.incidents[0]).toMatchObject({ id: 1, status: 'resolved', state: 'open', resolution: { note, in_force: true } });
    expect((await (await read('/incidents')).json()).incidents).toEqual([]);
    const history = await (await read('/incidents/1/events')).json();
    expect(history).toMatchObject({ resolution_total: 1, resolutions: [{ note, in_force: true, by_viewer: true }] });
    expect((await (await read('/incidents/1/events?before=1')).json()).resolutions).toBeUndefined();
    for (const text of [JSON.stringify(body), JSON.stringify(resolved), JSON.stringify(history)]) { expect(text).not.toContain('secret'); expect(text).not.toContain('client@example.test'); expect(text).not.toContain('owner@example.test'); }
    const replay = await post(1, { kind: 'no_action', note: 'Second onglet.', expected });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, created: false, resolution: { id: body.resolution.id, kind: 'provider_delivery_verified', note } });
    expect(rows()).toBe(1);
  });

  it('deux confirmations simultanées ne créent qu’une seule preuve', async () => {
    const expected = await shown();
    const responses = await Promise.all([post(1, { kind: 'no_action', note: 'Commande de test.', expected }), post(1, { kind: 'no_action', note: 'Commande de test.', expected })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
    const bodies = await Promise.all(responses.map(r => r.json()));
    expect(new Set(bodies.map(b => b.resolution.id)).size).toBe(1);
    expect(rows()).toBe(1);
  });

  it('protège l’écriture par session administrateur, origine, CSRF et type de contenu', async () => {
    const expected = await shown(), body = { kind: 'no_action', note: 'Commande de test.', expected };
    for (const [headers, status] of [[{ cookie: '' }, 401], [{ cookie: '__Host-osd_session=' + 'E'.repeat(43) }, 403], [{ origin: 'https://example.test' }, 403], [{ 'x-osd-csrf': '' }, 403], [{ 'content-type': 'text/plain' }, 403]] as const) {
      expect((await post(1, body, headers)).status).toBe(status);
    }
    expect(rows()).toBe(0);
  });

  it.each([
    ['sans état attendu', { kind: 'no_action', note: 'Test.' }],
    ['type inconnu', { kind: 'autre', note: 'Test.', expected: 'EXPECTED' }],
    ['champ ajouté', { kind: 'no_action', note: 'Test.', expected: 'EXPECTED', resolved_by: 2 }],
    ['date fournie par le navigateur', { kind: 'no_action', note: 'Test.', expected: 'EXPECTED', resolved_at: 1 }],
    ['observation nulle', { kind: 'no_action', note: 'Test.', expected: { observations: 0, reason: 'x', delivery_state: 'review', order_state: 'paid' } }],
    ['note non textuelle', { kind: 'no_action', note: 42, expected: 'EXPECTED' }],
  ])('refuse un corps invalide (%s) sans écrire', async (_label, raw) => {
    const expected = await shown(), body = JSON.parse(JSON.stringify(raw).replace('"EXPECTED"', JSON.stringify(expected)));
    const response = await post(1, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_body' });
    expect(rows()).toBe(0);
  });

  it.each([
    ['   ', 'note_empty'], ['x'.repeat(281), 'note_too_long'], ['Écrit à client@example.test', 'note_email'], ['Voir https://resend.com/emails/abc', 'note_link'],
    ['Message 4ef9a417-02e9-4d39-ad75-9611e0fcc33c', 'note_identifier'], ['Session cs_live_a1B2c3D4e5F6g7H8', 'note_identifier'], ['Inversion ‮du sens', 'note_control'],
  ])('refuse la note %j avec le code %s sans la renvoyer', async (text, code) => {
    const response = await post(1, { kind: 'no_action', note: text, expected: await shown() });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: code });
    expect(rows()).toBe(0);
  });

  it('refuse un dossier inconnu, un état périmé, un envoi accepté entre-temps et un recul d’horloge', async () => {
    const expected = await shown();
    expect((await post(999, { kind: 'no_action', note: 'Test.', expected })).status).toBe(404);
    const stale = await post(1, { kind: 'no_action', note: 'Test.', expected: { ...expected, observations: 2 } });
    expect(stale.status).toBe(409); expect(await stale.json()).toEqual({ error: 'incident_changed' });
    add(2); const second = await shown(2);
    getDb().prepare("UPDATE order_deliveries SET state='sent',sent_at=? WHERE id=2").run(now);
    const closed = await post(2, { kind: 'no_action', note: 'Test.', expected: second });
    expect(closed.status).toBe(409); expect(await closed.json()).toEqual({ error: 'incident_closed' });
    observeDeliveryIncident(getDb(), 1, now + 5000);
    const clock = await post(1, { kind: 'no_action', note: 'Test.', expected });
    expect(clock.status).toBe(409); expect(await clock.json()).toEqual({ error: 'incident_clock_pending' });
    expect(rows()).toBe(0);
  });

  it('répond 503 sans attendre ni écrire quand une autre connexion tient le verrou, puis accepte la même demande', async () => {
    const expected = await shown(), other = new Database(getDb().name);
    try {
      other.exec('BEGIN IMMEDIATE');
      const started = performance.now(), busy = await post(1, { kind: 'no_action', note: 'Commande de test.', expected });
      expect(busy.status).toBe(503);
      expect(busy.headers.get('retry-after')).toBe('5');
      expect(busy.headers.get('cache-control')).toBe('private, no-store');
      expect(await busy.json()).toEqual({ error: 'incident_busy' });
      expect(performance.now() - started).toBeLessThan(1500);
      expect(getDb().pragma('busy_timeout', { simple: true })).toBe(SQLITE_BUSY_TIMEOUT_MS);
      other.exec('ROLLBACK');
      expect(rows()).toBe(0);
      expect((await post(1, { kind: 'no_action', note: 'Commande de test.', expected })).status).toBe(201);
    } finally { if (other.inTransaction) other.exec('ROLLBACK'); other.close(); }
  });

  it('une action de suivi n’est plus proposée ni créée sur un dossier clos manuellement', async () => {
    expect((await post(1, { kind: 'customer_contacted', note: 'Client informé.', expected: await shown() })).status).toBe(201);
    const task = await createApp().request('/api/admin/crm/incidents/1/task', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', 'x-osd-csrf': 'dashboard' }, body: JSON.stringify({ due_on: null }) });
    expect(task.status).toBe(409);
    expect(await task.json()).toEqual({ error: 'incident_resolved' });
    expect(getDb().prepare('SELECT COUNT(*) n FROM crm_tasks').get()).toEqual({ n: 0 });
  });

  it('les automatisations ne montrent plus le dossier clos parmi ceux à vérifier', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    add(2);
    expect((await post(1, { kind: 'no_action', note: 'Commande de test.', expected: await shown() })).status).toBe(201);
    const operations = await (await read('/operations')).json();
    expect(operations.incidents.summary).toEqual({ open: 1, resolved: 1, accepted: 0, cancelled: 0 });
    expect(operations.incidents.incidents.map((i: { delivery_id: number }) => i.delivery_id)).toEqual([2]);
  });

  it('accepte la sélection « resolved » et refuse toujours une sélection inconnue', async () => {
    expect((await read('/incidents?state=resolved')).status).toBe(200);
    expect((await read('/incidents?state=manual')).status).toBe(400);
  });
});
