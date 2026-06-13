/**
 * MCP HTTP routes.
 *
 * In production both `https://mcp.openswissdata.com/*` and
 * `https://www.openswissdata.com/mcp/*` resolve here. The host-based router
 * in `src/index.ts` strips the `/mcp` prefix when serving the dedicated
 * sub-domain so the same Hono router handles both layouts.
 *
 * Endpoints:
 *   GET  /              — server info (protocol version, capabilities, tools)
 *   GET  /health        — liveness probe (no auth)
 *   POST /jsonrpc       — JSON-RPC 2.0 endpoint (initialize/tools/list/call)
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

import { Hono } from "hono";
import { dispatch, getServerInfo } from "../../mcp/server.js";
import { oauthRouter, oauthVerify, type MCPAuthVar } from "../../mcp/oauth/index.js";
import { trackMcpToolCall } from "../../mcp/track-mcp.js";

export const mcpRoute = new Hono<MCPAuthVar>();

// Health is intentionally unauthenticated — used by Railway's healthcheck.
mcpRoute.get("/health", (c) => c.json({ status: "ok" }));

// OAuth endpoints (registered before the Bearer-protected JSON-RPC route).
mcpRoute.route("/oauth", oauthRouter);

// JSON discovery endpoint (server info, protocol version, tools list).
// `/mcp` (no path) is intentionally NOT registered here — that path is
// reserved for the Astro static page (public docs at /mcp/index.html).
// Agents/curl call `/mcp/discovery` to get the JSON discovery payload.
mcpRoute.get("/discovery", oauthVerify(), (c) => c.json(getServerInfo()));

mcpRoute.post("/jsonrpc", oauthVerify(), async (c) => {
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
    const started = Date.now();
    const out = await Promise.all(body.map((r) => dispatch(r, auth)));
    const dur = Date.now() - started;
    // One event row per tools/call sub-request (trackMcpToolCall no-ops on others).
    body.forEach((r, i) =>
      trackMcpToolCall(c, r as { method?: unknown; params?: unknown }, out[i], auth, dur),
    );
    return c.json(out);
  }

  const started = Date.now();
  const response = await dispatch(body, auth);
  trackMcpToolCall(c, body as { method?: unknown; params?: unknown }, response, auth, Date.now() - started);
  return c.json(response);
});
