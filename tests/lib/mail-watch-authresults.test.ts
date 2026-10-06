// Durcissement du 06.10.2026 : analyse d'`Authentication-Results` selon la grammaire RFC 8601
// (analyseur lexical : guillemets avec échappements, commentaires imbriqués ; clauses méthode=résultat
// puis propriétés). La liste de confiance de PRODUCTION reste vide (verrouillée par
// `mail-watch-authserv.test.ts`) : ici, une liste est INJECTÉE pour éprouver l'analyse elle-même.
// Les cas « attaque » reprennent tels quels la sonde de la relecture adverse du 06.10.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Message = { folder: string; uid: number; envelope: Record<string, unknown>; internalDate: Date; source: string; headers?: Record<string, string> };
const imap = vi.hoisted(() => ({
  messages: [] as Message[],
  forbidden: [] as string[],
  folders: [{ path: 'INBOX' }] as Array<{ path: string; specialUse?: string }>,
}));
// Boîte IMAP simulée (aucune connexion réelle, commandes d'écriture interdites), comme
// `mail-watch-letters.test.ts`.
vi.mock('imapflow', () => {
  const forbid = (name: string) => async () => { imap.forbidden.push(name); throw new Error(`commande interdite : ${name}`); };
  class ImapFlow {
    current = '';
    on() {}
    async connect() {}
    close() {}
    async list() { return imap.folders; }
    async mailboxOpen(path: string) { this.current = path; return { path, uidValidity: 7n }; }
    async search() { return imap.messages.filter(m => m.folder === this.current).map(m => m.uid); }
    async *fetch(range: number[]) {
      for (const m of imap.messages.filter(x => x.folder === this.current && range.includes(x.uid))) yield { uid: m.uid, envelope: m.envelope, internalDate: m.internalDate };
    }
    async fetchOne(uid: string, query: { source?: { maxLength: number }; headers?: string[] }) {
      const m = imap.messages.find(x => x.folder === this.current && String(x.uid) === uid);
      if (!m) return false;
      if (query.headers) {
        const wanted = new Set(query.headers.map(h => h.toLowerCase()));
        const lines = Object.entries(m.headers ?? {}).filter(([k]) => wanted.has(k.toLowerCase())).map(([k, v]) => `${k}: ${v}`);
        return { uid: m.uid, headers: Buffer.from(lines.length ? `${lines.join('\r\n')}\r\n` : '') };
      }
      return { uid: m.uid, source: Buffer.from(m.source) };
    }
    messageFlagsAdd = forbid('messageFlagsAdd'); messageFlagsSet = forbid('messageFlagsSet'); messageFlagsRemove = forbid('messageFlagsRemove');
    messageDelete = forbid('messageDelete'); messageMove = forbid('messageMove'); messageCopy = forbid('messageCopy'); append = forbid('append');
  }
  return { ImapFlow };
});

import { getDb, closeDb } from '../../src/lib/db.js';
import { seal, clearCrmCache } from '../../src/lib/crm-source.js';
import {
  classifyReplyKind, extractAuthservId, hasAlignedAuthentication, readAuthenticationResults, runMailWatch,
  splitAuthClauses, TRUSTED_AUTHSERV_IDS, type ReplyHeaders,
} from '../../src/lib/mail-watch.js';

/** Liste de confiance injectée pour les tests (jamais la constante de production). */
const TRUSTED: ReadonlySet<string> = new Set(['mx.infomaniak.ch']);
const SENDER = 'seco.admin.ch';
const verdict = (raw: string, host = SENDER) => (hasAlignedAuthentication(raw, host, TRUSTED) ? 'human' : 'unverified');

/** En-tête légitime réaliste : version, commentaires (dont un « ; » dans un commentaire), plusieurs
 * méthodes, `header.b` en base64 avec « = » et « / », DKIM signé par le domaine PARENT (`admin.ch`)
 * d'un expéditeur sous-domaine (`seco.admin.ch`), DMARC volontairement absent pour que DKIM seul décide. */
const LEGIT = 'mx.infomaniak.ch 1; dkim=pass (2048-bit key; unprotected) header.d=admin.ch header.i=@admin.ch '
  + 'header.s=selector1 header.b=Ab+/Cd==; spf=pass (mx.infomaniak.ch: domain of juriste@seco.admin.ch designates '
  + '192.0.2.1 as permitted sender) smtp.mailfrom=juriste@seco.admin.ch; arc=none (no signatures found)';

