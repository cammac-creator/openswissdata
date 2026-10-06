// Tâche 3 du plan du 06.10.2026, corrections finales 1 et 2 (relecture Opus de toute la branche) :
// rattachement d'une réponse d'autorité à la lettre institutionnelle qu'elle concerne, authenticité
// (DKIM/DMARC, liste de confiance VIDE pour l'instant), motifs « auto » resserrés, lettres `failed`
// tentées, rattachement par l'enveloppe seule après trois échecs d'en-têtes. Même boîte IMAP simulée
// que `tests/lib/mail-watch.test.ts` (aucune connexion réelle, commandes d'écriture interdites),
// étendue pour répondre aussi à `fetchOne({ headers })`.
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
import {
  runMailWatch, attachReply, splitAuthClauses, extractAuthservId, parseAuthenticationResults, signingDomainAligned,
} from '../../src/lib/mail-watch.js';
import { runLettersSender } from '../../src/lib/letters-sender.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const TOKEN = '123456789:jeton-fictif-TELEGRAM-abcdefghij';

const telegramOk = () => vi.fn(async () => Response.json({ ok: true, result: { message_id: 1 } }));
const sentTexts = (fetcher: ReturnType<typeof telegramOk>) => fetcher.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body)) as { chat_id: string; text: string });
const witness = () => JSON.parse((getDb().prepare("SELECT details_json FROM operation_checks WHERE name='mail_watch'").get() as { details_json: string }).details_json);
const run = (fetcher: typeof fetch, now: number) => runMailWatch({ fetch: fetcher, now: () => now });
const domainOfAddr = (address: string) => address.slice(address.lastIndexOf('@') + 1).toLowerCase();
/** En-tête `Authentication-Results` « parfait » (DKIM et DMARC alignés sur le domaine de l'expéditeur) :
 * sert à prouver qu'il ne suffit PAS à lui seul tant que `TRUSTED_AUTHSERV_IDS` est vide. */
