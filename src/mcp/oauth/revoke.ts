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

export const revokeRoute = new Hono();

function constantTimeStrEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

revokeRoute.post("/revoke", async (c) => {
  const body = (await c.req.parseBody()) as Record<string, unknown>;

  // Client auth (Basic OR body fields)
  let cid = "";
  let secret = "";
  const ah = c.req.header("authorization") ?? c.req.header("Authorization");
  if (ah?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(ah.slice(6), "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep > 0) {
        cid = decoded.slice(0, sep);
        secret = decoded.slice(sep + 1);
      }
    } catch {
      /* ignore */
    }
  }
  if (!cid && typeof body.client_id === "string") cid = body.client_id;
  if (!secret && typeof body.client_secret === "string") secret = body.client_secret;

  if (!cid || !secret) {
    return c.json({ error: "invalid_client" }, 401);
  }

  const client = findClientById(cid);
  if (!client || client.revoked_at) {
    return c.json({ error: "invalid_client" }, 401);
  }
  if (!constantTimeStrEq(hashToken(secret), client.client_secret_hash)) {
    return c.json({ error: "invalid_client" }, 401);
  }

  const token = body.token;
  if (typeof token === "string" && token.length > 0) {
    revokeTokenByHash(hashToken(token));
  }
  // RFC 7009: always 200 (don't leak token validity).
  return c.body(null, 200);
});
