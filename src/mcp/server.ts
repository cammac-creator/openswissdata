/**
 * MCP server — JSON-RPC 2.0 dispatcher for the openswissdata Model Context
 * Protocol surface.
 *
 * We deliberately do NOT depend on `@modelcontextprotocol/sdk` for the runtime
 * path: the SDK's `Server` requires a Transport (stdio or
 * StreamableHTTPServerTransport with Express-style req/res + session manager),
 * which adds friction inside Hono for no MVP gain. The wire protocol we need
 * is a tiny subset:
 *   - initialize          → capabilities, negotiated version, instructions
 *   - tools/list          → enumerate the tools this caller may call
 *   - tools/call          → dispatch by tool name
 *   - notifications/*     → accepted without reply (HTTP 202 in the route)
 *
 * V2 may switch to the SDK once we add SSE / streaming + session resumption.
 *
 * Spec reference: https://modelcontextprotocol.io/  (2025-11-25)
 */

import { tariffLookupTool } from "./tools/tariff-lookup.js";
import { kycCheckTool } from "./tools/kyc-check.js";
import { crossWalkTool } from "./tools/cross-walk.js";
import { tariffSemanticSearchTool } from "./tools/tariff-semantic-search.js";
import { classifyTextTool } from "./tools/classify-text.js";
import { finmaSearchTool } from "./tools/finma-search.js";
import { tariffChangelogTool } from "./tools/tariff-changelog.js";
import { entityHistoryTool } from "./tools/entity-history.js";
import { TOOL_SCOPE, isToolAllowed, type MCPAuthContext } from "./oauth/index.js";
import { ANONYMOUS_TOOL_NAMES } from "./oauth/verify.js";
import { ANONYMOUS_RATE_LIMIT } from "./rate-limit.js";

// Versions servies, de la plus récente à la plus ancienne. Le serveur n'utilise que initialize,
// ping, tools/list et tools/call, dont la forme est identique dans ces quatre versions.
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/**
 * Règle de négociation MCP : renvoyer la version demandée si elle est servie, sinon la plus
 * récente. Imposer la dernière version à tous faisait échouer les clients plus anciens
 * (SDK 1.17 : « Server's protocol version is not supported »).
 */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

const SERVER_INFO = {
  name: "openswissdata-mcp",
  title: "OpenSwissData",
  version: "0.3.0",
} as const;

const PUBLIC_SITE = (process.env.BASE_URL ?? "https://www.openswissdata.com").replace(/\/$/, "");
const ANONYMOUS_LIMIT_TEXT = `${ANONYMOUS_RATE_LIMIT.calls} calls per ${ANONYMOUS_RATE_LIMIT.window} per IP address`;

/**
 * Consignes lues par l'agent à la connexion : ce qui est gratuit, comment appeler, ce qu'il faut citer.
 * Jamais la suite de caractères « data » + deux-points : certains clients la cherchent pour deviner une
 * réponse en flux SSE et ne lisent alors plus le JSON (sonde d'awesome-remote-mcp-servers, 28.09.2026).
 */
export const SERVER_INSTRUCTIONS = [
  "OpenSwissData serves normalised copies of Swiss federal reference data. It covers the Swiss customs tariff (TARES, 8-digit Swiss tariff numbers with MFN duty, preferential regimes and restrictions), the FINMA register of supervised institutions plus the FINMA warnings list, and correspondences between the NOGA 2008/2025, NACE 2.0/2.1 and ISIC 4 activity classifications.",
  `Free without any key or sign-up (${ANONYMOUS_LIMIT_TEXT}):`,
  "- tariff_lookup: an 8-digit Swiss tariff number (dots allowed, e.g. 8471.3000) returns the full TARES line; a 2- to 7-digit HS prefix (e.g. the international HS6 code 847130) lists the Swiss 8-digit lines under it. Set lang to en, de, it or fr (default fr).",
  "- kyc_check: search the FINMA register and the FINMA warnings list by entity name.",
  "- cross_walk: map a code between NOGA 2008, NOGA 2025, NACE 2.0, NACE 2.1 and ISIC 4, with the relation type and its source.",
  "The other tools (semantic search, change history) belong to the Pro plan, which is closed to new subscribers at the moment.",
  "The data is an unofficial copy: tell the user so, show the notice when a result carries one, and point to the official source (xtares.admin.ch, finma.ch, the Swiss Federal Statistical Office) for binding decisions.",
  `Documentation for agents: ${PUBLIC_SITE}/llms.txt. Full datasets are sold as signed files: ${PUBLIC_SITE}/en/`,
].join("\n");

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: unknown;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  /**
   * Tool handlers may be sync (CSV-only tools) or async (embedding-based
   * tools that await `@huggingface/transformers`). The dispatch layer awaits the
   * return value uniformly.
   */
  handler: (args: unknown) => ToolResult | Promise<ToolResult>;
}

