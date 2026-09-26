import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectPublicResponse, runPublicMonitor } from '../../scripts/monitor-public.mjs';

const instant = Date.parse('2026-09-26T12:00:00Z');
const ready = { status: 'ready', checks: { database: true, frontend: true }, revision: 'a'.repeat(40) };
const fresh = { status: 'ok', finma_version: '2026.09.26', age_hours: 12 };
describe('Sonde extérieure publique', () => {
  let bronzeDir: string;
  beforeEach(() => { bronzeDir = mkdtempSync(join(tmpdir(), 'osd-monitor-')); });
  afterEach(() => { rmSync(bronzeDir, { recursive: true, force: true }); });
  const options = () => ({ bronzeDir, now: () => instant });
  it('contrôle les deux sondes sans secret, garde leurs octets avant interprétation', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toMatch(/^https:\/\/www.openswissdata.com\/api\/health\/(ready|freshness)$/);
      expect(init.redirect).toBe('error'); expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(Object.keys(init.headers).sort()).toEqual(['accept', 'cache-control', 'user-agent']);
      return Response.json(url.endsWith('ready') ? ready : fresh);
    });
    const result = await runPublicMonitor({ ...options(), fetchImpl });
    expect(result.ok).toBe(true); expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const name of ['ready', 'freshness']) {
      const meta = JSON.parse(readFileSync(join(bronzeDir, `${name}.json`), 'utf8'));
      const raw = readFileSync(join(bronzeDir, `${name}-${meta.sha256}.bin`));
      expect(meta.complete).toBe(true); expect(meta.http).toBe(200);
      expect(meta.sha256).toBe(createHash('sha256').update(raw).digest('hex'));
      expect(JSON.parse(raw.toString())).toEqual(name === 'ready' ? ready : fresh);
    }
  });
  it.each([null, [], { ...ready, revision: null }, { ...ready, checks: { database: 'true', frontend: true } }, { ...ready, status: 'ok' }])('refuse un faux résultat prêt : %j', value => {
    expect(inspectPublicResponse('ready', 200, value, instant).ok).toBe(false);
  });
  it.each([
    { ...fresh, finma_version: '2026.02.31' }, { ...fresh, finma_version: '2026.09.26secret' },
    { ...fresh, finma_version: '2026.09.27' }, { ...fresh, finma_version: '2026.09.23' },
    { ...fresh, age_hours: 0 }, { ...fresh, age_hours: '12' }, { ...fresh, status: 'stale' },
  ])('recoupe la date et l’âge indépendamment du succès annoncé : %j', value => {
    expect(inspectPublicResponse('freshness', 200, value, instant).ok).toBe(false);
  });
  it('applique aussi le seuil exact côté observateur', () => {
    const now = Date.parse('2026-09-29T00:00:00Z');
    expect(inspectPublicResponse('freshness', 200, { ...fresh, age_hours: 72 }, now - 1).ok).toBe(true);
    expect(inspectPublicResponse('freshness', 200, { ...fresh, age_hours: 72 }, now).ok).toBe(false);
    expect(inspectPublicResponse('ready', 503, ready, instant).ok).toBe(false);
  });
  it('continue la seconde sonde après une panne et ne reproduit aucune erreur brute', async () => {
    const fetchImpl = vi.fn(async url => { if (url.endsWith('ready')) throw new Error('secret@example.test'); return Response.json(fresh); });
    const result = await runPublicMonitor({ ...options(), fetchImpl });
    expect(result.ok).toBe(false); expect(result.checks.map(c => c.ok)).toEqual([false, true]);
    expect(JSON.stringify(result)).not.toContain('secret'); expect(result.checks[0].reason).toBe('network_error');
  });
  it('conserve une réponse malformée en privé sans en afficher le corps', async () => {
    const result = await runPublicMonitor({ ...options(), fetchImpl: async () => new Response('<secret@example.test>') });
    expect(result.ok).toBe(false); expect(result.checks[0].reason).toBe('invalid_json');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(readdirSync(bronzeDir).filter(f => f.endsWith('.bin'))).toHaveLength(2);
  });
  it('arrête les réponses volumineuses et marque la copie tronquée', async () => {
    const result = await runPublicMonitor({ ...options(), fetchImpl: async () => new Response('x'.repeat(100_000)) });
    expect(result.ok).toBe(false); expect(result.checks[0].reason).toBe('body_too_large');
    const meta = JSON.parse(readFileSync(join(bronzeDir, 'ready.json'), 'utf8'));
    expect(meta.complete).toBe(false); expect(meta.bytes).toBe(32_768);
  });
  it('borne aussi un corps qui ne termine jamais', async () => {
    const fetchImpl = async (_url, init) => new Response(new ReadableStream({ start(controller) { init.signal.addEventListener('abort', () => controller.error(new Error('aborted'))); } }));
    const result = await runPublicMonitor({ ...options(), fetchImpl, timeoutMs: 20 });
    expect(result.ok).toBe(false); expect(result.checks.every(c => c.reason === 'timeout')).toBe(true);
  });
  it('refuse l’écrasement d’une copie de traitement préexistante', async () => {
    const result = await runPublicMonitor({ ...options(), bronzeDir: join(bronzeDir, 'ready.json', 'sub'), fetchImpl: async () => Response.json(ready) });
    // Un second passage dans le même dossier refuse l’écrasement des sources.
    expect(result.checks[0].ok).toBe(true);
    const repeated = await runPublicMonitor({ ...options(), bronzeDir: join(bronzeDir, 'ready.json', 'sub'), fetchImpl: async () => Response.json(ready) });
    expect(repeated.checks.every(c => c.reason === 'bronze_error')).toBe(true);
  });
  it('échoue si le répertoire de copie ne peut pas être créé', async () => {
    writeFileSync(join(bronzeDir, 'obstacle'), 'fictif');
    const result = await runPublicMonitor({ ...options(), bronzeDir: join(bronzeDir, 'obstacle', 'sub'), fetchImpl: async () => Response.json(ready) });
    expect(result.ok).toBe(false); expect(result.checks.every(c => c.reason === 'bronze_error')).toBe(true);
  });
  it('borne aussi une connexion qui ne reçoit aucun en-tête', async () => {
    const fetchImpl = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout'))));
    const result = await runPublicMonitor({ ...options(), fetchImpl, timeoutMs: 20 });
    expect(result.checks.every(c => c.reason === 'timeout')).toBe(true);
  });
  it('distingue erreur HTTP avec HTML et ancienneté FINMA explicite', async () => {
    const result = await runPublicMonitor({ ...options(), fetchImpl: async url => url.endsWith('ready') ? new Response('<html>Erreur</html>', { status: 503 }) : Response.json({ status: 'stale', finma_version: '2026.09.20' }, { status: 503 }) });
    expect(result.checks.map(c => c.reason)).toEqual(['http_error', 'stale']); expect(result.ok).toBe(false);
  });
});
