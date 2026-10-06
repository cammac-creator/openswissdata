// Veille des réponses attendues dans la boîte de support contact@ (FINMA, OFS, ONU et domaines configurés).
// Lecture seule : dossiers ouverts en EXAMINE (readOnly), enveloppes et corps lus en BODY.PEEK ; aucun drapeau,
// déplacement ni effacement. Alerte Telegram en texte brut. Aucun contenu n'est conservé pour les messages
// simplement alertés : le témoin `operation_checks/mail_watch` garde des compteurs, des dates, un code fermé et
// des empreintes des messages signalés. Exception : une réponse rattachée à une lettre institutionnelle (tâche 3
// du plan du 06.10.2026) écrit sur `institutional_letters` sa date, le DOMAINE de l'expéditeur (jamais l'adresse),
// son objet tronqué à 200 caractères et son type (humaine/automatique) — ces quatre champs, jamais un extrait.
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getDb } from './db.js';
import { currentMessage } from './crm-language.js';
import { connection, imap } from '../routes/crm-mail.js';
import type { MailWatchCode, MailWatchStatus } from './mail-watch-types.js';
import { toZurichParts, type LetterKind, type ReplyKind } from './letters.js';

const CHECK = 'mail_watch';
const START_DELAY = 60_000;
const INTERVAL = 10 * 60_000;
const WINDOW = 3 * 86_400_000;
const MAX_ALERTS = 5;
const MAX_SEEN = 300;
const MAX_FETCH = 100;
const EXTRACT_LENGTH = 400;
const SOURCE_LIMIT = 256_000;
const TELEGRAM_TIMEOUT = 10_000;
const TELEGRAM_LIMIT = 4000;
const OWN_DOMAIN = 'openswissdata.com';
// Organismes officiels : seuls leurs messages portent un extrait. Un autre domaine surveillé (un client, ajouté par
// OSD_MAIL_WATCH_DOMAINS dans la configuration du serveur, jamais dans ce dépôt public) n'envoie qu'expéditeur et objet.
const INSTITUTIONS: Readonly<Record<string, string>> = { 'finma.ch': 'FINMA', 'bfs.admin.ch': 'OFS', 'un.org': 'ONU' };
export const DEFAULT_WATCH_DOMAINS: readonly string[] = Object.keys(INSTITUTIONS);
const CODES: ReadonlySet<string> = new Set<MailWatchCode>(['not_configured', 'telegram_config_invalid', 'mailbox_not_connected', 'mailbox_unreadable', 'imap_failed', 'telegram_http', 'telegram_timeout', 'telegram_network', 'telegram_not_ok']);
// Rattachement aux lettres (tâche 3) : une lettre `sent` envoyée il y a moins de 120 jours, sans réponse
// humaine rattachée, élargit la veille à son domaine (en plus de la liste ci-dessus, inchangée).
const PENDING_LETTER_WINDOW_MS = 120 * 86_400_000;
// En-têtes supplémentaires lus par BODY.PEEK[HEADER.FIELDS (...)], seulement quand un domaine surveillé a une
// lettre en attente de réponse : `In-Reply-To` est déjà dans l'enveloppe (`envelope.inReplyTo`), gratuite.
const REPLY_HEADER_FIELDS = ['references', 'auto-submitted', 'x-autoreply', 'x-autorespond'];
// Préfixe de réponse ou de transfert, français/allemand/anglais, avec ou sans espace avant le « : ».
const REPLY_PREFIX_RE = /^\s*(?:re|aw|antw|tr|wg|fwd)\s*:\s*/i;
const AUTO_SUBJECT_MARKERS: readonly string[] = [
  'accusé de réception', 'eingangsbestätigung', 'automatic reply', 'réponse automatique',
  'automatische antwort', 'abwesenheit', 'out of office', 'absence',
].map(m => m.normalize('NFC').toLowerCase());

