import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Boîte IMAP simulée : aucune connexion réelle. Les commandes qui modifieraient la boîte sont comptées et refusées.
type Message = { folder: string; uid: number; envelope: Record<string, unknown>; internalDate: Date; source: string };
const imap = vi.hoisted(() => ({
  messages: [] as Message[],
  calls: [] as Array<{ name: string; args: unknown[] }>,
  forbidden: [] as string[],
  folders: [{ path: 'INBOX' }, { path: 'Spam', specialUse: '\\Junk' }, { path: 'Sent', specialUse: '\\Sent' }, { path: 'Archive', specialUse: '\\Archive' }] as Array<{ path: string; specialUse?: string }>,
  failConnect: false,
}));
vi.mock('imapflow', () => {
  const forbid = (name: string) => async () => { imap.forbidden.push(name); throw new Error(`commande interdite : ${name}`); };
  class ImapFlow {
    current = '';
    constructor(options: { host: string }) { imap.calls.push({ name: 'constructor', args: [options.host] }); }
    on() {}
    async connect() { if (imap.failConnect) throw new Error('imap indisponible'); }
    close() {}
    async list() { imap.calls.push({ name: 'list', args: [] }); return imap.folders; }
    async mailboxOpen(path: string, options: unknown) { imap.calls.push({ name: 'mailboxOpen', args: [path, options] }); this.current = path; return { path, uidValidity: 7n }; }
    async search(query: unknown, options: unknown) { imap.calls.push({ name: 'search', args: [query, options] }); return imap.messages.filter(m => m.folder === this.current).map(m => m.uid); }
    async *fetch(range: number[], query: unknown, options: unknown) {
      imap.calls.push({ name: 'fetch', args: [range, query, options] });
      for (const m of imap.messages.filter(x => x.folder === this.current && range.includes(x.uid))) yield { uid: m.uid, envelope: m.envelope, internalDate: m.internalDate };
    }
    async fetchOne(uid: string, query: unknown, options: unknown) {
      imap.calls.push({ name: 'fetchOne', args: [uid, query, options] });
      const m = imap.messages.find(x => x.folder === this.current && String(x.uid) === uid);
      return m ? { uid: m.uid, source: Buffer.from(m.source) } : false;
    }
    messageFlagsAdd = forbid('messageFlagsAdd'); messageFlagsSet = forbid('messageFlagsSet'); messageFlagsRemove = forbid('messageFlagsRemove');
    setFlagColor = forbid('setFlagColor'); messageDelete = forbid('messageDelete'); messageMove = forbid('messageMove'); messageCopy = forbid('messageCopy');
    append = forbid('append'); mailboxCreate = forbid('mailboxCreate'); mailboxRename = forbid('mailboxRename'); mailboxDelete = forbid('mailboxDelete');
  }
  return { ImapFlow };
});

import { getDb, closeDb } from '../../src/lib/db.js';
import { seal, clearCrmCache } from '../../src/lib/crm-source.js';
import { runMailWatch, startMailWatch, readMailWatchStatus, alertText, extractText, watchedDomains, watchedDomainFor, DEFAULT_WATCH_DOMAINS } from '../../src/lib/mail-watch.js';

