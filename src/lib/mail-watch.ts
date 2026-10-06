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
// Rattachement aux lettres (tâche 3, élargi par la correction finale du 06.10) : une lettre `sent`, ou
// `failed` avec un essai réel (`attempted_at`), envoyée il y a moins de 120 jours — quel que soit l'état
// de sa réponse — élargit la veille à son domaine (en plus de la liste ci-dessus, inchangée).
const PENDING_LETTER_WINDOW_MS = 120 * 86_400_000;
// En-têtes supplémentaires lus par BODY.PEEK[HEADER.FIELDS (...)], seulement quand un domaine surveillé a une
// lettre en attente de réponse : `In-Reply-To` est déjà dans l'enveloppe (`envelope.inReplyTo`), gratuite.
// `Precedence` et `Authentication-Results` ajoutés par la correction finale du 06.10.2026.
const REPLY_HEADER_FIELDS = ['references', 'auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence', 'authentication-results'];
// Préfixe de réponse ou de transfert, français/allemand/anglais, avec ou sans espace avant le « : ».
const REPLY_PREFIX_RE = /^\s*(?:re|aw|antw|tr|wg|fwd)\s*:\s*/i;
// Apostrophes ramenées à une seule forme (ASCII), AVANT la normalisation NFC (correction finale 2,
// 06.10, item 4) : « d’absence » (U+2019), « d‘absence » (U+2018) et « d'absence » (ASCII) doivent se
// comparer identiquement, qu'elles viennent d'un motif écrit dans ce fichier ou d'un objet reçu.
// Définie ICI (avant `AUTO_SUBJECT_MARKERS`, qui l'utilise dès le chargement du module) : une
// `const` n'est pas hissée comme une fonction, l'ordre du fichier compte.
const APOSTROPHE_RE = /[‘’ʼ´`]/g;
const normalizeApostrophes = (s: string) => s.replace(APOSTROPHE_RE, "'");
// Motifs resserrés par la correction finale du 06.10.2026 : « absence » seule retirée (trop de faux
// positifs, ex. « absence de base légale » dans un refus humain) ; motifs plus précis ajoutés à la place.
const AUTO_SUBJECT_MARKERS: readonly string[] = [
  'accusé de réception', 'eingangsbestätigung', 'automatic reply', 'réponse automatique',
  'automatische antwort', 'abwesenheit', 'out of office', 'message d’absence', 'absent du bureau',
  'absente du bureau', 'risposta automatica',
  // La normalisation ci-dessous (apostrophe ASCII + NFC) rend cette liste insensible à la forme de
  // l'apostrophe écrite ici : elle n'a donc plus besoin d'être ASCII elle-même.
].map(m => normalizeApostrophes(m).normalize('NFC').toLowerCase());
// `Precedence` reconnus comme automatiques ; jamais `list` (une liste de diffusion n'est pas un accusé).
const AUTO_PRECEDENCE: ReadonlySet<string> = new Set(['auto_reply', 'bulk', 'junk']);
// Après trois lectures d'en-têtes ratées pour le même message (bail non ouvert, UIDVALIDITY changée,
// exception), jamais d'abandon pur (correction finale 2, 06.10) : rattachement par la seule enveloppe
// (objet, In-Reply-To — déjà lus gratuitement) en `unverified`, sinon alerte de secours habituelle si
// l'objet ne correspond à rien. Compteur de tentatives borné, fingerprints seuls (jamais un domaine ni
// un objet dans le témoin).
const HEADER_RETRY_LIMIT = 3;
const MAX_HEADER_RETRY_ENTRIES = 200;
// Identifiants de serveur d'authentification (premier champ d'`Authentication-Results`, avant le
// premier « ; ») considérés fiables pour juger DKIM/DMARC. VIDE pour l'instant (correction finale 2,
// 06.10) : à remplir par Claude-Alain avec l'identifiant relevé sur une vraie réponse reçue via
// Infomaniak (voir `operation_checks/mail_watch_auth`, `last_authserv_id_seen`). Tant qu'elle est
// vide, AUCUNE réponse n'est jamais `human` par authenticité (toujours `unverified`) : c'est le choix
// sûr — n'importe qui peut écrire n'importe quel `Authentication-Results` dans un message.
// L'analyse de l'en-tête a été durcie le 06.10.2026 (grammaire RFC 8601 : guillemets échappés,
// commentaires imbriqués, `header.d` lu seulement comme propriété de sa clause ; voir
// `readAuthenticationResults` et tests/lib/mail-watch-authresults.test.ts, qui l'éprouvent avec une
// liste INJECTÉE). NE PAS REMPLIR pour autant avant d'avoir vérifié sur une vraie réponse reçue
// qu'Infomaniak place son propre en-tête en tête et relevé son identifiant exact. Le test
// tests/lib/mail-watch-authserv.test.ts verrouille cette liste vide (à réécrire à ce moment-là).
export const TRUSTED_AUTHSERV_IDS: ReadonlySet<string> = new Set<string>([]);
const AUTH_WITNESS_CHECK = 'mail_watch_auth';

type State = MailWatchStatus & { version: 1; seen: string[]; total_attached: number; headerFailures: Record<string, number> };
// Exportés pour `letters-sender.ts` (tâche 2), qui réutilise `telegramConfig`/`sendTelegram` tels quels.
export type TelegramConfig = { token: string; chat: string };
export type Sent = { ok: true } | { ok: false; code: MailWatchCode; http_status?: number };
/** En-têtes supplémentaires du message, lus seulement pour un domaine qui a une lettre en attente. */
export type ReplyHeaders = {
  references: string | null;
  autoSubmitted: string | null;
  autoreplyFlag: boolean;
  precedence: string | null;
  authenticationResults: string | null;
};
const EMPTY_REPLY_HEADERS: ReplyHeaders = { references: null, autoSubmitted: null, autoreplyFlag: false, precedence: null, authenticationResults: null };
/** Lettre `sent`, ou `failed` avec un essai réel, candidate au rattachement (tâche 3) — quel que soit
 * l'état de sa réponse (correction finale du 06.10) : la date « effective » (`sentAt`) est `sent_at`,
 * ou `attempted_at` à défaut (une lettre `failed` a pu malgré tout être reçue, issue incertaine). */
type LetterMatchTarget = { id: string; kind: LetterKind; parentId: string | null; domains: string[]; subject: string; resendId: string | null; sentAt: number };
/** Rattachement trouvé pour un message : la lettre D'ORIGINE (jamais une relance) à mettre à jour. */
type LetterMatch = { targetId: string; subject: string; sentAt: number; replyKind: ReplyKind };
export type MailWatchCandidate = {
  key: string; folder: string; uid: number; validity: string; domain: string; fromName: string; fromAddress: string;
  subject: string; receivedAt: number; extract: string | null;
  /** Vrai si `domain` ne vient QUE de la liste élargie par une lettre (jamais de la liste de base) :
   * sert au libellé Telegram d'un message non rattaché (« autorité », jamais « client »). */
  fromLetterDomain: boolean;
  /** `envelope.inReplyTo`, gratuite (fait partie de l'ENVELOPE IMAP standard). */
  inReplyTo: string | null;
  /** `null` si jamais demandés (aucune lettre en attente sur ce domaine) ou si la lecture a échoué. */
  headers: ReplyHeaders | null;
  /** Lecture des en-têtes requise mais pas encore obtenue de façon fiable (1er ou 2e échec) : le message
   * reste `pending`, jamais classé « humaine » par défaut, retenté au passage suivant (jamais `seen`). */
  headersPending: boolean;
  /** Troisième échec de lecture des en-têtes pour ce message : abandon, alerte de secours SANS
   * rattachement (`letterMatch` reste `null`), message marqué `seen` comme les autres. */
  headerGivenUp: boolean;
  letterMatch: LetterMatch | null;
};
type Dependencies = {
  database: () => Database.Database;
  now: () => number;
  connection: () => { user: string; pass: string } | null;
  withImap: typeof imap;
  fetch: typeof fetch;
  /** Serveurs d'authentification de confiance. En production, toujours `TRUSTED_AUTHSERV_IDS` (vide) ;
   * injectable SEULEMENT par les tests, pour éprouver l'analyse durcie sans remplir la constante. */
  trustedAuthservIds: ReadonlySet<string>;
};
const defaults: Dependencies = {
  database: getDb,
  // Lue à chaque appel, pas au chargement : une horloge simulée (tests) doit être vue.
  now: () => Date.now(),
  connection: () => connection('support'),
  withImap: imap,
  fetch: (input, init) => fetch(input, init),
  trustedAuthservIds: TRUSTED_AUTHSERV_IDS,
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

export function alertText(message: Pick<MailWatchCandidate, 'domain' | 'fromName' | 'fromAddress' | 'subject' | 'receivedAt' | 'extract'> & { fromLetterDomain?: boolean }): string {
  const name = organisation(message.domain);
  const address = clip(compact(message.fromAddress), 254);
  const display = clip(compact(message.fromName), 120);
  // Organisme officiel : expéditeur, objet et extrait. Autre domaine (un client) : ni nom, ni adresse, ni objet,
  // ni extrait ; seulement le domaine et l'heure, pour qu'aucune donnée personnelle d'un client ne parte vers Telegram.
  const official = Boolean(INSTITUTIONS[message.domain]);
  // Un domaine ajouté seulement parce qu'une lettre l'attend (jamais la liste de base) : ce message ne
  // s'est pas rattaché à cette lettre (sinon un autre texte, `letterReplyText`, aurait déjà remplacé
  // celui-ci), mais ce n'est pas un client pour autant — libellé « autorité », sans autre donnée.
  const unmatchedLetterDomain = !official && message.fromLetterDomain === true;
  const lines = [
    `📬 OpenSwissData : réponse reçue de ${name}`,
    ...(official ? [
      `De : ${display && display.toLowerCase() !== address.toLowerCase() ? `${display} <${address}>` : address}`,
      `Objet : ${clip(compact(message.subject), 300) || '(sans objet)'}`,
    ] : unmatchedLetterDomain ? [`Message d’une autorité (${clip(compact(message.domain), 253)}).`] : ['Message d’un client : lire dans contact@.']),
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
/** Alignement d'un domaine de signature (DKIM `header.d`, DMARC `header.from`) sur le domaine de
 * l'expéditeur (correction finale 2, 06.10, item 5) : `signingDomain` doit être égal au domaine de
 * l'expéditeur OU un PARENT de celui-ci — JAMAIS un enfant. `admin.ch` peut légitimement signer pour
 * `seco.admin.ch` (même zone DNS) ; l'inverse (`seco.admin.ch` signant soi-disant pour `admin.ch`, ou
 * pour un domaine frère) ne prouve rien et doit toujours être rejeté. Asymétrique à dessein, contrairement
 * à `domainsRelated` (bidirectionnel, utilisé lui pour le rattachement objet/domaine d'une lettre).
 */
export function signingDomainAligned(senderHost: string, signingDomain: string): boolean {
  if (!senderHost || !signingDomain) return false;
  return senderHost === signingDomain || senderHost.endsWith(`.${signingDomain}`);
}
// NFC : un client de messagerie peut envoyer un accent décomposé (NFD), qui ne contiendrait jamais
// la forme composée des motifs ci-dessous sans cette normalisation. `normalizeApostrophes` définie
// plus haut (avant `AUTO_SUBJECT_MARKERS`, qui en a besoin dès le chargement du module).
const normalizeText = (s: string) => compact(normalizeApostrophes(s).normalize('NFC')).toLowerCase();
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
/** En-têtes demandés par `REPLY_HEADER_FIELDS` : repli des lignes pliées (RFC 5322) avant lecture.
 * Ne garde que la PREMIÈRE occurrence de chaque nom (`if (!map.has(name))`) : un serveur receveur
 * ajoute son propre `Authentication-Results` tout en haut ; une occurrence plus bas peut être forgée
 * par l'expéditeur lui-même et ne doit jamais être prise pour l'évaluation du serveur receveur. */
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
    precedence: map.get('precedence') ?? null,
    authenticationResults: map.get('authentication-results') ?? null,
  };
}
// ─── Analyse d'`Authentication-Results` selon la grammaire RFC 8601 (durcie le 06.10.2026) ───────────
// Relecture adverse du 06.10 : l'ancienne analyse par expressions se contournait (guillemet échappé
// `\"` dans `smtp.mailfrom`, `header.d=` caché dans la partie locale entre guillemets de `header.i`,
// `header.d=` dans un commentaire). Les valeurs `smtp.mailfrom` et `header.i` sont choisies par
// l'EXPÉDITEUR : rien de ce qui se trouve entre guillemets ou entre parenthèses n'est jamais lu comme
// une propriété. L'analyse procède en deux temps :
//  1. un analyseur lexical (`scanAuthResults`) découpe l'en-tête en éléments : texte nu, chaîne entre
//     guillemets (échappements `\"` et `\\` décodés), séparateur (espaces OU commentaire RFC 5322,
//     imbriqué, avec échappements) et « ; » de premier niveau. Toute forme douteuse (guillemet ou
//     parenthèse non fermés, « ) » orpheline, « \ » final, en-tête démesuré) rejette l'en-tête ENTIER :
//     une réponse reste alors `unverified`, jamais l'inverse ;
//  2. chaque clause (`resinfo`) est lue SEULEMENT dans sa forme `méthode=résultat` suivie de propriétés
//     `ptype.property=valeur` ; `header.d` (DKIM) et `header.from` (DMARC) ne sont lus que comme
//     propriétés de leur clause, valeur nue ou entièrement entre guillemets, nom d'hôte strict.
const AUTH_RESULTS_MAX_LENGTH = 16_384;
const HOSTNAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const METHODSPEC_RE = /^([a-z0-9][a-z0-9_-]*)(?:\/[0-9]+)?=([a-z0-9][a-z0-9_-]*)$/i;
const PROPERTY_KEY_RE = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)?$/i;
type AuthPart = { kind: 'atom' | 'quoted'; text: string };
/** Un « mot » : suite d'éléments collés (texte nu et chaînes entre guillemets), sans séparateur entre eux
 * — ex. `header.i="a b"@exemple.ch` est UN seul mot de trois parties. */