type State = MailWatchStatus & { version: 1; seen: string[]; total_attached: number };
// Exportés pour `letters-sender.ts` (tâche 2), qui réutilise `telegramConfig`/`sendTelegram` tels quels.
export type TelegramConfig = { token: string; chat: string };
export type Sent = { ok: true } | { ok: false; code: MailWatchCode; http_status?: number };
/** En-têtes supplémentaires du message, lus seulement pour un domaine qui a une lettre en attente. */
type ReplyHeaders = { references: string | null; autoSubmitted: string | null; autoreplyFlag: boolean };
/** Lettre `sent` sans réponse humaine, candidate à un rattachement (tâche 3). */
type LetterMatchTarget = { id: string; kind: LetterKind; parentId: string | null; domains: string[]; subject: string; resendId: string | null; sentAt: number };
/** Rattachement trouvé pour un message : la lettre D'ORIGINE (jamais une relance) à mettre à jour. */
type LetterMatch = { targetId: string; subject: string; sentAt: number; replyKind: ReplyKind };
export type MailWatchCandidate = {
  key: string; folder: string; uid: number; validity: string; domain: string; fromName: string; fromAddress: string;
  subject: string; receivedAt: number; extract: string | null;
  /** `envelope.inReplyTo`, gratuite (fait partie de l'ENVELOPE IMAP standard). */
  inReplyTo: string | null;
  /** `null` si jamais demandés (aucune lettre en attente sur ce domaine) ou si la lecture a échoué. */
  headers: ReplyHeaders | null;
  /** Lecture des en-têtes requise mais pas encore obtenue de façon fiable : le message reste `pending`,
   * jamais classé « humaine » par défaut, retenté au passage suivant (jamais marqué `seen`). */
  headersPending: boolean;
  letterMatch: LetterMatch | null;
};
type Dependencies = {
  database: () => Database.Database;
  now: () => number;
  connection: () => { user: string; pass: string } | null;
  withImap: typeof imap;
  fetch: typeof fetch;
};
const defaults: Dependencies = {
  database: getDb,
  // Lue à chaque appel, pas au chargement : une horloge simulée (tests) doit être vue.
  now: () => Date.now(),
  connection: () => connection('support'),
  withImap: imap,
  fetch: (input, init) => fetch(input, init),
};

/** Domaines surveillés : `OSD_MAIL_WATCH_DOMAINS` (liste séparée par des virgules) remplace la liste par défaut. */
export function watchedDomains(value = process.env.OSD_MAIL_WATCH_DOMAINS): string[] {
  const valid = (value ?? '').split(',').map(d => d.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, ''))
    .filter(d => d.length <= 253 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(d));
  const unique = [...new Set(valid)].slice(0, 20);
  return unique.length ? unique : [...DEFAULT_WATCH_DOMAINS];
}
const domainOf = (address: string): string => address.slice(address.lastIndexOf('@') + 1).trim().toLowerCase().replace(/\.$/, '');
/** Domaine exact ou sous-domaine ; la recherche FROM d'IMAP n'est qu'une sous-chaîne (`un.org` trouve aussi `fun.org`). */
export function watchedDomainFor(address: string, domains: readonly string[]): string | null {
  if (address.lastIndexOf('@') < 1) return null;
  const host = domainOf(address);
  return domains.filter(d => host === d || host.endsWith(`.${d}`)).sort((a, b) => b.length - a.length)[0] ?? null;
}
const organisation = (domain: string) => INSTITUTIONS[domain] ?? domain;
const compact = (text: string) => text.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim();
// Coupe par point de code : une moitié de paire de substitution rendrait le texte invalide pour Telegram.
const clip = (text: string, max: number) => { const chars = Array.from(text); return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text; };
const swissTime = (time: number) => new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time);
const fingerprint = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 32);

/** Début du texte brut (partie text/plain, sinon HTML réduit en texte), sans la citation de notre lettre. */
export async function extractText(source: Buffer): Promise<string | null> {
  const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: 500_000 });
  const text = compact(currentMessage(parsed.text ?? ''));
  return text ? clip(text, EXTRACT_LENGTH) : null;
}

