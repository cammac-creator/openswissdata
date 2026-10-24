// Inscription par e-mail « être prévenu » (24.10.2026). Adresses d'exemple seulement (example.com), réseaux de
// documentation, clés fictives. Les envois Resend sont simulés : `sendPreparedEmail` est remplacé, sauf dans le test
// des en-têtes où le vrai module parle à un `fetch` simulé.
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
import { CONFIRMATION_TTL_MS, DAILY_CONFIRMATION_CAP, RESEND_INTERVAL_MS, announcementTokenFingerprint } from '../../src/lib/announcements.js';
import { ANNOUNCEMENT_PAGE_CSP } from '../../src/lib/announcement-page.js';

const SITE = 'https://www.openswissdata.com';
const ADRESSE = 'personne@example.com';
const HOUR = 3_600_000, DAY = 24 * HOUR;
const START = Date.UTC(2026, 9, 26, 8, 0, 0);
let now = START;
let ipCounter = 0;
const nextIp = () => { ipCounter += 1; return `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`; };
const valid = (email = ADRESSE, lang = 'fr') => ({ email, lang, subject: 'finma-historique', consent: true });
type App = ReturnType<typeof createApp>;

async function demande(app: App, body: unknown, ip = nextIp(), headers: Record<string, string> = {}) {
  const res = await app.request(`${SITE}/api/announcements/request`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, 'sec-fetch-site': 'same-origin', 'x-real-ip': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  await settleAnnouncementDeliveries();
  return res;
}
const rows = () => getDb().prepare('SELECT * FROM announcement_subscriptions ORDER BY id').all() as Array<Record<string, unknown>>;
function links(call = sendMock.mock.calls.at(-1)) {
  const payload = call![0];
  const confirm = /\/api\/announcements\/confirm\?token=([A-Za-z0-9_-]{43})(?=[\s"<]|$)/.exec(payload.text ?? '')?.[1];
  const unsubscribe = /\/api\/announcements\/unsubscribe\?token=([A-Za-z0-9_-]{59})(?=[\s"<]|$)/.exec(payload.text ?? '')?.[1];
  if (!confirm || !unsubscribe) throw new Error('liens absents du mail simulé');
  return { payload, confirm, unsubscribe };
}
const confirmPost = (app: App, token: string, headers: Record<string, string> = { origin: SITE, 'sec-fetch-site': 'same-origin' }) =>
  app.request(`${SITE}/api/announcements/confirm`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ token, decision: 'confirm' }).toString(),
  });

describe('Inscription « être prévenu » : routes', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'osd-annonces-'));
    process.env.DATABASE_PATH = join(tmp, 'fictive.sqlite');
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID', 'environnement-fictif');
    vi.stubEnv('SESSION_SECRET', 'cle-de-session-fictive-pour-les-tests-0123456789');
    now = START;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    sendMock.mockReset();
    sendMock.mockResolvedValue({ sent: true, providerId: '00000000-0000-4000-8000-000000000000' });
  });
  afterEach(async () => {
    await settleAnnouncementDeliveries();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.ADMIN_SECRET;
    delete process.env.ADMIN_EMAILS;
  });

  it('demande valide : une ligne en attente, empreinte du jeton seulement, un mail de confirmation', async () => {
    const app = createApp();
    const res = await demande(app, valid('  Personne@Example.COM ', 'de'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const columns = (getDb().prepare('PRAGMA table_info(announcement_subscriptions)').all() as Array<{ name: string }>).map(c => c.name);
    expect(columns).toEqual(['id', 'email', 'lang', 'subject', 'requested_at', 'confirmed_at', 'unsubscribed_at', 'announced_at', 'token_hash', 'token_expires_at']);
    const [row] = rows();
    expect(row).toMatchObject({ email: ADRESSE, lang: 'de', subject: 'finma-historique', requested_at: START, confirmed_at: null, unsubscribed_at: null, announced_at: null, token_expires_at: START + CONFIRMATION_TTL_MS });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const { payload, confirm } = links();
    expect(payload.to).toEqual([ADRESSE]);
    expect(payload.subject).toContain('Bestätigen');
    expect(row.token_hash).toBe(announcementTokenFingerprint(confirm));
    expect(row.token_hash).not.toBe(confirm);
    expect(JSON.stringify(rows())).not.toContain(confirm);
  });

  it('refus sans consentement : rien n’est enregistré ni envoyé', async () => {
    const app = createApp();
    for (const body of [{ ...valid(), consent: false }, { email: ADRESSE, lang: 'fr', subject: 'finma-historique' }, { ...valid(), consent: 'true' }]) {
      const res = await demande(app, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'consent_required' });
    }
    expect(rows()).toEqual([]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('entrées refusées : sujet inconnu, champ en plus, adresse invalide, corps trop gros, autre origine', async () => {
    const app = createApp();
    for (const body of [{ ...valid(), subject: 'autre-sujet' }, { ...valid(), extra: 1 }, { ...valid(), email: 'pas-une-adresse' }, { ...valid(), lang: 'it' }, '{']) {
      expect((await demande(app, body)).status).toBe(400);
    }
    expect((await demande(app, { ...valid(), email: `${'a'.repeat(1100)}@example.com` })).status).toBe(413);
    expect((await demande(app, valid(), nextIp(), { origin: 'https://autre.example' })).status).toBe(403);
    expect((await demande(app, valid(), nextIp(), { 'content-type': 'text/plain' })).status).toBe(400);
    expect(rows()).toEqual([]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('même réponse pour une adresse nouvelle, en attente ou confirmée ; aucun mail pour une adresse confirmée', async () => {
    const app = createApp();
    const lire = async (res: Response) => ({ status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), body: await res.text() });
    const nouvelle = await lire(await demande(app, valid()));
    expect(sendMock).toHaveBeenCalledTimes(1);
    now += 2 * 60_000;
    const enAttente = await lire(await demande(app, valid()));
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect((await confirmPost(app, links().confirm)).status).toBe(200);
    now += 2 * DAY;
    const confirmee = await lire(await demande(app, valid()));
    expect([enAttente, confirmee]).toEqual([nouvelle, nouvelle]);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].confirmed_at).not.toBeNull();
  });

  it('demande en attente : un nouveau lien au plus par 24 h, aucun après le 5e jour ; le nouveau remplace l’ancien', async () => {
    const app = createApp();
    await demande(app, valid());
    const premier = links().confirm;
    // Le compteur par adresse exige une minute entre deux demandes : on reste sous les 24 h, puis on les atteint.
    now = START + RESEND_INTERVAL_MS - 60_000;
    await demande(app, valid());
    expect(sendMock).toHaveBeenCalledTimes(1);
    now = START + RESEND_INTERVAL_MS;
    await demande(app, valid(ADRESSE, 'en'));
    expect(sendMock).toHaveBeenCalledTimes(2);
    const second = links().confirm;
    expect(second).not.toBe(premier);
    expect(rows()[0]).toMatchObject({ requested_at: START, lang: 'en' });
    // L'ancien lien ne sert plus ; le nouveau oui.
    expect((await confirmPost(app, premier)).status).toBe(410);
    // Après le 5e jour : plus aucun mail tant que la demande n'est pas purgée.
    now = START + 5 * DAY + 1;
    await demande(app, valid());
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect((await confirmPost(app, second)).status).toBe(410);
  });

  it('GET et HEAD du lien de confirmation ne confirment rien', async () => {
    const app = createApp();
    await demande(app, valid());
    const { confirm } = links();
    const avant = rows();
    const page = await app.request(`${SITE}/api/announcements/confirm?token=${confirm}`, { headers: { 'accept-language': 'de-CH' } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<form method="post" action="/api/announcements/confirm"');
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html).toContain('lang="fr"');
    expect(html).not.toContain(ADRESSE);
    expect(page.headers.get('content-security-policy')).toBe(ANNOUNCEMENT_PAGE_CSP);
    expect(page.headers.get('referrer-policy')).toBe('strict-origin');
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect((await app.request(`${SITE}/api/announcements/confirm?token=${confirm}`, { method: 'HEAD' })).status).toBe(200);
    expect(rows()).toEqual(avant);
    expect(rows()[0].confirmed_at).toBeNull();
  });

  it('POST confirme une fois, puis refuse ; le jeton est effacé à la confirmation', async () => {
    const app = createApp();
    await demande(app, valid());
    const { confirm } = links();
    now += HOUR;
    const ok = await confirmPost(app, confirm);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('Inscription confirmée');
    expect(rows()[0]).toMatchObject({ confirmed_at: START + HOUR, token_hash: null, token_expires_at: null });
    const encore = await confirmPost(app, confirm);
    expect(encore.status).toBe(410);
    expect(await encore.text()).toContain('Lien expiré ou déjà utilisé');
    expect(rows()[0].confirmed_at).toBe(START + HOUR);
    expect((await app.request(`${SITE}/api/announcements/confirm?token=${confirm}`)).status).toBe(410);
  });

  it('jeton échu refusé (48 h) ; un jeton de forme invalide aussi', async () => {
    const app = createApp();
    await demande(app, valid());
    const { confirm } = links();
    now = START + CONFIRMATION_TTL_MS;
    expect((await app.request(`${SITE}/api/announcements/confirm?token=${confirm}`)).status).toBe(410);
    expect((await confirmPost(app, confirm)).status).toBe(410);
    expect(rows()[0].confirmed_at).toBeNull();
    expect((await app.request(`${SITE}/api/announcements/confirm?token=court`)).status).toBe(400);
    expect((await app.request(`${SITE}/api/announcements/confirm?token=${confirm}&token=${confirm}`)).status).toBe(400);
  });

  it('le bouton de confirmation exige l’origine du site et un formulaire simple', async () => {
    const app = createApp();
    await demande(app, valid());
    const { confirm } = links();
    expect((await confirmPost(app, confirm, {})).status).toBe(403);
    expect((await confirmPost(app, confirm, { origin: 'https://autre.example' })).status).toBe(403);
    expect((await confirmPost(app, confirm, { origin: 'null' })).status).toBe(403);
    const json = await app.request(`${SITE}/api/announcements/confirm`, { method: 'POST', headers: { origin: SITE, 'content-type': 'application/json' }, body: JSON.stringify({ token: confirm, decision: 'confirm' }) });
    expect(json.status).toBe(400);
    const double = await app.request(`${SITE}/api/announcements/confirm`, { method: 'POST', headers: { origin: SITE, 'content-type': 'application/x-www-form-urlencoded' }, body: `token=${confirm}&token=${confirm}&decision=confirm` });
    expect(double.status).toBe(400);
    expect(rows()[0].confirmed_at).toBeNull();
  });

  it('désinscription : la page n’efface rien, le bouton efface la ligne, rejouable sans effet', async () => {
    const app = createApp();
    await demande(app, valid());
    const { confirm, unsubscribe } = links();
    await confirmPost(app, confirm);
    const page = await app.request(`${SITE}/api/announcements/unsubscribe?token=${unsubscribe}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<form method="post" action="/api/announcements/unsubscribe"');
    expect(page.headers.get('content-security-policy')).toBe(ANNOUNCEMENT_PAGE_CSP);
    expect(rows()).toHaveLength(1);
    const post = () => app.request(`${SITE}/api/announcements/unsubscribe`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: unsubscribe, decision: 'unsubscribe' }).toString(),
    });
    const done = await post();
    expect(done.status).toBe(200);
    expect(await done.text()).toContain('Adresse effacée');
    expect(rows()).toEqual([]);
    expect((await post()).status).toBe(200);
    expect(await (await app.request(`${SITE}/api/announcements/unsubscribe?token=${unsubscribe}`)).text()).toContain('Aucune inscription liée à ce lien');
  });

  it('désinscription : l’effacement entre aussitôt au registre et dans sa copie hors base, sans attendre le nettoyage', async () => {
    const app = createApp();
    await demande(app, valid());
    const { unsubscribe } = links();
    const id = rows()[0].id;
    now += HOUR;
    const res = await app.request(`${SITE}/api/announcements/unsubscribe?token=${unsubscribe}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
    });
    expect(res.status).toBe(200);
    expect(getDb().prepare('SELECT subject_id, erased_at FROM announcement_erasures').all()).toEqual([{ subject_id: id, erased_at: START + HOUR }]);
    const copie = readFileSync(join(tmp, 'retention', 'announcement-erasures.json'), 'utf8');
    expect(JSON.parse(copie)).toEqual({ version: 1, entries: [{ subject_id: id, erased_at: START + HOUR }] });
    expect(copie).not.toMatch(/@|example/);
  });

  it('désinscription en un clic (RFC 8058) : POST de la messagerie sans origine, urlencoded ou multipart', async () => {
    const app = createApp();
    await demande(app, valid());
    const premier = links().unsubscribe;
    const urlencoded = await app.request(`${SITE}/api/announcements/unsubscribe?token=${premier}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
    });
    expect(urlencoded.status).toBe(200);
    expect(rows()).toEqual([]);
    now += 2 * 60_000;
    await demande(app, valid('autre@example.com'));
    const second = links().unsubscribe;
    const form = new FormData();
    form.append('List-Unsubscribe', 'One-Click');
    const multipart = await app.request(`${SITE}/api/announcements/unsubscribe?token=${second}`, { method: 'POST', body: form });
    expect(multipart.status).toBe(200);
    expect(rows()).toEqual([]);
  });

  it('désinscription : lien modifié ou mal formé refusé sans rien effacer', async () => {
    const app = createApp();
    await demande(app, valid());
    const { unsubscribe } = links();
    const altere = unsubscribe.slice(0, 30) + (unsubscribe[30] === 'A' ? 'B' : 'A') + unsubscribe.slice(31);
    for (const token of [altere, 'court', unsubscribe + 'A']) {
      const res = await app.request(`${SITE}/api/announcements/unsubscribe?token=${token}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
      expect(res.status).toBe(400);
    }
    const sansCorps = await app.request(`${SITE}/api/announcements/unsubscribe?token=${unsubscribe}`, { method: 'POST' });
    expect(sansCorps.status).toBe(400);
    const deuxJetons = await app.request(`${SITE}/api/announcements/unsubscribe?token=${unsubscribe}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `token=${unsubscribe}&decision=unsubscribe`,
    });
    expect(deuxJetons.status).toBe(400);
    expect(rows()).toHaveLength(1);
  });

  it('limites par réseau et par adresse, avant toute lecture : même refus pour une adresse connue ou inconnue', async () => {
    const app = createApp();
    const reseau = nextIp();
    expect((await demande(app, valid(), reseau)).status).toBe(200);
    const memeReseau = await demande(app, valid('autre@example.com'), reseau);
    expect(memeReseau.status).toBe(429);
    expect(memeReseau.headers.get('retry-after')).toBe('10');
    // Même adresse depuis un autre réseau dans la minute : refusée, sans mail.
    const memeAdresse = await demande(app, valid());
    expect(memeAdresse.status).toBe(429);
    const inconnueA = await demande(app, valid('inconnue@example.com'));
    expect(inconnueA.status).toBe(200);
    const inconnueB = await demande(app, valid('inconnue@example.com'));
    expect([memeAdresse.status, await memeAdresse.text()]).toEqual([inconnueB.status, await inconnueB.text()]);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(rows().map(r => r.email)).toEqual([ADRESSE, 'inconnue@example.com']);
    // Une inscription ne consomme pas le crédit de connexion du même réseau.
    now += 11_000;
    const connexion = await app.request(`${SITE}/api/auth/magic-link`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': reseau }, body: JSON.stringify({ email: ADRESSE }) });
    expect(connexion.status).toBe(200);
  });

  it('plafond commun de mails sur 24 h : même réponse, aucun mail ni ligne au-delà, reprise ensuite', async () => {
    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { warnings.push(args.join(' ')); });
    const insert = getDb().prepare('INSERT INTO announcement_subscriptions(email,lang,subject,requested_at,token_hash,token_expires_at) VALUES(?,?,?,?,?,?)');
    for (let i = 0; i < DAILY_CONFIRMATION_CAP; i++) insert.run(`demande${i}@example.com`, 'fr', 'finma-historique', now - HOUR, i.toString(16).padStart(64, '0'), now - HOUR + CONFIRMATION_TTL_MS);
    const app = createApp();
    const res = await demande(app, valid());
    expect([res.status, await res.text()]).toEqual([200, JSON.stringify({ ok: true })]);
    expect(sendMock).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(DAILY_CONFIRMATION_CAP);
    expect(warnings.join('\n')).toContain('plafond quotidien');
    expect(warnings.join('\n')).not.toMatch(/@|example\.com/);
    // 24 h après ces liens, le plafond se libère.
    now += RESEND_INTERVAL_MS - HOUR + 1;
    expect((await demande(app, valid())).status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('la réponse part avant toute lecture ou écriture de la demande, et avant l’envoi', async () => {
    const app = createApp();
    const ordre: string[] = [];
    // Toute écriture de la demande est notée par la base elle-même (fonction appelée par un déclencheur).
    getDb().function('noter_ecriture', () => { ordre.push('écriture'); return null; });
    getDb().exec('CREATE TEMP TRIGGER noter_demande AFTER INSERT ON announcement_subscriptions BEGIN SELECT noter_ecriture(); END');
    let release!: (value: EmailSendResult) => void;
    sendMock.mockImplementationOnce(() => { ordre.push('envoi'); return new Promise<EmailSendResult>(resolve => { release = resolve; }); });
    const res = await app.request(`${SITE}/api/announcements/request`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, 'x-real-ip': nextIp() }, body: JSON.stringify(valid()),
    });
    ordre.push('réponse');
    expect(res.status).toBe(200);
    expect(rows()).toEqual([]);
    expect(sendMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(ordre).toEqual(['réponse', 'écriture', 'envoi']);
    release({ sent: true });
    await settleAnnouncementDeliveries();
    expect(rows()).toHaveLength(1);
  });

  it('un mail qui ne part pas ne retient rien ; une nouvelle demande renvoie un mail', async () => {
    const app = createApp();
    sendMock.mockResolvedValueOnce({ sent: false, reason: 'resend_error', details: 'HTTP 500' });
    expect((await demande(app, valid())).status).toBe(200);
    expect(rows()).toEqual([]);
    now += 2 * 60_000;
    expect((await demande(app, valid())).status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('aucune adresse dans le journal, même en cas d’échec d’envoi ou de base', async () => {
    const lignes: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { lignes.push(args.map(a => a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); });
    }
    const app = createApp();
    sendMock.mockResolvedValueOnce({ sent: false, reason: 'resend_error', details: 'network_error' });
    await demande(app, valid());
    now += 2 * 60_000;
    sendMock.mockRejectedValueOnce(new Error(`refus fictif pour ${ADRESSE}`));
    await demande(app, valid());
    now += 2 * 60_000;
    await demande(app, valid());
    await confirmPost(app, links().confirm);
    now += 2 * 60_000;
    getDb().exec('DROP TABLE announcement_subscriptions');
    // La demande est traitée après la réponse : la panne de base ne change pas la réponse neutre, elle est journalisée.
    const panne = await demande(app, valid('troisieme@example.com'));
    expect([panne.status, await panne.text()]).toEqual([200, JSON.stringify({ ok: true })]);
    expect(lignes.join('\n')).toContain('[annonce] demande non enregistrée');
    const page = await app.request(`${SITE}/api/announcements/confirm?token=${'Q'.repeat(43)}`);
    expect(page.status).toBe(503);
    expect(lignes.length).toBeGreaterThan(0);
    for (const ligne of lignes) {
      expect(ligne).not.toMatch(/@|example\.com|personne|troisieme/);
    }
  });

  it('le suivi des appels n’enregistre aucune trace de ces routes', async () => {
    const app = createApp();
    await demande(app, valid());
    await confirmPost(app, links().confirm);
    await new Promise(resolve => setImmediate(resolve));
    const traces = getDb().prepare("SELECT COUNT(*) AS n FROM events WHERE name LIKE '/api/announcements%'").get() as { n: number };
    expect(traces.n).toBe(0);
  });

  it('le relevé de chiffres ne rend que des nombres : inscriptions confirmées par sujet, hors adresses internes', async () => {
    process.env.ADMIN_SECRET = 'secret-administration-fictif-123';
    process.env.ADMIN_EMAILS = 'bureau@example.com';
    const db = getDb();
    const insert = db.prepare('INSERT INTO announcement_subscriptions(email,lang,subject,requested_at,confirmed_at,token_hash,token_expires_at) VALUES(?,?,?,?,?,?,?)');
    insert.run(ADRESSE, 'fr', 'finma-historique', START, START + HOUR, null, null);
    insert.run('bureau@example.com', 'fr', 'finma-historique', START, START + HOUR, null, null);
    insert.run('attente@example.com', 'en', 'finma-historique', START, null, 'a'.repeat(64), START + CONFIRMATION_TTL_MS);
    const res = await createApp().request('/api/admin/indicateurs', { headers: { 'x-admin-secret': process.env.ADMIN_SECRET } });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { inscriptions_confirmees: Record<string, unknown> };
    expect(body.inscriptions_confirmees).toEqual({ 'finma-historique': 1 });
    expect(Object.values(body.inscriptions_confirmees).every(value => Number.isSafeInteger(value))).toBe(true);
    expect(text).not.toMatch(/@|example\.com/);
  });
});

describe('Inscription « être prévenu » : mail envoyé à Resend', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'osd-annonces-mail-'));
    process.env.DATABASE_PATH = join(tmp, 'fictive.sqlite');
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID', 'environnement-fictif');
    vi.stubEnv('SESSION_SECRET', 'cle-de-session-fictive-pour-les-tests-0123456789');
    vi.stubEnv('RESEND_API_KEY', 'cle-resend-fictive');
    sendMock.mockReset();
  });
  afterEach(async () => {
    await settleAnnouncementDeliveries();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
  });

  it('en-têtes List-Unsubscribe (RFC 8058), aucun paramètre de mesure, aucune image autre que le logo fixe', async () => {
    const actual = await vi.importActual<typeof import('../../src/lib/email.js')>('../../src/lib/email.js');
    sendMock.mockImplementation(actual.sendPreparedEmail);
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ id: '00000000-0000-4000-8000-000000000000' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await demande(createApp(), valid(ADRESSE, 'en'));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.resend.com/emails');
    const sent = JSON.parse(String(init?.body)) as PreparedEmail & Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['from', 'headers', 'html', 'reply_to', 'subject', 'text', 'to']);
    expect(sent.to).toEqual([ADRESSE]);
    expect(sent.headers).toEqual({
      'List-Unsubscribe': expect.stringMatching(/^<https:\/\/www\.openswissdata\.com\/api\/announcements\/unsubscribe\?token=[A-Za-z0-9_-]{59}>$/),
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    const hrefs = [...sent.html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    for (const href of hrefs) {
      const parsed = new URL(href);
      expect(parsed.origin).toBe(SITE);
      expect([...parsed.searchParams.keys()].every(key => key === 'token')).toBe(true);
    }
    expect(hrefs).toContain(`${SITE}/en/legal/privacy#finalites`);
    expect(sent.html).not.toMatch(/utm_|track|pixel|width="1"|height="1"/i);
    expect([...sent.html.matchAll(/<img\b[^>]*src="([^"]+)"/g)].map(m => m[1])).toEqual(['https://www.openswissdata.com/logo.png']);
    expect(sent.text).toContain('48 hours');
    expect(sent.text).toContain('erased after 7 days');
    // Le jeton de confirmation du mail est bien celui dont l'empreinte est gardée.
    const confirm = /confirm\?token=([A-Za-z0-9_-]{43})/.exec(sent.text ?? '')![1];
    expect((getDb().prepare('SELECT token_hash FROM announcement_subscriptions').get() as { token_hash: string }).token_hash).toBe(announcementTokenFingerprint(confirm));
  });
});
