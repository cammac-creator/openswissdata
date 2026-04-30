/**
 * Standalone STDIO MCP server that forwards every request to the live
 * openswissdata HTTP MCP endpoint.
 *
 * Why standalone:
 *   - Claude Desktop / Cursor / Cline launch MCP servers as a child process
 *     speaking JSON-RPC over STDIO. They don't talk HTTP directly.
 *   - This binary is the bridge: it advertises the same 8 tools as the
 *     remote, but delegates `tools/call` over HTTP behind the scenes.
 *
 * Usage:
 *   - `npx @openswissdata/mcp` (STDIO server, used by client config files)
 *   - `OPENSWISSDATA_API_KEY=sk_live_... openswissdata-mcp` (with auth)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { RemoteProxy, type ProxyOptions } from "./proxy.js";

const SERVER_NAME = "openswissdata-mcp";
const SERVER_VERSION = "0.1.0";

export interface BuildServerOptions extends ProxyOptions {
  /** Inject a pre-built proxy (test injection). */
  proxy?: RemoteProxy;
}

/**
 * Build a configured low-level MCP `Server` instance ready to be connected
 * to a transport. The transport is chosen by the entry point (`index.ts`)
 * so the server stays test-friendly without spawning STDIO.
 */
export function buildServer(options: BuildServerOptions = {}): {
  server: Server;
  proxy: RemoteProxy;
} {
  const proxy = options.proxy ?? new RemoteProxy(options);

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: false } } },
  );

  // tools/list — proxy straight through. The remote returns the canonical
  // schema, so we don't have to hardcode anything in this binary.
  //
  // We cast the handler return type because the MCP SDK's strict result
  // schema includes optional `task` / `_meta` envelope fields that we don't
  // need to populate — the SDK serialises the plain `{ tools: [...] }` shape
  // we return here just fine at runtime.
  server.setRequestHandler(
    ListToolsRequestSchema,
    (async (_req: ListToolsRequest) => {
      const list = await proxy.listTools();
      return list;
    }) as Parameters<typeof server.setRequestHandler>[1],
  );

  // tools/call — forward the call and pass `result.content` back unchanged.
  // We preserve `isError` and `structured` so the MCP client sees exactly
  // what the remote produced (including the mandatory non-official disclaimers
  // in the text content).
  server.setRequestHandler(
    CallToolRequestSchema,
    (async (req: CallToolRequest) => {
      const name = req.params.name;
      const args = req.params.arguments ?? {};
      try {
        const result = await proxy.callTool(name, args);
        return {
          content: result.content,
          ...(result.isError !== undefined ? { isError: result.isError } : {}),
          ...(result.structured !== undefined ? { structuredContent: result.structured } : {}),
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `Proxy error calling '${name}': ${message}` }],
          isError: true,
        };
      }
    }) as Parameters<typeof server.setRequestHandler>[1],
  );

  return { server, proxy };
}

export { SERVER_NAME, SERVER_VERSION };
