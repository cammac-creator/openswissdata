// Inscriptions « être prévenu » (24.10.2026, texte de protection des données validé par Claude-Alain) :
// demande → lien de confirmation à usage unique (48 h) → inscription confirmée, ou effacement.
// Chaque fonction de ce module est synchrone et sans réseau : l'envoi du mail se fait après la transaction.
// Aucune adresse dans une erreur, un journal ou une valeur de retour destinée à une réponse HTTP.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { generateToken, isValidTokenFormat } from './tokens.js';
import { recordAnnouncementErasures } from './announcement-erasures.js';

export const ANNOUNCEMENT_SUBJECTS = ['finma-historique'] as const;
export type AnnouncementSubject = (typeof ANNOUNCEMENT_SUBJECTS)[number];
export const ANNOUNCEMENT_LANGS = ['fr', 'de', 'en'] as const;
export type AnnouncementLang = (typeof ANNOUNCEMENT_LANGS)[number];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Validité du lien de confirmation. */
export const CONFIRMATION_TTL_MS = 48 * HOUR;
/** Une demande non confirmée est effacée 7 jours après la première demande du cycle. */
export const PENDING_RETENTION_MS = 7 * DAY;
/** Au plus un mail par jour pour une même demande en attente. */
export const RESEND_INTERVAL_MS = 24 * HOUR;
/** Dernier renvoi possible : le nouveau lien doit rester valable 48 h avant la purge des 7 jours. */
export const LAST_RESEND_AGE_MS = PENDING_RETENTION_MS - CONFIRMATION_TTL_MS;
/**
 * Plafond commun de mails de confirmation sur 24 h glissantes, toutes adresses confondues. Le formulaire peut sinon
 * servir à faire écrire notre domaine à des adresses choisies par un tiers, et le compte Resend est partagé avec les
 * livraisons des achats : ce plafond protège leur quota. Au-delà, même réponse, aucun mail, rien d'enregistré.
 */
export const DAILY_CONFIRMATION_CAP = 50;

export class AnnouncementError extends Error {
  constructor(readonly code: 'configuration' | 'storage') { super(`announcement_${code}`); }
}

/** Adresse normalisée gardée en base : espaces retirés, minuscules (adresse ASCII validée en amont). */
export const normalizeAnnouncementEmail = (value: string) => value.trim().toLowerCase();
/** Empreinte SHA-256 du jeton : seule forme conservée, comparée par égalité d'empreinte. */
export const announcementTokenFingerprint = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

type Row = { id: number; lang: AnnouncementLang; requested_at: number; confirmed_at: number | null; token_hash: string | null; token_expires_at: number | null };

/** Envoi à faire après la transaction ; `previous` permet d'annuler proprement si le mail ne part pas. */
export type AnnouncementDelivery = {
  kind: 'new' | 'resend';
  id: number;
  email: string;
  lang: AnnouncementLang;
  subject: AnnouncementSubject;
  requestedAt: number;
  token: string;
  tokenHash: string;
  previous: { lang: AnnouncementLang; tokenHash: string | null; expiresAt: number | null } | null;
};

/**
 * Enregistre une demande et dit s'il faut envoyer un mail (`'capped'` : plafond commun atteint, rien n'est fait).
 * Même traitement apparent pour l'appelant :
 * - adresse inconnue (ou demande échue non encore purgée) : nouvelle demande, un mail ;
 * - demande en attente : un nouveau lien au plus toutes les 24 h et seulement pendant les 5 premiers
 *   jours (le lien remplace le précédent) ; sinon rien ;
 * - inscription déjà confirmée : rien, aucun mail.
 */
