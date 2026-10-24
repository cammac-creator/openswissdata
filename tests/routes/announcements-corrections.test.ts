// Corrections après la relecture de sécurité (24.10.2026) : plafond commun qui compte aussi les confirmations, budget
// quotidien par réseau, refus comptés au relevé, demande échue remplacée sous un nouvel identifiant, effacement sur
// demande écrite par l'administration, aucune demande après le 30.06.2027. Adresses d'exemple seulement.
import '../helpers/session-origin.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PreparedEmail, EmailSendResult } from '../../src/lib/email.js';

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn<(payload: PreparedEmail, key?: string, options?: { attempts?: number }) => Promise<EmailSendResult>>(),
}));
vi.mock('../../src/lib/email.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/lib/email.js')>()),
  sendPreparedEmail: sendMock,
}));

import { createApp } from '../../src/index.js';
import { closeDb, getDb } from '../../src/lib/db.js';
import { settleAnnouncementDeliveries } from '../../src/routes/announcements.js';
import { CONFIRMATION_TTL_MS, DAILY_CONFIRMATION_CAP, NETWORK_DAILY_BUDGET } from '../../src/lib/announcements.js';
import { ANNOUNCEMENT_FALLBACK_END } from '../../src/lib/announcement-retention.js';

const SITE = 'https://www.openswissdata.com';
const SECRET = 'secret-administration-fictif-123';
const HOUR = 3_600_000, DAY = 24 * HOUR;
const START = Date.UTC(2026, 9, 26, 8, 0, 0);
let now = START;
let ipCounter = 0;
const nextIp = () => { ipCounter += 1; return `10.40.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`; };
const valid = (email: string) => ({ email, lang: 'fr', subject: 'finma-historique', consent: true });
type App = ReturnType<typeof createApp>;

