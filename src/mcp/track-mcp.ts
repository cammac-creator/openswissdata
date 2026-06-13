/**
 * Instrumentation for MCP tool calls — writes one `events` row per `tools/call`
 * so the kill-gate metric ("≈20 human MCP calls/week excluding bots") is
 * actually measurable. Server-side only: agents/curl don't run JS, so Plausible
 * never sees an MCP call — this is the sole source of MCP usage truth.
 *
 * Design: reuse the existing `events` table with kind='custom',
 * name='mcp_tool_call'. No new `kind` (the CHECK constraint is mirrored in two
 * files and a bad kind would be SILENTLY dropped by track()'s SQLITE_CONSTRAINT
 * swallow) and no schema migration. The discriminant lives in `ua_class` (the
 * caller class) and `meta_json` (tool, auth, tier, client_id).
 */

import type { Context } from "hono";
import {
  track,
  visitorHashFromRequest,
  countryFromRequest,
  refererOrigin,
} from "../lib/track.js";
import { mcpCallerClass } from "./caller-class.js";
import type { MCPAuthContext } from "./oauth/verify.js";
import type { JsonRpcResponse } from "./server.js";

/**
 * Log a single MCP tool call. Fully fire-and-forget: the whole body (header
 * reads, SHA-256 visitor hash, JSON.stringify, the INSERT) runs inside a
 * setImmediate + try/catch, so it adds NO synchronous work to — and can never
 * throw on — the /jsonrpc response path. No-ops unless method === "tools/call"
 * (cheap synchronous guard so discovery calls don't even schedule a tick).
 */
export function trackMcpToolCall(
  c: Context,
  req: { method?: unknown; params?: unknown },
  res: JsonRpcResponse | undefined,
  auth: MCPAuthContext | null,
  durationMs: number,
): void {
  if (req?.method !== "tools/call") return; // discovery (initialize/ping/tools/list) is not a tool call

  // Defer ALL work off the hot path. setImmediate captures c by reference; the
  // request headers it reads are immutable and still available here.
  setImmediate(() => {
    try {
      const params = (req.params ?? {}) as { name?: unknown };
      const tool = typeof params.name === "string" ? params.name : "(unknown)";

      const ua = c.req.header("user-agent") ?? "";
      const authenticated = auth !== null; // valid OAuth bearer OR admin bypass
      const isAdmin = auth?.admin === true; // legacy MCP_BEARER_TOKEN = us (Claude-Alain)
      const callerClass = mcpCallerClass(ua, authenticated);

      // HTTP-shaped status for consistency with api_request rows.
      const status = res?.error ? 400 : 200;

      track({
        kind: "custom",
        name: "mcp_tool_call",
        status,
        duration_ms: durationMs,
        customer_id: null, // MCP identity lives in client_id (meta_json), not the customers table
        visitor_hash: visitorHashFromRequest(c),
        country: countryFromRequest(c),
        referer: refererOrigin(c),
        ua_class: callerClass, // human_authenticated | mcp_client | scanner | bot | unknown
        meta_json: JSON.stringify({
          mcp: true,
          tool,
          jsonrpc_method: "tools/call",
          authenticated,
          admin: isAdmin,
          tier: auth?.tier ?? "anonymous",
          client_id: auth?.client_id ?? null,
          ua,
        }),
      });
    } catch (err) {
      console.warn("[track-mcp] failed to log tool call", err);
    }
  });
}
