/**
 * DB-backed store for OAuth artefacts (clients, codes, tokens).
 *
 * Lives between the route handlers and `better-sqlite3`. All token / code /
 * secret values are HMAC-SHA256 hashed (`hashToken`) before being persisted —
 * we never store plaintext.
 */

import { getDb } from "../../lib/db.js";
import { hashToken } from "./crypto.js";
import { parseScopes, serializeScopes, TIER_DEFAULT_SCOPES, type Scope, type Tier } from "./scopes.js";

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d
const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 min

export interface MCPClient {
  id: number;
  client_id: string;
  client_secret_hash: string;
  name: string;
  email: string;
  tier: Tier;
  scopes: string;
  customer_id: number | null;
  created_at: number;
  revoked_at: number | null;
  stripe_subscription_id: string | null;
}

export interface MCPAuthCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256" | "plain";
  scope: string;
  state: string | null;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

export interface MCPToken {
  id: number;
  client_id: string;
  access_token_hash: string;
  refresh_token_hash: string | null;
  scope: string;
  expires_at: number;
  refresh_expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

// ----- Clients -----------------------------------------------------------

export function insertClient(args: {
  client_id: string;
  client_secret_hash: string;
  name: string;
  email: string;
  tier: Tier;
  scopes: readonly Scope[];
  customer_id?: number | null;
  stripe_subscription_id?: string | null;
}): MCPClient {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO mcp_clients (client_id, client_secret_hash, name, email, tier, scopes, customer_id, stripe_subscription_id, created_at)
     VALUES (@client_id, @client_secret_hash, @name, @email, @tier, @scopes, @customer_id, @stripe_subscription_id, @created_at)`,
  ).run({
    ...args,
    scopes: serializeScopes(args.scopes),
    customer_id: args.customer_id ?? null,
    stripe_subscription_id: args.stripe_subscription_id ?? null,
    created_at: now,
  });
  return findClientById(args.client_id) as MCPClient;
}

export function findClientById(client_id: string): MCPClient | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM mcp_clients WHERE client_id = ?")
    .get(client_id) as MCPClient | undefined;
  return row ?? null;
}

/**
 * Find the most recent non-revoked client registered under an email. Used by
 * the Stripe webhook to upgrade an existing client after a paid subscription
 * (we match payer → client by email, since checkout carries no client_id).
 */
export function findClientByEmail(email: string): MCPClient | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM mcp_clients WHERE email = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
    .get(email) as MCPClient | undefined;
  return row ?? null;
}

/** Find the client whose paid tier is backed by a given Stripe subscription. */
export function findClientBySubscriptionId(subscriptionId: string): MCPClient | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM mcp_clients WHERE stripe_subscription_id = ?")
    .get(subscriptionId) as MCPClient | undefined;
  return row ?? null;
}

/**
 * Move a client to a new tier and REWRITE its scopes to that tier's defaults.
 *
 * Rewriting `scopes` is mandatory, not cosmetic: oauthVerify() reads the
 * `scopes` column (not TIER_DEFAULT_SCOPES) at every request, so a tier change
 * without rewriting scopes would unlock — or revoke — nothing. Optionally links
 * the Stripe customer and subscription that justified the change (pass the key
 * with `null` to clear it, e.g. on downgrade).
 */
export function setClientTier(
  client_id: string,
  tier: Tier,
  opts?: { customer_id?: number | null; stripe_subscription_id?: string | null },
): MCPClient | null {
  const db = getDb();
  const scopes = serializeScopes(TIER_DEFAULT_SCOPES[tier]);
  const sets = ["tier = @tier", "scopes = @scopes"];
  const params: Record<string, unknown> = { client_id, tier, scopes };
  if (opts && "customer_id" in opts) {
    sets.push("customer_id = @customer_id");
    params.customer_id = opts.customer_id ?? null;
  }
  if (opts && "stripe_subscription_id" in opts) {
    sets.push("stripe_subscription_id = @stripe_subscription_id");
    params.stripe_subscription_id = opts.stripe_subscription_id ?? null;
  }
  db.prepare(`UPDATE mcp_clients SET ${sets.join(", ")} WHERE client_id = @client_id`).run(params);
  return findClientById(client_id);
}

// ----- Authorization codes ----------------------------------------------

export function insertAuthCode(args: {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256" | "plain";
  scope: string;
  state: string | null;
}): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO mcp_oauth_codes
       (code, client_id, redirect_uri, code_challenge, code_challenge_method, scope, state, expires_at, created_at)
     VALUES (@code, @client_id, @redirect_uri, @code_challenge, @code_challenge_method, @scope, @state, @expires_at, @created_at)`,
  ).run({
    ...args,
    expires_at: now + AUTH_CODE_TTL_MS,
    created_at: now,
  });
}

export function consumeAuthCode(plain: string): MCPAuthCode | null {
  const db = getDb();
  const codeHash = hashToken(plain);
  const row = db
    .prepare("SELECT * FROM mcp_oauth_codes WHERE code = ?")
    .get(codeHash) as MCPAuthCode | undefined;
  if (!row) return null;
  // Mark as used (single-use).
  db.prepare("UPDATE mcp_oauth_codes SET used_at = ? WHERE code = ?").run(
    Date.now(),
    codeHash,
  );
  return row;
}

// ----- Access / refresh tokens ------------------------------------------

export function insertToken(args: {
  client_id: string;
  access_token_plain: string;
  refresh_token_plain: string | null;
  scope: string;
}): MCPToken {
  const db = getDb();
  const now = Date.now();
  const access_token_hash = hashToken(args.access_token_plain);
  const refresh_token_hash = args.refresh_token_plain
    ? hashToken(args.refresh_token_plain)
    : null;

  const result = db
    .prepare(
      `INSERT INTO mcp_tokens
         (client_id, access_token_hash, refresh_token_hash, scope, expires_at, refresh_expires_at, created_at)
       VALUES (@client_id, @access_token_hash, @refresh_token_hash, @scope, @expires_at, @refresh_expires_at, @created_at)`,
    )
    .run({
      client_id: args.client_id,
      access_token_hash,
      refresh_token_hash,
      scope: args.scope,
      expires_at: now + ACCESS_TOKEN_TTL_MS,
      refresh_expires_at: refresh_token_hash ? now + REFRESH_TOKEN_TTL_MS : null,
      created_at: now,
    });

  return findTokenByAccessHash(access_token_hash) as MCPToken;
}

export function findTokenByAccessHash(hash: string): MCPToken | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM mcp_tokens WHERE access_token_hash = ? AND revoked_at IS NULL")
    .get(hash) as MCPToken | undefined;
  return row ?? null;
}

export function findTokenByRefreshHash(hash: string): MCPToken | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM mcp_tokens WHERE refresh_token_hash = ? AND revoked_at IS NULL")
    .get(hash) as MCPToken | undefined;
  return row ?? null;
}

export function revokeTokenByHash(hash: string): boolean {
  const db = getDb();
  const result = db
    .prepare(
      "UPDATE mcp_tokens SET revoked_at = ? WHERE (access_token_hash = ? OR refresh_token_hash = ?) AND revoked_at IS NULL",
    )
    .run(Date.now(), hash, hash);
  return result.changes > 0;
}

export function clientScopes(client: MCPClient): Scope[] {
  return parseScopes(client.scopes);
}

export const TTL = {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  AUTH_CODE_TTL_MS,
} as const;
