/**
 * MCP HTTP routes.
 *
 * In production both `https://mcp.openswissdata.com/*` and
 * `https://www.openswissdata.com/mcp/*` resolve here. The host-based router
 * in `src/index.ts` strips the `/mcp` prefix when serving the dedicated
 * sub-domain so the same Hono router handles both layouts.
 *
 * Endpoints:
 *   GET  /discovery     — server info (protocol versions, tools callable by this caller)
 *   GET  /health        — liveness probe (no auth)
 *   POST /jsonrpc       — JSON-RPC 2.0 endpoint (initialize/tools/list/call)
 *   POST /              — même point d'entrée (adresse `/mcp` souvent collée telle quelle)
 *   GET  /jsonrpc       — 405 : Streamable HTTP sans flux SSE, réponses JSON uniquement
 *
 *   POST /oauth/register
 *   GET  /oauth/authorize
 *   POST /oauth/authorize/decision
 *   POST /oauth/token
 *   POST /oauth/revoke
 *
 * Auth (V2):
 *   - OAuth 2.1 Bearer tokens issued via /oauth/* routes — verified by the
 *     `oauthVerify()` middleware.
 *   - The legacy `MCP_BEARER_TOKEN` env var still works as an admin bypass.
 *   - Anonymous calls (no token) hit the IP-keyed in-memory rate limit and
 *     can invoke the V1 read-only tools (`tariff_lookup`, `kyc_check`,
 *     `cross_walk`), plus the three search tools within the free trial
 *     (20 calls per 24 hours per network, own counter, see `trialGate`).
 */

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { callableBy, dispatch, getServerInfo, type TrialGate } from "../../mcp/server.js";
import { oauthRouter, oauthVerify, type MCPAuthVar } from "../../mcp/oauth/index.js";
import { anonymousLimitResponse } from "../../mcp/oauth/verify.js";
import { checkRateLimit, checkTrialLimit, type TrialResult } from "../../mcp/rate-limit.js";
import { mcpBodyLimit } from "../../mcp/body-limit.js";
import { trackMcpInitialize, trackMcpToolCall, trackMcpTrial } from "../../mcp/track-mcp.js";

export const mcpRoute = new Hono<MCPAuthVar>();

