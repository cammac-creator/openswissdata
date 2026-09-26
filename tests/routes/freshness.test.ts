import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthRoute } from '../../src/routes/health.js';
import { closeDb, getDb } from '../../src/lib/db.js';
import { finmaFreshness } from '../../src/lib/dataset-freshness.js';

describe('Fraîcheur FINMA : date réelle et seuil exact', () => {
  let temp: string;
  const instant = Date.parse('2026-09-26T12:00:00Z');
  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'osd-freshness-'));
    vi.stubEnv('DATABASE_PATH', join(temp, 'test.sqlite'));
    vi.spyOn(Date, 'now').mockReturnValue(instant);
  });
  afterEach(() => { closeDb(); rmSync(temp, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it.each(['2026.02.31', '2026-09-26', '2026x09x26', '2026.09.26-suite', '2026.13.01', '0000.01.01', '2026.02.29', '', null, '<secret>'])('refuse une édition invalide sans en reproduire le contenu : %s', version => {
    expect(finmaFreshness(version, instant)).toEqual({ status: 'stale', finma_version: null, age_hours: null });
  });
  it('accepte un jour bissextile réel et refuse le futur', () => {
    expect(finmaFreshness('2024.02.29', Date.parse('2024-02-29T23:00:00Z'))).toEqual({ status: 'ok', finma_version: '2024.02.29', age_hours: 23 });
    expect(finmaFreshness('2026.09.27', instant)).toEqual({ status: 'stale', finma_version: '2026.09.27', age_hours: null });
  });
  it('sépare le seuil exact de 72 heures de son affichage arrondi', () => {
    const midnight = Date.parse('2026-09-23T00:00:00Z');
    expect(finmaFreshness('2026.09.23', midnight + 72 * 3_600_000 - 1).status).toBe('ok');
    expect(finmaFreshness('2026.09.23', midnight + 72 * 3_600_000).status).toBe('stale');
  });
  it('sert 503 sans donnée puis 200 sans cache pour la version réellement enregistrée', async () => {
    const missing = await healthRoute.request('/freshness');
    expect(missing.status).toBe(503); expect(missing.headers.get('cache-control')).toBe('no-store');
    getDb().prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,current_version,created_at) VALUES('finma','FINMA','finma',29900,'fictif','2026.09.26',?)").run(instant);
    const good = await healthRoute.request('/freshness');
    expect(good.status).toBe(200); expect(good.headers.get('cache-control')).toBe('no-store');
    expect(await good.json()).toEqual({ status: 'ok', finma_version: '2026.09.26', age_hours: 12 });
    getDb().prepare("UPDATE datasets SET current_version='2026.02.31' WHERE id='finma'").run();
    const invalid = await healthRoute.request('/freshness');
    expect(invalid.status).toBe(503); expect((await invalid.json()).finma_version).toBeNull();
  });
});
