import {getDb, SQLITE_BUSY_TIMEOUT_MS} from './db.js';
import {generateToken, isValidTokenFormat} from './tokens.js';
import {createHash} from 'node:crypto';
import {sessionCookieName} from './session-cookie.js';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export type LoginReturn = 'account' | 'admin';
type SessionRow = {customer_id: number; email: string; locale: string; purpose: string;
  return_to: string; created_at: number; expires_at: number};

/** Un cookie complet, unique et de forme exacte ; aucun préfixe ni premier doublon privilégié. */
export function uniqueTokenCookie(cookie: string | undefined, name: string): string | null {
  if (!cookie || cookie.length > 16384) return null;
  const values: string[] = [];
  for (const part of cookie.split(';')) {
    // Seuls espace et tabulation appartiennent aux blancs syntaxiques d'un cookie.
    const value = part.replace(/^[ \t]+|[ \t]+$/g, '');
    const split = value.indexOf('=');
    const cookieName = split < 0 ? value : value.slice(0, split).replace(/^[ \t]+|[ \t]+$/g, '');
    if (cookieName !== name && cookieName.trim().toLowerCase() === name.toLowerCase()) return null;
    if (cookieName === name) values.push(split < 0 ? '' : value.slice(split + 1));
  }
  return values.length === 1 && isValidTokenFormat(values[0]) ? values[0] : null;
}
export const accountSessionToken = (cookie: string | undefined) => uniqueTokenCookie(cookie, sessionCookieName());

/** Compatibilité limitée aux deux durées exactes émises par l'ancien code. */
function purpose(row: SessionRow): string {
  if (row.purpose !== 'legacy') return row.purpose;
  const duration = row.expires_at - row.created_at;
  return duration === MAGIC_LINK_TTL_MS ? 'magic_link' : duration === SESSION_TTL_MS ? 'session' : 'unknown';
}
function current(row: SessionRow, now: number): boolean {
  return Number.isSafeInteger(row.created_at) && Number.isSafeInteger(row.expires_at) &&
    row.created_at <= now && row.expires_at > now;
}
function find(token: string): SessionRow | undefined {
  return getDb().prepare(`SELECT s.customer_id,s.purpose,s.return_to,s.created_at,s.expires_at,c.email,c.locale
    FROM sessions s JOIN customers c ON c.id=s.customer_id WHERE s.token=?`).get(token) as SessionRow | undefined;
}

export function readAccountSession(cookie: string | undefined): {customer_id: number; email: string} | null {
  return sessionForToken(accountSessionToken(cookie));
}

function sessionForToken(token: string | null): {customer_id: number; email: string} | null {
  if (!token) return null;
  const row = find(token);
  return row && current(row, Date.now()) && purpose(row) === 'session'
    ? {customer_id: row.customer_id, email: row.email} : null;
}

export function accountSessionSnapshot(cookie: string | undefined) {
  const token = accountSessionToken(cookie), session = sessionForToken(token);
  return {session, token, fingerprint: session && token ? createHash('sha256').update(token).digest('hex') : null};
}

/** Lecture seule : les prévisualisations de mails ne consomment aucun lien. */
export function inspectMagicLink(token: string, legacyReturn: LoginReturn) {
  if (!isValidTokenFormat(token)) return null;
  const row = find(token);
  if (!row || !current(row, Date.now()) || purpose(row) !== 'magic_link') return null;
  return {customerId: row.customer_id, email: row.email, locale: row.locale, expiresAt: row.expires_at,
    target: row.purpose === 'legacy' ? legacyReturn : row.return_to === 'admin' ? 'admin' as const : 'account' as const};
}

export class LoginContextChanged extends Error {
  constructor() { super('login_context_changed'); }
}

/** Aucune attente de verrou, aucun réseau, et délai restauré même sur exception. */
export function sessionWrite<T>(work: () => T): T {
  const db = getDb();
  try {
    db.pragma('busy_timeout = 0');
    return db.transaction(work).immediate();
  } finally {
    try { if (db.open) db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`); }
    catch { console.warn('[connexion] délai SQLite non restauré'); }
  }
}

export function issueMagicLink(customerId: number, target: LoginReturn): string {
  return sessionWrite(() => {
    const token = generateToken();
    const now = Date.now();
    const inserted = getDb().prepare(`INSERT INTO sessions(token,customer_id,expires_at,created_at,purpose,return_to)
      VALUES(?,?,?,?,'magic_link',?)`).run(token, customerId, now + MAGIC_LINK_TTL_MS, now, target);
    if (inserted.changes !== 1) throw new Error('login_link_not_created');
    return token;
  });
}

export function confirmMagicLink(token: string, target: LoginReturn, cookie: string | undefined,
  expected: {session: string | null; customerId: number; expiresAt: number}) {
  return sessionWrite(() => {
    const now = Date.now();
    if (expected.expiresAt <= now) return null;
    const current = accountSessionSnapshot(cookie);
    if (current.fingerprint !== expected.session) throw new LoginContextChanged();
    const row = inspectMagicLink(token, target);
    if (!row || row.customerId !== expected.customerId || row.target !== target) return null;
    const db = getDb();
    const removed = db.prepare('DELETE FROM sessions WHERE token=? AND expires_at>?').run(token, now);
    if (removed.changes !== 1) throw new Error('login_link_not_consumed');
    // Seule la session authentifiée remplacée est fermée ; les autres appareils restent ouverts.
    if (current.session) {
      const closed = db.prepare('DELETE FROM sessions WHERE token=? AND customer_id=?')
        .run(current.token, current.session.customer_id);
      if (closed.changes !== 1) throw new Error('previous_session_not_revoked');
    }
    const sessionToken = generateToken();
    const inserted = db.prepare(`INSERT INTO sessions(token,customer_id,expires_at,created_at,purpose,return_to)
      VALUES(?,?,?,?,'session','account')`).run(sessionToken, row.customerId, now + SESSION_TTL_MS, now);
    if (inserted.changes !== 1) throw new Error('account_session_not_created');
    return {token: sessionToken, locale: row.locale, target: row.target};
  });
}

export function deleteAccountSession(cookie: string | undefined): void {
  const token = accountSessionToken(cookie);
  if (!token) return;
  sessionWrite(() => {
    const row = find(token);
    // Un lien reçu par email ne devient pas révocable en le plaçant dans un cookie.
    if (row && purpose(row) === 'session') {
      const removed = getDb().prepare('DELETE FROM sessions WHERE token=?').run(token);
      if (removed.changes !== 1) throw new Error('account_session_not_revoked');
    }
  });
}
