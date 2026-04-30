/**
 * MCP server — JSON-RPC 2.0 dispatcher for the openswissdata Model Context
 * Protocol surface.
 *
 * We deliberately do NOT depend on `@modelcontextprotocol/sdk` for the runtime
 * path: the SDK's `Server` requires a Transport (stdio or
 * StreamableHTTPServerTransport with Express-style req/res + session manager),
 * which adds friction inside Hono for no MVP gain. The wire protocol we need
 * is a tiny subset:
 *   - initialize          → capabilities
 *   - tools/list          → enumerate registered tools
 *   - tools/call          → dispatch by tool name
 *
 * V2 may switch to the SDK once we add SSE / streaming + session resumption.
 *
 * Spec reference: https://modelcontextprotocol.io/  (2025-06-18)
 */

import { tariffLookupTool } from "./tools/tariff-lookup.js";
import { kycCheckTool } from "./tools/kyc-check.js";
import { crossWalkTool } from "./tools/cross-walk.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = {
  name: "openswissdata-mcp",
  version: "0.1.0",
} as const;

interface Tool {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  handler: (args: unknown) => {
    content: { type: "text"; text: string }[];
    isError?: boolean;
    structured?: unknown;
  };
}

const TOOLS: readonly Tool[] = [tariffLookupTool, kycCheckTool, crossWalkTool] as const;
const TOOLS_BY_NAME: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const ERR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

function err(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function listTools(): { tools: { name: string; description: string; inputSchema: unknown }[] } {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

export function getServerInfo(): {
  protocol_version: string;
  server_info: { name: string; version: string };
  capabilities: { tools: { list_changed: false } };
  tools: string[];
} {
  return {
    protocol_version: PROTOCOL_VERSION,
    server_info: { ...SERVER_INFO },
    capabilities: { tools: { list_changed: false } },
    tools: TOOLS.map((t) => t.name),
  };
}

export async function dispatch(req: unknown): Promise<JsonRpcResponse> {
  if (!req || typeof req !== "object") {
    return err(null, ERR.INVALID_REQUEST, "Request must be a JSON object");
  }
  const r = req as Partial<JsonRpcRequest>;
  const id = r.id ?? null;
  if (r.jsonrpc !== "2.0") {
    return err(id, ERR.INVALID_REQUEST, "jsonrpc must equal '2.0'");
  }
  if (typeof r.method !== "string") {
    return err(id, ERR.INVALID_REQUEST, "method must be a string");
  }

  try {
    switch (r.method) {
      case "initialize":
        return ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: { ...SERVER_INFO },
          capabilities: { tools: { listChanged: false } },
        });

      case "ping":
        return ok(id, {});

      case "tools/list":
        return ok(id, listTools());

      case "tools/call": {
        const params = r.params as { name?: string; arguments?: unknown } | undefined;
        if (!params || typeof params.name !== "string") {
          return err(id, ERR.INVALID_PARAMS, "params.name (string) is required");
        }
        const tool = TOOLS_BY_NAME[params.name];
        if (!tool) {
          return err(id, ERR.METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
        }
        const result = tool.handler(params.arguments ?? {});
        return ok(id, result);
      }

      default:
        return err(id, ERR.METHOD_NOT_FOUND, `Unknown method: ${r.method}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(id, ERR.INTERNAL_ERROR, `Internal error: ${msg}`);
  }
}