export function alertText(message: Pick<MailWatchCandidate, 'domain' | 'fromName' | 'fromAddress' | 'subject' | 'receivedAt' | 'extract'>): string {
  const name = organisation(message.domain);
  const address = clip(compact(message.fromAddress), 254);
  const display = clip(compact(message.fromName), 120);
  // Organisme officiel : expéditeur, objet et extrait. Autre domaine (un client) : ni nom, ni adresse, ni objet,
  // ni extrait ; seulement le domaine et l'heure, pour qu'aucune donnée personnelle d'un client ne parte vers Telegram.
  const official = Boolean(INSTITUTIONS[message.domain]);
  const lines = [
    `📬 OpenSwissData : réponse reçue de ${name}`,
    ...(official ? [
      `De : ${display && display.toLowerCase() !== address.toLowerCase() ? `${display} <${address}>` : address}`,
      `Objet : ${clip(compact(message.subject), 300) || '(sans objet)'}`,
    ] : ['Message d’un client : lire dans contact@.']),
    `Reçu : ${swissTime(message.receivedAt)}`,
    ...(message.extract && official ? [message.extract] : []),
    `Dis « réponse ${name} » à Claude pour la suite.`,
  ];
  return clip(lines.join('\n'), TELEGRAM_LIMIT);
}

/** Exportée pour `letters-sender.ts` (tâche 2) : même configuration Telegram, jamais dupliquée. */
export function telegramConfig(): TelegramConfig | 'missing' | 'invalid' {
  const token = process.env.OSD_VEILLE_TELEGRAM_TOKEN?.trim() ?? '';
  const chat = process.env.OSD_VEILLE_TELEGRAM_CHAT?.trim() ?? '';
  if (!token || !chat) return 'missing';
  // Le jeton entre dans le chemin de l'adresse : un format inattendu n'est jamais envoyé.
  if (!/^\d{1,20}:[A-Za-z0-9_-]{20,100}$/.test(token) || !/^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,64})$/.test(chat)) return 'invalid';
  return { token, chat };
}

/** Exportée pour `letters-sender.ts` (tâche 2) : même fonction d'envoi Telegram, jamais dupliquée. */
export async function sendTelegram(config: TelegramConfig, text: string, fetcher: typeof fetch): Promise<Sent> {
  let response: Response;
  try {
    response = await fetcher(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chat, text, link_preview_options: { is_disabled: true } }),
      redirect: 'error',
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT),
    });
  } catch (error) {
    // Le message d'une erreur réseau peut citer l'adresse, donc le jeton : seul un code fermé est gardé.
    return { ok: false, code: error instanceof Error && error.name === 'TimeoutError' ? 'telegram_timeout' : 'telegram_network' };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, code: 'telegram_http', http_status: response.status };
  }
  const body: unknown = await response.json().catch(() => null);
  return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true ? { ok: true } : { ok: false, code: 'telegram_not_ok' };
}

/** Domaine exact (`a===b`) ou sous-domaine dans l'un ou l'autre sens (jamais une sous-chaîne, jamais
 * un domaine frère : `xyz.admin.ch` et `seco.admin.ch` ne se rattachent jamais l'un à l'autre). */
function domainsRelated(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}
// NFC : un client de messagerie peut envoyer un accent décomposé (NFD), qui ne contiendrait jamais
// la forme composée des motifs ci-dessous sans cette normalisation.
const normalizeText = (s: string) => compact(s.normalize('NFC')).toLowerCase();
function stripReplyPrefixes(subject: string): string {
  let s = subject;
  for (;;) {
    const next = s.replace(REPLY_PREFIX_RE, '');
    if (next === s) return s;
    s = next;
  }
}
/** Objet de la lettre (débarrassé de ses préfixes de réponse éventuels) contenu dans l'objet reçu,
 * comparaison NFC insensible à la casse et aux espaces multiples. Un objet de lettre vide après
 * dépouillement ne correspond jamais (il serait sinon « contenu » dans n'importe quel message). */
