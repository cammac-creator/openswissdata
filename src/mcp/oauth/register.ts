/**
 * POST /oauth/register — Dynamic Client Registration (RFC 7591 — minimal).
 *
 * Body (JSON):
 *   {
 *     "name": "My MCP integration",
 *     "email": "dev@example.com",
 *     "tier": "free" | "standard" | "pro" | "standalone",   // optional, default "free"
 *     "redirect_uris": ["http://localhost:8765/callback"]    // not stored — declared at /authorize
 *   }
 *
 * Response (201):
 *   {
 *     "client_id": "osd_<base64url>",
 *     "client_secret": "<base64url>",   // shown ONCE — re-registration required if lost
 *     "tier": "free",
 *     "scopes": "tariff:read classifications:read finma:read",
 *     "token_endpoint": "https://mcp.openswissdata.com/oauth/token",
 *     "authorization_endpoint": "https://mcp.openswissdata.com/oauth/authorize"
 *   }
 *
 * In production, paid tiers (standard / pro / standalone) MUST be activated
 * by the Stripe webhook — registering with `tier=pro` here only gets you
 * `tier=free` until a paid order is fulfilled. We keep the field on the
 * registration request as a hint for the email confirmation copy.
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  generateClientId,
  generateClientSecret,
  hashToken,
} from "./crypto.js";
import { insertClient } from "./store.js";
import {
  TIER_DEFAULT_SCOPES,
  isValidTier,
  serializeScopes,
  type Tier,
} from "./scopes.js";

const RegisterSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  tier: z.string().optional(),
  redirect_uris: z.array(z.string().url()).optional(),
});

export const registerRoute = new Hono();

registerRoute.post("/register", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request", error_description: "JSON body required" }, 400);
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", error_description: parsed.error.message },
      400,
    );
  }

  // Paid tiers only granted by webhook later — bound the requested tier here.
  const requestedTier = parsed.data.tier ?? "free";
  const tier: Tier = isValidTier(requestedTier) ? "free" : "free";
  // Note: requestedTier is captured but ignored — registration always lands on
  // 'free'. The Stripe webhook will UPGRADE the row once the order is paid.
  void requestedTier;

  const clientId = generateClientId();
  const clientSecret = generateClientSecret();
  const scopes = TIER_DEFAULT_SCOPES[tier];

  insertClient({
    client_id: clientId,
    client_secret_hash: hashToken(clientSecret),
    name: parsed.data.name,
    email: parsed.data.email,
    tier,
    scopes,
  });

  const baseUrl = process.env.MCP_BASE_URL ?? "https://mcp.openswissdata.com";

  return c.json(
    {
      client_id: clientId,
      client_secret: clientSecret,
      tier,
      scopes: serializeScopes(scopes),
      token_endpoint: `${baseUrl}/oauth/token`,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      revoke_endpoint: `${baseUrl}/oauth/revoke`,
    },
    201,
  );
});