type AuthWord = AuthPart[];
type AuthScan = { segments: AuthWord[][]; semicolons: number[] };
/** Analyseur lexical. `null` si l'en-tête est malformé (rejet de l'en-tête entier, sûr par défaut). */
function scanAuthResults(raw: string): AuthScan | null {
  if (raw.length > AUTH_RESULTS_MAX_LENGTH) return null;
  const segments: AuthWord[][] = [[]];
  const semicolons: number[] = [];
  let word: AuthWord | null = null;
  const endWord = () => { if (word) { segments[segments.length - 1].push(word); word = null; } };
  const push = (part: AuthPart) => {
    if (!word) word = [];
    const last = word[word.length - 1];
    if (last && last.kind === 'atom' && part.kind === 'atom') last.text += part.text;
    else word.push(part);
  };
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"') {
      // Chaîne entre guillemets (RFC 5322 quoted-string) : `\x` donne `x` ; « ; », « ( » et « ) » y
      // sont du texte ordinaire.
      let text = '';
      let j = i + 1;
      let closed = false;
      while (j < raw.length) {
        const c = raw[j];
        if (c === '\\') { if (j + 1 >= raw.length) return null; text += raw[j + 1]; j += 2; continue; }
        if (c === '"') { closed = true; j++; break; }
        text += c; j++;
      }
      if (!closed) return null;
      push({ kind: 'quoted', text });
      i = j;
      continue;
    }
    if (ch === '(') {
      // Commentaire RFC 5322 : imbriqué, `\x` échappe un caractère (y compris « ) »), « " » y est un
      // caractère ordinaire. Un commentaire sépare comme une espace : jamais de mot collé au travers.
      let depth = 1;
      let j = i + 1;
      while (j < raw.length && depth > 0) {
        const c = raw[j];
        if (c === '\\') { if (j + 1 >= raw.length) return null; j += 2; continue; }
        if (c === '(') depth++;
        else if (c === ')') depth--;
        j++;
      }
      if (depth > 0) return null;
      endWord();
      i = j;
      continue;
    }
    if (ch === ')') return null;
    if (ch === ';') { endWord(); semicolons.push(i); segments.push([]); i++; continue; }
    if (/\s/.test(ch)) { endWord(); i++; continue; }
    push({ kind: 'atom', text: ch });
    i++;
  }
  endWord();
  return { segments, semicolons };
}
/** Identifiant du serveur lu dans le premier segment (avant le premier « ; » de premier niveau) : un nom
 * d'hôte nu, suivi éventuellement d'un numéro de version (`authres-version`), et RIEN d'autre. */