function subjectMatches(letterSubject: string, receivedSubject: string): boolean {
  const stripped = normalizeText(stripReplyPrefixes(letterSubject));
  return stripped.length > 0 && normalizeText(receivedSubject).includes(stripped);
}
/** En-têtes demandés par `REPLY_HEADER_FIELDS` : repli des lignes pliées (RFC 5322) avant lecture. */
function parseHeaderBlock(buf: Buffer): ReplyHeaders {
  const unfolded = buf.toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
  const map = new Map<string, string>();
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    if (!map.has(name)) map.set(name, line.slice(idx + 1).trim());
  }
  return {
    references: map.get('references') ?? null,
    autoSubmitted: map.get('auto-submitted') ?? null,
    autoreplyFlag: map.has('x-autoreply') || map.has('x-autorespond'),
  };
}
/** `auto` si l'en-tête l'indique explicitement ou si l'objet porte un motif d'accusé/absence connu ; sinon `human`. */
function classifyReplyKind(subject: string, headers: ReplyHeaders): ReplyKind {
  const submitted = headers.autoSubmitted?.trim().toLowerCase();
  if (submitted && submitted !== 'no') return 'auto';
  if (headers.autoreplyFlag) return 'auto';
  const normalized = normalizeText(subject);
  return AUTO_SUBJECT_MARKERS.some(marker => normalized.includes(marker)) ? 'auto' : 'human';
}
/** Lettres `sent` encore sans réponse humaine (une réponse automatique n'arrête jamais le rattachement
 * d'une réponse humaine ultérieure). Sert à la fois à élargir la veille et à trouver le bon rattachement. */
function pendingLetters(db: Database.Database): LetterMatchTarget[] {
  const rows = db.prepare(
    `SELECT id, kind, parent_id, to_address, cc, subject, resend_id, sent_at FROM institutional_letters
     WHERE status='sent' AND sent_at IS NOT NULL AND (reply_kind IS NULL OR reply_kind='auto')`,
  ).all() as Array<{ id: string; kind: string; parent_id: string | null; to_address: string; cc: string | null; subject: string; resend_id: string | null; sent_at: number }>;
  return rows.map(r => ({
    id: r.id, kind: r.kind as LetterKind, parentId: r.parent_id,
    domains: [...new Set([domainOf(r.to_address), ...(r.cc ? [domainOf(r.cc)] : [])])],
    subject: r.subject, resendId: r.resend_id, sentAt: r.sent_at,
  }));
}
/** Domaines des lettres en attente envoyées il y a moins de 120 jours (en plus des domaines par défaut,
 * inchangés) : même règle de rattachement « domaine exact ou sous-domaine » que la veille elle-même. */
function pendingLetterDomains(targets: readonly LetterMatchTarget[], now: number): string[] {
  const cutoff = now - PENDING_LETTER_WINDOW_MS;
  return [...new Set(targets.filter(t => t.sentAt >= cutoff).flatMap(t => t.domains))];
}
/** Lettre (ou relance) dont le domaine ET (l'objet ou l'identifiant Resend dans l'en-tête) correspondent ;
 * la plus récemment envoyée si plusieurs conviennent. */
function findLetterMatch(senderHost: string, subject: string, inReplyTo: string | null, references: string | null, targets: readonly LetterMatchTarget[]): LetterMatchTarget | null {
  const sameDomain = targets.filter(t => t.domains.some(d => domainsRelated(senderHost, d)));
  if (!sameDomain.length) return null;
  const headerBlob = `${inReplyTo ?? ''} ${references ?? ''}`.toLowerCase();
  const matched = sameDomain.filter(t => subjectMatches(t.subject, subject) || (!!t.resendId && headerBlob.includes(t.resendId.toLowerCase())));
  return matched.length ? matched.reduce((best, cur) => (cur.sentAt > best.sentAt ? cur : best)) : null;
}
/** Une relance pointe toujours vers la lettre D'ORIGINE : c'est elle que `letters-sender.ts` consulte
 * (`reply_kind`) pour arrêter une relance ou en annuler une déjà en file. */