describe('Authentication-Results : les attaques de la sonde du 06.10 restent `unverified` (liste injectée)', () => {
  it.each([
    ['guillemet échappé dans smtp.mailfrom (découpage des clauses)', 'mx.infomaniak.ch; spf=pass smtp.mailfrom="a\\";dkim=pass header.d=seco.admin.ch;x="@e; dkim=none'],
    // Variante bien formée SANS gestion des échappements (sinon le rejet viendrait seulement du guillemet
    // non fermé) : seule la lecture correcte de `\"` la garde dans une seule valeur.
    ['guillemets échappés encadrant une fausse clause', 'mx.infomaniak.ch; spf=pass smtp.mailfrom="a\\"; dkim=pass header.d=seco.admin.ch; x=\\"b"@evil.example'],
    ['header.d caché dans la partie locale entre guillemets de header.i', 'mx.infomaniak.ch; dkim=pass header.i="a header.d=seco.admin.ch"@evil.example header.s=x'],
    ['header.d dans un commentaire de la clause dkim', 'mx.infomaniak.ch; dkim=pass (header.d=seco.admin.ch) header.d=evil.example'],
    ['clause dkim inventée dans un commentaire', 'mx.infomaniak.ch; spf=pass (x; dkim=pass header.d=seco.admin.ch) smtp.mailfrom=evil.example; dkim=none'],
    ['clause dkim inventée entre guillemets', 'mx.infomaniak.ch; spf=pass smtp.mailfrom="x;dkim=pass header.d=seco.admin.ch"@evil.example; dkim=none'],
    ['« ) » échappée dans un commentaire', 'mx.infomaniak.ch; spf=pass (x \\) ; dkim=pass header.d=seco.admin.ch ; ) smtp.mailfrom=evil.example'],
    // Variante bien formée sans gestion des échappements dans les commentaires (`\(` puis `\)`).
    ['« ) » et « ( » échappées dans un commentaire', 'mx.infomaniak.ch; spf=pass (x \\) ; dkim=pass header.d=seco.admin.ch ; \\( ) smtp.mailfrom=evil.example'],
    ['résultat approché (pass-ish)', 'mx.infomaniak.ch; dkim=pass-ish header.d=seco.admin.ch'],
    ['clause placée dans le premier segment (identifiant du serveur)', 'mx.infomaniak.ch dkim=pass header.d=seco.admin.ch; dkim=none'],
    ['deux header.d dans la même clause (ambiguë)', 'mx.infomaniak.ch; dkim=pass header.d=seco.admin.ch header.d=evil.example'],
    ['valeur mêlée guillemets et texte nu', 'mx.infomaniak.ch; dkim=pass header.d="seco.admin.ch"x'],
    ['header.d sans point', 'mx.infomaniak.ch; dkim=pass header.d=ch'],
    // Relecture adverse du 06.10 (soir) : séparateurs hors ASCII et guillemets dans un commentaire.
    ['espace insécable qui découpe header.i', 'mx.infomaniak.ch; dkim=pass header.i=x\u00a0header.d=seco.admin.ch\u00a0y=@evil.example header.s=sel'],
    ['séparateur de ligne U+2028', 'mx.infomaniak.ch; dkim=pass header.i=x\u2028header.d=seco.admin.ch\u2028y=@evil.example'],
    ['U+FEFF', 'mx.infomaniak.ch; dkim=pass header.i=x\ufeffheader.d=seco.admin.ch\ufeffy=@evil.example'],
    ['tabulation verticale', 'mx.infomaniak.ch; dkim=pass header.i=x\u000bheader.d=seco.admin.ch\u000by=@evil.example'],
    ['saut de page', 'mx.infomaniak.ch; dkim=pass header.i=x\u000cheader.d=seco.admin.ch\u000cy=@evil.example'],
    ['guillemets dans un commentaire recopiant l’expéditeur', 'mx.infomaniak.ch; spf=pass (domain of "x) ; dkim=pass header.d=seco.admin.ch ; y=(z"@evil.example designates 1.2.3.4) smtp.mailfrom=evil.example'],
  ])('%s', (_label, raw) => {
    expect(verdict(raw)).toBe('unverified');
  });

  it.each([
    ['guillemet non fermé', 'mx.infomaniak.ch; dkim=pass header.d=seco.admin.ch; spf=pass smtp.mailfrom="x'],
    ['commentaire non fermé', 'mx.infomaniak.ch; dkim=pass header.d=seco.admin.ch (x'],
    ['« ) » orpheline', 'mx.infomaniak.ch; dkim=pass header.d=seco.admin.ch x)'],
    ['« \\ » final dans une chaîne', 'mx.infomaniak.ch; dkim=pass header.d=seco.admin.ch; spf=pass smtp.mailfrom="x\\'],
    ['en-tête démesuré', `mx.infomaniak.ch; dkim=pass header.d=seco.admin.ch; spf=pass (${'x'.repeat(20_000)})`],
  ])('en-tête malformé rejeté en entier (%s)', (_label, raw) => {
    expect(readAuthenticationResults(raw)).toBeNull();
    expect(verdict(raw)).toBe('unverified');
  });
});