function authservIdOf(scan: AuthScan): string | null {
  const head = scan.segments[0] ?? [];
  if (head.length < 1 || head.length > 2) return null;
  if (!head.every(w => w.length === 1 && w[0].kind === 'atom')) return null;
  if (head.length === 2 && !/^[0-9]+$/.test(head[1][0].text)) return null;
  // Forme stricte d'un nom d'hôte : si le premier en-tête vient de l'expéditeur (inconnu tant
  // qu'aucune vraie réponse n'a été observée), rien d'autre qu'un nom d'hôte n'est jamais conservé.
  const id = head[0][0].text.toLowerCase();
  return id.length <= 253 && HOSTNAME_RE.test(id) ? id : null;
}
/** Domaine lu dans la valeur d'une propriété : entièrement nue OU entièrement entre guillemets (jamais un
 * mélange comme `"x"@y`), nom d'hôte strict (au moins un point), sinon `null`. */
function domainValue(parts: AuthPart[]): string | null {
  if (parts.length !== 1) return null;
  const value = parts[0].text.trim().toLowerCase();
  return value.length <= 253 && HOSTNAME_RE.test(value) ? value : null;
}
type ResInfo = { method: string; result: string; properties: Array<{ key: string; value: AuthPart[] }> };
/** Une clause `resinfo` : `méthode=résultat` (un seul mot nu), puis des propriétés `clé=valeur` dont la
 * clé est nue et précède le premier « = » nu du mot. Toute autre forme rend la clause nulle. */
