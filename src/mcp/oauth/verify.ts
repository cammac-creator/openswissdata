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

import type { Context, MiddlewareHandler } from "hono";
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
import { checkRateLimit, ANONYMOUS_RATE_LIMIT, type RateLimitResult } from "../rate-limit.js";
import { timingSafeEqual } from "node:crypto";
import { abuseIp, trustedRequestIp } from "../../lib/request-ip.js";
import { trackMcpRateLimited } from "../track-mcp.js";

/** Outils appelables sans jeton, dans l'ordre présenté aux agents. */
export const ANONYMOUS_TOOL_NAMES = ["tariff_lookup", "kyc_check", "company_check", "cross_walk"] as const;
const ANONYMOUS_TOOLS: ReadonlySet<string> = new Set(ANONYMOUS_TOOL_NAMES);

/**
 * Outils de recherche ouverts sans jeton dans la limite de l'essai (décision de Claude-Alain du
 * 29.09.2026) : leur appel anonyme consomme le compteur d'essai du réseau, décompté dans le
 * dispatcher. Les jetons authentifiés gardent leurs portées, sans essai.
 */
export const ANONYMOUS_TRIAL_TOOL_NAMES = ["tariff_semantic_search", "classify_text", "finma_search"] as const;
const ANONYMOUS_TRIAL_TOOLS: ReadonlySet<string> = new Set(ANONYMOUS_TRIAL_TOOL_NAMES);

export function isTrialTool(name: string): boolean {
  return ANONYMOUS_TRIAL_TOOLS.has(name);
}

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
    /** Clé du limiteur anonyme (réseau fiable), pour facturer chaque message d'un lot. */
    mcp_rate_key: string | null;
  };
};

function constantTimeStrEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Public /pricing URL surfaced on 429s so a rate-limited caller (human or LLM)
 * sees the upgrade path. Uses BASE_URL (the public site), not MCP_BASE_URL.
 */
function pricingUpgradeUrl(): string {
  return (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "") + "/pricing";
}

/** Page anglaise des fichiers vendus : seule offre ouverte tant que les abonnements sont fermés. */
function datasetsUrl(): string {
  return (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "") + "/en/";
}

function retryAfterSeconds(resetAt: number): number {
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}

/**
 * Refus de la limite anonyme, partagé par le contrôle d'entrée et par la facturation des lots.
 * Journalisé avant la réponse, une fois par fenêtre et par réseau : un refus non mesuré rend
 * l'API innocente à tort, un refus mesuré à chaque appel inonderait le journal.
 */
export function anonymousLimitResponse(c: Context, rl: RateLimitResult): Response {
  if (rl.firstRefusal) trackMcpRateLimited(c, "anonymous");
  const retryAfter = retryAfterSeconds(rl.resetAt);
  const files = datasetsUrl();
  c.header("Retry-After", String(retryAfter));
  c.header("X-RateLimit-Limit", String(rl.limit));
  c.header("X-RateLimit-Remaining", String(rl.remaining));
  c.header("X-RateLimit-Reset", String(Math.floor(rl.resetAt / 1000)));
  c.header("Cache-Control", "no-store");
  return c.json(
    {
      error: "rate_limit_exceeded",
      error_description: `Anonymous limit reached: ${ANONYMOUS_RATE_LIMIT.calls} calls per ${ANONYMOUS_RATE_LIMIT.window} per IP address (each message of a batch counts). Retry after ${retryAfter} seconds. No paid API plan is open at the moment; the full datasets are sold as signed files at ${files}`,
      retry_after_seconds: retryAfter,
      limit: rl.limit,
      window: ANONYMOUS_RATE_LIMIT.window,
      datasets_url: files,
    },
    429,
  );
}

/**
 * Build the OAuth verification middleware. Pass `requireToken=true` to refuse
 * unauthenticated calls outright (used by the admin-only routes — none yet).
 */
