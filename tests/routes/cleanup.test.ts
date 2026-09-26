import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, closeDb } from '../../src/lib/db.js';
import { createApp } from '../../src/index.js';

describe('Résultat vérifiable du nettoyage planifié', () => {
  let dir: string;
  const headers = { 'x-admin-secret': 'secret-long-strictement-fictif' };
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'osd-cleanup-route-')); process.env.DATABASE_PATH = join(dir, 'fictive.sqlite'); process.env.ADMIN_SECRET = headers['x-admin-secret']; getDb(); });
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.DATABASE_PATH; delete process.env.ADMIN_SECRET; delete process.env.ADMIN_EMAILS; vi.unstubAllGlobals(); });
  it('refuse une purge anonyme sans écrire de témoin', async () => {
    expect((await createApp().request('/api/admin/cleanup-expired', { method: 'POST' })).status).toBe(401);
    expect(getDb().prepare("SELECT COUNT(*) n FROM operation_checks WHERE name='cleanup'").get()).toEqual({ n: 0 });
  });
  it('répond 200 seulement avec un résultat complet et un témoin relisible', async () => {
    const response = await createApp().request('/api/admin/cleanup-expired', { method: 'POST', headers });
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.ok).toBe(true);
    expect(body.entries).toHaveLength(13);
    expect(body.entries).toContainEqual({ name: 'auth_request_limits', deleted: 0, status: 'ok', unit: 'rows' });
    expect(getDb().prepare("SELECT checked_at FROM operation_checks WHERE name='cleanup'").get()).toEqual({ checked_at: body.checked_at });
    expect(JSON.stringify(body)).not.toContain(dir);
  });
  it('répond 503 en cas de purge SQL partielle et garde le détail minimal', async () => {
    const db = getDb();
    db.prepare("INSERT INTO events(kind,name,ts) VALUES('custom','ancien',?)").run(Date.now() - 181 * 86_400_000);
    db.exec("CREATE TRIGGER stop_events BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'raison privée fictive'); END");
    const response = await createApp().request('/api/admin/cleanup-expired', { method: 'POST', headers });
    const body = await response.json();
    expect(response.status).toBe(503); expect(body.ok).toBe(false);
    expect(body.entries.find((e: { name: string }) => e.name === 'events').status).toBe('error');
    expect(JSON.stringify(body)).not.toContain('raison privée');
  });
  it('garde le bureau utilisable si le témoin de nettoyage est illisible', async () => {
    const db = getDb(), now = Date.now(), token = 'Q'.repeat(43);
    process.env.ADMIN_EMAILS = 'admin@example.test';
    db.prepare("INSERT INTO customers(email,created_at) VALUES('admin@example.test',?)").run(now);
    db.prepare('INSERT INTO sessions(token,customer_id,expires_at,created_at) VALUES(?,1,?,?)').run(token, now + 60_000, now);
    db.prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('cleanup',?,'{')").run(now);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const response = await createApp().request('/api/admin/crm/operations', { headers: { cookie: `osd_session=${token}` } });
    expect(response.status).toBe(200);
    expect((await response.json()).cleanup).toBeNull();
    db.exec('DROP TABLE operation_checks');
    const missing = await createApp().request('/api/admin/crm/operations', { headers: { cookie: `osd_session=${token}` } });
    expect(missing.status).toBe(200);
    expect((await missing.json()).cleanup).toBeNull();
  });
});
