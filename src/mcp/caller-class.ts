/**
 * Classify the caller behind an MCP request, so the kill-gate metric can count
 * REAL human MCP usage and exclude scanner/bot noise (the mistake that produced
 * the bogus "117 MCP calls" figure).
 *
 * The authenticated signal dominates the User-Agent: holding a valid OAuth
 * bearer means a real client went through the PKCE + consent flow, which a
 * scanner cannot fake. For anonymous calls we fall back to UA heuristics.
 *
 * Gate definition (see admin-stats): a call counts as a real human ONLY if its
 * class is `human_authenticated` (a valid OAuth bearer, non-admin). Going
 * through OAuth register + authorize is real enrolment effort a scanner can't
 * fake by spoofing a header. `mcp_client` (anonymous call whose UA merely looks
 * like a real client) is DIAGNOSTIC ONLY — never counted toward the gate, since
 * `curl -A "claude"` would otherwise inflate it (the exact "117" mistake).
 */

export type McpCallerClass =
  | "human_authenticated" // OAuth bearer (non-admin) — human near-certain
  | "mcp_client" //          UA of a real MCP client piloted by a human
  | "scanner" //             generic tooling / scanners hitting the endpoint
  | "bot" //                 declared crawler / preview bot
  | "unknown"; //            empty/unrecognized UA on an anonymous call — suspicious

// Real MCP clients (an agent piloted by a human).
const MCP_CLIENT_UA = /claude|anthropic|cursor|cline|continue|windsurf|librechat|mcp-remote|modelcontextprotocol|openai-node|chatgpt|copilot/;
// Declared crawlers / preview bots.
const BOT_UA = /bot|crawl|spider|slurp|preview/;
// Generic tooling / scanners.
const SCANNER_UA = /curl|wget|python-requests|httpx|aiohttp|go-http-client|java\/|libwww|scrapy|masscan|zgrab|censys|nuclei|nmap|node-fetch|undici|okhttp|axios|postman|insomnia/;

/**
 * Classify an MCP caller. `authenticated` should be true when a valid OAuth
 * bearer (or the admin bypass) was presented — it dominates the UA. For
 * anonymous calls we test crawler/scanner signatures BEFORE the MCP-client
 * allowlist, so a `ClaudeBot` crawler or a `python-requests` spoofing "claude"
 * lands in bot/scanner rather than being mislabelled `mcp_client`.
 */
export function mcpCallerClass(ua: string, authenticated: boolean): McpCallerClass {
  if (authenticated) return "human_authenticated";
  const u = (ua ?? "").toLowerCase();
  if (BOT_UA.test(u)) return "bot"; //         declared crawlers first (e.g. ClaudeBot)
  if (SCANNER_UA.test(u)) return "scanner"; // generic tooling next (e.g. python-requests/...claude)
  if (MCP_CLIENT_UA.test(u)) return "mcp_client"; // anonymous, UA looks like a real client (diagnostic only)
  // Empty or unrecognized UA on an anonymous MCP call = suspicious → unknown.
  return "unknown";
}

/**
 * Classes that count as real human MCP usage for the kill gate. ONLY
 * `human_authenticated`: anonymous classes (`mcp_client`/`unknown`) are
 * UA-based and trivially spoofable, so they are diagnostic-only.
 */
export const HUMAN_CALLER_CLASSES: readonly McpCallerClass[] = ["human_authenticated"];
