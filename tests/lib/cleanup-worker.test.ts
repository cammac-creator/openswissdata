import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { CleanupProof } from '../../src/lib/cleanup-types.js';
import { startCleanupWorker } from '../../src/lib/cleanup-worker.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, closeDb } from '../../src/lib/db.js';
import { runFullCleanup, readCleanupProof } from '../../src/lib/cleanup.js';

const NOW = Date.UTC(2026, 8, 26, 12), HOUR = 3_600_000;
describe('Conservation autonome dans le serveur', () => {
  let stop: (() => void) | undefined;
  const database = vi.fn(() => ({} as Database.Database));
  const readProof = vi.fn<() => CleanupProof | null>();
  const cleanup = vi.fn<() => Promise<CleanupProof>>();
  const proof = (checked_at = Date.now(), ok = true): CleanupProof => ({ checked_at, ok, entries: [], totalDeleted: 0 });
  const start = () => { stop = startCleanupWorker({ database, readProof, cleanup }); };
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    database.mockClear(); readProof.mockReset().mockReturnValue(null);
    cleanup.mockReset().mockImplementation(async () => proof());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

  it('diffère le premier passage et nettoie sans visite ni tâche GitHub', async () => {
    start(); await vi.advanceTimersByTimeAsync(29_999);
    expect(database).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith(database.mock.results[0].value, NOW + 30_000);
  });
  it('respecte six heures depuis le dernier succès, y compris extérieur', async () => {
    readProof.mockReturnValue(proof(NOW)); start();
    await vi.advanceTimersByTimeAsync(6 * HOUR - 1);
    expect(cleanup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('relit un nouveau succès extérieur avant de décider la reprise', async () => {
    readProof.mockReturnValue(proof(NOW)); start();
    await vi.advanceTimersByTimeAsync(5 * HOUR);
    readProof.mockReturnValue(proof());
    await vi.advanceTimersByTimeAsync(5 * HOUR);
    expect(cleanup).not.toHaveBeenCalled();
  });
  it.each(['incomplet', 'futur'] as const)('ne prend pas un témoin %s pour un succès récent', async kind => {
    readProof.mockReturnValue(proof(kind === 'futur' ? NOW + HOUR : NOW, kind !== 'incomplet'));
    start(); await vi.advanceTimersByTimeAsync(30_000);
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it.each(['exception', 'partiel'] as const)('reprend un échec %s après une heure, sans exposer sa cause brute', async kind => {
    if (kind === 'exception') cleanup.mockRejectedValue(new Error('secret-fictif-ne-pas-journaliser'));
    else cleanup.mockResolvedValue(proof(NOW, false));
    start(); await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(HOUR - 1);
    expect(cleanup).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret-fictif');
  });
  it('reprend aussi une base momentanément inaccessible, avec le même délai', async () => {
    database.mockImplementationOnce(() => { throw new Error('chemin privé fictif'); });
    start(); await vi.advanceTimersByTimeAsync(30_000 + HOUR - 1);
    expect(database).toHaveBeenCalledOnce(); expect(cleanup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(cleanup).toHaveBeenCalledOnce();
  });
  it('ne superpose pas les passages longs et ne relance rien après un arrêt en cours', async () => {
    let finish!: (value: CleanupProof) => void;
    cleanup.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    start(); await vi.advanceTimersByTimeAsync(30_000 + 10 * HOUR);
    expect(cleanup).toHaveBeenCalledOnce();
    stop?.(); finish(proof()); await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect(cleanup).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('annule le premier passage lors de l’arrêt', async () => {
    start(); stop?.(); await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect(database).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('ne reste pas bloqué après un recul de l’horloge', async () => {
    start(); await vi.advanceTimersByTimeAsync(30_000);
    vi.setSystemTime(NOW - 24 * HOUR);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
  it('respecte un succès extérieur après un échec serveur', async () => {
    cleanup.mockResolvedValue(proof(NOW, false)); start();
    await vi.advanceTimersByTimeAsync(30_000);
    readProof.mockReturnValue(proof());
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('écrit un vrai témoin sur une base fictive et évite ensuite une nouvelle purge', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'osd-worker-fictif-'));
    let pending: Promise<CleanupProof> | undefined;
    try {
      const db = getDb(join(dir, 'fictive.sqlite'));
      db.prepare("INSERT INTO events(kind,name,ts) VALUES('custom','fictif-expire',?)").run(NOW - 181 * 24 * HOUR);
      const run = vi.fn((database: Database.Database, now?: number) => { pending = runFullCleanup(database, now); return pending; });
      stop = startCleanupWorker({ database: () => db, cleanup: run });
      await vi.advanceTimersByTimeAsync(30_000); await pending;
      expect(readCleanupProof(db)?.ok).toBe(true);
      expect(db.prepare('SELECT COUNT(*) n FROM events').get()).toEqual({ n: 0 });
      await vi.advanceTimersByTimeAsync(5 * HOUR);
      expect(run).toHaveBeenCalledOnce();
    } finally { stop?.(); closeDb(); rmSync(dir, { recursive: true, force: true }); }
  });
});