async function demande(app: App, email: string, ip = nextIp()) {
  const res = await app.request(`${SITE}/api/announcements/request`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, 'x-real-ip': ip }, body: JSON.stringify(valid(email)),
  });
  await settleAnnouncementDeliveries();
  return res;
}
const rows = () => getDb().prepare('SELECT id, email, requested_at, confirmed_at FROM announcement_subscriptions ORDER BY id').all() as Array<{ id: number; email: string; requested_at: number; confirmed_at: number | null }>;
const unsubscribeLink = () => /\/api\/announcements\/unsubscribe\?token=([A-Za-z0-9_-]{59})(?=[\s"<]|$)/.exec(sendMock.mock.calls.at(-1)![0].text ?? '')![1];
const pendingInsert = () => getDb().prepare('INSERT INTO announcement_subscriptions(email,lang,subject,requested_at,confirmed_at,token_hash,token_expires_at) VALUES(?,?,?,?,?,?,?)');
const indicateurs = async (app: App) => (await app.request('/api/admin/indicateurs', { headers: { 'x-admin-secret': SECRET } })).json() as Promise<Record<string, unknown>>;

describe('Inscription « être prévenu » : corrections de la relecture de sécurité', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'osd-annonces-corrections-'));
    process.env.DATABASE_PATH = join(tmp, 'fictive.sqlite');
    process.env.ADMIN_SECRET = SECRET;
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID', 'environnement-fictif');
    vi.stubEnv('SESSION_SECRET', 'cle-de-session-fictive-pour-les-tests-0123456789');
    now = START;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    sendMock.mockReset();
    sendMock.mockResolvedValue({ sent: true });
  });
  afterEach(async () => {
    await settleAnnouncementDeliveries();
    vi.restoreAllMocks();
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.ADMIN_SECRET;
  });

  it('plafond commun : une confirmation des dernières 24 h compte, et confirmer ne libère pas de place', async () => {
    const insert = pendingInsert();
    for (let i = 0; i < DAILY_CONFIRMATION_CAP - 1; i++) insert.run(`demande${i}@example.com`, 'fr', 'finma-historique', now - HOUR, null, i.toString(16).padStart(64, '0'), now - HOUR + CONFIRMATION_TTL_MS);
    insert.run('confirmee@example.com', 'fr', 'finma-historique', now - 2 * HOUR, now - HOUR, null, null);
    const app = createApp();
    expect([(await demande(app, 'nouvelle@example.com')).status, sendMock.mock.calls.length, rows().length]).toEqual([200, 0, DAILY_CONFIRMATION_CAP]);
    // Une des demandes en attente est confirmée : le compte ne baisse pas.
    getDb().prepare("UPDATE announcement_subscriptions SET confirmed_at=?, token_hash=NULL, token_expires_at=NULL WHERE email='demande0@example.com'").run(now);
    now += 2 * 60_000;
    expect((await demande(app, 'nouvelle@example.com')).status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
    expect(await indicateurs(app)).toMatchObject({ inscriptions_ecartees_plafond_24h: 2 });
    // Au-delà de 24 h, liens et confirmations ne comptent plus, les refus non plus.
    now += DAY;
    expect((await demande(app, 'nouvelle@example.com')).status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const body = await indicateurs(app);
    expect(body.inscriptions_ecartees_plafond_24h).toBe(0);
    expect(JSON.stringify(body)).not.toMatch(/@|example\.com/);
  });

  it('budget quotidien par réseau : 5 demandes acceptées par 24 h, quel que soit l’état des adresses ; préfixe /64 en IPv6', async () => {
    const app = createApp();
    const reseau = '192.0.2.10';
    expect(NETWORK_DAILY_BUDGET).toBe(5);
    // Une adresse confirmée consomme le budget comme une adresse neuve : le budget ne dit rien de l'état d'une adresse.
    pendingInsert().run('confirmee@example.com', 'fr', 'finma-historique', now - DAY, now - DAY + HOUR, null, null);
    for (let i = 0; i < NETWORK_DAILY_BUDGET; i++) {
      expect((await demande(app, i < 2 ? 'confirmee@example.com' : `neuve${i}@example.com`, reseau)).status).toBe(200);
      now += 61_000;
    }
    const refus = await demande(app, 'encore@example.com', reseau);
    expect(refus.status).toBe(429);
    expect(refus.headers.get('retry-after')).toBe('3600');
    expect(rows().map(r => r.email)).not.toContain('encore@example.com');
    now += 61_000; // le compteur par adresse a compté la demande refusée : une minute d'écart
    expect((await demande(app, 'encore@example.com', '192.0.2.11')).status).toBe(200);
    // IPv6 : deux adresses du même /64 partagent le budget, un autre /64 non.
    for (let i = 0; i < NETWORK_DAILY_BUDGET; i++) { expect((await demande(app, `v6-${i}@example.com`, `2001:db8:0:0::${i + 1}`)).status).toBe(200); now += 11_000; }
    expect((await demande(app, 'v6-plus@example.com', '2001:db8:0:0::ff')).status).toBe(429);
    now += 61_000;
    expect((await demande(app, 'v6-plus@example.com', '2001:db8:0:1::1')).status).toBe(200);
    // 24 h plus tard, le réseau retrouve son budget.
    now += DAY;
    expect((await demande(app, 'apres@example.com', reseau)).status).toBe(200);
    const stored = getDb().prepare('SELECT identity_key FROM announcement_network_requests').all() as Array<{ identity_key: string }>;
    expect(stored.every(r => /^[0-9a-f]{64}$/.test(r.identity_key))).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/192\.0\.2|2001:db8/);
  });

  it('les compteurs de 24 h sont purgés par le nettoyage, sans nouvelle catégorie', async () => {
    const app = createApp();
    await demande(app, 'personne@example.com');
    getDb().prepare('INSERT INTO announcement_capped_requests(capped_at) VALUES(?)').run(now);
    const { runFullCleanup } = await import('../../src/lib/cleanup.js');
    const proof = await runFullCleanup(getDb(), now + DAY);
    expect(proof.entries).toHaveLength(19);
    const count = (table: string) => (getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect([count('announcement_network_requests'), count('announcement_capped_requests')]).toEqual([0, 0]);
  });

  it('demande échue non purgée : effacée et inscrite au registre, nouvelle demande sous un nouvel identifiant ; l’ancien lien ne la vise pas', async () => {
    const app = createApp();
    await demande(app, 'personne@example.com');
    const [ancienne] = rows();
    const ancienLien = unsubscribeLink();
    now = START + 7 * DAY + HOUR;
    expect((await demande(app, 'personne@example.com')).status).toBe(200);
    const [nouvelle] = rows();
    expect(nouvelle.id).not.toBe(ancienne.id);
    expect(nouvelle.requested_at).toBe(now);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(getDb().prepare('SELECT subject_id, erased_at FROM announcement_erasures').all()).toEqual([{ subject_id: ancienne.id, erased_at: now }]);
    expect(JSON.parse(readFileSync(join(tmp, 'retention', 'announcement-erasures.json'), 'utf8')).entries).toEqual([{ subject_id: ancienne.id, erased_at: now }]);
    const res = await app.request(`${SITE}/api/announcements/unsubscribe?token=${ancienLien}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
    });
    expect(res.status).toBe(200);
    expect(rows()).toEqual([nouvelle]);
  });

  it('effacement sur demande écrite : secret exigé, même fonction (registre compris), un nombre seulement, aucune adresse au journal', async () => {
    const lignes: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { lignes.push(args.map(String).join(' ')); });
    const app = createApp();
    await demande(app, 'personne@example.com');
    await demande(app, 'autre@example.com');
    const effacer = (headers: Record<string, string>, body: unknown = { email: ' Personne@Example.com ' }) => app.request('/api/admin/announcements/erase', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    expect((await effacer({})).status).toBe(401);
    expect((await effacer({ 'x-admin-secret': 'secret-administration-fictif-12X' })).status).toBe(401);
    expect((await effacer({ 'x-admin-secret': SECRET }, { email: 'pas-une-adresse' })).status).toBe(400);
    expect((await effacer({ 'x-admin-secret': SECRET }, '{')).status).toBe(400);
    expect(rows()).toHaveLength(2);
    const id = rows().find(r => r.email === 'personne@example.com')!.id;
    now += HOUR;
    const ok = await effacer({ 'x-admin-secret': SECRET });
    const text = await ok.text();
    expect([ok.status, text]).toEqual([200, JSON.stringify({ erased: 1 })]);
    expect(rows().map(r => r.email)).toEqual(['autre@example.com']);
    expect(getDb().prepare('SELECT subject_id, erased_at FROM announcement_erasures').all()).toEqual([{ subject_id: id, erased_at: START + HOUR }]);
    expect(JSON.parse(readFileSync(join(tmp, 'retention', 'announcement-erasures.json'), 'utf8')).entries).toEqual([{ subject_id: id, erased_at: START + HOUR }]);
    expect(await (await effacer({ 'x-admin-secret': SECRET })).text()).toBe(JSON.stringify({ erased: 0 }));
    for (const ligne of lignes) expect(ligne).not.toMatch(/@|example\.com|personne/i);
  });

  it('après la fin du 30.06.2027 : même réponse neutre, aucune ligne, aucun mail, aucun compteur ; la veille, accepté', async () => {
    const app = createApp();
    now = ANNOUNCEMENT_FALLBACK_END - 1;
    expect((await demande(app, 'veille@example.com')).status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
    now = ANNOUNCEMENT_FALLBACK_END;
    const res = await demande(app, 'apres@example.com');
    expect([res.status, await res.text()]).toEqual([200, JSON.stringify({ ok: true })]);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(rows().map(r => r.email)).toEqual(['veille@example.com']);
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM announcement_network_requests').get() as { n: number }).n).toBe(1);
  });
});
