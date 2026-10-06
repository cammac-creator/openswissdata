// Tâche 3 du plan du 06.10.2026, et correction finale demandée par la relecture Opus : rattachement
// d'une réponse d'autorité à la lettre institutionnelle qu'elle concerne, authenticité (DKIM/DMARC),
// motifs « auto » resserrés, lettres `failed` tentées, alerte de secours après trois échecs d'en-têtes.
// Même boîte IMAP simulée que `tests/lib/mail-watch.test.ts` (aucune connexion réelle, commandes
// d'écriture interdites), étendue pour répondre aussi à `fetchOne({ headers })`.
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
import { runLettersSender } from '../../src/lib/letters-sender.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const TOKEN = '123456789:jeton-fictif-TELEGRAM-abcdefghij';

const telegramOk = () => vi.fn(async () => Response.json({ ok: true, result: { message_id: 1 } }));
const sentTexts = (fetcher: ReturnType<typeof telegramOk>) => fetcher.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body)) as { chat_id: string; text: string });
const witness = () => JSON.parse((getDb().prepare("SELECT details_json FROM operation_checks WHERE name='mail_watch'").get() as { details_json: string }).details_json);
const run = (fetcher: typeof fetch, now: number) => runMailWatch({ fetch: fetcher, now: () => now });
const domainOfAddr = (address: string) => address.slice(address.lastIndexOf('@') + 1).toLowerCase();

/** `Authentication-Results` aligné (DKIM et DMARC passent, sur le domaine de l'expéditeur) : sert aux
 * tests qui veulent une réponse authentifiée (`human`) sans faire de l'authenticité leur sujet. */
const authPass = (address: string): Record<string, string> => {
  const d = domainOfAddr(address);
  return { 'Authentication-Results': `mx.infomaniak.ch; dkim=pass header.d=${d} header.s=sel; dmarc=pass header.from=${d}` };
};