const NOW = Date.UTC(2026, 8, 30, 12, 0);
const TOKEN = '123456789:jeton-fictif-TELEGRAM-abcdefghij';
const HOUR = 3_600_000;
const body = (text: string, headers = 'Content-Type: text/plain; charset=utf-8') => `From: x\r\nSubject: y\r\n${headers}\r\n\r\n${text}`;
const finmaText = `Bonjour,\n\nNous avons bien reçu votre demande concernant le registre des intermédiaires affiliés à un OAR. ${'Nous examinons votre demande avec attention. '.repeat(15)}\n\nMeilleures salutations\n\nLe 30.09.2026, OpenSwissData a écrit :\n> CITATION-DE-NOTRE-LETTRE`;
const finma = (uid = 11, overrides: Partial<Message> = {}): Message => ({
  folder: 'INBOX', uid, internalDate: new Date(NOW - 2 * HOUR), source: body(finmaText),
  envelope: { messageId: `<reponse-${uid}@finma.ch>`, from: [{ name: 'Service juridique', address: 'juridique@finma.ch' }], subject: 'Votre demande OAR', date: new Date(NOW - 2 * HOUR) },
  ...overrides,
});
const client = (): Message => ({
  folder: 'INBOX', uid: 12, internalDate: new Date(NOW - HOUR), source: body('TEXTE-CLIENT-CONFIDENTIEL'),
  envelope: { messageId: '<reponse@client.example.test>', from: [{ name: 'Acheteur', address: 'achat@client.example.test' }], subject: 'Re: votre commande', date: new Date(NOW - HOUR) },
});
const telegramOk = () => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ ok: true, result: { message_id: 1 } }));
const sentTexts = (fetcher: ReturnType<typeof telegramOk>) => fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { chat_id: string; text: string; parse_mode?: string });
const witness = () => getDb().prepare("SELECT checked_at,details_json FROM operation_checks WHERE name='mail_watch'").get() as { checked_at: number; details_json: string } | undefined;
const run = (fetcher: typeof fetch) => runMailWatch({ fetch: fetcher, now: () => NOW });

