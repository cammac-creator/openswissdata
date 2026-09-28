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
 *     can only invoke the V1 read-only tools (`tariff_lookup`, `kyc_check`,
 *     `cross_walk`).
 */

import { Hono, type Context } from "hono";
import { callableBy, dispatch, getServerInfo } from "../../mcp/server.js";
import { oauthRouter, oauthVerify, type MCPAuthVar } from "../../mcp/oauth/index.js";
import { trackMcpInitialize, trackMcpToolCall } from "../../mcp/track-mcp.js";

export const mcpRoute = new Hono<MCPAuthVar>();

// Health is intentionally unauthenticated — used by Railway's healthcheck.
mcpRoute.get("/health", (c) => c.json({ status: "ok" }));

// OAuth endpoints (registered before the Bearer-protected JSON-RPC route).
mcpRoute.route("/oauth", oauthRouter);

// JSON discovery endpoint (server info, protocol version, tools list).
// GET `/mcp` stays the Astro static page (public docs at /mcp/index.html).
// Agents/curl call `/mcp/discovery` to get the JSON discovery payload.
mcpRoute.get("/discovery", oauthVerify(), (c) => c.json(getServerInfo(callableBy(c.get("mcp_auth")))));

type JsonRpcMessage = { method?: unknown; params?: unknown };

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
    const started = Date.now();
    const out = await Promise.all(body.map((r) => dispatch(r, auth)));
    const dur = Date.now() - started;
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

  const started = Date.now();
  const response = await dispatch(body, auth);
  if (response === null) return c.body(null, 202);
  trackMcpToolCall(c, body as JsonRpcMessage, response, auth, Date.now() - started);
  trackMcpInitialize(c, body as JsonRpcMessage, response, auth);
  return c.json(response);
}

mcpRoute.post("/jsonrpc", oauthVerify(), handleJsonRpc);
mcpRoute.post("/", oauthVerify(), handleJsonRpc);

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