function parseResInfo(words: AuthWord[]): ResInfo | null {
  const [first, ...rest] = words;
  if (!first || first.length !== 1 || first[0].kind !== 'atom') return null;
  const spec = METHODSPEC_RE.exec(first[0].text);
  if (!spec) return null;
  const properties: ResInfo['properties'] = [];
  for (const word of rest) {
    const head = word[0];
    if (head.kind !== 'atom') return null;
    const eq = head.text.indexOf('=');
    if (eq <= 0) return null;
    const key = head.text.slice(0, eq);
    if (!PROPERTY_KEY_RE.test(key)) return null;
    const remainder = head.text.slice(eq + 1);
    const value: AuthPart[] = [...(remainder ? [{ kind: 'atom' as const, text: remainder }] : []), ...word.slice(1)];
    properties.push({ key: key.toLowerCase(), value });
  }
  return { method: spec[1].toLowerCase(), result: spec[2].toLowerCase(), properties };
}
/** Domaine de la propriété `key` d'une clause : exactement UNE occurrence (deux `header.d` dans la même
 * clause la rendent ambiguë, donc nulle), valeur de domaine stricte. */
function singleDomainProperty(info: ResInfo, key: string): string | null {
  const found = info.properties.filter(p => p.key === key);
  return found.length === 1 ? domainValue(found[0].value) : null;
}
export type AuthenticationResultsReading = {
  /** Identifiant du serveur qui a écrit l'en-tête (nom d'hôte strict), `null` si absent ou malformé. */
  authservId: string | null;
  /** `header.d` de TOUTES les clauses `dkim=pass` lisibles (une clause tierce ne masque pas la suivante). */
  dkimPassDomains: string[];
  /** `header.from` de TOUTES les clauses `dmarc=pass` lisibles. */
  dmarcPassFromDomains: string[];
};
/** Lecture structurée d'un en-tête `Authentication-Results`, SANS juger la confiance du serveur.
 * `null` si l'en-tête est absent ou malformé. */
