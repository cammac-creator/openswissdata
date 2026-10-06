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
import { companyCheckTool } from "./tools/company-check.js";
import { crossWalkTool } from "./tools/cross-walk.js";
import { tariffSemanticSearchTool } from "./tools/tariff-semantic-search.js";
import { classifyTextTool } from "./tools/classify-text.js";
import { finmaSearchTool } from "./tools/finma-search.js";
import { tariffChangelogTool } from "./tools/tariff-changelog.js";
import { entityHistoryTool } from "./tools/entity-history.js";
import { TOOL_SCOPE, isToolAllowed, type MCPAuthContext } from "./oauth/index.js";
import { ANONYMOUS_TOOL_NAMES, ANONYMOUS_TRIAL_TOOL_NAMES, isTrialTool } from "./oauth/verify.js";
import { ANONYMOUS_RATE_LIMIT, ANONYMOUS_TRIAL_LIMIT, type TrialResult } from "./rate-limit.js";

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
const TRIAL_LIMIT_TEXT = `${ANONYMOUS_TRIAL_LIMIT.calls} calls per ${ANONYMOUS_TRIAL_LIMIT.window} per IP address`;
const TRIAL_TOOLS_TEXT = `${ANONYMOUS_TRIAL_TOOL_NAMES.slice(0, -1).join(", ")} and ${ANONYMOUS_TRIAL_TOOL_NAMES[ANONYMOUS_TRIAL_TOOL_NAMES.length - 1]}`;
const TRIAL_WINDOW_HOURS = ANONYMOUS_TRIAL_LIMIT.windowMs / 3_600_000;

/**
 * Vérification officielle rappelée dans chaque réponse d'essai : l'essai sert à juger l'outil,
 * jamais à fonder une décision sur une copie non officielle.
 */
const OFFICIAL_CHECK = new Map<string, { short: string; url: string; text: string }>([
  ["tariff_semantic_search", {
    short: "the official tariff at xtares.admin.ch",
    url: "https://xtares.admin.ch",
    text: "Check the tariff number, its duties and conditions in the official Swiss customs tariff (Tares) at https://xtares.admin.ch before any customs declaration.",
  }],
  ["classify_text", {
    short: "the NOGA publications of the Federal Statistical Office",
    url: "https://www.bfs.admin.ch/bfs/en/home/statistics/industry-services/nomenclatures/noga.html",
    text: "Check the NOGA code in the publications of the Swiss Federal Statistical Office: https://www.bfs.admin.ch/bfs/en/home/statistics/industry-services/nomenclatures/noga.html. A similarity score is not an official classification.",
  }],
  ["finma_search", {
    short: "the official FINMA register",
    url: "https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/",
    text: "Check the institution in the official FINMA register: https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/ (FINMA warning list: https://www.finma.ch/en/finma-public/warnungen/warning-list/).",
  }],
]);

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
  "- company_check: a Swiss UID (CHE-xxx.xxx.xxx) returns commercial register data (LINDAS), FINMA register entries and LEI records (GLEIF), each fact with its source, plus exact cross-checks. It does not say whether the company is still registered.",
  "- cross_walk: map a code between NOGA 2008, NOGA 2025, NACE 2.0, NACE 2.1 and ISIC 4, with the relation type and its source.",
  `Free trial without a key, limited to ${TRIAL_LIMIT_TEXT} in total: ${TRIAL_TOOLS_TEXT} (search TARES lines by goods description, NOGA 2025 codes by activity description, the FINMA register with typo tolerance); each trial answer states the calls left and the official source on which to check the result before use.`,
  "The change history tools (tariff_changelog, entity_history) belong to the Pro plan, which is closed to new subscribers at the moment.",
  "The data is an unofficial copy: tell the user so, show the notice when a result carries one, and point to the official source (xtares.admin.ch, finma.ch, the Swiss Federal Statistical Office) for binding decisions.",
  `Documentation for agents: ${PUBLIC_SITE}/llms.txt. Full datasets are sold as signed files: ${PUBLIC_SITE}/en/`,
].join("\n");

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: unknown;
  /** Compteur d'essai d'un appel anonyme à un outil de recherche (absent pour tous les autres appels). */
  trial?: TrialInfo;
}