const alignedAuthHeaders = (address: string): Record<string, string> => {
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

describe('Fonctions pures d’authenticité (unitaire, corrections finales 1 et 2 du 06.10)', () => {
  it('splitAuthClauses : ne coupe jamais à l’intérieur de guillemets ni de parenthèses (commentaires RFC 5322)', () => {
    expect(splitAuthClauses('mx.example; spf=pass smtp.mailfrom="a;b"@evil.example; dkim=none'))
      .toEqual(['mx.example', 'spf=pass smtp.mailfrom="a;b"@evil.example', 'dkim=none']);
    expect(splitAuthClauses('mx.example (un commentaire ; avec point-virgule); dkim=pass header.d=x.ch'))
      .toEqual(['mx.example (un commentaire ; avec point-virgule)', 'dkim=pass header.d=x.ch']);
  });

  it('parseAuthenticationResults : une clause doit COMMENCER par dkim=pass/dmarc=pass — une contrefaçon nichée dans une AUTRE clause ne compte jamais', () => {
    // Reproduit tel quel le cas « injection smtp.mailfrom » de la sonde finale (item 2a/2b).
    const injected = 'mx.infomaniak.com; spf=pass smtp.mailfrom="dkim=pass header.d=ne.admin.ch"@evil.example; dkim=none';
    expect(parseAuthenticationResults(injected)).toEqual({ dkimDomain: null, dmarcFromDomain: null });
  });

  it('parseAuthenticationResults : TRUSTED_AUTHSERV_IDS est vide — AUCUN identifiant n’est jamais fiable, même dkim=pass parfaitement formé', () => {
    expect(parseAuthenticationResults('mx.infomaniak.ch; dkim=pass header.d=seco.admin.ch')).toEqual({ dkimDomain: null, dmarcFromDomain: null });
    expect(parseAuthenticationResults('forged; dkim=pass header.d=vd.admin.ch')).toEqual({ dkimDomain: null, dmarcFromDomain: null });
    expect(parseAuthenticationResults(null)).toEqual({ dkimDomain: null, dmarcFromDomain: null });
  });

  it('extractAuthservId : premier élément de la première clause, jamais une adresse', () => {
    expect(extractAuthservId('mx.infomaniak.ch 1; dkim=pass header.d=x.ch')).toBe('mx.infomaniak.ch');
    expect(extractAuthservId('')).toBeNull();
  });

  it('signingDomainAligned (item 5) : égal ou PARENT du domaine de l’expéditeur seulement, jamais un enfant', () => {
    expect(signingDomainAligned('seco.admin.ch', 'seco.admin.ch')).toBe(true); // égal
    expect(signingDomainAligned('bj.admin.ch', 'admin.ch')).toBe(true); // parent
    expect(signingDomainAligned('admin.ch', 'bj.admin.ch')).toBe(false); // enfant : jamais
    expect(signingDomainAligned('seco.admin.ch', 'xyz.admin.ch')).toBe(false); // frère : jamais
  });

  describe('attachReply : ordre de confiance (auto < unverified < human), hors IMAP', () => {
    let temp: string;
    beforeEach(() => {
      temp = mkdtempSync(join(tmpdir(), 'osd-attach-'));
      process.env.DATABASE_PATH = join(temp, 'f.sqlite');
      process.env.OSD_BACKUP_KEY = 'c'.repeat(64);
    });
    afterEach(() => { closeDb(); rmSync(temp, { recursive: true, force: true }); delete process.env.DATABASE_PATH; delete process.env.OSD_BACKUP_KEY; });

    it('depuis NULL, les trois types s’écrivent', () => {
      for (const kind of ['auto', 'unverified', 'human'] as const) {
        const id = insertLetter({ subject: `Lettre ${kind}` });
        expect(attachReply(getDb(), id, 1000, 'seco.admin.ch', 'Re: X', kind)).toBe(true);
        expect(getLetter(id).reply_kind).toBe(kind);
      }
    });

    it('auto n’écrase jamais unverified ni human ; unverified n’écrase jamais human', () => {
      const idU = insertLetter(); attachReply(getDb(), idU, 1, 'a.ch', 's', 'unverified');
      expect(attachReply(getDb(), idU, 2, 'b.ch', 's2', 'auto')).toBe(false);
      expect(getLetter(idU).reply_from).toBe('a.ch');

      const idH = insertLetter(); attachReply(getDb(), idH, 1, 'a.ch', 's', 'human');
      expect(attachReply(getDb(), idH, 2, 'b.ch', 's2', 'auto')).toBe(false);
      expect(attachReply(getDb(), idH, 3, 'c.ch', 's3', 'unverified')).toBe(false);
      expect(getLetter(idH).reply_from).toBe('a.ch');
    });

    it('human remplace unverified ; human rafraîchit human (nouvelle correspondance)', () => {
      const id = insertLetter(); attachReply(getDb(), id, 1, 'a.ch', 's1', 'unverified');
      expect(attachReply(getDb(), id, 2, 'b.ch', 's2', 'human')).toBe(true);
      expect(getLetter(id)).toMatchObject({ reply_from: 'b.ch', reply_subject: 's2', reply_kind: 'human' });
      expect(attachReply(getDb(), id, 3, 'c.ch', 's3', 'human')).toBe(true);
      expect(getLetter(id)).toMatchObject({ reply_from: 'c.ch', reply_subject: 's3' });
    });

    it('reply_processed_at est remis à NULL à chaque montée en rang, jamais sinon modifié par cette fonction', () => {
      const id = insertLetter({ reply_processed_at: 999 });
      attachReply(getDb(), id, 1, 'a.ch', 's', 'auto');
      expect(getLetter(id).reply_processed_at).toBeNull();
    });
  });
});

describe('Rattachement des réponses aux lettres institutionnelles (corrections finales 1 et 2 du 06.10)', () => {
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

  it('rattache par objet (Re:), écrit date/domaine/objet tronqué/type `unverified`, et son Telegram remplace l’alerte habituelle', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - 5 * DAY, subject: 'Autorisation de reprise' });
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
    const fetcher = telegramOk();
    const result = await run(fetcher, now);
    expect(fetcher).toHaveBeenCalledOnce();
    const [sent] = sentTexts(fetcher);
    expect(sent.text).toBe('Réponse à la lettre du 05.10.2026 (Autorisation de reprise) : NON AUTHENTIFIÉE, vérifier l’expéditeur de seco.admin.ch');
    expect(sent.text).not.toMatch(/juriste|@/);
    const letter = getLetter(id);
    expect(letter.reply_from).toBe('seco.admin.ch');
    expect(letter.reply_subject).toBe('Re: Autorisation de reprise');
    expect(letter.reply_kind).toBe('unverified');
    expect(letter.reply_at).toBe(now - HOUR);
    expect(letter.reply_extract).toBeNull();
    expect(result.alerted).toBe(1);
  });

  it('rattache par l’identifiant Resend dans References, sans correspondance d’objet', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - 2 * DAY, subject: 'Autorisation de reprise', resend_id: 'abc12345-1111-2222-3333-444444444444' });
    imap.messages = [msg({
      uid: 2, address: 'juriste@seco.admin.ch', subject: 'Sans rapport apparent', receivedAt: now - HOUR,
      headers: { References: '<abc12345-1111-2222-3333-444444444444@resend.dev>' },
    })];
    const result = await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('unverified');
    expect(result.alerted).toBe(1);
  });

  it('même avec DKIM et DMARC parfaitement alignés, reste `unverified` tant que TRUSTED_AUTHSERV_IDS est vide (sûr par défaut)', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Autorisation de reprise' });
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - 10 * 60_000, headers: alignedAuthHeaders('juriste@seco.admin.ch') })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('unverified');
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
      { subject: "Message d'absence : Autorisation de reprise" }, // apostrophe ASCII (item 4)
      { subject: 'Absent du bureau : Autorisation de reprise' },
      { subject: 'Absente du bureau : Autorisation de reprise' },
      { subject: 'Risposta automatica: Autorisation de reprise' },
    ];
    for (const [i, c] of cases.entries()) {
      const tag = String(i).padStart(2, '0');
      const id = insertLetter({ sent_at: now - HOUR, subject: `Autorisation de reprise cas-${tag}` });
      const subject = c.subject.replace('Autorisation de reprise', `Autorisation de reprise cas-${tag}`);
      imap.messages = [msg({ uid: 100 + i, address: 'juriste@seco.admin.ch', subject, receivedAt: now - 10 * 60_000, headers: c.headers })];
      await run(telegramOk(), now);
      expect(getLetter(id).reply_kind, `cas #${i} (${subject})`).toBe('auto');
    }
  });

  it('« absence » seule n’est plus un motif automatique : « AW: Demande de données – absence de base légale » reste non-auto (unverified)', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Demande de données' });
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'AW: Demande de données – absence de base légale', receivedAt: now - 10 * 60_000 })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('unverified'); // jamais `auto`
  });

  it('un motif automatique DANS L’OBJET DE LA LETTRE elle-même ne fait jamais classer sa réponse en auto', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Réponse automatique aux demandes de données' });
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Réponse automatique aux demandes de données', receivedAt: now - 10 * 60_000 })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('unverified'); // jamais `auto`
  });

  it('`Precedence: list` n’est jamais traité comme automatique (seuls auto_reply/bulk/junk comptent)', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Autorisation de reprise' });
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - 10 * 60_000, headers: { Precedence: 'list' } })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('unverified'); // non auto
  });

  it('seul le PREMIER `Auto-Submitted` compte (le serveur receveur ajoute le sien en tête ; une contrefaçon plus bas est ignorée)', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - HOUR, subject: 'Autorisation de reprise' });
    imap.messages = [msg({
      uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - 10 * 60_000,
      rawHeaderOverride: 'Auto-Submitted: no\r\nAuto-Submitted: auto-replied\r\n',
    })];
    await run(telegramOk(), now);
    // Si la contrefaçon (2e ligne) l'emportait, ce serait classé `auto` ; le premier (« no ») doit l'emporter.
    expect(getLetter(id).reply_kind).toBe('unverified');
  });

  it('refuse un domaine qui imite (domaine frère sous le même parent, jamais un sous-domaine)', async () => {
    process.env.OSD_MAIL_WATCH_DOMAINS = 'admin.ch';
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise', to_address: 'sanctions@seco.admin.ch' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [msg({ uid: 1, address: 'quelqu-un@xyz.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
    const fetcher = telegramOk();
    const result = await run(fetcher, now);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(sentTexts(fetcher)[0].text.split('\n')[0]).toBe('📬 OpenSwissData : réponse reçue de admin.ch');
    expect(getLetter(id).reply_kind).toBeNull();
    expect(result.alerted).toBe(1);
  });

  it('rattache dans le sens inverse : lettre envoyée à un sous-domaine, réponse du domaine parent déjà surveillé par défaut', async () => {
    process.env.OSD_MAIL_WATCH_DOMAINS = 'seco.admin.ch';
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise', to_address: 'x@guichet.seco.admin.ch' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('unverified');
    expect(getLetter(id).reply_from).toBe('seco.admin.ch');
  });

  it('une lettre récente (<120 jours) élargit la veille à son domaine ; une lettre ancienne (>120 jours) ne l’élargit pas', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    insertLetter({ sent_at: now - 200 * DAY, subject: 'Vieille demande', to_address: 'x@vieux-domaine.admin.ch' });
    imap.messages = [msg({ uid: 1, address: 'x@vieux-domaine.admin.ch', subject: 'Re: Vieille demande', receivedAt: now - HOUR })];
    const fetcher = telegramOk();
    const result = await run(fetcher, now);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.matched).toBe(0);
  });

  it('une lettre `failed` avec un essai réel (attempted_at, sent_at NULL) élargit aussi la veille et se rattache, avec la bonne date', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const attemptedAt = now - 3 * DAY;
    const id = insertLetter({ status: 'failed', sent_at: null, attempted_at: attemptedAt, subject: 'Conditions d’accès', to_address: 'x@seco.admin.ch' });
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Conditions d’accès', receivedAt: now - HOUR })];
    const fetcher = telegramOk();
    const result = await run(fetcher, now);
    expect(result.matched).toBe(1);
    expect(getLetter(id).reply_kind).toBe('unverified');
    expect(sentTexts(fetcher)[0].text).toMatch(/^Réponse à la lettre du 07\.10\.2026 /);
  });

  it('une réponse « Re: Relance : X » (réponse à la relance) se rattache à la lettre D’ORIGINE, jamais à la relance', async () => {
    const now = Date.UTC(2026, 9, 26, 12, 0);
    const parentId = insertLetter({ sent_at: Date.UTC(2026, 9, 5, 12, 0), subject: 'Autorisation de reprise' });
    insertLetter({ kind: 'reminder', parent_id: parentId, status: 'sent', sent_at: now - HOUR, subject: 'Relance : Autorisation de reprise', to_address: 'sanctions@seco.admin.ch' });
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Relance : Autorisation de reprise', receivedAt: now - 30 * 60_000 })];
    await run(telegramOk(), now);
    const parent = getLetter(parentId);
    expect(parent.reply_kind).toBe('unverified');
    expect(parent.reply_subject).toBe('Re: Relance : Autorisation de reprise');
  });

  it('une lecture d’en-têtes impossible laisse le message en attente (jamais classé par défaut), retenté au passage suivant', async () => {
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
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
    expect(getLetter(id).reply_kind).toBe('unverified');
  });

  it('après TROIS échecs de lecture d’en-têtes, jamais d’abandon pur : rattachement par l’enveloppe seule en `unverified` (correction finale 2, item 1)', async () => {
    const SENT_AT = Date.UTC(2026, 8, 1, 8, 1);
    const id = insertLetter({ sent_at: SENT_AT, subject: 'Demande de statistiques communales', to_address: 'boite@ge.admin.ch' });
    const now = Date.UTC(2026, 9, 6, 8, 1);
    imap.messages = [msg({ uid: 1, address: 'chef@ge.admin.ch', subject: 'RE: Demande de statistiques communales', receivedAt: now - HOUR })];
    imap.failHeadersForUid = 1;

    const r1 = telegramOk();
    await run(r1, now + 10_000);
    expect(r1).not.toHaveBeenCalled();
    expect(getLetter(id).reply_kind).toBeNull();
    expect(Object.values(witness().headerFailures as Record<string, number>)).toEqual([1]);

    const r2 = telegramOk();
    await run(r2, now + 10_000 + 600_000);
    expect(r2).not.toHaveBeenCalled();
    expect(getLetter(id).reply_kind).toBeNull();

    const r3 = telegramOk();
    const result = await run(r3, now + 10_000 + 2 * 600_000);
    expect(r3).toHaveBeenCalledOnce(); // 3e échec : rattaché quand même, PAS d'alerte de secours habituelle.
    expect(sentTexts(r3)[0].text).toBe('Réponse à la lettre du 01.09.2026 (Demande de statistiques communales) : NON AUTHENTIFIÉE, vérifier l’expéditeur de ge.admin.ch');
    expect(result.alerted).toBe(1);
    expect(getLetter(id).reply_kind).toBe('unverified'); // rattaché, jamais `null`.
    expect(witness().headerFailures).toEqual({});

    // La relance ne doit alors JAMAIS être créée (unverified arrête la relance comme human) : plus de
    // 15 jours ouvrés séparent SENT_AT de `now`, elle le serait sans cette correction.
    await runLettersSender({
      now: () => now + 10_000 + 2 * 600_000 + 60_000, rng: () => 0, hasApiKey: () => true,
      fetch: (async () => Response.json({ ok: true })) as unknown as typeof fetch, send: async () => ({ sent: true, providerId: 'r' }),
    });
    expect(getDb().prepare("SELECT 1 FROM institutional_letters WHERE parent_id=?").get(id)).toBeUndefined();
  });

  it('après trois échecs, si l’enveloppe (objet) ne correspond à RIEN, alerte de secours habituelle sans rattachement', async () => {
    insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise', to_address: 'x@seco.admin.ch' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Bulletin trimestriel sans rapport', receivedAt: now - HOUR })];
    imap.failHeadersForUid = 1;
    await run(telegramOk(), now);
    await run(telegramOk(), now + 600_000);
    const r3 = telegramOk();
    await run(r3, now + 2 * 600_000);
    expect(r3).toHaveBeenCalledOnce();
    expect(sentTexts(r3)[0].text.split('\n')[0]).toBe('📬 OpenSwissData : réponse reçue de seco.admin.ch');
    expect(sentTexts(r3)[0].text).not.toContain('Réponse à la lettre');
  });

  it('n’interroge les en-têtes que pour un domaine qui a une lettre en attente ; un organisme officiel sans lettre n’en a pas besoin', async () => {
    insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise', to_address: 'sanctions@seco.admin.ch' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [
      msg({ uid: 1, address: 'juridique@finma.ch', subject: 'Sans rapport', receivedAt: now - 2 * HOUR }),
      msg({ uid: 2, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR }),
    ];
    await run(telegramOk(), now);
    const headerCalls = imap.calls.filter(c => c.name === 'fetchOne' && (c.args[1] as { headers?: unknown }).headers);
    const sourceCalls = imap.calls.filter(c => c.name === 'fetchOne' && (c.args[1] as { source?: unknown }).source);
    expect(headerCalls.map(c => c.args[0])).toEqual(['2']);
    expect(sourceCalls.map(c => c.args[0])).toEqual(['1']);
  });

  it('un message non rattaché d’un domaine ajouté par une lettre est libellé « autorité », jamais « client »', async () => {
    insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise', to_address: 'sanctions@seco.admin.ch' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [msg({ uid: 1, address: 'standard@seco.admin.ch', subject: 'Bulletin trimestriel', receivedAt: now - HOUR })];
    const fetcher = telegramOk();
    await run(fetcher, now);
    const text = sentTexts(fetcher)[0].text;
    expect(text.split('\n')[1]).toBe('Message d’une autorité (seco.admin.ch).');
    expect(text).not.toContain('client');
  });

  it('un message déjà rattaché (et marqué signalé) n’est jamais rejoué au passage suivant', async () => {
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
    await run(telegramOk(), now);
    expect(getLetter(id).reply_kind).toBe('unverified');
    expect(witness().total_attached).toBe(1);
    const second = telegramOk();
    await run(second, now + HOUR);
    expect(second).not.toHaveBeenCalled();
    expect(witness().total_attached).toBe(1);
  });

  it('le texte Telegram d’une réponse rattachée ne contient jamais d’adresse, et sans adresse en base', async () => {
    const id = insertLetter({ sent_at: Date.UTC(2026, 9, 1, 12, 0), subject: 'Autorisation de reprise' });
    const now = Date.UTC(2026, 9, 10, 12, 0);
    imap.messages = [msg({ uid: 1, address: 'juriste.nominatif@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: now - HOUR })];
    const fetcher = telegramOk();
    await run(fetcher, now);
    const text = sentTexts(fetcher)[0].text;
    expect(text).not.toContain('juriste.nominatif');
    expect(text).not.toContain('@');
    const letter = getLetter(id);
    expect(String(letter.reply_from)).not.toContain('@');
    expect(JSON.stringify(letter)).not.toContain('juriste.nominatif');
  });

  it('une réponse `unverified` → la relance en file est annulée au passage suivant de l’expéditeur (intégration avec runLettersSender)', async () => {
    const SENT_AT = Date.UTC(2026, 9, 5, 12, 0);
    const DUE_NOW = Date.UTC(2026, 9, 26, 12, 0);
    const parentId = insertLetter({ sent_at: SENT_AT, subject: 'Autorisation de reprise' });

    getDb().prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('mail_watch',?,?)")
      .run(DUE_NOW, JSON.stringify({ version: 1, checked_at: DUE_NOW, status: 'ok', code: null, http_status: null, last_success_at: DUE_NOW, last_alert_at: null, matched: 0, alerted: 0, pending: 0, total_alerted: 0, domains: 0, total_attached: 0, seen: [], headerFailures: {} }));

    await runLettersSender({ now: () => DUE_NOW, rng: () => 0, send: vi.fn(), fetch: (async () => Response.json({ ok: true })) as unknown as typeof fetch, hasApiKey: () => true });
    const reminder = getDb().prepare("SELECT id, scheduled_at FROM institutional_letters WHERE parent_id=? AND kind='reminder'").get(parentId) as { id: string; scheduled_at: number };
    expect(reminder).toBeDefined();
    expect(getLetter(reminder.id).status).toBe('queued');

    const mailNow = DUE_NOW + HOUR;
    imap.messages = [msg({ uid: 1, address: 'juriste@seco.admin.ch', subject: 'Re: Autorisation de reprise', receivedAt: mailNow - HOUR })];
    await run(telegramOk(), mailNow);
    expect(getLetter(parentId).reply_kind).toBe('unverified');
    expect(getLetter(reminder.id).status).toBe('queued');

    const send = vi.fn();
    await runLettersSender({ now: () => reminder.scheduled_at + 30_000, rng: () => 0, send, fetch: (async () => Response.json({ ok: true })) as unknown as typeof fetch, hasApiKey: () => true });
    expect(send).not.toHaveBeenCalled();
    expect(getLetter(reminder.id).status).toBe('cancelled');
  });
});
