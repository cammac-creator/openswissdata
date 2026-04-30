/**
 * MCP HTTP routes.
 *
 * Mounted under `/mcp` in `src/index.ts`. In production a CNAME on
 * `mcp.openswissdata.com` will point to the same Railway service (DNS work
 * pending — see docs/mcp/README.md).
 *
 * Endpoints:
 *   GET  /mcp              — server info (protocol version, capabilities, tools)
 *   GET  /mcp/health       — liveness probe (no auth)
 *   POST /mcp/jsonrpc      — JSON-RPC 2.0 endpoint for `initialize`,
 *                            `tools/list`, `tools/call`
 *
 * Auth (MVP):
 *   - If env var MCP_BEARER_TOKEN is set, all requests require
 *     `Authorization: Bearer <token>`.
 *   - If unset (dev/test), auth is bypassed — same convention as the
 *     Resend/R2 keys handled in src/env.ts.
 *   - V2 will replace this with OAuth 2.1 + per-licence quotas.
 */

import { Hono } from "hono";
import { dispatch, getServerInfo } from "../../mcp/server.js";
import { checkRateLimit } from "../../mcp/rate-limit.js";

export const mcpRoute = new Hono();

function bearerOk(c: { req: { header: (n: string) => string | undefined } }): boolean {
  const expected = process.env.MCP_BEARER_TOKEN;
  if (!expected) return true; // dev/test — auth not enforced
  const auth = c.req.header("authorization") ?? c.req.header("Authorization");
  if (!auth) return false;
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  return m[1].trim() === expected;
}

function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

mcpRoute.get("/health", (c) => c.json({ status: "ok" }));

mcpRoute.get("/", (c) => {
  if (!bearerOk(c)) return c.json({ error: "unauthorized" }, 401);
  return c.json(getServerInfo());
});

mcpRoute.post("/jsonrpc", async (c) => {
  if (!bearerOk(c)) return c.json({ error: "unauthorized" }, 401);

  const ip = clientIp(c);
  const rl = checkRateLimit(ip);
  c.header("X-RateLimit-Limit", String(rl.limit));
  c.header("X-RateLimit-Remaining", String(rl.remaining));
  c.header("X-RateLimit-Reset", String(Math.floor(rl.resetAt / 1000)));
  if (!rl.allowed) {
    return c.json({ error: "rate_limited", reset_at: rl.resetAt }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
    );
  }

  // Batch requests (MCP spec allows arrays, but we keep MVP simple)
  if (Array.isArray(body)) {
    const out = await Promise.all(body.map((r) => dispatch(r)));
    return c.json(out);
  }

  const response = await dispatch(body);
  return c.json(response);
});