export function readAuthenticationResults(raw: string | null): AuthenticationResultsReading | null {
  if (!raw) return null;
  const scan = scanAuthResults(raw);
  if (!scan) return null;
  const dkimPassDomains: string[] = [];
  const dmarcPassFromDomains: string[] = [];
  for (const words of scan.segments.slice(1)) {
    const info = parseResInfo(words);
    if (!info || info.result !== 'pass') continue;
    if (info.method === 'dkim') {
      const d = singleDomainProperty(info, 'header.d');
      if (d) dkimPassDomains.push(d);
    } else if (info.method === 'dmarc') {
      const d = singleDomainProperty(info, 'header.from');
      if (d) dmarcPassFromDomains.push(d);
    }
  }
  return { authservId: authservIdOf(scan), dkimPassDomains, dmarcPassFromDomains };
}
/** L'en-tête montre-t-il une authentification ALIGNÉE de l'expéditeur, posée par un serveur de la liste
 * de confiance ? Liste vide (cas de production tant que `TRUSTED_AUTHSERV_IDS` n'est pas rempli) :
 * toujours `false`, avant même toute lecture. Une seule clause `dkim=pass` (ou `dmarc=pass`) alignée
 * suffit — égal ou PARENT du domaine de l'expéditeur, jamais un enfant (`signingDomainAligned`). */
export function hasAlignedAuthentication(raw: string | null, senderHost: string, trusted: ReadonlySet<string>): boolean {
  if (trusted.size === 0) return false;
  const reading = readAuthenticationResults(raw);
  if (!reading?.authservId) return false;
  const id = reading.authservId;
  if (![...trusted].some(t => t.toLowerCase() === id)) return false;
  const host = senderHost.trim().toLowerCase();
  return reading.dkimPassDomains.some(d => signingDomainAligned(host, d))
    || reading.dmarcPassFromDomains.some(d => signingDomainAligned(host, d));
}
/** Découpe un en-tête `Authentication-Results` en clauses (texte brut de chacune, commentaires et
 * guillemets compris) aux seuls « ; » de premier niveau repérés par l'analyseur lexical : jamais dans
 * une chaîne entre guillemets (échappements compris) ni dans un commentaire (imbriqué). Diagnostic
 * seulement ; `[]` si l'en-tête est malformé. */
export function splitAuthClauses(raw: string): string[] {
  const scan = scanAuthResults(raw);
  if (!scan) return [];
  const clauses: string[] = [];
  let from = 0;
  for (const at of scan.semicolons) { clauses.push(raw.slice(from, at)); from = at + 1; }
  clauses.push(raw.slice(from));
  return clauses.map(c => c.trim()).filter(c => c.length > 0);
}
/** Identifiant du serveur d'authentification (avant le premier « ; » de premier niveau, éventuellement
 * suivi d'une version) d'un en-tête `Authentication-Results` — un nom d'hôte, jamais une adresse.
 * `null` si l'en-tête est vide, malformé ou si ce premier élément n'est pas un nom d'hôte strict. */
export function extractAuthservId(raw: string): string | null {
  const scan = scanAuthResults(raw);
  return scan ? authservIdOf(scan) : null;
}
/** Compatibilité (diagnostic, tests existants) : PREMIER domaine `dkim=pass` et PREMIER `dmarc=pass`
 * lus, seulement si le serveur figure dans `trusted`. La décision `human` n'utilise JAMAIS cette
 * fonction (elle ignorerait une seconde clause alignée) : voir `hasAlignedAuthentication`. */
export function parseAuthenticationResults(raw: string | null, trusted: ReadonlySet<string> = TRUSTED_AUTHSERV_IDS): { dkimDomain: string | null; dmarcFromDomain: string | null } {
  const empty = { dkimDomain: null, dmarcFromDomain: null };
  if (trusted.size === 0) return empty;
  const reading = readAuthenticationResults(raw);
  const id = reading?.authservId;
  if (!reading || !id || ![...trusted].some(t => t.toLowerCase() === id)) return empty;
  return { dkimDomain: reading.dkimPassDomains[0] ?? null, dmarcFromDomain: reading.dmarcPassFromDomains[0] ?? null };
}
/**
 * `auto` d'abord (en-têtes, ou objet — débarrassé du texte de la lettre rattachée — portant un motif
 * d'accusé/absence connu) : une réponse automatique n'a jamais besoin d'authentification. Sinon
 * `human` si DKIM ou DMARC est aligné sur le domaine de l'expéditeur (égal ou PARENT de celui-ci,
 * jamais un enfant — `signingDomainAligned`, item 5) ; sinon `unverified`. `letterSubject` est l'objet
 * de la lettre (ou relance) qui a servi au rattachement — on le retire d'abord de l'objet reçu, sinon
 * un mot de la lettre elle-même (ex. une lettre dont l'objet contient « réponse automatique ») ferait
 * passer une vraie réponse humaine pour un accusé automatique. `trusted` : serveurs d'authentification
 * de confiance — en production toujours `TRUSTED_AUTHSERV_IDS` (vide, donc jamais `human` par
 * authenticité) ; une autre liste n'est passée que par les tests.
 */