function insertLetter(overrides: Record<string, unknown> = {}): string {
  const db = getDb();
  const id = (overrides.id as string) ?? `id-${Math.random().toString(36).slice(2)}`;
  const row = {
    id, kind: 'letter', parent_id: null, to_address: 'sanctions@seco.admin.ch', cc: null,
    subject: 'Autorisation de reprise', body: 'Texte de la lettre.\n\nMeilleures salutations\n\nClaude-Alain Martin\nOpenSwissData\ncontact@openswissdata.com',
    purpose: 'Clarification', status: 'sent', scheduled_at: 0, lease_until: null, attempted_at: null, attempts: 0,
    resend_id: null, sent_at: 0, reply_at: null, reply_from: null, reply_subject: null, reply_extract: null,
    reply_kind: null, reply_processed_at: null, created_at: 0,
    ...overrides, id,
  };
  db.prepare(
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
function getLetter(id: string): Record<string, unknown> {
  return getDb().prepare('SELECT * FROM institutional_letters WHERE id=?').get(id) as Record<string, unknown>;
}

const msg = (over: Partial<Message> & { uid: number; address: string; subject: string; receivedAt: number }): Message => ({
  folder: 'INBOX', uid: over.uid, internalDate: new Date(over.receivedAt), source: 'From: x\r\nSubject: y\r\n\r\nCorps.',
  envelope: { messageId: `<m-${over.uid}@x.test>`, from: [{ name: 'Service', address: over.address }], subject: over.subject, date: new Date(over.receivedAt) },
  ...over,
});
/** Comme `msg`, mais avec une authenticité DKIM/DMARC alignée par défaut (fusionnée avec d'éventuels
 * autres en-têtes demandés) : pour les tests dont le sujet n'est pas l'authenticité elle-même. */
const humanMsg = (over: Partial<Message> & { uid: number; address: string; subject: string; receivedAt: number }): Message =>
  msg({ ...over, headers: { ...authPass(over.address), ...over.headers } });

describe('Rattachement des réponses aux lettres institutionnelles (tâche 3, corrigé le 06.10)', () => {
  let temp: string;
  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'osd-veille-lettres-'));
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

  it('rattache par objet (Re:), écrit date/domaine/objet tronqué/type, et son Telegram remplace l’alerte habituelle', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - 5 * DAY, subject: 'Autorisation de reprise' });
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
    const fetcher = telegramOk();
    const result = await run(fetcher, now);
    expect(fetcher).toHaveBeenCalledOnce();
    const [sent] = sentTexts(fetcher);
    expect(sent.text).toBe('Réponse à la lettre du 05.10.2026 (Autorisation de reprise) : humaine de seco.admin.ch');
    expect(sent.text).not.toMatch(/juriste|@/);
    const letter = getLetter(id);
    expect(letter.reply_from).toBe('seco.admin.ch');
    expect(letter.reply_subject).toBe('Re: Autorisation de reprise');
    expect(letter.reply_kind).toBe('human');
    expect(letter.reply_at).toBe(now - HOUR);
    expect(letter.reply_extract).toBeNull();
    expect(result.alerted).toBe(1);
  });

  it('rattache par l’identifiant Resend dans References, sans correspondance d’objet', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - 2 * DAY, subject: 'Autorisation de reprise', resend_id: 'abc12345-1111-2222-3333-444444444444' });
    imap.messages = [humanMsg({
      uid: 2, address: 'juriste@seco.admin.ch', subject: 'Sans rapport apparent', receivedAt: now - HOUR,
      headers: { References: '<abc12345-1111-2222-3333-444444444444@resend.dev>' },
    })];
    const result = await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('human');
    expect(result.alerted).toBe(1);
  });

  it('classe « auto » par l’en-tête Auto-Submitted, X-Autoreply/X-Autorespond, Precedence, ou l’objet (chaque motif)', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const cases: Array<{ headers?: Record<string, string>; subject: string }> = [
      { headers: { 'Auto-Submitted': 'auto-replied' }, subject: 'Re: Autorisation de reprise' },
      { headers: { 'X-Autoreply': 'yes' }, subject: 'Re: Autorisation de reprise' },
      { headers: { 'X-Autorespond': 'yes' }, subject: 'Re: Autorisation de reprise' },
      { headers: { Precedence: 'bulk' }, subject: 'Re: Autorisation de reprise' },
      { headers: { Precedence: 'auto_reply' }, subject: 'Re: Autorisation de reprise' },
      { headers: { Precedence: 'junk' }, subject: 'Re: Autorisation de reprise' },
      { subject: 'Accusé de réception : Autorisation de reprise' },
      { subject: 'Eingangsbestätigung : Autorisation de reprise' },
      { subject: 'Automatic reply: Autorisation de reprise' },
      { subject: 'Réponse automatique : Autorisation de reprise' },
      { subject: 'Automatische Antwort: Autorisation de reprise' },
      { subject: 'Abwesenheit: Autorisation de reprise' },
      { subject: 'Out of office: Autorisation de reprise' },
      { subject: 'Message d’absence : Autorisation de reprise' },
      { subject: 'Absent du bureau : Autorisation de reprise' },
      { subject: 'Absente du bureau : Autorisation de reprise' },
      { subject: 'Risposta automatica: Autorisation de reprise' },
    ];
    for (const [i, c] of cases.entries()) {
      // Objet de lettre unique par cas, à deux chiffres (« 00 », « 01 », … jamais préfixe l'un de
      // l'autre comme « 1 »/« 10 ») : les objets des autres cas ne doivent jamais correspondre
      // (sinon le message pourrait se rattacher à une lettre déjà classée par un cas précédent).
      const tag = String(i).padStart(2, '0');
      const id = insertLetter({ sent_at: now - HOUR, subject: `Autorisation de reprise cas-${tag}` });
      const subject = c.subject.replace('Autorisation de reprise', `Autorisation de reprise cas-${tag}`);
      imap.messages = [humanMsg({ uid: 100 + i, address: 'juriste@seco.admin.ch', subject, receivedAt: now - 10 * 60_000, headers: c.headers })];
      await run(telegramOk(), now);
      expect(getLetter(id).reply_kind, `cas #${i} (${subject})`).toBe('auto');
    }
  });

  it('« absence » seule n’est plus un motif automatique : un refus humain qui la cite reste `human`', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Demande de données' });
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'AW: Demande de données – absence de base légale', receivedAt: now - 10 * 60_000 })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('human');
  });

  it('un mot d’un motif automatique DANS L’OBJET DE LA LETTRE elle-même ne fait jamais classer sa réponse humaine en auto', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    // L'objet de la LETTRE contient « réponse automatique » (ex. une lettre sur le sujet des réponses
    // automatiques) : ce mot doit être retiré de l'objet reçu avant la recherche de motifs.
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Réponse automatique aux demandes de données' });
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Réponse automatique aux demandes de données', receivedAt: now - 10 * 60_000 })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('human');
  });

  it('`Precedence: list` n’est jamais traité comme automatique (seuls auto_reply/bulk/junk comptent)', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Autorisation de reprise' });
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - 10 * 60_000, headers: { Precedence: 'list' } })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('human'); // non auto, et authentifié (humanMsg) : donc humaine.
  });

  it('authenticité : DKIM aligné suffit (sans DMARC)', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Autorisation de reprise' });
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - 10 * 60_000, headers: { 'Authentication-Results': 'mx; dkim=pass header.d=seco.admin.ch header.s=s' } })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('human');
  });

  it('authenticité : DMARC aligné suffit (sans DKIM)', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Autorisation de reprise' });
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - 10 * 60_000, headers: { 'Authentication-Results': 'mx; dmarc=pass header.from=seco.admin.ch' } })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('human');
  });

  it('authenticité : en-tête absent → `unverified`, jamais `human`, Telegram avertit « NON AUTHENTIFIÉE »', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Autorisation de reprise' });
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - 10 * 60_000 })];
    const fetcher = telegramOk();
    await run(fetcher, now);
    expect(getLetter(id).reply_kind).toBe('unverified');
    expect(sentTexts(fetcher)[0].text).toContain('NON AUTHENTIFIÉE, vérifier l’expéditeur');
  });

  it('authenticité : dkim/dmarc explicitement en échec (fail) → `unverified`', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Autorisation de reprise' });
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - 10 * 60_000, headers: { 'Authentication-Results': 'mx; dkim=fail header.d=seco.admin.ch; dmarc=fail header.from=seco.admin.ch' } })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('unverified');
  });

  it('authenticité : seul le PREMIER `Authentication-Results` compte (une contrefaçon plus bas n’aide pas)', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Autorisation de reprise' });
    imap.messages = [msg({
      uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - 10 * 60_000,
      rawHeaderOverride: 'Authentication-Results: mx.infomaniak.ch; dkim=fail header.d=seco.admin.ch\r\nAuthentication-Results: forge.evil.test; dkim=pass header.d=seco.admin.ch\r\n',
    })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('unverified'); // le vrai premier en-tête (dkim=fail) l'emporte.
  });

  it('authenticité : un `header.d` sans point (ex. « ch » seul) est toujours rejeté', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Autorisation de reprise' });
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - 10 * 60_000, headers: { 'Authentication-Results': 'mx; dkim=pass header.d=ch' } })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('unverified');
  });

  it('une auto n’écrase jamais une humaine déjà enregistrée ; une humaine remplace une auto (deux passages)', async () => {
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise' });
    // 1) une humaine arrive d'abord.
    const t1 = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: t1 - HOUR })];
    await run(telegramOk(), t1);
    expect(getLetter(id).reply_kind).toBe('human');
    const humanSubject = getLetter(id).reply_subject;
    // 2) une auto arrive ensuite (autre message, autre clé) : ne doit rien changer.
    const t2 = t1 + HOUR;
    imap.messages.push(humanMsg({ uid: 2, address: 'juriste@seco.admin.ch', subject: 'Out of office: Autorisation de reprise', receivedAt: t2 - HOUR }));
    await run(telegramOk(), t2);
    const after = getLetter(id);
    expect(after.reply_kind).toBe('human');
    expect(after.reply_subject).toBe(humanSubject); // pas écrasé

    // 3) sur une seconde lettre, l'ordre inverse : auto d'abord, puis humaine qui remplace.
    const id2 = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Conditions d’accès' });
    imap.messages.push(humanMsg({ uid: 3, address: 'juriste@seco.admin.ch', subject: 'Abwesenheit: Conditions d’accès', receivedAt: t2 - 30 * 60_000 }));
    await run(telegramOk(), t2 + HOUR);
    expect(getLetter(id2).reply_kind).toBe('auto');
    imap.messages.push(humanMsg({ uid: 4, address: 'juriste@seco.admin.ch', subject: 'Re: Conditions d’accès', receivedAt: t2 + 30 * 60_000 }));
    await run(telegramOk(), t2 + 2 * HOUR);
    expect(getLetter(id2).reply_kind).toBe('human');
  });

  it('`unverified` n’écrase jamais `human` ; `human` remplace `unverified` (deux passages)', async () => {
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise' });
    const t1 = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: t1 - HOUR })];
    await run(telegramOk(), t1);
    expect(getLetter(id).reply_kind).toBe('human');
    const t2 = t1 + HOUR;
    imap.messages.push(msg({ uid: 2, address: 'juriste@seco.admin.ch', subject: 'Nouveau message sans en-tête : Autorisation de reprise', receivedAt: t2 - HOUR }));
    await run(telegramOk(), t2);
    expect(getLetter(id).reply_kind).toBe('human'); // unverified n'écrase jamais human.

    const id2 = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Conditions d’accès' });
    imap.messages.push(msg({ uid: 3, address: 'juriste@seco.admin.ch', subject: 'Re: Conditions d’accès', receivedAt: t2 - 30 * 60_000 }));
    await run(telegramOk(), t2 + HOUR);
    expect(getLetter(id2).reply_kind).toBe('unverified');
    imap.messages.push(humanMsg({ uid: 4, address: 'juriste@seco.admin.ch', subject: 'Re: Conditions d’accès (confirmation)', receivedAt: t2 + 30 * 60_000 }));
    await run(telegramOk(), t2 + 2 * HOUR);
    expect(getLetter(id2).reply_kind).toBe('human'); // human remplace unverified.
  });

  it('humaine puis auto dans le MÊME passage (deux lettres) : chacune garde son résultat propre', async () => {
    const idHuman = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Sujet humain' });
    const idAuto = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Sujet auto' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [
      humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Sujet humain', receivedAt: now - 2 * HOUR }),
      humanMsg({ uid: 2, address: 'juriste@seco.admin.ch', subject: 'Out of office: Sujet auto', receivedAt: now - HOUR }),
    ];
    await run(telegramOk(), now);
    expect(getLetter(idHuman).reply_kind).toBe('human');
    expect(getLetter(idAuto).reply_kind).toBe('auto');
  });

  it('auto puis humaine dans le MÊME passage, sur la MÊME lettre : la seconde (humaine) gagne', async () => {
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    // L'auto est reçue avant (receivedAt plus ancien = traité en premier par le tri du passage).
    imap.messages = [
      humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Out of office: Autorisation de reprise', receivedAt: now - 2 * HOUR }),
      humanMsg({ uid: 2, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR }),
    ];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('human');
  });

  it('refuse un domaine qui imite (domaine frère sous le même parent, jamais un sous-domaine)', async () => {
    process.env.OSD_MAIL_WATCH_DOMAINS = 'admin.ch';
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise', to_address: 'sanctions@seco.admin.ch' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    // xyz.admin.ch est bien surveillé (admin.ch de base), mais n'est ni seco.admin.ch ni un sous-domaine.
    imap.messages = [humanMsg({ uid: 1, address: 'quelqu-un@xyz.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
    const fetcher = telegramOk();
    const result = await run(fetcher, now);
    expect(fetcher).toHaveBeenCalledOnce(); // le message est bien collecté et alerté normalement (domaine de base « admin.ch »)...
    expect(sentTexts(fetcher)[0].text.split('\n')[0]).toBe('📬 OpenSwissData : réponse reçue de admin.ch');
    expect(getLetter(id).reply_kind).toBeNull(); // ...mais xyz.admin.ch n'est ni seco.admin.ch ni un sous-domaine : jamais rattaché.
    expect(result.alerted).toBe(1);
  });

  it('rattache dans le sens inverse : lettre envoyée à un sous-domaine, réponse du domaine parent déjà surveillé par défaut', async () => {
    process.env.OSD_MAIL_WATCH_DOMAINS = 'seco.admin.ch';
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise', to_address: 'x@guichet.seco.admin.ch' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('human');
    expect(getLetter(id).reply_from).toBe('seco.admin.ch');
  });

  it('une lettre récente (<120 jours) élargit la veille à son domaine ; une lettre ancienne (>120 jours) ne l’élargit pas', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    insertLetter({ sent_at: now - 200 * DAY, subject: 'Vieille demande', to_address: 'x@vieux-domaine.admin.ch' });
    imap.messages = [humanMsg({ uid: 1, address: 'x@vieux-domaine.admin.ch', subject: 'Re: Vieille demande', receivedAt: now - HOUR })];
    const fetcher = telegramOk();
    const result = await run(fetcher, now);
    expect(fetcher).not.toHaveBeenCalled(); // domaine jamais ajouté à la veille : le message n'est même pas vu
    expect(result.matched).toBe(0);
  });

  it('une lettre `failed` avec un essai réel (attempted_at, sent_at NULL) élargit aussi la veille et se rattache, avec la bonne date', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const attemptedAt = now - 3 * DAY;
    const id = insertLetter({ status: 'failed', sent_at: null, attempted_at: attemptedAt, subject: 'Conditions d’accès', to_address: 'x@seco.admin.ch' });
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Conditions d’accès', receivedAt: now - HOUR })];
    const fetcher = telegramOk();
    const result = await run(fetcher, now);
    expect(result.matched).toBe(1); // le domaine d'une lettre `failed` tentée élargit bien la veille.
    expect(getLetter(id).reply_kind).toBe('human');
    expect(sentTexts(fetcher)[0].text).toMatch(/^Réponse à la lettre du 07\.10\.2026 /); // date = attempted_at, jamais 01.01.1970.
  });

  it('une lettre déjà `human` reste une cible valable : une nouvelle réponse humaine rafraîchit date/objet/domaine', async () => {
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise' });
    const t1 = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: t1 - HOUR })];
    await run(telegramOk(), t1);
    expect(getLetter(id).reply_kind).toBe('human');
    const firstAt = getLetter(id).reply_at;

    const t2 = t1 + 2 * HOUR;
    imap.messages.push(humanMsg({ uid: 2, address: 'collegue@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: t2 - HOUR }));
    await run(telegramOk(), t2);
    const after = getLetter(id);
    expect(after.reply_kind).toBe('human');
    expect(after.reply_at).toBe(t2 - HOUR);
    expect(after.reply_at).not.toBe(firstAt);
  });

  it('une réponse « Re: Relance : X » (réponse à la relance) se rattache à la lettre D’ORIGINE, jamais à la relance', async () => {
    const now = Date.UTC(2026, 9, 26, 12, 0);
    const parentId = insertLetter({ sent_at: Date.UTC(2026, 9, 5, 12, 0), subject: 'Autorisation de reprise' });
    insertLetter({ kind: 'reminder', parent_id: parentId, status: 'sent', sent_at: now - HOUR, subject: 'Relance : Autorisation de reprise', to_address: 'sanctions@seco.admin.ch' });
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Relance : Autorisation de reprise', receivedAt: now - 30 * 60_000 })];
    await run(telegramOk(), now);
    const parent = getLetter(parentId);
    expect(parent.reply_kind).toBe('human');
    expect(parent.reply_subject).toBe('Re: Relance : Autorisation de reprise');
  });

  it('une lecture d’en-têtes impossible laisse le message en attente (jamais classé « humaine » par défaut), retenté au passage suivant', async () => {
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
    imap.failHeadersForUid = 1;
    const fetcher = telegramOk();
    const first = await run(fetcher, now);
    expect(fetcher).not.toHaveBeenCalled();
    expect(first).toMatchObject({ status: 'ok', matched: 1, alerted: 0, pending: 1 });
    expect(getLetter(id).reply_kind).toBeNull();

    imap.failHeadersForUid = null;
    const second = telegramOk();
    const result = await run(second, now + 60_000);
    expect(second).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ alerted: 1, pending: 0 });
    expect(getLetter(id).reply_kind).toBe('human');
  });

  it('après trois échecs de lecture d’en-têtes pour le même message, alerte de secours habituelle SANS rattachement', async () => {
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
    imap.failHeadersForUid = 1;

    const r1 = telegramOk();
    await run(r1, now);
    expect(r1).not.toHaveBeenCalled();
    expect(Object.values(witness().headerFailures as Record<string, number>)).toEqual([1]);

    const r2 = telegramOk();
    await run(r2, now + 60_000);
    expect(r2).not.toHaveBeenCalled();
    expect(Object.values(witness().headerFailures as Record<string, number>)).toEqual([2]);

    const r3 = telegramOk();
    const result = await run(r3, now + 2 * 60_000);
    expect(r3).toHaveBeenCalledOnce(); // 3e échec : abandon, alerte de secours habituelle.
    expect(sentTexts(r3)[0].text.split('\n')[0]).toBe('📬 OpenSwissData : réponse reçue de seco.admin.ch');
    expect(result.alerted).toBe(1);
    expect(getLetter(id).reply_kind).toBeNull(); // jamais de rattachement sans en-têtes fiables.
    expect(witness().headerFailures).toEqual({}); // compteur purgé, message marqué signalé comme les autres.
  });

  it('n’interroge les en-têtes que pour un domaine qui a une lettre en attente ; un organisme officiel sans lettre n’en a pas besoin', async () => {
    insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise', to_address: 'sanctions@seco.admin.ch' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [
      humanMsg({ uid: 1, address: 'juridique@finma.ch', subject: 'Sans rapport', receivedAt: now - 2 * HOUR }), // FINMA : officiel, aucune lettre en attente
      humanMsg({ uid: 2, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR }),
    ];
    await run(telegramOk(), now);
    const headerCalls = imap.calls.filter(c => c.name === 'fetchOne' && (c.args[1] as { headers?: unknown }).headers);
    const sourceCalls = imap.calls.filter(c => c.name === 'fetchOne' && (c.args[1] as { source?: unknown }).source);
    expect(headerCalls.map(c => c.args[0])).toEqual(['2']);
    expect(sourceCalls.map(c => c.args[0])).toEqual(['1']); // FINMA garde son extrait habituel, jamais d'en-têtes
  });

  it('un message non rattaché d’un domaine ajouté par une lettre est libellé « autorité », jamais « client »', async () => {
    insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise', to_address: 'sanctions@seco.admin.ch' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    // Objet totalement étranger : aucun rattachement possible, mais le domaine vient bien d'une lettre.
    imap.messages = [humanMsg({ uid: 1, address: 'standard@seco.admin.ch', subject: 'Bulletin trimestriel', receivedAt: now - HOUR })];
    const fetcher = telegramOk();
    await run(fetcher, now);
    const text = sentTexts(fetcher)[0].text;
    expect(text.split('\n')[1]).toBe('Message d’une autorité (seco.admin.ch).');
    expect(text).not.toContain('client');
  });

  it('un message déjà rattaché (et marqué signalé) n’est jamais rejoué au passage suivant', async () => {
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('human');
    expect(witness().total_attached).toBe(1);
    const second = telegramOk();
    await run(second, now + HOUR);
    expect(second).not.toHaveBeenCalled();
    expect(witness().total_attached).toBe(1); // jamais une seconde fois pour le même message
  });

  it('le texte Telegram d’une réponse rattachée ne contient jamais d’adresse, et sans adresse en base', async () => {
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [humanMsg({ uid: 1, address: 'juriste.nominatif@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
    const fetcher = telegramOk();
    await run(fetcher, now);
    const text = sentTexts(fetcher)[0].text;
    expect(text).not.toContain('juriste.nominatif');
    expect(text).not.toContain('@');
    const letter = getLetter(id);
    expect(String(letter.reply_from)).not.toContain('@');
    expect(JSON.stringify(letter)).not.toContain('juriste.nominatif');
  });

  it('réponse humaine → la relance en file est annulée au passage suivant de l’expéditeur (intégration avec runLettersSender)', async () => {
    const SENT_AT = Date.UTC(2026, 9, 5, 12, 0);
    const DUE_NOW = Date.UTC(2026, 9, 26, 12, 0); // 15 jours ouvrés après SENT_AT (voir tests/lib/letters-sender.test.ts)
    const parentId = insertLetter({ sent_at: SENT_AT, subject: 'Autorisation de reprise' });

    // Témoin mail_watch frais : sans lui, la relance n'est ni créée ni réclamée (correction du 06.10,
    // item 1) — un passage de la veille suffit à le poser.
    getDb().prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('mail_watch',?,?)")
      .run(DUE_NOW, JSON.stringify({ version: 1, checked_at: DUE_NOW, status: 'ok', code: null, http_status: null, last_success_at: DUE_NOW, last_alert_at: null, matched: 0, alerted: 0, pending: 0, total_alerted: 0, domains: 0, total_attached: 0, seen: [], headerFailures: {} }));

    // 1) la relance est créée (encore `queued`), 15 jours ouvrés après l'envoi, sans réponse.
    await runLettersSender({ now: () => DUE_NOW, rng: () => 0, send: vi.fn(), fetch: (async () => Response.json({ ok: true })) as unknown as typeof fetch, hasApiKey: () => true });
    const reminder = getDb().prepare("SELECT id, scheduled_at FROM institutional_letters WHERE parent_id=? AND kind='reminder'").get(parentId) as { id: string; scheduled_at: number };
    expect(reminder).toBeDefined();
    expect(getLetter(reminder.id).status).toBe('queued');

    // 2) une réponse humaine de SECO arrive, rattachée par la veille courrier à la lettre d'ORIGINE.
    const mailNow = DUE_NOW + HOUR;
    imap.messages = [humanMsg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: mailNow - HOUR })];
    await run(telegramOk(), mailNow);
    expect(getLetter(parentId).reply_kind).toBe('human');
    expect(getLetter(reminder.id).status).toBe('queued'); // pas encore réclamée

    // 3) au passage suivant de l'expéditeur, la relance en file est annulée, jamais envoyée (la veille
    // reste « fraîche » : la relance avait déjà été posée avant la réponse).
    const send = vi.fn();
    await runLettersSender({ now: () => reminder.scheduled_at + 30_000, rng: () => 0, send, fetch: (async () => Response.json({ ok: true })) as unknown as typeof fetch, hasApiKey: () => true });
    expect(send).not.toHaveBeenCalled();
    expect(getLetter(reminder.id).status).toBe('cancelled');
  });
});