const TOOLS: readonly Tool[] = [
  tariffLookupTool,
  kycCheckTool,
  crossWalkTool,
  tariffSemanticSearchTool,
  classifyTextTool,
  finmaSearchTool,
  tariffChangelogTool,
  entityHistoryTool,
] as const;
const TOOLS_BY_NAME = new Map<string, Tool>(TOOLS.map((t) => [t.name, t]));

// Titres lisibles (MCP 2025-06-18) ; tous les outils lisent des données sans rien modifier.
const TOOL_TITLES = new Map<string, string>([
  ["tariff_lookup", "Swiss customs tariff line (TARES)"],
  ["kyc_check", "FINMA register and warnings list check"],
  ["cross_walk", "NOGA / NACE / ISIC code correspondence"],
  ["tariff_semantic_search", "TARES semantic search (French descriptions)"],
  ["classify_text", "NOGA 2025 classification of a business description"],
  ["finma_search", "FINMA register fuzzy name search"],
  ["tariff_changelog", "TARES duty rate history"],
  ["entity_history", "FINMA entity change history"],
]);
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

// Piste gratuite proposée quand un appel anonyme vise un outil qui exige des droits.
const FREE_ALTERNATIVE = new Map<string, string>([
  ["tariff_semantic_search", "If you know the international HS code (4 or 6 digits), call tariff_lookup with it: it lists the Swiss 8-digit lines under that prefix."],
  ["classify_text", "If you have a candidate NOGA, NACE or ISIC code, call cross_walk to get its correspondences."],
  ["finma_search", "Call kyc_check with the entity name or a distinctive part of it: it searches the FINMA register and the FINMA warnings list."],
  ["tariff_changelog", "There is no free equivalent: tariff_lookup returns the current line only."],
  ["entity_history", "There is no free equivalent: kyc_check returns the current register entry only."],
]);

function scopeOf(name: string) {
  return Object.hasOwn(TOOL_SCOPE, name) ? TOOL_SCOPE[name] : null;
}

/** Outils que cet appelant peut réellement appeler : un agent ne voit pas d'outil qui lui serait refusé. */
export function callableBy(ctx: MCPAuthContext | null): (name: string) => boolean {
  return (name) => isToolAllowed(name, scopeOf(name), ctx);
}

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

export function listTools(canCall: (name: string) => boolean = () => true): {
  tools: { name: string; title: string; description: string; inputSchema: unknown; annotations: Record<string, unknown> }[];
} {
  return {
    tools: TOOLS.filter((t) => canCall(t.name)).map((t) => {
      const title = TOOL_TITLES.get(t.name) ?? t.name;
      return {
        name: t.name,
        title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: { title, ...READ_ONLY_ANNOTATIONS },
      };
    }),
  };
}

