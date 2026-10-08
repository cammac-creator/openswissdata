// Plan du 08.10.2026 (demandes aux distributeurs officiels), point 4 : une lettre envoyée à une
// administration cantonale élargit la veille à SON domaine (`pendingLetterDomains`, sans liste à tenir
// à jour) et la réponse s'y rattache comme pour une autorité fédérale. Même boîte IMAP simulée que
// `tests/lib/mail-watch-letters.test.ts` (aucune connexion réelle, commandes d'écriture interdites).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Message = {
  folder: string;
  uid: number;
  envelope: Record<string, unknown>;
  internalDate: Date;
  source: string;
  headers?: Record<string, string>;
  /** Pour simuler DEUX lignes du même nom d'en-tête (contrefaçon plus bas) : un objet ne peut pas
   * porter deux fois la même clé, donc ce bloc brut remplace entièrement la construction depuis `headers`. */
  rawHeaderOverride?: string;
};
const imap = vi.hoisted(() => ({
  messages: [] as Message[],
  calls: [] as Array<{ name: string; args: unknown[] }>,
  forbidden: [] as string[],
  folders: [{ path: 'INBOX' }, { path: 'Spam', specialUse: '\\Junk' }] as Array<{ path: string; specialUse?: string }>,
  failConnect: false,
  failHeadersForUid: null as number | null,
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
    async fetchOne(uid: string, query: { source?: { maxLength: number }; headers?: string[] }, options: unknown) {
      imap.calls.push({ name: 'fetchOne', args: [uid, query, options] });
      const m = imap.messages.find(x => x.folder === this.current && String(x.uid) === uid);
      if (!m) return false;
      if (query.headers) {
        if (imap.failHeadersForUid === m.uid) throw new Error('lecture des en-têtes impossible');
        if (m.rawHeaderOverride !== undefined) return { uid: m.uid, headers: Buffer.from(m.rawHeaderOverride) };
        const wanted = new Set(query.headers.map(h => h.toLowerCase()));
        const lines = Object.entries(m.headers ?? {}).filter(([k]) => wanted.has(k.toLowerCase())).map(([k, v]) => `${k}: ${v}`);
        return { uid: m.uid, headers: Buffer.from(lines.length ? `${lines.join('\r\n')}\r\n` : '') };
      }
      return { uid: m.uid, source: Buffer.from(m.source) };
    }
    messageFlagsAdd = forbid('messageFlagsAdd'); messageFlagsSet = forbid('messageFlagsSet'); messageFlagsRemove = forbid('messageFlagsRemove');
    setFlagColor = forbid('setFlagColor'); messageDelete = forbid('messageDelete'); messageMove = forbid('messageMove'); messageCopy = forbid('messageCopy');
    append = forbid('append'); mailboxCreate = forbid('mailboxCreate'); mailboxRename = forbid('mailboxRename'); mailboxDelete = forbid('mailboxDelete');
  }
  return { ImapFlow };
});

import { getDb, closeDb } from '../../src/lib/db.js';
import { seal, clearCrmCache } from '../../src/lib/crm-source.js';
import { runMailWatch } from '../../src/lib/mail-watch.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const TOKEN = '123456789:jeton-fictif-TELEGRAM-abcdefghij';
const telegramOk = () => vi.fn(async () => Response.json({ ok: true, result: { message_id: 1 } }));
const sentTexts = (fetcher: ReturnType<typeof telegramOk>) => fetcher.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body)) as { text: string });

function insertLetter(overrides: Record<string, unknown>): string {
  const id = `id-${Math.random().toString(36).slice(2)}`;
  const row = {
    id, kind: 'letter', parent_id: null, to_address: 'boite-fictive@lustat.ch', cc: null,
    subject: 'Demande de licence ouverte sur opendata.swiss (LUSTAT Statistik Luzern)', body: 'Texte.',
    purpose: 'demande-licence:lustat', status: 'sent', scheduled_at: 0, lease_until: null, attempted_at: null, attempts: 0,
    resend_id: null, sent_at: 0, reply_at: null, reply_from: null, reply_subject: null, reply_extract: null,
    reply_kind: null, reply_processed_at: null, created_at: 0,
    ...overrides,
  };
  getDb().prepare(
    `INSERT INTO institutional_letters
      (id, kind, parent_id, to_address, cc, subject, body, purpose, status, scheduled_at,
       lease_until, attempted_at, attempts, resend_id, sent_at, reply_at, reply_from, reply_subject,
       reply_extract, reply_kind, reply_processed_at, created_at)
     VALUES
      (@id, @kind, @parent_id, @to_address, @cc, @subject, @body, @purpose, @status, @scheduled_at,
       @lease_until, @attempted_at, @attempts, @resend_id, @sent_at, @reply_at, @reply_from, @reply_subject,
       @reply_extract, @reply_kind, @reply_processed_at, @created_at)`,
  ).run(row);
  return id;
}
const getLetter = (id: string) => getDb().prepare('SELECT * FROM institutional_letters WHERE id=?').get(id) as Record<string, unknown>;
const msg = (uid: number, address: string, subject: string, receivedAt: number): Message => ({
  folder: 'INBOX', uid, internalDate: new Date(receivedAt), source: 'From: x\r\nSubject: y\r\n\r\nCorps.',
  envelope: { messageId: `<m-${uid}@x.test>`, from: [{ name: 'Service', address }], subject, date: new Date(receivedAt) },
});

