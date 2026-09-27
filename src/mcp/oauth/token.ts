/**
 * POST /oauth/token — Token endpoint.
 *
 * Supports two grants:
 *   - authorization_code  (RFC 6749 §4.1.3 + RFC 7636 PKCE verify)
 *   - refresh_token       (RFC 6749 §6)
 *
 * For PKCE the verifier MUST be presented; we re-hash it (S256) and
 * constant-time-compare to the stored challenge.
 *
 * Client authentication: the spec accepts either Basic auth or body-form
 * `client_id` + `client_secret`. Both are accepted here. If the client was
 * registered with a non-empty client_secret_hash it MUST be presented (RFC
 * 7591 — confidential client). Public clients (no secret) are not supported
 * yet.
 */

import { Hono, type Context } from "hono";
import { timingSafeEqual } from "node:crypto";
import { isValidScope, parseScopes, serializeScopes } from './scopes.js';
import { getDb, SQLITE_BUSY_TIMEOUT_MS } from '../../lib/db.js';
import { readOAuthForm } from './input.js';
import {parseClientCredentials, rejectClientAuth} from './client-auth.js';
import {isRegisteredRedirectUri} from './redirects.js';
import {
  generateRandomToken,
  hashToken,
  isValidVerifier,
  pkceVerify,
} from "./crypto.js";
import {
  consumeAuthCode,
  findAuthCode,
  findClientById,
  findTokenByRefreshHash,
  insertToken,
  revokeTokenByHash,
  TTL,
} from "./store.js";

export const tokenRoute = new Hono();

function constantTimeStrEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