function resolveLetterTarget(matched: LetterMatchTarget, targets: readonly LetterMatchTarget[]): LetterMatchTarget {
  if (matched.kind === 'reminder' && matched.parentId) {
    const parent = targets.find(t => t.id === matched.parentId);
    if (parent) return parent;
  }
  return matched;
}
const pad2 = (n: number) => String(n).padStart(2, '0');
/** Date Zurich au format JJ.MM.AAAA, pour le texte Telegram de rattachement. */
function zurichDayMonthYear(ms: number): string {
  const p = toZurichParts(ms);
  return `${pad2(p.day)}.${pad2(p.month)}.${p.year}`;
}
/** Texte Telegram « à la place » de l'alerte habituelle pour un message rattaché (jamais les deux). */
function letterReplyText(match: LetterMatch, senderDomain: string): string {
  const subject = clip(compact(match.subject), 300) || '(sans objet)';
  const label = match.replyKind === 'human' ? 'humaine' : 'accusé automatique';
  return clip(`Réponse à la lettre du ${zurichDayMonthYear(match.sentAt)} (${subject}) : ${label} de ${senderDomain}`, TELEGRAM_LIMIT);
}
/** Écrit le rattachement sur la lettre D'ORIGINE, jamais l'adresse ni un extrait. Une réponse `auto`
 * n'écrase jamais une réponse `human` déjà enregistrée ; une `human` remplace une `auto`. Renvoie `true`
 * seulement si l'écriture a eu lieu (sert au compteur interne, jamais exposé au bureau). */
function attachReply(db: Database.Database, targetId: string, at: number, fromDomain: string, subject: string, kind: ReplyKind): boolean {
  const result = db.prepare(
    `UPDATE institutional_letters SET reply_at=?, reply_from=?, reply_subject=?, reply_kind=?
     WHERE id=? AND (reply_kind IS NULL OR (reply_kind='auto' AND ?='human'))`,
  ).run(at, fromDomain, clip(compact(subject), 200), kind, targetId, kind);
  return result.changes === 1;
}