/** État de l'essai renvoyé à l'agent : aucune donnée sur le réseau lui-même. */
export interface TrialInfo {
  tools: readonly string[];
  limit: number;
  used: number;
  remaining: number;
  window_hours: number;
  resets_at: string;
  official_check: string;
  retry_after_seconds?: number;
}

/**
 * Compteur d'essai d'une requête anonyme, fourni par la route (qui connaît le réseau et mesure).
 * `consume` est appelé de façon synchrone avant l'exécution : dans un lot, l'ordre des messages
 * décide lesquels sont servis.
 */
export interface TrialGate {
  consume(tool: string): TrialResult;
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
  companyCheckTool,
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
  ["company_check", "Swiss company check by UID"],
  ["cross_walk", "NOGA / NACE / ISIC code correspondence"],
  ["tariff_semantic_search", "TARES search by goods description (FR/DE/IT/EN)"],
  ["classify_text", "NOGA 2025 classification of a business description"],
  ["finma_search", "FINMA register fuzzy name search"],
  ["tariff_changelog", "TARES duty rate history"],
  ["entity_history", "FINMA entity change history"],
]);
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
// `company_check` interroge en direct deux sources tierces (LINDAS, GLEIF) à chaque appel non
// mis en cache : seul outil dont l'annotation `openWorldHint` vaut `true` (tous les autres
// lisent une copie locale, jamais le monde extérieur en direct).
const OPEN_WORLD_ANNOTATIONS = { ...READ_ONLY_ANNOTATIONS, openWorldHint: true } as const;
function annotationsFor(name: string): Record<string, unknown> {
  return name === "company_check" ? OPEN_WORLD_ANNOTATIONS : READ_ONLY_ANNOTATIONS;
}

// Piste gratuite proposée quand un appel anonyme vise un outil qui exige des droits, ou quand
// l'essai des outils de recherche est épuisé pour ce réseau.
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

/**
 * Outils présentés. `trial` (appelant anonyme) signale l'essai dans le titre et en tête de la
 * description des outils de recherche ; un jeton voit les textes d'origine. Jamais la suite
 * « data » + deux-points dans ces textes (voir SERVER_INSTRUCTIONS).
 */