describe('Authentication-Results : lecture RFC 8601 des en-têtes légitimes (liste injectée)', () => {
  it('en-tête réaliste (version, commentaires, plusieurs méthodes, header.d parent d’un sous-domaine) → human', () => {
    expect(readAuthenticationResults(LEGIT)).toEqual({ authservId: 'mx.infomaniak.ch', dkimPassDomains: ['admin.ch'], dmarcPassFromDomains: [] });
    expect(verdict(LEGIT)).toBe('human');
  });

  it('dkim=pass d’un domaine tiers PUIS dkim=pass aligné → human (toutes les clauses sont examinées)', () => {
    expect(verdict('mx.infomaniak.ch; dkim=pass header.d=esp.example header.s=a; dkim=pass header.d=seco.admin.ch header.s=b')).toBe('human');
  });

  it('dkim=fail aligné → unverified', () => {
    expect(verdict('mx.infomaniak.ch; dkim=fail (bad signature) header.d=seco.admin.ch')).toBe('unverified');
  });

  it('dmarc=pass header.from=seco.admin.ch → human (commentaire de politique ignoré)', () => {
    expect(verdict('mx.infomaniak.ch; dmarc=pass (p=reject dis=none) header.from=seco.admin.ch')).toBe('human');
  });

  it('header.d ENFANT du domaine de l’expéditeur → unverified', () => {
    expect(verdict('mx.infomaniak.ch; dkim=pass header.d=seco.admin.ch', 'admin.ch')).toBe('unverified');
  });

  it('en-tête d’un autre serveur (identifiant hors liste) → unverified', () => {
    expect(verdict('forge.example; dkim=pass header.d=seco.admin.ch; dmarc=pass header.from=seco.admin.ch')).toBe('unverified');
  });

  it('identifiant en majuscules, valeur entre guillemets, mot-clé en majuscules → human', () => {
    expect(verdict('MX.Infomaniak.CH; DKIM=Pass header.d="seco.admin.ch"')).toBe('human');
  });

  it('« \\\\ » en fin de chaîne entre guillemets ferme bien la chaîne : la clause suivante est lue', () => {
    // Texte réel de l'en-tête : smtp.mailfrom="a\\"@evil.example — la barre est échappée, le guillemet ferme.
    const raw = 'mx.infomaniak.ch; spf=pass smtp.mailfrom="a\\\\"@evil.example; dkim=pass header.d=seco.admin.ch';
    expect(splitAuthClauses(raw)).toEqual(['mx.infomaniak.ch', 'spf=pass smtp.mailfrom="a\\\\"@evil.example', 'dkim=pass header.d=seco.admin.ch']);
    expect(verdict(raw)).toBe('human');
  });

  it('liste de PRODUCTION (vide) : même l’en-tête légitime reste unverified', () => {
    expect(TRUSTED_AUTHSERV_IDS.size).toBe(0);
    expect(hasAlignedAuthentication(LEGIT, SENDER, TRUSTED_AUTHSERV_IDS)).toBe(false);
  });

  it('splitAuthClauses : un guillemet échappé ne coupe plus la valeur', () => {
    expect(splitAuthClauses('mx.example; spf=pass smtp.mailfrom="a\\";b"@evil.example; dkim=none'))
      .toEqual(['mx.example', 'spf=pass smtp.mailfrom="a\\";b"@evil.example', 'dkim=none']);
  });

  it('extractAuthservId : version et commentaire acceptés, toute autre suite refusée', () => {
    expect(extractAuthservId('mx.infomaniak.ch (relais) 1; dkim=none')).toBe('mx.infomaniak.ch');
    expect(extractAuthservId('mx.infomaniak.ch autre; dkim=none')).toBeNull();
    expect(extractAuthservId('"mx.infomaniak.ch"; dkim=none')).toBeNull();
  });
});

