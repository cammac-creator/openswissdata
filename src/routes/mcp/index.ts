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

export const mcpRoute = new Hono<MCPAuthVar>();

// Health is intentionally unauthenticated — used by Railway's healthcheck.
mcpRoute.get("/health", (c) => c.json({ status: "ok" }));

// OAuth endpoints (registered before the Bearer-protected JSON-RPC route).
mcpRoute.route("/oauth", oauthRouter);

// Server info — bypasses quota; bare auth check only.
mcpRoute.get("/", oauthVerify(), (c) => c.json(getServerInfo()));

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
    const out = await Promise.all(body.map((r) => dispatch(r, auth)));
    return c.json(out);
  }

  const response = await dispatch(body, auth);
  return c.json(response);
});