export function listTools(canCall: (name: string) => boolean = () => true, opts: { trial?: boolean } = {}): {
  tools: { name: string; title: string; description: string; inputSchema: unknown; annotations: Record<string, unknown> }[];
} {
  return {
    tools: TOOLS.filter((t) => canCall(t.name)).map((t) => {
      const trial = opts.trial === true && isTrialTool(t.name);
      const base = TOOL_TITLES.get(t.name) ?? t.name;
      const title = trial ? `${base} (free trial, ${ANONYMOUS_TRIAL_LIMIT.calls} calls per ${ANONYMOUS_TRIAL_LIMIT.window})` : base;
      const description = trial
        ? `FREE TRIAL without a key: ${TRIAL_LIMIT_TEXT} in total for ${TRIAL_TOOLS_TEXT}. Each answer states the trial calls left; check every result on ${OFFICIAL_CHECK.get(t.name)?.short ?? "the official source"} before use. ${t.description}`
        : t.description;
      return {
        name: t.name,
        title,
        description,
        inputSchema: t.inputSchema,
        annotations: { title, ...annotationsFor(t.name) },
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
  anonymous_access: { tools: readonly string[]; limit: string; trial: { tools: readonly string[]; limit: string; window_hours: number } };
  documentation: string;
} {
  return {
    protocol_version: LATEST_PROTOCOL_VERSION,
    supported_protocol_versions: SUPPORTED_PROTOCOL_VERSIONS,
    server_info: { ...SERVER_INFO },
    capabilities: { tools: { list_changed: false } },
    tools: TOOLS.filter((t) => canCall(t.name)).map((t) => t.name),
    anonymous_access: {
      tools: ANONYMOUS_TOOL_NAMES,
      limit: ANONYMOUS_LIMIT_TEXT,
      trial: { tools: ANONYMOUS_TRIAL_TOOL_NAMES, limit: TRIAL_LIMIT_TEXT, window_hours: TRIAL_WINDOW_HOURS },
    },
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
    `Free trial without a key (${TRIAL_LIMIT_TEXT} in total): ${TRIAL_TOOLS_TEXT}.`,
    `Full datasets are sold as signed files: ${PUBLIC_SITE}/en/`,
  ].filter(Boolean).join("\n");
  return { content: [{ type: "text", text }], isError: true };
}

const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function trialInfo(name: string, outcome: TrialResult): TrialInfo {
  return {
    tools: ANONYMOUS_TRIAL_TOOL_NAMES,
    limit: outcome.limit,
    used: outcome.used,
    remaining: outcome.remaining,
    window_hours: TRIAL_WINDOW_HOURS,
    resets_at: isoSeconds(outcome.resetAt),
    official_check: OFFICIAL_CHECK.get(name)?.url ?? PUBLIC_SITE,
  };
}

/**
 * Réponse d'essai : compteur et rappel de vérification ajoutés au premier texte (un agent qui ne
 * transmet que content[0].text les garde), y compris pour une entrée invalide, qui a coûté un appel.
 */
function withTrialNotice(name: string, result: ToolResult, outcome: TrialResult): ToolResult {
  const notice = [
    `FREE TRIAL (no key): ${outcome.remaining} of ${outcome.limit} trial calls left for this network until ${isoSeconds(outcome.resetAt)}, shared by ${TRIAL_TOOLS_TEXT}.`,
    OFFICIAL_CHECK.get(name)?.text ?? "Check the result on the official source before use.",
  ].join("\n");
  const [first, ...rest] = Array.isArray(result.content) ? result.content : [];
  const content = first && typeof first.text === "string"
    ? [{ ...first, text: `${first.text}\n\n${notice}` }, ...rest]
    : [{ type: "text" as const, text: notice }, ...rest];
  return { ...result, content, trial: trialInfo(name, outcome) };
}

/** Essai épuisé : résultat lisible, délai de reprise, piste gratuite ; aucun lien d'achat (offre Pro fermée). */
function trialExhausted(name: string, outcome: TrialResult): ToolResult {
  const retryAfter = Math.max(1, Math.ceil((outcome.resetAt - Date.now()) / 1000));
  const text = [
    `The free trial is used up for this network: ${TRIAL_LIMIT_TEXT} in total for ${TRIAL_TOOLS_TEXT}. It opens again at ${isoSeconds(outcome.resetAt)}; retry after ${retryAfter} seconds.`,
    FREE_ALTERNATIVE.get(name) ?? "",
    `Free tools without a key remain available: ${ANONYMOUS_TOOL_NAMES.join(", ")} (${ANONYMOUS_LIMIT_TEXT}).`,
    "The Pro plan is closed to new subscribers at the moment, so no access token can be obtained today.",
  ].filter(Boolean).join("\n");
  return {
    content: [{ type: "text", text }],
    isError: true,
    trial: { ...trialInfo(name, outcome), retry_after_seconds: retryAfter },
  };
}

/** Appel direct sans compteur (hors de la route HTTP) : l'essai n'est jamais servi sans décompte. */
function trialUnavailable(name: string): ToolResult {
  const text = [
    `'${name}' is offered without a key only within the free trial, which could not be counted for this request.`,
    FREE_ALTERNATIVE.get(name) ?? "",
    `Free tools without a key: ${ANONYMOUS_TOOL_NAMES.join(", ")} (${ANONYMOUS_LIMIT_TEXT}).`,
  ].filter(Boolean).join("\n");
  return { content: [{ type: "text", text }], isError: true };
}

/** Réponse JSON-RPC, ou `null` pour une notification (message sans `id`), qui n'appelle aucune réponse. */
export async function dispatch(
  req: unknown,
  ctx: MCPAuthContext | null = null,
  trial: TrialGate | null = null,
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
        return ok(id, listTools(callableBy(ctx), { trial: ctx === null }));

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

        // Essai anonyme : décompte synchrone, avant toute attente, puis exécution et rappel.
        if (ctx === null && isTrialTool(params.name)) {
          const outcome = trial ? trial.consume(params.name) : null;
          if (!outcome) return ok(id, trialUnavailable(params.name));
          if (!outcome.allowed) return ok(id, trialExhausted(params.name, outcome));
          const served = await tool.handler(params.arguments ?? {});
          return ok(id, withTrialNotice(params.name, served, outcome));
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
