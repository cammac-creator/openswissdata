/**
 * Bearer token verification middleware for MCP endpoints.
 *
 * Strategy:
 *   1. If `Authorization: Bearer <t>` is present:
 *      - Hash the token, look up `mcp_tokens` by access_token_hash.
 *      - Reject 401 if not found / expired / revoked.
 *      - Load the client's tier; consume one quota unit; reject 429 if over.
 *      - Stash `c.var.mcp_auth = { client_id, scopes, tier }` for the
 *        downstream JSON-RPC dispatcher to consult.
 *
 *   2. Else if no Authorization header:
 *      - Fall back to the IP-keyed in-memory rate limit (free tier).
 *      - Stash `c.var.mcp_auth = null` and let downstream code restrict the
 *        callable tools to the V1 default surface.
 *
 *   3. The legacy `MCP_BEARER_TOKEN` env var is kept as an admin/debug
 *      bypass (constant-time compared against a single static token). When
 *      it matches, `c.var.mcp_auth` is set to a synthetic admin context with
 *      ALL scopes and unlimited quota.
 */

import type { MiddlewareHandler } from "hono";
import { hashToken } from "./crypto.js";
import { findClientById, findTokenByAccessHash, type MCPClient } from "./store.js";
import { consumeQuota, type QuotaResult } from "./quota.js";
import {
  parseScopes,
  SCOPES,
  type Scope,
  type Tier,
  isValidTier,
} from "./scopes.js";
import { checkRateLimit, type RateLimitResult } from "../rate-limit.js";
import { timingSafeEqual } from "node:crypto";

export interface MCPAuthContext {
  client_id: string;
  client_pk: number; // mcp_clients.id (autoincrement) — useful for joins
  tier: Tier;
  scopes: readonly Scope[];
  /** True when authenticated with the legacy MCP_BEARER_TOKEN admin bypass. */
  admin: boolean;
}

export type MCPAuthVar = {
  Variables: {
    mcp_auth: MCPAuthContext | null;
    mcp_quota: QuotaResult | null;
    mcp_rate_limit: RateLimitResult | null;
  };
};

function constantTimeStrEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function clientIp(req: { header: (n: string) => string | undefined }): string {
  return (
    req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.header("x-real-ip") ||
    "unknown"
  );
}

/**
 * Build the OAuth verification middleware. Pass `requireToken=true` to refuse
 * unauthenticated calls outright (used by the admin-only routes — none yet).
 */
export function oauthVerify(opts: { requireToken?: boolean } = {}): MiddlewareHandler<MCPAuthVar> {
  const requireToken = opts.requireToken === true;

  return async (c, next) => {
    const auth = c.req.header("authorization") ?? c.req.header("Authorization");
    const m = auth?.match(/^Bearer\s+(.+)$/);
    const token = m?.[1]?.trim();

    // 0. Legacy admin bypass — only when MCP_BEARER_TOKEN is configured.
    const legacy = process.env.MCP_BEARER_TOKEN;
    if (token && legacy && constantTimeStrEq(token, legacy)) {
      c.set("mcp_auth", {
        client_id: "admin",
        client_pk: -1,
        tier: "pro",
        scopes: SCOPES,
        admin: true,
      });
      c.set("mcp_quota", null);
      c.set("mcp_rate_limit", null);
      await next();
      return;
    }

    // 1. OAuth bearer
    if (token) {
      let stored;
      try {
        stored = findTokenByAccessHash(hashToken(token));
      } catch (e) {
        return c.json(
          { error: "server_error", error_description: e instanceof Error ? e.message : String(e) },
          500,
        );
      }
      if (!stored) {
        return c.json({ error: "invalid_token", error_description: "unknown token" }, 401);
      }
      if (stored.expires_at < Date.now()) {
        return c.json({ error: "invalid_token", error_description: "token expired" }, 401);
      }

      const client: MCPClient | null = findClientById(stored.client_id);
      if (!client || client.revoked_at) {
        return c.json({ error: "invalid_token", error_description: "client revoked" }, 401);
      }
      const tier: Tier = isValidTier(client.tier) ? client.tier : "free";

      const quota = consumeQuota(client.client_id, tier);
      c.header("X-RateLimit-Tier", tier);
      c.header("X-RateLimit-Day-Used", String(quota.day_used));
      if (quota.day_limit >= 0) c.header("X-RateLimit-Day-Limit", String(quota.day_limit));
      c.header("X-RateLimit-Month-Used", String(quota.month_used));
      if (quota.month_limit >= 0) c.header("X-RateLimit-Month-Limit", String(quota.month_limit));

      if (!quota.allowed) {
        return c.json(
          {
            error: "rate_limit_exceeded",
            error_description: `tier=${tier} day=${quota.day_used}/${quota.day_limit} month=${quota.month_used}/${quota.month_limit}`,
          },
          429,
        );
      }

      c.set("mcp_auth", {
        client_id: client.client_id,
        client_pk: client.id,
        tier,
        scopes: parseScopes(client.scopes),
        admin: false,
      });
      c.set("mcp_quota", quota);
      c.set("mcp_rate_limit", null);
      await next();
      return;
    }

    // 2. No token. If the route requires one, 401.
    if (requireToken) {
      return c.json({ error: "unauthorized" }, 401);
    }

    // Fallback: IP rate limit (free anonymous tier).
    const ip = clientIp(c.req);
    const rl = checkRateLimit(ip);
    c.header("X-RateLimit-Limit", String(rl.limit));
    c.header("X-RateLimit-Remaining", String(rl.remaining));
    c.header("X-RateLimit-Reset", String(Math.floor(rl.resetAt / 1000)));
    if (!rl.allowed) {
      return c.json(
        { error: "rate_limit_exceeded", error_description: "anonymous tier exceeded" },
        429,
      );
    }
    c.set("mcp_auth", null);
    c.set("mcp_quota", null);
    c.set("mcp_rate_limit", rl);
    await next();
  };
}

/**
 * Returns the set of tools the current request is allowed to call. Used by
 * the JSON-RPC dispatcher.
 *
 * - Anonymous (no token) → only V1 read-only tools (`tariff_lookup`, `kyc_check`,
 *   `cross_walk`).
 * - Token-authenticated → tools whose required scope is present in the token.
 */
export function isToolAllowed(
  toolName: string,
  requiredScope: Scope | null,
  auth: MCPAuthContext | null,
): boolean {
  if (auth?.admin) return true;
  if (!auth) {
    // Anonymous fallback: only V1 read-only tools, gated by their scope being
    // among the "default-on" public scopes.
    const PUBLIC_TOOLS = new Set(["tariff_lookup", "kyc_check", "cross_walk"]);
    return PUBLIC_TOOLS.has(toolName);
  }
  if (!requiredScope) return true;
  return auth.scopes.includes(requiredScope);
}