export function classifyReplyKind(receivedSubject: string, letterSubject: string, headers: ReplyHeaders, senderHost: string, trusted: ReadonlySet<string> = TRUSTED_AUTHSERV_IDS): ReplyKind {
  const submitted = headers.autoSubmitted?.trim().toLowerCase();
  if (submitted && submitted !== 'no') return 'auto';
  if (headers.autoreplyFlag) return 'auto';
  if (headers.precedence && AUTO_PRECEDENCE.has(headers.precedence.trim().toLowerCase())) return 'auto';
  const strippedLetter = normalizeText(stripReplyPrefixes(letterSubject));
  const normalizedReceived = normalizeText(receivedSubject);
  const remainder = strippedLetter ? normalizedReceived.split(strippedLetter).join(' ') : normalizedReceived;
  if (AUTO_SUBJECT_MARKERS.some(marker => remainder.includes(marker))) return 'auto';
  return hasAlignedAuthentication(headers.authenticationResults, senderHost, trusted) ? 'human' : 'unverified';
}
/** Lettres `sent`, ou `failed` avec un essai réel — quel que soit l'état de leur réponse (correction
 * finale du 06.10) : sert à la fois à élargir la veille (domaines <120 jours) et à trouver le bon
 * rattachement (sans limite d'âge pour le rattachement lui-même, cf. `runMailWatch`). L'ordre de
 * confiance (auto < unverified < human) est appliqué à l'ÉCRITURE (`attachReply`), jamais ici : une
 * lettre déjà `human` reste une cible valable pour qu'une nouvelle réponse humaine rafraîchisse
 * `reply_at`/`reply_subject`/`reply_from`. */
function rattachableLetters(db: Database.Database): LetterMatchTarget[] {
  const rows = db.prepare(
    `SELECT id, kind, parent_id, to_address, cc, subject, resend_id, COALESCE(sent_at, attempted_at) AS effective_at
     FROM institutional_letters
     WHERE (status='sent' AND sent_at IS NOT NULL) OR (status='failed' AND attempted_at IS NOT NULL)`,
  ).all() as Array<{ id: string; kind: string; parent_id: string | null; to_address: string; cc: string | null; subject: string; resend_id: string | null; effective_at: number }>;
  return rows.map(r => ({
    id: r.id, kind: r.kind as LetterKind, parentId: r.parent_id,
    domains: [...new Set([domainOf(r.to_address), ...(r.cc ? [domainOf(r.cc)] : [])])],
    subject: r.subject, resendId: r.resend_id, sentAt: r.effective_at,
  }));
}
/** Domaines des lettres rattachables envoyées (ou tentées) il y a moins de 120 jours (en plus des
 * domaines par défaut, inchangés) : même règle de rattachement « domaine exact ou sous-domaine » que
 * la veille elle-même. Seule la VEILLE est bornée à 120 jours ; le rattachement, lui, ne l'est pas
 * (une lettre ancienne vers un domaine déjà surveillé par défaut reste une cible valable). */
function pendingLetterDomains(targets: readonly LetterMatchTarget[], now: number): string[] {
  const cutoff = now - PENDING_LETTER_WINDOW_MS;
  return [...new Set(targets.filter(t => t.sentAt >= cutoff).flatMap(t => t.domains))];
}
/** Lettre (ou relance) dont le domaine ET (l'objet ou l'identifiant Resend dans l'en-tête) correspondent ;
 * la plus récemment envoyée (ou tentée) si plusieurs conviennent. */
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
  const label = match.replyKind === 'human' ? 'humaine' : match.replyKind === 'unverified' ? 'NON AUTHENTIFIÉE, vérifier l’expéditeur' : 'accusé automatique';
  return clip(`Réponse à la lettre du ${zurichDayMonthYear(match.sentAt)} (${subject}) : ${label} de ${senderDomain}`, TELEGRAM_LIMIT);
}
// Ordre de confiance d'une réponse (auto < unverified < human), appliqué dans le `WHERE` ci-dessous :
// une nouvelle réponse n'écrit jamais par-dessus une réponse de rang strictement supérieur déjà
// enregistrée ; un même rang (ex. une seconde réponse humaine) rafraîchit les quatre champs.
/** Écrit le rattachement sur la lettre D'ORIGINE, jamais l'adresse ni un extrait. `reply_processed_at`
 * est remis à NULL à chaque écriture : une réponse qui monte de rang (auto→unverified, auto→human,
 * unverified→human) doit être revue, même si l'ancienne avait déjà été traitée ; un même rang (rafraîchi)
 * ou un départ de zéro (`reply_kind` NULL) n'avaient de toute façon jamais pu être traités encore.
 * Renvoie `true` seulement si l'écriture a eu lieu (sert au compteur interne, jamais exposé au bureau). */
export function attachReply(db: Database.Database, targetId: string, at: number, fromDomain: string, subject: string, kind: ReplyKind): boolean {
  const result = db.prepare(
    `UPDATE institutional_letters SET reply_at=@at, reply_from=@from_domain, reply_subject=@subject,
       reply_kind=@kind, reply_processed_at=NULL
     WHERE id=@id AND (
       reply_kind IS NULL
       OR (reply_kind='auto' AND @kind IN ('auto','unverified','human'))
       OR (reply_kind='unverified' AND @kind IN ('unverified','human'))
       OR (reply_kind='human' AND @kind='human')
     )`,
  ).run({ at, from_domain: fromDomain, subject: clip(compact(subject), 200), kind, id: targetId });
  return result.changes === 1;
}

