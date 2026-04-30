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

import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import {
  generateRandomToken,
  hashToken,
  isValidVerifier,
  pkceVerify,
} from "./crypto.js";
import {
  consumeAuthCode,
  findClientById,
  findTokenByRefreshHash,
  insertToken,
  revokeTokenByHash,
  TTL,
} from "./store.js";

export const tokenRoute = new Hono();

interface ParsedClientAuth {
  client_id: string;
  client_secret: string;
}

function parseClientAuth(c: {
  req: { header: (n: string) => string | undefined };
}, body: Record<string, unknown>): ParsedClientAuth | null {
  // Basic auth first.
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  if (authHeader?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep > 0) {
        return {
          client_id: decoded.slice(0, sep),
          client_secret: decoded.slice(sep + 1),
        };
      }
    } catch {
      /* fall through */
    }
  }
  const cid = body.client_id;
  const sec = body.client_secret;
  if (typeof cid === "string" && typeof sec === "string") {
    return { client_id: cid, client_secret: sec };
  }
  return null;
}

function constantTimeStrEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

tokenRoute.post("/token", async (c) => {
  // Body can be url-encoded form OR JSON. parseBody handles both via Hono.
  const body = (await c.req.parseBody()) as Record<string, unknown>;

  const grant = String(body.grant_type ?? "");
  if (grant === "authorization_code") return handleCode(c, body);
  if (grant === "refresh_token") return handleRefresh(c, body);
  return c.json(
    { error: "unsupported_grant_type", error_description: `grant_type=${grant} not supported` },
    400,
  );
});

async function handleCode(c: any, body: Record<string, unknown>) {
  const code = String(body.code ?? "");
  const verifier = String(body.code_verifier ?? "");
  const redirect_uri = String(body.redirect_uri ?? "");

  const auth = parseClientAuth(c, body);
  if (!auth) return c.json({ error: "invalid_client", error_description: "client credentials missing" }, 401);

  if (!code || !verifier) {
    return c.json({ error: "invalid_request", error_description: "code + code_verifier required" }, 400);
  }
  if (!isValidVerifier(verifier)) {
    return c.json({ error: "invalid_grant", error_description: "code_verifier malformed" }, 400);
  }

  const client = findClientById(auth.client_id);
  if (!client || client.revoked_at) {
    return c.json({ error: "invalid_client" }, 401);
  }
  if (!constantTimeStrEq(hashToken(auth.client_secret), client.client_secret_hash)) {
    return c.json({ error: "invalid_client", error_description: "bad client_secret" }, 401);
  }

  const stored = consumeAuthCode(code);
  if (!stored) return c.json({ error: "invalid_grant", error_description: "code not found" }, 400);
  if (stored.used_at) return c.json({ error: "invalid_grant", error_description: "code already used" }, 400);
  if (stored.expires_at < Date.now()) return c.json({ error: "invalid_grant", error_description: "code expired" }, 400);
  if (stored.client_id !== auth.client_id) return c.json({ error: "invalid_grant", error_description: "client_id mismatch" }, 400);
  if (stored.redirect_uri !== redirect_uri) return c.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
  if (!pkceVerify(verifier, stored.code_challenge, stored.code_challenge_method)) {
    return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
  }

  const access = generateRandomToken();
  const refresh = generateRandomToken();
  insertToken({
    client_id: auth.client_id,
    access_token_plain: access,
    refresh_token_plain: refresh,
    scope: stored.scope,
  });

  return c.json({
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.floor(TTL.ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refresh,
    scope: stored.scope,
  });
}

async function handleRefresh(c: any, body: Record<string, unknown>) {
  const refresh = String(body.refresh_token ?? "");
  const auth = parseClientAuth(c, body);
  if (!auth) return c.json({ error: "invalid_client", error_description: "client credentials missing" }, 401);
  if (!refresh) return c.json({ error: "invalid_request", error_description: "refresh_token required" }, 400);

  const client = findClientById(auth.client_id);
  if (!client || client.revoked_at) {
    return c.json({ error: "invalid_client" }, 401);
  }
  if (!constantTimeStrEq(hashToken(auth.client_secret), client.client_secret_hash)) {
    return c.json({ error: "invalid_client" }, 401);
  }

  const refreshHash = hashToken(refresh);
  const existing = findTokenByRefreshHash(refreshHash);
  if (!existing) return c.json({ error: "invalid_grant", error_description: "refresh_token unknown" }, 400);
  if (existing.client_id !== auth.client_id) {
    return c.json({ error: "invalid_grant", error_description: "client mismatch" }, 400);
  }
  if (existing.refresh_expires_at && existing.refresh_expires_at < Date.now()) {
    return c.json({ error: "invalid_grant", error_description: "refresh_token expired" }, 400);
  }

  // Rotate refresh token (recommended in OAuth 2.1).
  revokeTokenByHash(refreshHash);

  const newAccess = generateRandomToken();
  const newRefresh = generateRandomToken();
  insertToken({
    client_id: auth.client_id,
    access_token_plain: newAccess,
    refresh_token_plain: newRefresh,
    scope: existing.scope,
  });

  return c.json({
    access_token: newAccess,
    token_type: "Bearer",
    expires_in: Math.floor(TTL.ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: newRefresh,
    scope: existing.scope,
  });
}
