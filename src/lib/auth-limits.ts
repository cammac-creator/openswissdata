import { createHmac } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Context } from 'hono';
import { abuseIp, trustedRequestIp } from './request-ip.js';

export const AUTH_EMAIL_REFILL_MS = 12 * 60_000;
const MAX_IDENTITIES = { ip: 10_000, email: 200_000 } as const;
type Scope = 'ip' | 'email';
type Counter = { budget_ms: number; updated_at: number; accepted_at: number };
const policies = {
  ip: { capacity: 1, refillMs: 10_000, gapMs: 10_000 },
  email: { capacity: 5, refillMs: AUTH_EMAIL_REFILL_MS, gapMs: 60_000 },
} as const;

export class AuthLimitError extends Error {
  constructor(public readonly reason: 'configuration' | 'clock' | 'capacity_ip' | 'capacity_email') { super('auth_limit_unavailable'); }
}
let lastFailureLog = 0;
/** Un signal générique borné, sans message brut du fournisseur, adresse ni identifiant. */
export function reportAuthLimitFailure(error: unknown): void {
  const now = Date.now();
  if (lastFailureLog && now >= lastFailureLog && now - lastFailureLog < 60_000) return;
  lastFailureLog = now;
  const reason = error instanceof AuthLimitError ? error.reason : 'storage';
  console.warn(`[connexion] protection temporairement indisponible : ${reason}`);
}

/** Conserver le préfixe /64 des limites existantes, sans réduire l’adresse des visiteurs. */
export const normalizeAuthIp = abuseIp;
export function authRequestIp(c: Context): string {
  return abuseIp(trustedRequestIp(c) ?? '');
}

function identityKey(scope: Scope, identity: string): string {
  const secret = process.env.SESSION_SECRET;
  if ((process.env.RAILWAY_ENVIRONMENT_ID || !['development', 'test'].includes(process.env.NODE_ENV ?? '')) && (!secret || secret.length < 16)) throw new AuthLimitError('configuration');
  return createHmac('sha256', secret || 'osd-local-rate-limit-development-only')
    .update(`openswissdata:auth-limit:v1:${scope}:`)
    .update(scope === 'email' ? identity.trim().toLowerCase() : identity)
    .digest('hex');
}

/** Limite durable et atomique ; un refus ne prolonge pas le délai du destinataire. */
export function consumeAuthLimit(db: Database.Database, scope: Scope, identity: string, now = Date.now()): boolean {
  if (!Number.isSafeInteger(now) || now < 1_000_000_000_000) throw new AuthLimitError('clock');
  const key = identityKey(scope, identity), policy = policies[scope];
  return db.transaction(() => {
    // Borner le travail sous verrou : les prochaines requêtes ou le passage périodique poursuivent la purge.
    db.prepare('DELETE FROM auth_request_limits WHERE rowid IN (SELECT rowid FROM auth_request_limits WHERE expires_at <= ? ORDER BY expires_at LIMIT 500)').run(now);
    const row = db.prepare('SELECT budget_ms,updated_at,accepted_at FROM auth_request_limits WHERE scope=? AND identity_key=? AND expires_at>?')
      .get(scope, key, now) as Counter | undefined;
    if (row && now - row.accepted_at < policy.gapMs) return false;
    const available = row ? Math.min(policy.capacity * policy.refillMs, row.budget_ms + Math.max(0, now - row.updated_at)) : policy.capacity * policy.refillMs;
    if (!Number.isSafeInteger(available) || available < policy.refillMs) return false;
    if (!row && (db.prepare('SELECT COUNT(*) AS n FROM auth_request_limits WHERE scope=? AND expires_at>?').get(scope, now) as { n: number }).n >= MAX_IDENTITIES[scope]) {
      // Ne pas évincer une limite encore active : cela autoriserait son contournement.
      throw new AuthLimitError(scope === 'ip' ? 'capacity_ip' : 'capacity_email');
    }
    db.prepare(`INSERT INTO auth_request_limits(scope,identity_key,budget_ms,updated_at,accepted_at,expires_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(scope,identity_key) DO UPDATE SET budget_ms=excluded.budget_ms,updated_at=excluded.updated_at,accepted_at=excluded.accepted_at,expires_at=excluded.expires_at`)
      .run(scope, key, available - policy.refillMs, now, now, now + Math.max(policy.gapMs, policy.capacity * policy.refillMs - (available - policy.refillMs)));
    return true;
  }).immediate();
}