async function collect(client: ImapFlow, baseDomains: readonly string[], extraDomains: readonly string[], now: number, seen: ReadonlySet<string>, letterTargets: readonly LetterMatchTarget[]) {
  const since = now - WINDOW;
  const searchDomains = [...new Set([...baseDomains, ...extraDomains])];
  // Boîte de réception et indésirables : une réponse attendue peut être classée en spam par erreur.
  const folders = (await client.list()).filter(f => f.path === 'INBOX' || f.specialUse === '\\Junk').slice(0, 2);
  const keys = new Set<string>();
  const fresh: MailWatchCandidate[] = [];
  for (const folder of folders) {
    const mailbox = await client.mailboxOpen(folder.path, { readOnly: true });
    const validity = mailbox.uidValidity.toString();
    const uids = await client.search({ since: new Date(since), or: searchDomains.map(from => ({ from })) }, { uid: true });
    if (!Array.isArray(uids) || !uids.length) continue;
    // Enveloppe seulement ; aucune autre commande IMAP n'est lancée pendant la lecture du flux.
    for await (const m of client.fetch(uids.slice(-MAX_FETCH), { envelope: true, uid: true, internalDate: true }, { uid: true })) {
      const envelope = m.envelope;
      const sender = envelope?.from?.find(a => a.address);
      const address = sender?.address?.trim() ?? '';
      if (!envelope || !address) continue;
      const host = domainOf(address);
      // Copies de nos propres envois (contact@ en copie cachée) : jamais une réponse.
      if (host === OWN_DOMAIN || host.endsWith(`.${OWN_DOMAIN}`)) continue;
      // Le domaine « officiel » (alerte complète, extrait compris) vient toujours de la liste de base ;
      // un domaine ajouté seulement parce qu'une lettre l'attend (`extraDomains`) ne doit jamais faire
      // passer un message non rattaché pour un organisme officiel ni changer son alerte habituelle.
      const domain = watchedDomainFor(address, baseDomains) ?? watchedDomainFor(address, extraDomains);
      if (!domain) continue;
      const receivedAt = new Date(m.internalDate ?? envelope.date ?? Number.NaN).getTime();
      if (!Number.isFinite(receivedAt) || receivedAt < since) continue;
      const messageId = envelope.messageId?.trim();
      // Le Message-ID suit un message déplacé entre dossiers ; à défaut, dossier + UIDVALIDITY + UID.
      const key = fingerprint(messageId ? `mid:${messageId}` : `uid:${folder.path}:${validity}:${m.uid}`);
      if (keys.has(key)) continue;
      keys.add(key);
      if (seen.has(key)) continue;
      fresh.push({
        key, folder: folder.path, uid: m.uid, validity, domain, fromName: sender?.name ?? '', fromAddress: address,
        subject: envelope.subject ?? '', receivedAt, extract: null,
        inReplyTo: envelope.inReplyTo?.trim() || null, headers: null, headersPending: false, letterMatch: null,
      });
    }
  }
  fresh.sort((a, b) => a.receivedAt - b.receivedAt);
  const selected = fresh.slice(0, MAX_ALERTS);
  // Extrait des seuls organismes officiels, après la lecture des enveloppes. Un échec laisse l'alerte partir sans extrait.
  for (const folder of new Set(selected.filter(c => INSTITUTIONS[c.domain]).map(c => c.folder))) {
    try {
      const mailbox = await client.mailboxOpen(folder, { readOnly: true });
      for (const candidate of selected.filter(c => c.folder === folder && INSTITUTIONS[c.domain])) {
        if (mailbox.uidValidity.toString() !== candidate.validity) continue;
        try {
          const m = await client.fetchOne(String(candidate.uid), { source: { maxLength: SOURCE_LIMIT } }, { uid: true });
          if (m && m.source) candidate.extract = await extractText(m.source);
        } catch { /* Alerte sans extrait. */ }
      }
    } catch { /* Alerte sans extrait. */ }
  }
  // En-têtes de rattachement : seulement si une lettre en attente partage le domaine de l'expéditeur
  // (sinon aucun appel IMAP de plus). Une lecture manquante ou incertaine (bail non ouvert, UIDVALIDITY
  // changée, exception) laisse le message `headersPending` : jamais classé sans ces en-têtes, jamais
  // marqué `seen`, retenté au passage suivant — une réponse humaine mal lue ne doit jamais passer pour
  // une réponse automatique, ni l'inverse.
  const needsHeaders = (c: MailWatchCandidate) => letterTargets.some(t => t.domains.some(d => domainsRelated(domainOf(c.fromAddress), d)));
  for (const folder of new Set(selected.filter(needsHeaders).map(c => c.folder))) {
    let mailbox: { uidValidity: bigint } | undefined;
    try { mailbox = await client.mailboxOpen(folder, { readOnly: true }); }
    catch { for (const c of selected.filter(c => c.folder === folder && needsHeaders(c))) c.headersPending = true; continue; }
    for (const candidate of selected.filter(c => c.folder === folder && needsHeaders(c))) {
      if (mailbox.uidValidity.toString() !== candidate.validity) { candidate.headersPending = true; continue; }
      try {
        const m = await client.fetchOne(String(candidate.uid), { headers: REPLY_HEADER_FIELDS }, { uid: true });
        if (m && m.headers !== undefined) candidate.headers = parseHeaderBlock(m.headers);
        else candidate.headersPending = true;
      } catch { candidate.headersPending = true; }
    }
  }
  for (const candidate of selected) {
    if (candidate.headersPending) continue;
    const matched = findLetterMatch(domainOf(candidate.fromAddress), candidate.subject, candidate.inReplyTo, candidate.headers?.references ?? null, letterTargets);
    if (!matched) continue;
    const target = resolveLetterTarget(matched, letterTargets);
    candidate.letterMatch = { targetId: target.id, subject: target.subject, sentAt: target.sentAt, replyKind: classifyReplyKind(candidate.subject, candidate.headers ?? { references: null, autoSubmitted: null, autoreplyFlag: false }) };
  }
  return { matched: keys.size, fresh: fresh.length, selected };
}

