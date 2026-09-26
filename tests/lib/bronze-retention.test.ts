import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { purgeExpiredBronze } from '../../src/lib/bronze-retention.js';

vi.mock('node:fs/promises', async original => {
  const real = await original<typeof import('node:fs/promises')>();
  return { ...real, rm: vi.fn(real.rm) };
});
const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

describe('Erreurs et concurrence pendant la purge du bronze', () => {
  let dir: string, root: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'osd-bronze-errors-')); root = join(dir, 'bronze', 'dashboard');
    for (const day of ['2026-01-01', '2026-01-02']) {
      mkdirSync(join(root, day), { recursive: true }); writeFileSync(join(root, day, 'fictif.enc'), 'fictif');
    }
  });
  afterEach(() => { vi.mocked(rm).mockReset().mockImplementation(real.rm); rmSync(dir, { recursive: true, force: true }); });
  it('garde le nombre réellement retiré si un autre dossier refuse la suppression', async () => {
    vi.mocked(rm).mockRejectedValueOnce(Object.assign(new Error('message et chemin confidentiels fictifs'), { code: 'EACCES' }));
    const result = await purgeExpiredBronze(root, Date.UTC(2026, 8, 26));
    expect(result).toEqual({ deleted: 1, failed: 1 });
    expect(readdirSync(root)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('confidentiels');
  });
  it('ne présente pas un dossier retiré par une autre purge comme une panne', async () => {
    vi.mocked(rm).mockImplementationOnce(async (path, options) => {
      await real.rm(path, options);
      throw Object.assign(new Error('déjà retiré'), { code: 'ENOENT' });
    });
    expect(await purgeExpiredBronze(root, Date.UTC(2026, 8, 26))).toEqual({ deleted: 1, failed: 0 });
    expect(readdirSync(root)).toEqual([]);
  });
});