export function getServerInfo(canCall: (name: string) => boolean = () => true): {
  protocol_version: string;
  supported_protocol_versions: readonly string[];
  server_info: { name: string; title: string; version: string };
  capabilities: { tools: { list_changed: false } };
  tools: string[];
  anonymous_access: { tools: readonly string[]; limit: string };
  documentation: string;
} {
  return {
    protocol_version: LATEST_PROTOCOL_VERSION,
    supported_protocol_versions: SUPPORTED_PROTOCOL_VERSIONS,
    server_info: { ...SERVER_INFO },
    capabilities: { tools: { list_changed: false } },
    tools: TOOLS.filter((t) => canCall(t.name)).map((t) => t.name),
    anonymous_access: { tools: ANONYMOUS_TOOL_NAMES, limit: ANONYMOUS_LIMIT_TEXT },
    documentation: `${PUBLIC_SITE}/llms.txt`,
  };
}

/** Refus lisible par l'agent (résultat d'outil), plutôt qu'une erreur de protocole qui interrompt sa tâche. */
function anonymousRefusal(name: string): ToolResult {
  const alternative = FREE_ALTERNATIVE.get(name) ?? "";
  const text = [
    `'${name}' cannot be called without an access token. It belongs to the OpenSwissData Pro plan, which is closed to new subscribers at the moment, so no token can be obtained today.`,
    alternative,
    `Free tools without a key: ${ANONYMOUS_TOOL_NAMES.join(", ")} (${ANONYMOUS_LIMIT_TEXT}).`,
    `Full datasets are sold as signed files: ${PUBLIC_SITE}/en/`,
  ].filter(Boolean).join("\n");
  return { content: [{ type: "text", text }], isError: true };
}

/** Réponse JSON-RPC, ou `null` pour une notification (message sans `id`), qui n'appelle aucune réponse. */
export async function dispatch(
  req: unknown,
  ctx: MCPAuthContext | null = null,
): Promise<JsonRpcResponse | null> {
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
  // JSON-RPC : une notification n'a pas de membre id ; aucune exécution, aucune réponse.
  if (!Object.hasOwn(r, "id")) return null;

  try {
    switch (r.method) {
      case "initialize": {
        const params = (r.params ?? {}) as { protocolVersion?: unknown };
        return ok(id, {
          protocolVersion: negotiateProtocolVersion(params.protocolVersion),
          serverInfo: { ...SERVER_INFO },
          capabilities: { tools: { listChanged: false } },
          instructions: SERVER_INSTRUCTIONS,
        });
      }

      case "ping":
        return ok(id, {});

      case "tools/list":
        return ok(id, listTools(callableBy(ctx)));

      case "tools/call": {
        const params = r.params as { name?: string; arguments?: unknown } | undefined;
        if (!params || typeof params.name !== "string") {
          return err(id, ERR.INVALID_PARAMS, "params.name (string) is required");
        }
        const tool = TOOLS_BY_NAME.get(params.name);
        if (!tool) {
          return err(id, ERR.METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
        }

        // OAuth scope check — anonymous callers only get V1 tools, token
        // bearers must hold the scope the tool requires (see TOOL_SCOPE).
        const required = scopeOf(params.name);
        if (!isToolAllowed(params.name, required, ctx)) {
          // Anonyme : refus explicite et piste gratuite. Jeton authentifié : refus de portée inchangé.
          if (ctx === null) return ok(id, anonymousRefusal(params.name));
          return err(
            id,
            -32001,
            `Insufficient scope for tool '${params.name}' (requires '${required ?? "?"}')`,
          );
        }

        // Always await — some handlers are sync (CSV lookup) and some are
        // async (embedding pipeline). `await` of a non-promise is a no-op.
        const result = await tool.handler(params.arguments ?? {});
        return ok(id, result);
      }

      default:
        return err(id, ERR.METHOD_NOT_FOUND, `Unknown method: ${r.method}`);
    }
  } catch {
    reportToolFailure();
    return err(id, ERR.INTERNAL_ERROR, 'Internal error');
  }
}

let lastToolFailureLog = 0;
function reportToolFailure(): void {
  try {
    const now = Date.now();
    if (lastToolFailureLog && now >= lastToolFailureLog && now - lastToolFailureLog < 60_000) return;
    lastToolFailureLog = now;
    console.warn('[mcp] exécution temporairement indisponible');
  } catch { /* Aucun argument, secret ou détail technique dans la réponse. */ }
}
