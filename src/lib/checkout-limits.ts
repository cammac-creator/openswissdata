import { createHmac } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Context } from 'hono';
import { abuseIp, trustedRequestIp } from './request-ip.js';

export const CHECKOUT_GAP_MS = 6_000;
export const CHECKOUT_MAX_IDENTITIES = 10_000;
const MIN_TIME = 1_000_000_000_000, MAX_TIME = 8_640_000_000_000_000;
type Counter = { accepted_at: number; expires_at: number };
export type CheckoutLimit = { allowed: true } | { allowed: false; retryAfter: number };
export class CheckoutLimitError extends Error {
  constructor(public readonly reason: 'configuration' | 'clock' | 'capacity') { super('checkout_limit_unavailable'); }
}

export function checkoutRequestIp(c: Context): string {
  return abuseIp(trustedRequestIp(c) ?? '');
}
function identityKey(identity: string): string {
  const secret = process.env.SESSION_SECRET;
  if ((process.env.RAILWAY_ENVIRONMENT_ID || !['development', 'test'].includes(process.env.NODE_ENV ?? '')) && (!secret || secret.length < 16)) {
    throw new CheckoutLimitError('configuration');
  }
  return createHmac('sha256', secret || 'osd-local-rate-limit-development-only')
    .update('openswissdata:checkout-limit:v1:ip:').update(identity).digest('hex');
}

/** Même limite pour formulaire/API et toutes les connexions SQLite ; refus sans prolongation. */
export function consumeCheckoutLimit(db: Database.Database, identity: string, now = Date.now()): CheckoutLimit {
  if (!Number.isSafeInteger(now) || now < MIN_TIME || now > MAX_TIME - CHECKOUT_GAP_MS) throw new CheckoutLimitError('clock');
  const key = identityKey(identity), timeout = db.pragma('busy_timeout', { simple: true }) as number;
  // La protection publique ne doit pas immobiliser le serveur pendant une écriture concurrente.
  try {
    db.pragma('busy_timeout = 0');
    return db.transaction((): CheckoutLimit => {
      const row = db.prepare('SELECT accepted_at,expires_at FROM checkout_request_limits WHERE identity_key=?').get(key) as Counter | undefined;
      if (row && (!Number.isSafeInteger(row.accepted_at) || row.accepted_at < MIN_TIME || row.accepted_at > now ||
        !Number.isSafeInteger(row.expires_at) || row.expires_at !== row.accepted_at + CHECKOUT_GAP_MS)) throw new CheckoutLimitError('clock');
      if (row && row.expires_at > now) return { allowed: false, retryAfter: Math.ceil((row.expires_at - now) / 1000) };
      // Purge bornée, uniquement de dates cohérentes ; ne pas évincer une protection active.
      db.prepare(`DELETE FROM checkout_request_limits WHERE rowid IN (
        SELECT rowid FROM checkout_request_limits WHERE expires_at <= ? AND typeof(accepted_at)='integer'
        AND typeof(expires_at)='integer' AND accepted_at >= ? AND expires_at=accepted_at+?
        ORDER BY expires_at LIMIT 500)`).run(now, MIN_TIME, CHECKOUT_GAP_MS);
      const exists = db.prepare('SELECT 1 FROM checkout_request_limits WHERE identity_key=?').get(key);
      if (!exists && (db.prepare('SELECT COUNT(*) AS n FROM checkout_request_limits').get() as { n: number }).n >= CHECKOUT_MAX_IDENTITIES) throw new CheckoutLimitError('capacity');
      db.prepare(`INSERT INTO checkout_request_limits(identity_key,accepted_at,expires_at) VALUES(?,?,?)
        ON CONFLICT(identity_key) DO UPDATE SET accepted_at=excluded.accepted_at,expires_at=excluded.expires_at`).run(key, now, now + CHECKOUT_GAP_MS);
      return { allowed: true };
    }).immediate();
  } finally { if (db.open) db.pragma(`busy_timeout = ${timeout}`); }
}

let lastFailureLog = 0;
/** Diagnostic borné et fermé ; sa panne ne remplace jamais le refus prudent de la requête. */
export function reportCheckoutLimitFailure(error: unknown): void {
  try {
    const now = Date.now();
    if (lastFailureLog && now >= lastFailureLog && now - lastFailureLog < 60_000) return;
    lastFailureLog = now;
    console.warn(`[paiement] protection temporairement indisponible : ${error instanceof CheckoutLimitError ? error.reason : error instanceof Error && 'code' in error && error.code === 'SQLITE_BUSY' ? 'busy' : 'storage'}`);
  } catch { /* La réponse 503 reste prioritaire sur le journal facultatif. */ }
}