describe('Veille courrier : réponses des administrations cantonales', () => {
  let temp: string;
  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'osd-veille-cantons-'));
    process.env.DATABASE_PATH = join(temp, 'fictive.sqlite');
    process.env.OSD_BACKUP_KEY = 'c'.repeat(64);
    process.env.OSD_VEILLE_TELEGRAM_TOKEN = TOKEN;
    process.env.OSD_VEILLE_TELEGRAM_CHAT = '424242';
    imap.messages = []; imap.calls = []; imap.forbidden = []; imap.failConnect = false; imap.failHeadersForUid = null;
    clearCrmCache();
    getDb().prepare('INSERT INTO crm_connections(name,secret_encrypted,updated_at) VALUES(?,?,?)').run('support', seal(JSON.stringify({ user: 'contact@openswissdata.com', pass: 'fictif' })), 0);
  });
  afterEach(() => {
    closeDb(); rmSync(temp, { recursive: true, force: true });
    for (const name of ['DATABASE_PATH', 'OSD_BACKUP_KEY', 'OSD_VEILLE_TELEGRAM_TOKEN', 'OSD_VEILLE_TELEGRAM_CHAT', 'OSD_MAIL_WATCH_DOMAINS']) delete process.env[name];
  });

  it('une lettre à lustat.ch fait chercher ce domaine et rattache la réponse (domaine seul, jamais l’adresse)', async () => {
    const now = Date.UTC(2026, 9, 20, 12, 0);
    const id = insertLetter({ sent_at: now - 3 * DAY });
    imap.messages = [msg(1, 'statistik@lustat.ch', 'AW: Demande de licence ouverte sur opendata.swiss (LUSTAT Statistik Luzern)', now - HOUR)];
    const fetcher = telegramOk();
    const result = await runMailWatch({ fetch: fetcher, now: () => now });
    const search = imap.calls.find(c => c.name === 'search');
    expect(JSON.stringify(search?.args[0])).toContain('lustat.ch');
    const letter = getLetter(id);
    expect(letter.reply_from).toBe('lustat.ch');
    expect(letter.reply_kind).toBe('unverified');
    expect(letter.reply_at).toBe(now - HOUR);
    expect(result.alerted).toBe(1);
    const [sent] = sentTexts(fetcher);
    expect(sent.text).toContain('lustat.ch');
    expect(sent.text).not.toMatch(/statistik@|@/);
    expect(imap.forbidden).toEqual([]);
  });

  it('une lettre à zh.ch rattache la réponse d’un sous-domaine du canton (statistik.zh.ch)', async () => {
    const now = Date.UTC(2026, 9, 20, 12, 0);
    const id = insertLetter({
      to_address: 'boite-fictive@zh.ch', purpose: 'demande-licence:fachstelle-ogd-kanton-zuerich',
      subject: 'Anfrage für eine offene Lizenz auf opendata.swiss (Kanton Zürich)', sent_at: now - 2 * DAY,
    });
    imap.messages = [msg(2, 'info@statistik.zh.ch', 'AW: Anfrage für eine offene Lizenz auf opendata.swiss (Kanton Zürich)', now - HOUR)];
    await runMailWatch({ fetch: telegramOk(), now: () => now });
    expect(getLetter(id)).toMatchObject({ reply_from: 'statistik.zh.ch', reply_kind: 'unverified' });
  });

  it('un domaine imité (lustat.ch.example.com) ne se rattache jamais à la lettre', async () => {
    const now = Date.UTC(2026, 9, 20, 12, 0);
    const id = insertLetter({ sent_at: now - 3 * DAY });
    imap.messages = [msg(3, 'x@lustat.ch.example.com', 'AW: Demande de licence ouverte sur opendata.swiss (LUSTAT Statistik Luzern)', now - HOUR)];
    await runMailWatch({ fetch: telegramOk(), now: () => now });
    expect(getLetter(id).reply_at).toBeNull();
  });
});