describe('classifyReplyKind avec liste injectée', () => {
  const headers = (over: Partial<ReplyHeaders>): ReplyHeaders => ({ references: null, autoSubmitted: null, autoreplyFlag: false, precedence: null, authenticationResults: null, ...over });
  it('human seulement si l’en-tête est aligné ; une réponse automatique reste auto', () => {
    expect(classifyReplyKind('Re: Lettre', 'Lettre', headers({ authenticationResults: LEGIT }), SENDER, TRUSTED)).toBe('human');
    expect(classifyReplyKind('Re: Lettre', 'Lettre', headers({ authenticationResults: LEGIT }), SENDER)).toBe('unverified');
    expect(classifyReplyKind('Re: Lettre', 'Lettre', headers({ authenticationResults: LEGIT, autoSubmitted: 'auto-replied' }), SENDER, TRUSTED)).toBe('auto');
  });
});

describe('Veille complète avec liste injectée (câblage de `trustedAuthservIds`)', () => {
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 9, 10, 12, 0);
  let temp: string;
  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'osd-veille-authres-'));
    process.env.DATABASE_PATH = join(temp, 'fictive.sqlite');
    process.env.OSD_BACKUP_KEY = 'c'.repeat(64);
    process.env.OSD_VEILLE_TELEGRAM_TOKEN = '123456789:jeton-fictif-TELEGRAM-abcdefghij';
    process.env.OSD_VEILLE_TELEGRAM_CHAT = '424242';
    imap.messages = []; imap.forbidden = [];
    clearCrmCache();
    getDb().prepare('INSERT INTO crm_connections(name,secret_encrypted,updated_at) VALUES(?,?,?)').run('support', seal(JSON.stringify({ user: 'contact@openswissdata.com', pass: 'fictif' })), 0);
  });
  afterEach(() => {
    closeDb(); rmSync(temp, { recursive: true, force: true });
    for (const name of ['DATABASE_PATH', 'OSD_BACKUP_KEY', 'OSD_VEILLE_TELEGRAM_TOKEN', 'OSD_VEILLE_TELEGRAM_CHAT']) delete process.env[name];
  });
  const insertLetter = (): string => {
    const id = `id-${Math.random().toString(36).slice(2)}`;
    getDb().prepare(
      `INSERT INTO institutional_letters (id, kind, parent_id, to_address, cc, subject, body, purpose, status, scheduled_at, attempts, sent_at, created_at)
       VALUES (?, 'letter', NULL, 'sanctions@seco.admin.ch', NULL, 'Autorisation de reprise', 'Texte.', 'Clarification', 'sent', 0, 0, ?, 0)`,
    ).run(id, now - 2 * DAY);
    return id;
  };
  const replyKind = (id: string) => (getDb().prepare('SELECT reply_kind FROM institutional_letters WHERE id=?').get(id) as { reply_kind: string | null }).reply_kind;
  const reply = (authenticationResults: string): Message => ({
    folder: 'INBOX', uid: 1, internalDate: new Date(now - HOUR), source: 'From: x\r\nSubject: y\r\n\r\nCorps.',
    envelope: { messageId: '<m-1@x.test>', from: [{ name: 'Service', address: 'juriste@seco.admin.ch' }], subject: 'Re: Autorisation de reprise', date: new Date(now - HOUR) },
    headers: { 'Authentication-Results': authenticationResults },
  });
  const telegram = () => vi.fn(async () => Response.json({ ok: true, result: { message_id: 1 } }));

  it('en-tête légitime + liste injectée → human ; sans injection → unverified (production)', async () => {
    const id = insertLetter();
    imap.messages = [reply(LEGIT)];
    await runMailWatch({ fetch: telegram(), now: () => now, trustedAuthservIds: TRUSTED });
    expect(replyKind(id)).toBe('human');
    expect(imap.forbidden).toEqual([]);
  });

  it('sans injection, le même en-tête reste unverified', async () => {
    const id = insertLetter();
    imap.messages = [reply(LEGIT)];
    await runMailWatch({ fetch: telegram(), now: () => now });
    expect(replyKind(id)).toBe('unverified');
  });

  it('attaque header.i + liste injectée → unverified', async () => {
    const id = insertLetter();
    imap.messages = [reply('mx.infomaniak.ch; dkim=pass header.i="a header.d=seco.admin.ch"@evil.example header.s=x')];
    await runMailWatch({ fetch: telegram(), now: () => now, trustedAuthservIds: TRUSTED });
    expect(replyKind(id)).toBe('unverified');
  });
});