const count = (value: unknown) => (Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0);
const stamp = (value: unknown) => (Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null);
function readState(db: Database.Database): State | null {
  const row = db.prepare('SELECT checked_at,details_json FROM operation_checks WHERE name=?').get(CHECK) as { checked_at: number; details_json: string } | undefined;
  if (!row) return null;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(row.details_json) as Record<string, unknown>; } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const status = raw.status === 'ok' || raw.status === 'inactive' || raw.status === 'error' ? raw.status : 'error';
  return {
    version: 1,
    checked_at: row.checked_at,
    status,
    code: typeof raw.code === 'string' && CODES.has(raw.code) ? (raw.code as MailWatchCode) : null,
    http_status: Number.isSafeInteger(raw.http_status) && (raw.http_status as number) >= 100 && (raw.http_status as number) < 600 ? (raw.http_status as number) : null,
    last_success_at: stamp(raw.last_success_at),
    last_alert_at: stamp(raw.last_alert_at),
    matched: count(raw.matched),
    alerted: count(raw.alerted),
    pending: count(raw.pending),
    total_alerted: count(raw.total_alerted),
    domains: count(raw.domains),
    // Compteur interne, jamais exposé par `publicView` (voir `readMailWatchStatus`) : réponses rattachées
    // à une lettre institutionnelle depuis la création du témoin.
    total_attached: count(raw.total_attached),
    seen: Array.isArray(raw.seen) ? raw.seen.filter((k): k is string => typeof k === 'string' && /^[0-9a-f]{32}$/.test(k)).slice(-MAX_SEEN) : [],
  };
}
function publicView(state: State): MailWatchStatus {
  const { checked_at, status, code, http_status, last_success_at, last_alert_at, matched, alerted, pending, total_alerted, domains } = state;
  return { checked_at, status, code, http_status, last_success_at, last_alert_at, matched, alerted, pending, total_alerted, domains };
}
function save(db: Database.Database, state: State): State {
  db.prepare('INSERT INTO operation_checks(name,checked_at,details_json) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json')
    .run(CHECK, state.checked_at, JSON.stringify(state));
  return state;
}

/** Témoin exposé au bureau : jamais la liste des empreintes. */
export function readMailWatchStatus(db: Database.Database = getDb()): MailWatchStatus | null {
  const state = readState(db);
  return state ? publicView(state) : null;
}