export function oauthVerify(opts: { requireToken?: boolean } = {}): MiddlewareHandler<MCPAuthVar> {
  const requireToken = opts.requireToken === true;

  return async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const auth = c.req.header("authorization") ?? c.req.header("Authorization");
    const token = auth && auth.length <= 4096 ? auth.match(/^Bearer +([A-Za-z0-9._~+\/-]+=*)$/i)?.[1] : undefined;
    const refuseToken = () => {
      c.header('WWW-Authenticate', 'Bearer realm="openswissdata", error="invalid_token"');
      return c.json({ error: 'invalid_token' }, 401);
    };
    // Un en-tête présent mais invalide n’est jamais une demande d’accès anonyme.
    if (auth !== undefined && !token) {
      return refuseToken();
    }

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
      c.set("mcp_rate_key", null);
      await next();
      return;
    }

    // 1. OAuth bearer
    if (token) {
      let stored, client: MCPClient | null, tier: Tier, quota: QuotaResult;
      try {
        stored = findTokenByAccessHash(hashToken(token));
        if (!stored || !Number.isSafeInteger(stored.expires_at) || stored.expires_at <= Date.now()) return refuseToken();

        client = findClientById(stored.client_id);
        if (!client || client.revoked_at !== null || !isValidTier(client.tier)) return refuseToken();
        tier = client.tier;

        quota = consumeQuota(client.client_id, tier);
      } catch {
        reportAuthFailure();
        return c.json({ error: 'server_error' }, 500);
      }
      c.header("X-RateLimit-Tier", tier);
      c.header("X-RateLimit-Day-Used", String(quota.day_used));
      if (quota.day_limit >= 0) c.header("X-RateLimit-Day-Limit", String(quota.day_limit));
      c.header("X-RateLimit-Month-Used", String(quota.month_used));
      if (quota.month_limit >= 0) c.header("X-RateLimit-Month-Limit", String(quota.month_limit));

      if (!quota.allowed) {
        const upgrade = pricingUpgradeUrl();
        // Mois épuisé : le blocage dure jusqu'au mois suivant, même si le jour l'est aussi.
        const monthExceeded = quota.month_limit >= 0 && quota.month_used > quota.month_limit;
        c.header("Retry-After", String(secondsUntilUtcBoundary(monthExceeded ? "month" : "day")));
        return c.json(
          {
            error: "rate_limit_exceeded",
            error_description: `tier=${tier} day=${quota.day_used}/${quota.day_limit} month=${quota.month_used}/${quota.month_limit} — upgrade at ${upgrade}`,
            upgrade_url: upgrade,
          },
          429,
        );
      }

      const allowedScopes = parseScopes(client.scopes);
      c.set("mcp_auth", {
        client_id: client.client_id,
        client_pk: client.id,
        tier,
        // Un jeton ne gagne jamais les autres droits du compte ; les retraits du compte s’appliquent immédiatement.
        scopes: parseScopes(stored.scope).filter(scope => allowedScopes.includes(scope)),
        admin: false,
      });
      c.set("mcp_quota", quota);
      c.set("mcp_rate_limit", null);
      c.set("mcp_rate_key", null);
      await next();
      return;
    }

    // 2. No token. If the route requires one, 401.
    if (requireToken) {
      c.header('WWW-Authenticate', 'Bearer realm="openswissdata"');
      return c.json({ error: "unauthorized" }, 401);
    }

    // Fallback: IP rate limit (free anonymous tier). Adresse du proxy Railway validé
    // (IPv6 réduite en /64), jamais le premier X-Forwarded-For fourni par le client.
    const ip = abuseIp(trustedRequestIp(c) ?? "");
    const rl = checkRateLimit(ip);
    c.header("X-RateLimit-Limit", String(rl.limit));
    c.header("X-RateLimit-Remaining", String(rl.remaining));
    c.header("X-RateLimit-Reset", String(Math.floor(rl.resetAt / 1000)));
    if (!rl.allowed) return anonymousLimitResponse(c, rl);
    c.set("mcp_auth", null);
    c.set("mcp_quota", null);
    c.set("mcp_rate_limit", rl);
    c.set("mcp_rate_key", ip);
    await next();
  };
}

/**
 * Returns the set of tools the current request is allowed to call. Used by
 * the JSON-RPC dispatcher.
 *
 * - Anonymous (no token) → only V1 read-only tools (`tariff_lookup`, `kyc_check`,
 *   `cross_walk`), plus the three trial tools, each call of which the dispatcher
 *   charges to the network's trial counter before running it.
 * - Token-authenticated → tools whose required scope is present in the token.
 */
export function isToolAllowed(
  toolName: string,
  requiredScope: Scope | null,
  auth: MCPAuthContext | null,
): boolean {
  if (!requiredScope) return false;
  if (auth?.admin) return true;
  if (!auth) {
    // Anonymous fallback: only V1 read-only tools, gated by their scope being
    // among the "default-on" public scopes, and the trial tools (counted apart).
    return ANONYMOUS_TOOLS.has(toolName) || ANONYMOUS_TRIAL_TOOLS.has(toolName);
  }
  return auth.scopes.includes(requiredScope);
}

/** Secondes jusqu'au prochain jour ou mois UTC, bornes des compteurs de `consumeQuota`. */
function secondsUntilUtcBoundary(unit: "day" | "month"): number {
  const now = new Date();
  const next = unit === "day"
    ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

let lastAuthFailureLog = 0;
function reportAuthFailure(): void {
  try {
    const now = Date.now();
    if (lastAuthFailureLog && now >= lastAuthFailureLog && now - lastAuthFailureLog < 60_000) return;
    lastAuthFailureLog = now;
    console.warn('[oauth] vérification temporairement indisponible');
  } catch { /* Aucun détail de stockage ni secret dans la réponse. */ }
}