tokenRoute.post("/token", async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
  const body = await readOAuthForm(c);
  if (!body) return c.json({error: 'invalid_request'}, 400);

  const grant = String(body.grant_type ?? "");
  if (grant === "authorization_code" || grant === "refresh_token") {
    try {
      const db = getDb();
      try {
        // Aucun await ni appel réseau : validation, consommation et émission indivisibles.
        db.pragma('busy_timeout = 0');
        return db.transaction(() => grant === 'authorization_code' ? handleCode(c, body) : handleRefresh(c, body)).immediate();
      } finally {
        // Après COMMIT, un diagnostic ou un réglage ne doit pas masquer la paire émise.
        try { if (db.open) db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`); } catch (error) { reportTokenFailure(error, 'restore'); }
      }
    } catch (error) {
      reportTokenFailure(error);
      c.header('Retry-After', '1');
      return c.json({ error: 'temporarily_unavailable' }, 503);
    }
  }
  return c.json(
    { error: "unsupported_grant_type" },
    400,
  );
});

let lastFailureLog = 0;
function reportTokenFailure(error: unknown, reason?: 'restore'): void {
  try {
    const now = Date.now();
    if (lastFailureLog && now >= lastFailureLog && now - lastFailureLog < 60_000) return;
    lastFailureLog = now;
    console.warn(`[oauth] incident technique : ${reason ?? (error instanceof Error && 'code' in error && error.code === 'SQLITE_BUSY' ? 'busy' : 'storage')}`);
  } catch { /* Un diagnostic facultatif ne remplace pas le refus prudent. */ }
}

function handleCode(c: Context, body: Record<string, unknown>): Response {
  const code = String(body.code ?? "");
  const verifier = String(body.code_verifier ?? "");
  const redirect_uri = String(body.redirect_uri ?? "");

  const parsedAuth = parseClientCredentials(c.req.header('authorization'), body);
  if (!parsedAuth.ok) return rejectClientAuth(c, parsedAuth.error);
  const auth = parsedAuth.credentials;

  if (!code || !verifier) {
    return c.json({ error: "invalid_request", error_description: "code + code_verifier required" }, 400);
  }
  if (!isValidVerifier(verifier)) {
    return c.json({ error: "invalid_grant", error_description: "code_verifier malformed" }, 400);
  }

  const client = findClientById(auth.client_id);
  if (!client || client.revoked_at !== null) {
    return rejectClientAuth(c);
  }
  if (!constantTimeStrEq(hashToken(auth.client_secret), client.client_secret_hash)) {
    return rejectClientAuth(c);
  }

  const stored = findAuthCode(code);
  if (!stored) return c.json({ error: "invalid_grant", error_description: "code not found" }, 400);
  if (stored.used_at !== null) return c.json({ error: "invalid_grant", error_description: "code already used" }, 400);
  if (!Number.isSafeInteger(stored.expires_at) || stored.expires_at <= Date.now()) return c.json({ error: "invalid_grant", error_description: "code expired" }, 400);
  if (stored.client_id !== auth.client_id) return c.json({ error: "invalid_grant", error_description: "client_id mismatch" }, 400);
  if (stored.redirect_uri !== redirect_uri) return c.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
  if (stored.code_challenge_method !== 'S256' || !isRegisteredRedirectUri(client.client_id, redirect_uri)) return c.json({error: 'invalid_grant'}, 400);
  if (!pkceVerify(verifier, stored.code_challenge, stored.code_challenge_method)) {
    return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
  }

  const allowedScopes = parseScopes(client.scopes);
  const grantedScope = serializeScopes(parseScopes(stored.scope).filter(scope => allowedScopes.includes(scope)));
  if (!grantedScope || !consumeAuthCode(code)) return c.json({ error: 'invalid_grant' }, 400);

  const access = generateRandomToken();
  const refresh = generateRandomToken();
  insertToken({
    client_id: auth.client_id,
    access_token_plain: access,
    refresh_token_plain: refresh,
    scope: grantedScope,
  });

  return c.json({
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.floor(TTL.ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refresh,
    scope: grantedScope,
  });
}

function handleRefresh(c: Context, body: Record<string, unknown>): Response {
  const refresh = String(body.refresh_token ?? "");
  const parsedAuth = parseClientCredentials(c.req.header('authorization'), body);
  if (!parsedAuth.ok) return rejectClientAuth(c, parsedAuth.error);
  const auth = parsedAuth.credentials;
  if (!refresh) return c.json({ error: "invalid_request", error_description: "refresh_token required" }, 400);

  const client = findClientById(auth.client_id);
  if (!client || client.revoked_at !== null) {
    return rejectClientAuth(c);
  }
  if (!constantTimeStrEq(hashToken(auth.client_secret), client.client_secret_hash)) {
    return rejectClientAuth(c);
  }

  const refreshHash = hashToken(refresh);
  const existing = findTokenByRefreshHash(refreshHash);
  if (!existing) return c.json({ error: "invalid_grant", error_description: "refresh_token unknown" }, 400);
  if (existing.client_id !== auth.client_id) {
    return c.json({ error: "invalid_grant", error_description: "client mismatch" }, 400);
  }
  if (!Number.isSafeInteger(existing.refresh_expires_at) || existing.refresh_expires_at! <= Date.now()) {
    return c.json({ error: "invalid_grant", error_description: "refresh_token expired" }, 400);
  }

  // Le renouvellement peut réduire une portée, jamais ajouter des droits au jeton d’origine.
  const originalScopes = parseScopes(existing.scope), allowedScopes = parseScopes(client.scopes);
  let nextScopes = originalScopes.filter(scope => allowedScopes.includes(scope));
  if (body.scope !== undefined) {
    if (typeof body.scope !== 'string' || body.scope.length > 1024) return c.json({ error: 'invalid_scope' }, 400);
    const requested = body.scope.trim().split(/\s+/);
    if (requested.some(scope => !isValidScope(scope) || !originalScopes.includes(scope) || !allowedScopes.includes(scope))) {
      return c.json({ error: 'invalid_scope' }, 400);
    }
    nextScopes = parseScopes(body.scope);
  }
  if (!nextScopes.length) return c.json({ error: 'invalid_scope' }, 400);
  const grantedScope = serializeScopes(nextScopes);

  // Rotation dans la transaction d’émission : un échec annule aussi la révocation.
  if (!revokeTokenByHash(refreshHash, auth.client_id)) return c.json({ error: 'invalid_grant' }, 400);

  const newAccess = generateRandomToken();
  const newRefresh = generateRandomToken();
  insertToken({
    client_id: auth.client_id,
    access_token_plain: newAccess,
    refresh_token_plain: newRefresh,
    scope: grantedScope,
  });

  return c.json({
    access_token: newAccess,
    token_type: "Bearer",
    expires_in: Math.floor(TTL.ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: newRefresh,
    scope: grantedScope,
  });
}
