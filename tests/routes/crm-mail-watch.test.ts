import '../helpers/session-origin.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const started = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock('../../src/lib/mail-watch.js', async original => ({ ...await original<typeof import('../../src/lib/mail-watch.js')>(), startMailWatch: started }));
import { getDb, closeDb } from '../../src/lib/db.js';
import { createApp } from '../../src/index.js';

describe('Veille des réponses dans le bureau', () => {
  let dir: string;
  const token = 'W'.repeat(43), hash = 'a1'.repeat(16);
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'osd-veille-route-'));
    process.env.DATABASE_PATH = join(dir, 'fictive.sqlite');
    process.env.ADMIN_EMAILS = 'admin@example.test';
    const db = getDb(), now = Date.now();
    db.prepare("INSERT INTO customers(email,created_at) VALUES('admin@example.test',?)").run(now);
    db.prepare("INSERT INTO sessions(purpose,token,customer_id,expires_at,created_at) VALUES ('session',?,1,?,?)").run(token, now + 60_000, now);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
  });
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.DATABASE_PATH; delete process.env.ADMIN_EMAILS; vi.unstubAllGlobals(); });

  it('ne démarre jamais la veille dans createApp()', () => {
    createApp();
    expect(started).not.toHaveBeenCalled();
    const source = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
    const [app, entry] = source.split('if (import.meta.url === `file://${process.argv[1]}`)');
    expect(app).not.toContain('startMailWatch(');
    expect(entry).toContain('startMailWatch()');
  });

  it('expose le témoin sans empreinte, adresse ni objet', async () => {
    const now = Date.now();
    getDb().prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('mail_watch',?,?)").run(now, JSON.stringify({ version: 1, status: 'ok', code: null, http_status: null, last_success_at: now, last_alert_at: now, matched: 1, alerted: 1, pending: 0, total_alerted: 3, domains: 4, seen: [hash], subject: 'Objet privé', from: 'juridique@finma.ch' }));
    const response = await createApp().request('/api/admin/crm/operations', { headers: { cookie: `__Host-osd_session=${token}` } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.mail_watch).toEqual({ checked_at: now, status: 'ok', code: null, http_status: null, last_success_at: now, last_alert_at: now, matched: 1, alerted: 1, pending: 0, total_alerted: 3, domains: 4 });
    const wire = JSON.stringify(body.mail_watch);
    for (const secret of [hash, 'Objet privé', 'juridique@finma.ch']) expect(wire).not.toContain(secret);
  });

  it('garde le bureau utilisable sans témoin', async () => {
    const response = await createApp().request('/api/admin/crm/operations', { headers: { cookie: `__Host-osd_session=${token}` } });
    expect(response.status).toBe(200);
    expect((await response.json()).mail_watch).toBeNull();
  });
});
