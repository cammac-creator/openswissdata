/**
 * OAuth 2.1 scopes for the openswissdata MCP server.
 *
 * Each scope grants access to a slice of the tool surface. The mapping
 * tool_name → required_scope is consulted by the OAuth verify middleware
 * BEFORE dispatch, so unauthorized tools never run.
 *
 * Tier defaults:
 *   - free       : no scope (unauthenticated free-tier IP rate limit only)
 *                  OR `tariff:read classifications:read finma:read` if the
 *                  client has registered.
 *   - standard   : `tariff:read classifications:read finma:read`
 *   - pro        : adds `tariff:semantic tariff:history classifications:semantic
 *                  statent:read finma:history`
 *   - standalone : 5k/month dedicated MCP subscription — same as standard.
 *
 * V2 will refine this once per-tool tiering is finalised in marketing copy.
 */

export const SCOPES = [
  "tariff:read",
  "tariff:semantic",
  "tariff:history",
  "classifications:read",
  "classifications:semantic",
  "statent:read",
  "finma:read",
  "finma:history",
] as const;

export type Scope = (typeof SCOPES)[number];

/**
 * Map every known MCP tool to the scope required to call it.
 * Keep in sync with tools registered in `src/mcp/server.ts`.
 *
 * NOTE: the V1 tools (`tariff_lookup`, `kyc_check`, `cross_walk`) all map to
 * `:read` scopes — granted by default to every registered free tier client.
 */
export const TOOL_SCOPE: Readonly<Record<string, Scope>> = {
  // V1 tools (shipped)
  tariff_lookup: "tariff:read",
  kyc_check: "finma:read",
  cross_walk: "classifications:read",

  // V2 tools (planned — registered here so /oauth/authorize can include them
  // in the requested scope set up-front).
  tariff_semantic_search: "tariff:semantic",
  tariff_changelog: "tariff:history",
  classify_text: "classifications:semantic",
  statent_lookup: "statent:read",
  entity_history: "finma:history",
  finma_search: "finma:read",
} as const;

/** Tier → default granted scopes when registering a new client. */
export const TIER_DEFAULT_SCOPES: Readonly<Record<string, readonly Scope[]>> = {
  free: ["tariff:read", "classifications:read", "finma:read"],
  standard: ["tariff:read", "classifications:read", "finma:read"],
  pro: [
    "tariff:read",
    "tariff:semantic",
    "tariff:history",
    "classifications:read",
    "classifications:semantic",
    "statent:read",
    "finma:read",
    "finma:history",
  ],
  standalone: ["tariff:read", "classifications:read", "finma:read"],
};

/** Tier → daily request quota. -1 means use the monthly bucket only. */
export const TIER_QUOTA = {
  free: { day: 100, month: 100 * 30 }, // soft cap
  standard: { day: -1, month: 1_000 },
  pro: { day: -1, month: 10_000 },
  standalone: { day: -1, month: 5_000 },
} as const;

export type Tier = keyof typeof TIER_QUOTA;

export function isValidTier(t: string): t is Tier {
  return t === "free" || t === "standard" || t === "pro" || t === "standalone";
}

export function isValidScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}

/** Parses a space-separated scope string into a deduped array of valid scopes. */
export function parseScopes(input: string | undefined | null): Scope[] {
  if (!input) return [];
  const out = new Set<Scope>();
  for (const s of input.split(/\s+/)) {
    if (isValidScope(s)) out.add(s);
  }
  return [...out];
}

export function serializeScopes(scopes: readonly Scope[]): string {
  return scopes.join(" ");
}
