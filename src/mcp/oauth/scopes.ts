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
 *   - pro        : all 8 scopes (the full premium tool surface).
 *   - standalone : 5k/month paid MCP subscription (Pro 49 CHF/mo) — grants the
 *                  full premium tool surface ("the 9 MCP tools" promised on
 *                  /pricing), same scopes as `pro`.
 *   - business   : 50k/month paid MCP subscription (199 CHF/mo) — same premium
 *                  scopes as standalone/pro, differs ONLY by monthly quota.
 *
 * The paid tiers (standalone/business) are activated by the Stripe webhook
 * after a subscription is paid — see src/routes/stripe-webhook.ts.
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

/** The full premium tool surface — all 8 scopes (= "the 9 MCP tools"). */
const ALL_PREMIUM_SCOPES: readonly Scope[] = [
  "tariff:read",
  "tariff:semantic",
  "tariff:history",
  "classifications:read",
  "classifications:semantic",
  "statent:read",
  "finma:read",
  "finma:history",
];

/** Tier → default granted scopes when registering / upgrading a client. */
export const TIER_DEFAULT_SCOPES: Readonly<Record<string, readonly Scope[]>> = {
  free: ["tariff:read", "classifications:read", "finma:read"],
  standard: ["tariff:read", "classifications:read", "finma:read"],
  pro: ALL_PREMIUM_SCOPES,
  // Paid subscription tiers grant the full premium surface. Pro/standalone
  // (49 CHF) and business (199 CHF) differ ONLY by monthly quota, matching the
  // live /pricing page ("the 9 MCP tools" on both, 5k vs 50k requests/month).
  standalone: ALL_PREMIUM_SCOPES,
  business: ALL_PREMIUM_SCOPES,
};

/** Tier → daily request quota. -1 means use the monthly bucket only. */
export const TIER_QUOTA = {
  free: { day: 100, month: 100 * 30 }, // soft cap
  standard: { day: -1, month: 1_000 },
  pro: { day: -1, month: 10_000 },
  standalone: { day: -1, month: 5_000 },
  business: { day: -1, month: 50_000 },
} as const;

export type Tier = keyof typeof TIER_QUOTA;

export function isValidTier(t: string): t is Tier {
  return (
    t === "free" ||
    t === "standard" ||
    t === "pro" ||
    t === "standalone" ||
    t === "business"
  );
}

/**
 * Maps a paid subscription SKU (as carried in Stripe Checkout metadata
 * `dataset_ids`) to the MCP tier it grants. Single source of truth consumed by
 * the Stripe webhook to provision/upgrade a client after payment.
 * Keep in sync with SUBSCRIPTION_PRICE_ENV in src/routes/checkout.ts.
 */
export const SKU_TO_TIER: Readonly<Record<string, Tier>> = {
  mcp_standalone: "standalone",
  mcp_business: "business",
};

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