describe('Veille des réponses dans la boîte de support', () => {
  let temp: string;
  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'osd-veille-'));
    process.env.DATABASE_PATH = join(temp, 'fictive.sqlite');
    process.env.OSD_BACKUP_KEY = 'c'.repeat(64);
    process.env.OSD_VEILLE_TELEGRAM_TOKEN = TOKEN;
    process.env.OSD_VEILLE_TELEGRAM_CHAT = '424242';
    process.env.OSD_MAIL_WATCH_DOMAINS = 'finma.ch, bfs.admin.ch,un.org,@Client.Example.Test';
    imap.messages = []; imap.calls = []; imap.forbidden = []; imap.failConnect = false;
    clearCrmCache();
    getDb().prepare('INSERT INTO crm_connections(name,secret_encrypted,updated_at) VALUES(?,?,?)').run('support', seal(JSON.stringify({ user: 'contact@openswissdata.com', pass: 'mot-de-passe-fictif' })), NOW);
  });
  afterEach(() => {
    closeDb(); rmSync(temp, { recursive: true, force: true });
    for (const name of ['DATABASE_PATH', 'OSD_BACKUP_KEY', 'OSD_VEILLE_TELEGRAM_TOKEN', 'OSD_VEILLE_TELEGRAM_CHAT', 'OSD_MAIL_WATCH_DOMAINS']) delete process.env[name];
    vi.useRealTimers(); vi.restoreAllMocks();
  });

  it('signale une réponse FINMA neuve avec son extrait, puis la marque sans rien conserver de son contenu', async () => {
    imap.messages = [finma()];
    const fetcher = telegramOk();
    const result = await run(fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    const [sent] = sentTexts(fetcher);
    expect(sent.chat_id).toBe('424242');
    expect(sent).not.toHaveProperty('parse_mode');
    const lines = sent.text.split('\n');
    expect(lines.slice(0, 4)).toEqual(['📬 OpenSwissData : réponse reçue de FINMA', 'De : Service juridique <juridique@finma.ch>', 'Objet : Votre demande OAR', 'Reçu : 30.09.2026 12:00']);
    expect(lines[4]).toMatch(/^Bonjour, Nous avons bien reçu votre demande concernant le registre/);
    expect(Array.from(lines[4]).length).toBeLessThanOrEqual(400);
    expect(lines[4].endsWith('…')).toBe(true);
    expect(lines[5]).toBe('Dis « réponse FINMA » à Claude pour la suite.');
    expect(sent.text).not.toContain('CITATION-DE-NOTRE-LETTRE');
    expect(result).toMatchObject({ status: 'ok', code: null, matched: 1, alerted: 1, pending: 0, total_alerted: 1, domains: 4, last_success_at: NOW });
    const row = witness()!;
    expect(row.checked_at).toBe(NOW);
    const stored = JSON.parse(row.details_json);
    expect(stored.seen).toHaveLength(1);
    expect(stored.seen[0]).toMatch(/^[0-9a-f]{32}$/);
    for (const secret of ['finma.ch', 'juridique', 'Votre demande', 'Bonjour', 'reponse-11', TOKEN]) expect(row.details_json).not.toContain(secret);
  });

  it('ne renvoie pas une alerte déjà signalée au passage suivant', async () => {
    imap.messages = [finma()];
    await run(telegramOk());
    const second = telegramOk();
    const result = await run(second);
    expect(second).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'ok', matched: 1, alerted: 0, pending: 0, total_alerted: 1 });
  });

  it('signale un domaine client sans extrait et sans lire le corps du message', async () => {
    imap.messages = [client()];
    const fetcher = telegramOk();
    await run(fetcher);
    const [sent] = sentTexts(fetcher);
    expect(sent.text).toBe(['📬 OpenSwissData : réponse reçue de client.example.test', 'De : Acheteur <achat@client.example.test>', 'Objet : Re: votre commande', 'Reçu : 30.09.2026 13:00', 'Dis « réponse client.example.test » à Claude pour la suite.'].join('\n'));
    expect(imap.calls.some(c => c.name === 'fetchOne')).toBe(false);
  });

  it('ignore les expéditeurs non surveillés, nos propres copies et les messages de plus de trois jours', async () => {
    const other = (uid: number, address: string, when = NOW - HOUR): Message => ({ ...finma(uid), internalDate: new Date(when), envelope: { messageId: `<m-${uid}@x.test>`, from: [{ address }], subject: 'Autre', date: new Date(when) } });
    imap.messages = [other(21, 'info@fun.org'), other(22, 'x@notfinma.ch'), other(23, 'contact@openswissdata.com'), other(24, 'juridique@finma.ch', NOW - 4 * 86_400_000), other(25, 'x@finma.ch.example.test')];
    const fetcher = telegramOk();
    const result = await run(fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'ok', matched: 0, alerted: 0, pending: 0 });
  });

  it('accepte un sous-domaine et lit aussi les indésirables, avec une seule alerte par Message-ID', async () => {
    imap.messages = [
      finma(31, { envelope: { messageId: '<double@admin.ch>', from: [{ address: 'info@bfs.admin.ch' }], subject: 'Réponse OFS', date: new Date(NOW - HOUR) } }),
      finma(32, { folder: 'Spam', envelope: { messageId: '<double@admin.ch>', from: [{ address: 'info@bfs.admin.ch' }], subject: 'Réponse OFS', date: new Date(NOW - HOUR) } }),
      finma(33, { folder: 'Spam', envelope: { messageId: '<onu@un.org>', from: [{ name: 'Permissions', address: 'permissions@mail.un.org' }], subject: 'ISIC', date: new Date(NOW - HOUR) } }),
    ];
    const fetcher = telegramOk();
    const result = await run(fetcher);
    const texts = sentTexts(fetcher).map(s => s.text.split('\n')[0]);
    expect(texts).toEqual(['📬 OpenSwissData : réponse reçue de OFS', '📬 OpenSwissData : réponse reçue de ONU']);
    expect(result).toMatchObject({ matched: 2, alerted: 2 });
    expect(imap.calls.filter(c => c.name === 'mailboxOpen').map(c => c.args[0])).toEqual(expect.arrayContaining(['INBOX', 'Spam']));
    expect(imap.calls.filter(c => c.name === 'mailboxOpen').map(c => c.args[0])).not.toContain('Sent');
  });

  it('ne marque rien quand Telegram échoue et retente au passage suivant', async () => {
    imap.messages = [finma()];
    const failing = vi.fn(async () => new Response('{"ok":false}', { status: 502 }));
    const failed = await run(failing);
    expect(failed).toMatchObject({ status: 'error', code: 'telegram_http', http_status: 502, alerted: 0, pending: 1, last_success_at: null });
    expect(JSON.parse(witness()!.details_json).seen).toEqual([]);
    const refused = vi.fn(async () => Response.json({ ok: false, description: 'Bad Request' }));
    expect(await run(refused)).toMatchObject({ status: 'error', code: 'telegram_not_ok', pending: 1 });
    const fetcher = telegramOk();
    expect(await run(fetcher)).toMatchObject({ status: 'ok', alerted: 1, pending: 0, total_alerted: 1 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('plafonne à cinq alertes par passage, les plus anciennes d’abord, et reprend le reste ensuite', async () => {
    imap.messages = Array.from({ length: 7 }, (_, i) => finma(40 + i, { internalDate: new Date(NOW - (10 - i) * HOUR) }));
    const first = telegramOk();
    expect(await run(first)).toMatchObject({ matched: 7, alerted: 5, pending: 2 });
    expect(first).toHaveBeenCalledTimes(5);
    expect(sentTexts(first)[0].text).toContain('Reçu : 30.09.2026 04:00');
    const second = telegramOk();
    expect(await run(second)).toMatchObject({ matched: 7, alerted: 2, pending: 0, total_alerted: 7 });
  });

  it('reste inactive sans erreur quand les variables Telegram manquent, sans ouvrir la boîte', async () => {
    delete process.env.OSD_VEILLE_TELEGRAM_TOKEN;
    imap.messages = [finma()];
    const fetcher = telegramOk();
    await expect(run(fetcher)).resolves.toMatchObject({ status: 'inactive', code: 'not_configured' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(imap.calls).toEqual([]);
    process.env.OSD_VEILLE_TELEGRAM_TOKEN = '123:court/../autre';
    await expect(run(fetcher)).resolves.toMatchObject({ status: 'inactive', code: 'telegram_config_invalid' });
    expect(imap.calls).toEqual([]);
  });

  it('reste inactive sans erreur quand la boîte n’est pas connectée, et signale une lecture impossible', async () => {
    getDb().prepare('DELETE FROM crm_connections').run();
    imap.messages = [finma()];
    const fetcher = telegramOk();
    await expect(run(fetcher)).resolves.toMatchObject({ status: 'inactive', code: 'mailbox_not_connected' });
    expect(imap.calls).toEqual([]);
    imap.failConnect = true;
    getDb().prepare('INSERT INTO crm_connections(name,secret_encrypted,updated_at) VALUES(?,?,?)').run('support', seal(JSON.stringify({ user: 'contact@openswissdata.com', pass: 'fictif' })), NOW);
    await expect(run(fetcher)).resolves.toMatchObject({ status: 'error', code: 'imap_failed' });
    getDb().prepare('UPDATE crm_connections SET secret_encrypted=? WHERE name=?').run(seal(JSON.stringify({ user: 'autre@example.test', pass: 'fictif' })), 'support');
    await expect(run(fetcher)).resolves.toMatchObject({ status: 'error', code: 'mailbox_unreadable' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('n’envoie aucune commande IMAP qui modifie la boîte et ouvre chaque dossier en lecture seule', async () => {
    imap.messages = [finma(), client(), finma(13, { folder: 'Spam', envelope: { messageId: '<spam@finma.ch>', from: [{ address: 'a@finma.ch' }], subject: 'S', date: new Date(NOW) } })];
    await run(telegramOk());
    expect(imap.forbidden).toEqual([]);
    const opens = imap.calls.filter(c => c.name === 'mailboxOpen');
    expect(opens.length).toBeGreaterThan(0);
    for (const open of opens) expect(open.args[1]).toEqual({ readOnly: true });
    for (const fetch of imap.calls.filter(c => c.name === 'fetch')) expect(Object.keys(fetch.args[1] as object).sort()).toEqual(['envelope', 'internalDate', 'uid']);
    // `source` est compilé par imapflow en BODY.PEEK[] : la lecture du corps ne pose pas \Seen.
    for (const one of imap.calls.filter(c => c.name === 'fetchOne')) expect(one.args[1]).toEqual({ source: { maxLength: 256_000 } });
    expect(imap.calls.filter(c => c.name === 'fetchOne').map(c => c.args[0])).toEqual(['11', '13']);
  });

  it('ne laisse le jeton dans aucun journal, témoin ni résultat, même si l’erreur réseau le cite', async () => {
    // Seules les minuteries de la veille sont simulées : l'analyse du message garde ses rappels réels.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); vi.setSystemTime(NOW);
    imap.messages = [finma()];
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => {}));
    const leaking = vi.fn(async () => { throw new Error(`request to https://api.telegram.org/bot${TOKEN}/sendMessage failed`); });
    const results: unknown[] = [];
    const stop = startMailWatch({ run: async () => { const r = await runMailWatch({ fetch: leaking }); results.push(r); return r; } });
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(results).toHaveLength(1));
    stop();
    expect(leaking).toHaveBeenCalledOnce();
    expect(results).toEqual([expect.objectContaining({ status: 'error', code: 'telegram_network' })]);
    const everything = JSON.stringify([results, witness(), readMailWatchStatus(), logs.map(l => l.mock.calls)]);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain('jeton-fictif');
    expect(everything).not.toContain('juridique@finma.ch');
  });

  it('expose au bureau des compteurs, des dates et un code, jamais les empreintes', async () => {
    imap.messages = [finma()];
    await run(telegramOk());
    const status = readMailWatchStatus()!;
    expect(Object.keys(status).sort()).toEqual(['alerted', 'checked_at', 'code', 'domains', 'http_status', 'last_alert_at', 'last_success_at', 'matched', 'pending', 'status', 'total_alerted']);
    const hash = JSON.parse(witness()!.details_json).seen[0];
    expect(JSON.stringify(status)).not.toContain(hash);
  });

  it('relit un témoin illisible comme un départ à zéro, sans échouer', async () => {
    getDb().prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('mail_watch',?,'{')").run(NOW);
    expect(readMailWatchStatus()).toBeNull();
    imap.messages = [finma()];
    await expect(run(telegramOk())).resolves.toMatchObject({ status: 'ok', alerted: 1 });
  });
});

describe('Règles de la veille', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('garde les trois organismes par défaut et nettoie la liste configurée', () => {
    expect(DEFAULT_WATCH_DOMAINS).toEqual(['finma.ch', 'bfs.admin.ch', 'un.org']);
    expect(watchedDomains(undefined)).toEqual(['finma.ch', 'bfs.admin.ch', 'un.org']);
    expect(watchedDomains(' ,  ')).toEqual(['finma.ch', 'bfs.admin.ch', 'un.org']);
    expect(watchedDomains('FINMA.ch,@client.example.test, pas un domaine ,finma.ch')).toEqual(['finma.ch', 'client.example.test']);
  });
  it('compare le domaine exact ou un sous-domaine, jamais une sous-chaîne', () => {
    const domains = ['finma.ch', 'un.org'];
    expect(watchedDomainFor('a@finma.ch', domains)).toBe('finma.ch');
    expect(watchedDomainFor('a@Mail.FINMA.ch', domains)).toBe('finma.ch');
    expect(watchedDomainFor('a@fun.org', domains)).toBeNull();
    expect(watchedDomainFor('a@finma.ch.example.test', domains)).toBeNull();
    expect(watchedDomainFor('finma.ch', domains)).toBeNull();
  });
  it('réduit un message HTML en texte et n’ajoute jamais d’extrait pour un domaine non officiel', async () => {
    const html = await extractText(Buffer.from(body('<html><body><p>Madame, Monsieur,</p><p>Votre   demande\n est transmise.</p></body></html>', 'Content-Type: text/html; charset=utf-8')));
    expect(html).toBe('Madame, Monsieur, Votre demande est transmise.');
    const text = alertText({ domain: 'client.example.test', fromName: '', fromAddress: 'a@client.example.test', subject: '', receivedAt: NOW, extract: 'NE-PAS-ENVOYER' });
    expect(text).not.toContain('NE-PAS-ENVOYER');
    expect(text).toContain('De : a@client.example.test\nObjet : (sans objet)');
  });
  it('borne le texte envoyé à 4 000 caractères sans couper une paire de substitution', () => {
    const text = alertText({ domain: 'finma.ch', fromName: 'N', fromAddress: 'a@finma.ch', subject: '😀'.repeat(5000), receivedAt: NOW, extract: 'x' });
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain('Dis « réponse FINMA » à Claude pour la suite.');
    expect(text.isWellFormed()).toBe(true);
  });
  it('planifie le premier passage après 60 secondes, puis toutes les dix minutes, sans tomber sur une erreur', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pass = vi.fn().mockRejectedValueOnce(new Error('panne fictive')).mockResolvedValue({ status: 'ok', alerted: 0 });
    const stop = startMailWatch({ run: pass });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(pass).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(pass).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10 * 60_000 - 1);
    expect(pass).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(pass).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('panne fictive');
    stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(pass).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