export function registerAnnouncementRequest(
  db: Database.Database,
  input: { email: string; lang: AnnouncementLang; subject: AnnouncementSubject },
  now = Date.now(),
): AnnouncementDelivery | 'capped' | null {
  if (!Number.isSafeInteger(now) || now < 1_000_000_000_000) throw new AnnouncementError('configuration');
  const email = normalizeAnnouncementEmail(input.email);
  try {
    return db.transaction((): AnnouncementDelivery | 'capped' | null => {
      const row = db.prepare('SELECT id,lang,requested_at,confirmed_at,token_hash,token_expires_at FROM announcement_subscriptions WHERE email=? AND subject=?')
        .get(email, input.subject) as Row | undefined;
      if (row && row.confirmed_at !== null) return null;
      if (row && now - row.requested_at < PENDING_RETENTION_MS) {
        const lastSent = row.token_expires_at === null ? null : row.token_expires_at - CONFIRMATION_TTL_MS;
        if (lastSent !== null && now - lastSent < RESEND_INTERVAL_MS) return null;
        if (now - row.requested_at > LAST_RESEND_AGE_MS) return null;
      }
      // Un lien émis depuis moins de 24 h = un mail parti (le renvoi n'a lieu qu'une fois par 24 h et par demande).
      const recent = db.prepare('SELECT COUNT(*) AS n FROM announcement_subscriptions WHERE confirmed_at IS NULL AND token_expires_at > ?')
        .get(now + CONFIRMATION_TTL_MS - RESEND_INTERVAL_MS) as { n: number };
      if (recent.n >= DAILY_CONFIRMATION_CAP) return 'capped';
      const token = generateToken(), tokenHash = announcementTokenFingerprint(token), expiresAt = now + CONFIRMATION_TTL_MS;
      const base = { email, lang: input.lang, subject: input.subject, token, tokenHash };
      if (!row) {
        const info = db.prepare('INSERT INTO announcement_subscriptions(email,lang,subject,requested_at,token_hash,token_expires_at) VALUES(?,?,?,?,?,?)')
          .run(email, input.lang, input.subject, now, tokenHash, expiresAt);
        return { ...base, kind: 'new', id: Number(info.lastInsertRowid), requestedAt: now, previous: null };
      }
      if (now - row.requested_at >= PENDING_RETENTION_MS) {
        // Demande échue que le nettoyage n'a pas encore retirée : elle repart comme une demande neuve.
        const reset = db.prepare('UPDATE announcement_subscriptions SET lang=?,requested_at=?,token_hash=?,token_expires_at=? WHERE id=? AND confirmed_at IS NULL')
          .run(input.lang, now, tokenHash, expiresAt, row.id);
        if (reset.changes !== 1) throw new AnnouncementError('storage');
        return { ...base, kind: 'new', id: row.id, requestedAt: now, previous: null };
      }
      const update = db.prepare('UPDATE announcement_subscriptions SET lang=?,token_hash=?,token_expires_at=? WHERE id=? AND confirmed_at IS NULL')
        .run(input.lang, tokenHash, expiresAt, row.id);
      if (update.changes !== 1) throw new AnnouncementError('storage');
      return { ...base, kind: 'resend', id: row.id, requestedAt: row.requested_at, previous: { lang: row.lang, tokenHash: row.token_hash, expiresAt: row.token_expires_at } };
    }).immediate();
  } catch (error) {
    if (error instanceof AnnouncementError) throw error;
    throw new AnnouncementError('storage');
  }
}

/**
 * Le mail n'est pas parti : rien n'est retenu pour une demande neuve (effacement inscrit au registre), l'ancien lien
 * revient pour un renvoi. Renvoie true si une ligne a été effacée (la copie du registre est alors à synchroniser).
 */
export function abandonAnnouncementDelivery(db: Database.Database, delivery: AnnouncementDelivery, now = Date.now()): boolean {
  if (delivery.kind === 'new' || !delivery.previous) {
    return db.transaction(() => {
      const done = db.prepare('DELETE FROM announcement_subscriptions WHERE id=? AND token_hash=? AND confirmed_at IS NULL').run(delivery.id, delivery.tokenHash);
      if (done.changes) recordAnnouncementErasures(db, [delivery.id], Math.max(now, delivery.requestedAt));
      return done.changes > 0;
    }).immediate();
  }
  db.prepare('UPDATE announcement_subscriptions SET lang=?,token_hash=?,token_expires_at=? WHERE id=? AND token_hash=? AND confirmed_at IS NULL')
    .run(delivery.previous.lang, delivery.previous.tokenHash, delivery.previous.expiresAt, delivery.id, delivery.tokenHash);
  return false;
}

type Pending = { id: number; lang: AnnouncementLang; requested_at: number; token_expires_at: number };
function pendingByToken(db: Database.Database, token: string): Pending | undefined {
  if (!isValidTokenFormat(token)) return undefined;
  return db.prepare('SELECT id,lang,requested_at,token_expires_at FROM announcement_subscriptions WHERE token_hash=? AND confirmed_at IS NULL')
    .get(announcementTokenFingerprint(token)) as Pending | undefined;
}

/** Lecture seule, pour la page du lien (GET/HEAD) : aucune écriture, aucune confirmation. */
export function inspectAnnouncementConfirmation(db: Database.Database, token: string, now = Date.now()): { valid: boolean; lang: AnnouncementLang | null } {
  const row = pendingByToken(db, token);
  if (!row) return { valid: false, lang: null };
  return { valid: row.token_expires_at > now, lang: row.lang };
}

/** Confirmation par le bouton (POST) : une seule fois, avant l'échéance ; le jeton est effacé dans la même écriture. */
export function confirmAnnouncement(db: Database.Database, token: string, now = Date.now()):
  { confirmed: true; lang: AnnouncementLang; id: number; requestedAt: number } | { confirmed: false; lang: AnnouncementLang | null } {
  if (!isValidTokenFormat(token)) return { confirmed: false, lang: null };
  const hash = announcementTokenFingerprint(token);
  return db.transaction(() => {
    const row = pendingByToken(db, token);
    if (!row) return { confirmed: false as const, lang: null };
    if (row.token_expires_at <= now) return { confirmed: false as const, lang: row.lang };
    const done = db.prepare('UPDATE announcement_subscriptions SET confirmed_at=?,token_hash=NULL,token_expires_at=NULL WHERE id=? AND token_hash=? AND confirmed_at IS NULL AND token_expires_at>?')
      .run(now, row.id, hash, now);
    if (done.changes !== 1) return { confirmed: false as const, lang: row.lang };
    return { confirmed: true as const, lang: row.lang, id: row.id, requestedAt: row.requested_at };
  }).immediate();
}