// Données publiques en lecture seule : tout site peut appeler le point d'entrée depuis un
// navigateur (client MCP web, démonstrateur tiers). Aucun cookie n'est admis (pas de
// credentials) ; un jeton éventuel reste dans l'en-tête posé par la page qui le détient.
// Les routes OAuth gardent leurs propres règles et ne reçoivent pas ces en-têtes.
const mcpCors = cors({
  origin: "*",
  allowMethods: ["POST", "GET", "OPTIONS"],
  allowHeaders: ["content-type", "accept", "authorization", "mcp-protocol-version", "mcp-session-id", "last-event-id"],
  exposeHeaders: ["mcp-session-id", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-trial-limit", "x-trial-remaining", "x-trial-reset"],
  maxAge: 86_400,
});
mcpRoute.use("/jsonrpc", mcpCors);
mcpRoute.use("/discovery", mcpCors);
mcpRoute.use("/", mcpCors);

// Health is intentionally unauthenticated — used by Railway's healthcheck.
mcpRoute.get("/health", (c) => c.json({ status: "ok" }));

// OAuth endpoints (registered before the Bearer-protected JSON-RPC route).
mcpRoute.route("/oauth", oauthRouter);

// JSON discovery endpoint (server info, protocol version, tools list).
// GET `/mcp` stays the Astro static page (public docs at /mcp/index.html).
// Agents/curl call `/mcp/discovery` to get the JSON discovery payload.
mcpRoute.get("/discovery", oauthVerify(), (c) => c.json(getServerInfo(callableBy(c.get("mcp_auth")))));

type JsonRpcMessage = { method?: unknown; params?: unknown };

/**
 * Compteur d'essai d'une requête anonyme : même clé réseau que la limite horaire, compteur distinct.
 * Mesure chaque appel servi et le premier refus de la fenêtre ; retient le dernier état pour les
 * en-têtes. Aucun compteur pour un jeton (ses portées et son quota s'appliquent sans essai).
 */
function trialGate(c: Context<MCPAuthVar>): { gate: TrialGate; last: () => TrialResult | null; refused: () => boolean } | null {
  const key = c.get("mcp_rate_key");
  if (c.get("mcp_auth") !== null || !key) return null;
  let last: TrialResult | null = null;
  let refused = false;
  return {
    gate: {
      consume(tool) {
        const outcome = checkTrialLimit(key);
        last = outcome;
        if (!outcome.allowed) refused = true;
        if (outcome.allowed || outcome.firstRefusal) trackMcpTrial(c, tool, outcome);
        return outcome;
      },
    },
    last: () => last,
    refused: () => refused,
  };
}

/** En-têtes d'essai, seulement si la requête a touché l'essai ; Retry-After pour un appel isolé refusé. */
function setTrialHeaders(c: Context<MCPAuthVar>, trial: ReturnType<typeof trialGate>, single: boolean): void {
  const last = trial?.last();
  if (!trial || !last) return;
  c.header("X-Trial-Limit", String(last.limit));
  c.header("X-Trial-Remaining", String(last.remaining));
  c.header("X-Trial-Reset", String(Math.floor(last.resetAt / 1000)));
  if (single && trial.refused()) c.header("Retry-After", String(Math.max(1, Math.ceil((last.resetAt - Date.now()) / 1000))));
}

async function handleJsonRpc(c: Context<MCPAuthVar>) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
    );
  }

  const auth = c.get("mcp_auth");

  if (Array.isArray(body)) {
    // Bound the batch: an unbounded array of tools/call would run N dispatches
    // + N tracking passes synchronously, letting an anonymous caller stall the
    // single-threaded event loop. 50 is far above any real client's batch.
    if (body.length > 50) {
      return c.json(
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch too large (max 50)" } },
        400,
      );
    }
    if (body.length === 0) {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Empty batch" } }, 400);
    }
    // Anonyme : chaque message du lot coûte un appel. Le contrôle d'entrée en a déjà compté un ;
    // sans ce complément, un lot de 50 valait 50 appels pour le prix d'un.
    const rateKey = c.get("mcp_rate_key");
    if (rateKey && body.length > 1) {
      const rl = checkRateLimit(rateKey, undefined, body.length - 1);
      if (!rl.allowed) return anonymousLimitResponse(c, rl);
      c.header("X-RateLimit-Remaining", String(rl.remaining));
    }
    const trial = trialGate(c);
    const started = Date.now();
    const out = await Promise.all(body.map((r) => dispatch(r, auth, trial?.gate ?? null)));
    const dur = Date.now() - started;
    setTrialHeaders(c, trial, false);
    // One event row per answered tools/call (trackMcpToolCall no-ops on others);
    // une notification n'est ni exécutée ni mesurée.
    body.forEach((r, i) => {
      const reply = out[i];
      if (reply === null) return;
      trackMcpToolCall(c, r as JsonRpcMessage, reply, auth, dur);
      trackMcpInitialize(c, r as JsonRpcMessage, reply, auth);
    });
    const replies = out.filter((reply) => reply !== null);
    // Streamable HTTP : un lot fait uniquement de notifications reçoit 202 sans corps.
    return replies.length > 0 ? c.json(replies) : c.body(null, 202);
  }

  const trial = trialGate(c);
  const started = Date.now();
  const response = await dispatch(body, auth, trial?.gate ?? null);
  if (response === null) return c.body(null, 202);
  setTrialHeaders(c, trial, true);
  trackMcpToolCall(c, body as JsonRpcMessage, response, auth, Date.now() - started);
  trackMcpInitialize(c, body as JsonRpcMessage, response, auth);
  return c.json(response);
}

// Taille bornée avant tout quota ou décodage, puis contrôle d'accès, puis exécution.
mcpRoute.post("/jsonrpc", mcpBodyLimit, oauthVerify(), handleJsonRpc);
mcpRoute.post("/", mcpBodyLimit, oauthVerify(), handleJsonRpc);

// Aucun flux SSE n'est proposé : la spécification demande 405 pour qu'un client n'insiste pas.
mcpRoute.get("/jsonrpc", (c) => {
  c.header("Allow", "POST");
  c.header("Cache-Control", "no-store");
  return c.json(
    {
      error: "method_not_allowed",
      error_description: "This MCP endpoint speaks Streamable HTTP with JSON responses: send JSON-RPC messages with POST. No SSE stream is offered.",
    },
    405,
  );
});
