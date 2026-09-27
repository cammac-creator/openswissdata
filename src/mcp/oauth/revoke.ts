/**
 * POST /oauth/revoke — RFC 7009.
 *
 * Body (form):
 *   token=<access_or_refresh>
 *   token_type_hint=access_token|refresh_token   (optional, ignored — we hash
 *                                                  and try both indexes)
 *
 * Per spec the response is 200 even when the token is unknown — to avoid
 * disclosing token validity. We still authenticate the client.
 */

import { Hono } from "hono";
import { hashToken } from "./crypto.js";
import { findClientById, revokeTokenByHash } from "./store.js";
import { timingSafeEqual } from "node:crypto";
import { readOAuthForm } from './input.js';
import {parseClientCredentials, rejectClientAuth} from './client-auth.js';

export const revokeRoute = new Hono();

function constantTimeStrEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

revokeRoute.post("/revoke", async (c) => {
  c.header('Cache-Control', 'no-store');
  const body = await readOAuthForm(c);
  if (!body) return c.json({error: 'invalid_request'}, 400);

  const parsedAuth = parseClientCredentials(c.req.header('authorization'), body);
  if (!parsedAuth.ok) return rejectClientAuth(c, parsedAuth.error);
  const {client_id: cid, client_secret: secret} = parsedAuth.credentials;

  const client = findClientById(cid);
  if (!client || client.revoked_at !== null) {
    return rejectClientAuth(c);
  }
  if (!constantTimeStrEq(hashToken(secret), client.client_secret_hash)) {
    return rejectClientAuth(c);
  }

  const token = body.token;
  if (typeof token !== 'string' || !token.length) return c.json({error: 'invalid_request'}, 400);
  revokeTokenByHash(hashToken(token), cid);
  // RFC 7009: always 200 (don't leak token validity).
  return c.body(null, 200);
});