// --- Lien de désinscription -------------------------------------------------------------------------
// Il doit rester valable tant que l'inscription existe (jusqu'à 12 mois après l'annonce), alors que le jeton
// de confirmation meurt à la confirmation. Rien n'est stocké : identifiant interne et date de demande sont
// scellés (AES-256-GCM, clé dérivée de SESSION_SECRET) ; le lien ne révèle ni l'identifiant ni la date, et
// toute modification le rend illisible. Changer SESSION_SECRET rend les anciens liens inutilisables.
const UNSUBSCRIBE_DOMAIN = 'openswissdata:announcement-unsubscribe:v1';
const SEALED_BYTES = 12 + 16 + 16;
const SEALED_LENGTH = Math.ceil(SEALED_BYTES * 4 / 3);

function unsubscribeKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new AnnouncementError('configuration');
  return createHmac('sha256', secret).update(UNSUBSCRIBE_DOMAIN).digest();
}

export type UnsubscribeReference = { id: number; requestedAt: number };

export function sealUnsubscribeReference(reference: UnsubscribeReference): string {
  if (!Number.isSafeInteger(reference.id) || reference.id <= 0 || !Number.isSafeInteger(reference.requestedAt) || reference.requestedAt < 1_000_000_000_000) {
    throw new AnnouncementError('configuration');
  }
  const clear = Buffer.alloc(16);
  clear.writeBigUInt64BE(BigInt(reference.id), 0);
  clear.writeBigUInt64BE(BigInt(reference.requestedAt), 8);
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', unsubscribeKey(), iv);
  cipher.setAAD(Buffer.from(UNSUBSCRIBE_DOMAIN));
  const sealed = Buffer.concat([cipher.update(clear), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64url');
}

/** Null pour tout lien illisible ou modifié ; une configuration absente lève une erreur (jamais « lien invalide »). */
export function openUnsubscribeReference(value: string): UnsubscribeReference | null {
  const key = unsubscribeKey();
  if (typeof value !== 'string' || value.length !== SEALED_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.length !== SEALED_BYTES || bytes.toString('base64url') !== value) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(UNSUBSCRIBE_DOMAIN));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const clear = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    const id = Number(clear.readBigUInt64BE(0)), requestedAt = Number(clear.readBigUInt64BE(8));
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(requestedAt) || requestedAt < 1_000_000_000_000) return null;
    return { id, requestedAt };
  } catch { return null; }
}

/** Lecture seule, pour la page de désinscription (GET/HEAD). */
export function inspectAnnouncementSubscription(db: Database.Database, reference: UnsubscribeReference): { lang: AnnouncementLang } | null {
  return (db.prepare('SELECT lang FROM announcement_subscriptions WHERE id=? AND requested_at=?').get(reference.id, reference.requestedAt) as { lang: AnnouncementLang } | undefined) ?? null;
}

/**
 * Désinscription : la ligne disparaît immédiatement. Seuls son identifiant interne et la date de l'effacement entrent au
 * registre (même transaction), pour qu'une restauration ne la ramène pas.
 */
export function eraseAnnouncementSubscription(db: Database.Database, reference: UnsubscribeReference, now = Date.now()): { erased: boolean; lang: AnnouncementLang | null } {
  return db.transaction(() => {
    const row = inspectAnnouncementSubscription(db, reference);
    if (!row) return { erased: false, lang: null };
    const done = db.prepare('DELETE FROM announcement_subscriptions WHERE id=? AND requested_at=?').run(reference.id, reference.requestedAt);
    if (done.changes === 1) recordAnnouncementErasures(db, [reference.id], Math.max(now, reference.requestedAt));
    return { erased: done.changes === 1, lang: row.lang };
  }).immediate();
}

/**
 * Nombre d'inscriptions confirmées par sujet, sous des clés fixes (jamais un sujet lu en base, jamais une adresse).
 * Les adresses de ADMIN_EMAILS et CRM_INTERNAL_EMAILS (déjà normalisées par l'appelant) ne comptent pas.
 */
export function countConfirmedAnnouncements(db: Database.Database, excludedEmails: readonly string[] = []): Record<AnnouncementSubject, number> {
  const counts = Object.fromEntries(ANNOUNCEMENT_SUBJECTS.map(subject => [subject, 0])) as Record<AnnouncementSubject, number>;
  const exclusion = excludedEmails.length ? ` AND email NOT IN (${excludedEmails.map(() => '?').join(',')})` : '';
  const rows = db.prepare(`SELECT subject, COUNT(*) AS n FROM announcement_subscriptions WHERE confirmed_at IS NOT NULL${exclusion} GROUP BY subject`)
    .all(...excludedEmails) as Array<{ subject: string; n: number }>;
  for (const row of rows) {
    if ((ANNOUNCEMENT_SUBJECTS as readonly string[]).includes(row.subject) && Number.isSafeInteger(row.n)) counts[row.subject as AnnouncementSubject] = row.n;
  }
  return counts;
}