async function collect(client: ImapFlow, baseDomains: readonly string[], extraDomains: readonly string[], now: number, seen: ReadonlySet<string>, letterTargets: readonly LetterMatchTarget[], headerRetryCounts: Readonly<Record<string, number>>, trusted: ReadonlySet<string>) {
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
      const fromBase = watchedDomainFor(address, baseDomains);
      const domain = fromBase ?? watchedDomainFor(address, extraDomains);
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
        subject: envelope.subject ?? '', receivedAt, extract: null, fromLetterDomain: !fromBase,
        inReplyTo: envelope.inReplyTo?.trim() || null, headers: null, headersPending: false, headerGivenUp: false, letterMatch: null,
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
  // une réponse automatique, ni l'inverse. Après trois échecs pour le même message (compteur fourni par
  // l'appelant, cf. `headerFailures` du témoin), abandon définitif (`headerGivenUp`) : alerte de secours
  // habituelle, sans rattachement, plutôt qu'une attente sans fin.
  const needsHeaders = (c: MailWatchCandidate) => letterTargets.some(t => t.domains.some(d => domainsRelated(domainOf(c.fromAddress), d)));
  const giveUpOrDefer = (c: MailWatchCandidate) => {
    if ((headerRetryCounts[c.key] ?? 0) + 1 >= HEADER_RETRY_LIMIT) c.headerGivenUp = true;
    else c.headersPending = true;
  };
  for (const folder of new Set(selected.filter(needsHeaders).map(c => c.folder))) {
    let mailbox: { uidValidity: bigint } | undefined;
    try { mailbox = await client.mailboxOpen(folder, { readOnly: true }); }
    catch { for (const c of selected.filter(c => c.folder === folder && needsHeaders(c))) giveUpOrDefer(c); continue; }
    for (const candidate of selected.filter(c => c.folder === folder && needsHeaders(c))) {
      if (mailbox.uidValidity.toString() !== candidate.validity) { giveUpOrDefer(candidate); continue; }
      try {
        const m = await client.fetchOne(String(candidate.uid), { headers: REPLY_HEADER_FIELDS }, { uid: true });
        if (m && m.headers !== undefined) candidate.headers = parseHeaderBlock(m.headers);
        else giveUpOrDefer(candidate);
      } catch { giveUpOrDefer(candidate); }
    }
  }
  let lastAuthservId: string | null = null;
  for (const candidate of selected) {
    if (candidate.headersPending) continue;
    const senderHost = domainOf(candidate.fromAddress);
    // Abandon de la lecture des en-têtes (3e échec) : jamais un pur abandon (correction finale 2,
    // 06.10, item 1) — on rattache quand même par la seule enveloppe (objet, In-Reply-To, déjà lus
    // gratuitement, sans `References` ni en-têtes d'auto-détection) ; une correspondance devient
    // directement `unverified` (on ne peut juger ni l'authenticité ni l'automaticité sans en-têtes),
    // jamais `classifyReplyKind`. Sans correspondance, alerte de secours habituelle (boucle plus bas).
    if (candidate.headerGivenUp) {
      const matched = findLetterMatch(senderHost, candidate.subject, candidate.inReplyTo, null, letterTargets);
      if (matched) {
        const target = resolveLetterTarget(matched, letterTargets);
        // L'objet seul suffit à reconnaître un accusé d'absence : `auto` par l'objet, sinon `unverified`
        // (relecture ciblée du 06.10 : un « Out of office » ne doit pas arrêter la relance en silence).
        const kindFromSubject = classifyReplyKind(candidate.subject, matched.subject, EMPTY_REPLY_HEADERS, senderHost, trusted);
        candidate.letterMatch = { targetId: target.id, subject: target.subject, sentAt: target.sentAt, replyKind: kindFromSubject === 'auto' ? 'auto' : 'unverified' };
      }
      continue;
    }
    if (candidate.headers?.authenticationResults) {
      const id = extractAuthservId(candidate.headers.authenticationResults);
      if (id) lastAuthservId = id;
    }
    const matched = findLetterMatch(senderHost, candidate.subject, candidate.inReplyTo, candidate.headers?.references ?? null, letterTargets);
    if (!matched) continue;
    const target = resolveLetterTarget(matched, letterTargets);
    candidate.letterMatch = {
      targetId: target.id, subject: target.subject, sentAt: target.sentAt,
      replyKind: classifyReplyKind(candidate.subject, matched.subject, candidate.headers ?? EMPTY_REPLY_HEADERS, senderHost, trusted),
    };
  }
  return { matched: keys.size, fresh: fresh.length, selected, lastAuthservId };
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
    // Compteur interne de tentatives de lecture d'en-têtes ratées, par empreinte de message (jamais un
    // domaine ni un objet) ; borné, purgé dès la lecture réussie ou l'abandon au 3e échec.
    headerFailures: readHeaderFailures(raw.headerFailures),
  };
}
function readHeaderFailures(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] => /^[0-9a-f]{32}$/.test(entry[0]) && Number.isSafeInteger(entry[1]) && (entry[1] as number) > 0 && (entry[1] as number) < HEADER_RETRY_LIMIT);
  return Object.fromEntries(entries.slice(-MAX_HEADER_RETRY_ENTRIES));
}
function withHeaderFailure(map: Readonly<Record<string, number>>, key: string, value: number): Record<string, number> {
  const entries = Object.entries(map).filter(([k]) => k !== key);
  entries.push([key, value]);
  return Object.fromEntries(entries.slice(-MAX_HEADER_RETRY_ENTRIES));
}
function withoutHeaderFailure(map: Readonly<Record<string, number>>, key: string): Record<string, number> {
  const rest = { ...map };
  delete rest[key];
  return rest;
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

/**
 * Témoin SÉPARÉ (jamais mélangé à `operation_checks/mail_watch`, dont la forme exacte est figée par
 * un test existant) : dernier identifiant de serveur d'authentification vu dans un `Authentication-
 * Results` d'un domaine surveillé (correction finale 2, 06.10, item 2d) — un nom d'hôte, jamais une
 * adresse. Sert à Claude-Alain pour remplir `TRUSTED_AUTHSERV_IDS` avec l'identifiant réel observé
 * via Infomaniak.
 */
function recordAuthservIdSeen(db: Database.Database, authservId: string, now: number): void {
  db.prepare('INSERT INTO operation_checks(name,checked_at,details_json) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json')
    .run(AUTH_WITNESS_CHECK, now, JSON.stringify({ last_authserv_id_seen: authservId }));
}
/** Lecture privée (jamais exposée au bureau) : pour relever l'identifiant à ajouter à `TRUSTED_AUTHSERV_IDS`. */
export function readLastAuthservIdSeen(db: Database.Database = getDb()): string | null {
  const row = db.prepare('SELECT details_json FROM operation_checks WHERE name=?').get(AUTH_WITNESS_CHECK) as { details_json: string } | undefined;
  if (!row) return null;
  try {
    const raw = JSON.parse(row.details_json) as { last_authserv_id_seen?: unknown };
    return typeof raw.last_authserv_id_seen === 'string' ? raw.last_authserv_id_seen : null;
  } catch { return null; }
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
    headerFailures: previous?.headerFailures ?? {},
  };
  const finish = (patch: Partial<State>) => publicView(save(db, { ...state, ...patch }));
  const telegram = telegramConfig();
  if (telegram === 'missing') return finish({ status: 'inactive', code: 'not_configured' });
  if (telegram === 'invalid') return finish({ status: 'inactive', code: 'telegram_config_invalid' });
  const baseDomains = watchedDomains();
  // Lettres rattachables (sent, ou failed avec un essai réel — quel que soit l'état de leur réponse) :
  // élargissent la veille (domaines envoyés/tentés il y a moins de 120 jours) et servent de candidates
  // au rattachement (sans limite d'âge pour le rattachement lui-même : une liste de domaines par défaut
  // comme `finma.ch` reste surveillée indéfiniment).
  const letterTargets = rattachableLetters(db);
  const extraDomains = pendingLetterDomains(letterTargets, now);
  state.domains = [...new Set([...baseDomains, ...extraDomains])].length;
  let auth: { user: string; pass: string } | null;
  try { auth = deps.connection(); } catch { return finish({ status: 'error', code: 'mailbox_unreadable' }); }
  if (!auth) return finish({ status: 'inactive', code: 'mailbox_not_connected' });
  let found: Awaited<ReturnType<typeof collect>>;
  const seen = new Set(state.seen);
  try { found = await deps.withImap(auth, client => collect(client, baseDomains, extraDomains, now, seen, letterTargets, state.headerFailures, deps.trustedAuthservIds)); }
  catch { return finish({ status: 'error', code: 'imap_failed' }); }
  if (found.lastAuthservId) recordAuthservIdSeen(db, found.lastAuthservId, now);
  state = { ...state, matched: found.matched, pending: found.fresh };
  for (const candidate of found.selected) {
    if (candidate.headersPending) {
      // 1er ou 2e échec de lecture des en-têtes : ni alerte ni marquage `seen` ce passage-ci, le
      // message reste `pending` et sera relu au passage suivant (jamais classé à la légère). Le
      // compteur de tentatives, lui, est bien persisté tout de suite (3e échec = abandon).
      state = { ...state, headerFailures: withHeaderFailure(state.headerFailures, candidate.key, (state.headerFailures[candidate.key] ?? 0) + 1) };
      save(db, state);
      continue;
    }
    // `headerGivenUp` (3e échec) : alerte de secours habituelle, `letterMatch` est resté `null`
    // (jamais de rattachement sans en-têtes fiables) — texte et marquage `seen` identiques à un
    // message normal, pour ne jamais bloquer indéfiniment.
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
      headerFailures: withoutHeaderFailure(state.headerFailures, candidate.key),
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