/** Un passage complet. Ne marque un message signalé qu'après `ok:true` de Telegram. */
export async function runMailWatch(overrides: Partial<Dependencies> = {}): Promise<MailWatchStatus> {
  const deps: Dependencies = { ...defaults, ...overrides };
  const db = deps.database();
  const now = deps.now();
  const previous = readState(db);
  let state: State = {
    version: 1, checked_at: now, status: 'ok', code: null, http_status: null,
    last_success_at: previous?.last_success_at ?? null, last_alert_at: previous?.last_alert_at ?? null,
    matched: 0, alerted: 0, pending: 0, total_alerted: previous?.total_alerted ?? 0,
    total_attached: previous?.total_attached ?? 0, domains: 0, seen: previous?.seen ?? [],
  };
  const finish = (patch: Partial<State>) => publicView(save(db, { ...state, ...patch }));
  const telegram = telegramConfig();
  if (telegram === 'missing') return finish({ status: 'inactive', code: 'not_configured' });
  if (telegram === 'invalid') return finish({ status: 'inactive', code: 'telegram_config_invalid' });
  const baseDomains = watchedDomains();
  // Lettres `sent` encore sans réponse humaine : élargissent la veille (domaines envoyés il y a moins de
  // 120 jours) et servent de candidates au rattachement (sans limite d'âge pour le rattachement lui-même :
  // une liste de domaines par défaut comme `finma.ch` reste surveillée indéfiniment).
  const letterTargets = pendingLetters(db);
  const extraDomains = pendingLetterDomains(letterTargets, now);
  state.domains = [...new Set([...baseDomains, ...extraDomains])].length;
  let auth: { user: string; pass: string } | null;
  try { auth = deps.connection(); } catch { return finish({ status: 'error', code: 'mailbox_unreadable' }); }
  if (!auth) return finish({ status: 'inactive', code: 'mailbox_not_connected' });
  let found: Awaited<ReturnType<typeof collect>>;
  const seen = new Set(state.seen);
  try { found = await deps.withImap(auth, client => collect(client, baseDomains, extraDomains, now, seen, letterTargets)); }
  catch { return finish({ status: 'error', code: 'imap_failed' }); }
  state = { ...state, matched: found.matched, pending: found.fresh };
  for (const candidate of found.selected) {
    // En-têtes de rattachement pas encore obtenus de façon fiable : ni alerte ni marquage `seen` ce
    // passage-ci, le message reste `pending` et sera relu au passage suivant (jamais classé à la légère).
    if (candidate.headersPending) continue;
    const text = candidate.letterMatch ? letterReplyText(candidate.letterMatch, domainOf(candidate.fromAddress)) : alertText(candidate);
    const sent = await sendTelegram(telegram, text, deps.fetch);
    if (!sent.ok) return finish({ status: 'error', code: sent.code, http_status: sent.http_status ?? null });
    // Rattachement écrit seulement après l'accusé Telegram, comme le marquage `seen` ci-dessous : un
    // arrêt en cours de passage ne doit jamais perdre un rattachement ni le rejouer à double.
    const attached = candidate.letterMatch
      ? attachReply(db, candidate.letterMatch.targetId, candidate.receivedAt, domainOf(candidate.fromAddress), candidate.subject, candidate.letterMatch.replyKind)
      : false;
    state = {
      ...state, alerted: state.alerted + 1, pending: state.pending - 1, total_alerted: state.total_alerted + 1,
      total_attached: state.total_attached + (attached ? 1 : 0), last_alert_at: deps.now(),
      seen: [...state.seen.filter(k => k !== candidate.key), candidate.key].slice(-MAX_SEEN),
    };
    // Marqué aussitôt : un arrêt en cours de passage ne renverra pas cette alerte.
    save(db, state);
  }
  return finish({ status: 'ok', code: null, last_success_at: now });
}

/** Minuterie du point d'entrée réel (jamais dans createApp) : premier passage après 60 s, puis toutes les 10 minutes. */
export function startMailWatch(overrides: Partial<Dependencies> & { run?: () => Promise<MailWatchStatus> } = {}): () => void {
  const { run = () => runMailWatch(overrides) } = overrides;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delay);
    timer.unref();
  };
  const tick = async () => {
    if (stopped) return;
    try {
      const result = await run();
      // Codes fermés et nombres seulement : jamais d'adresse, d'objet, d'extrait ni de message d'erreur brut.
      if (result.status === 'error') console.error(`[veille courrier] passage en échec (${result.code ?? 'inconnu'}) ; nouvel essai dans dix minutes`);
      else if (result.alerted) console.info(`[veille courrier] ${result.alerted} alerte(s) envoyée(s)`);
    } catch {
      console.error('[veille courrier] passage interrompu ; nouvel essai dans dix minutes');
    } finally {
      // Une seule minuterie, réarmée après la fin : aucun passage concurrent ni relance après arrêt.
      schedule(INTERVAL);
    }
  };
  schedule(START_DELAY);
  console.info('[veille courrier] minuterie active ; premier passage après 60 secondes');
  return () => { stopped = true; clearTimeout(timer); };
}
