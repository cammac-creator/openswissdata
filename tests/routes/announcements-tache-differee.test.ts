// Tâche différée de l'inscription « être prévenu » (24.10.2026) : une base qui tombe juste après la réponse ne doit
// laisser aucune promesse rejetée sans gestionnaire (elle arrêterait le processus), ni écrire, ni envoyer.
// Adresses d'exemple seulement.
import '../helpers/session-origin.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PreparedEmail, EmailSendResult } from '../../src/lib/email.js';

const { sendMock, panne } = vi.hoisted(() => ({
  sendMock: vi.fn<(payload: PreparedEmail, key?: string, options?: { attempts?: number }) => Promise<EmailSendResult>>(),
  panne: { active: false },
}));
vi.mock('../../src/lib/email.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/lib/email.js')>()),
  sendPreparedEmail: sendMock,
}));
vi.mock('../../src/lib/db.js', async importOriginal => {
  const vrai = await importOriginal<typeof import('../../src/lib/db.js')>();
  return {
    ...vrai,
    getDb: (...args: Parameters<typeof vrai.getDb>) => {
      if (panne.active) throw new Error('base indisponible');
      return vrai.getDb(...args);
    },
  };
});

import { createApp } from '../../src/index.js';
import { closeDb, getDb } from '../../src/lib/db.js';
import { settleAnnouncementDeliveries } from '../../src/routes/announcements.js';

const SITE = 'https://www.openswissdata.com';

describe('Inscription « être prévenu » : tâche différée', () => {
  let tmp: string;
  const rejets: unknown[] = [];
  const surRejet = (raison: unknown) => { rejets.push(raison); };
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'osd-annonces-differee-'));
    process.env.DATABASE_PATH = join(tmp, 'fictive.sqlite');
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID', 'environnement-fictif');
    vi.stubEnv('SESSION_SECRET', 'cle-de-session-fictive-pour-les-tests-0123456789');
    panne.active = false;
    rejets.length = 0;
    process.on('unhandledRejection', surRejet);
    sendMock.mockReset();
    sendMock.mockResolvedValue({ sent: true });
  });
  afterEach(() => {
    process.off('unhandledRejection', surRejet);
    panne.active = false;
    closeDb();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('une base qui tombe après la réponse ne rejette aucune promesse, n\'écrit rien et n\'envoie rien', async () => {
    const app = createApp();
    const journal = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await app.request(`${SITE}/api/announcements/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE, 'x-real-ip': '10.77.0.1' },
      body: JSON.stringify({ email: 'personne@example.com', lang: 'fr', subject: 'finma-historique', consent: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    panne.active = true;
    await settleAnnouncementDeliveries();
    await new Promise(resolve => setImmediate(resolve));
    panne.active = false;
    expect(rejets).toEqual([]);
    expect(sendMock).not.toHaveBeenCalled();
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM announcement_subscriptions').get()).toEqual({ n: 0 });
    const messages = journal.mock.calls.map(appel => String(appel[0]));
    expect(messages.some(m => m.startsWith('[annonce]'))).toBe(true);
    expect(messages.join('\n')).not.toContain('personne@example.com');
  });
});
