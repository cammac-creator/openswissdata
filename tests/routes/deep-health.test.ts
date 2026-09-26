import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/index.js';
import { closeDb, getDb } from '../../src/lib/db.js';

const diagnostic = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/deep-health.js', () => ({ diagnoseDependencies: diagnostic }));

describe('Accès privé au diagnostic profond', () => {
  let temp: string;
  const admin = 'A'.repeat(43), buyer = 'B'.repeat(43), expired = 'C'.repeat(43);
  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'osd-diagnostic-'));
    vi.stubEnv('DATABASE_PATH', join(temp, 'test.sqlite'));
    vi.stubEnv('ADMIN_EMAILS', 'admin@example.test');
    const db = getDb(), now = Date.now();
    for (const [email, token, expiry] of [['admin@example.test', admin, now + 60_000], ['client@example.test', buyer, now + 60_000], ['expired@example.test', expired, now - 1]]) {
      const id = db.prepare('INSERT INTO customers(email,created_at) VALUES(?,?)').run(email, now).lastInsertRowid;
      db.prepare('INSERT INTO sessions(token,customer_id,expires_at,created_at) VALUES(?,?,?,?)').run(token, id, expiry, now);
    }
    diagnostic.mockReset().mockResolvedValue({ status: 'ok', checked_at: now, valid_until: now + 60_000, checks: { db: { ok: true }, r2: { ok: true }, stripe: { ok: true } } });
  });
  afterEach(() => { closeDb(); rmSync(temp, { force: true, recursive: true }); vi.unstubAllEnvs(); });
  it('refuse anonyme, client et session expirée avant tout appel externe', async () => {
    const app = createApp();
    for (const [token, status] of [['', 401], [buyer, 403], [expired, 401]] as const) {
      const response = await app.request('/api/health/deep', { headers: { cookie: `osd_session=${token}` } });
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.text()).not.toContain('checks');
    }
    expect((await app.request('/api/health/deep', { method: 'HEAD' })).status).toBe(401);
    expect(diagnostic).not.toHaveBeenCalled();
  });
  it('autorise le propriétaire puis refuse immédiatement sa session révoquée', async () => {
    const app = createApp(), headers = { cookie: `osd_session=${admin}` };
    const response = await app.request('/api/health/deep', { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await response.json()).checks.db.ok).toBe(true);
    getDb().prepare('DELETE FROM sessions WHERE token=?').run(admin);
    expect((await app.request('/api/health/deep', { headers })).status).toBe(401);
    expect(diagnostic).toHaveBeenCalledTimes(1);
  });
  it('rend la dégradation en 503 sans rendre le diagnostic public', async () => {
    diagnostic.mockResolvedValue({ status: 'degraded', checks: { stripe: { ok: false, reason: 'timeout' } } });
    const response = await createApp().request('/api/health/deep', { headers: { cookie: `osd_session=${admin}` } });
    expect(response.status).toBe(503);
    expect((await response.json()).status).toBe('degraded');
  });
  it('ne lance aucun diagnostic si l’administration est désactivée', async () => {
    vi.stubEnv('ADMIN_EMAILS', '');
    expect((await createApp().request('/api/health/deep', { headers: { cookie: `osd_session=${admin}` } })).status).toBe(503);
    expect(diagnostic).not.toHaveBeenCalled();
  });
  it('garde les sondes publiques légères sans appeler les fournisseurs', async () => {
    const app = createApp();
    expect((await app.request('/api/health')).status).toBe(200);
    await app.request('/api/health/ready');
    await app.request('/api/health/freshness');
    expect(diagnostic).not.toHaveBeenCalled();
  });
});
