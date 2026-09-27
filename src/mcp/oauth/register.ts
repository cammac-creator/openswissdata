/**
 * POST /oauth/register — Dynamic Client Registration (RFC 7591 — minimal).
 *
 * Body (JSON):
 *   {
 *     "name": "My MCP integration",
 *     "email": "dev@example.com",
 *     "tier": "free" | "standard" | "pro" | "standalone",   // optional, default "free"
 *     "redirect_uris": ["http://localhost:8765/callback"]    // liste explicite persistée
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
 * L'inscription ne crée que des droits gratuits. Une application payante est
 * distincte : son attribution ne peut jamais reposer sur l'email déclaré ici.
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  generateClientId,
  generateClientSecret,
  hashToken,
} from "./crypto.js";
import { insertClient } from "./store.js";
import {RedirectUrisSchema} from './redirects.js';
import { TIER_DEFAULT_SCOPES, serializeScopes, type Tier } from "./scopes.js";
import {
  oauthRegisterBucket,
  checkRateLimit,
  getClientIp,
} from "../../lib/rate-limit.js";

const RegisterSchema = z.object({
  name: z.string().trim().min(1).max(120).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
  email: z.string().email(),
  tier: z.string().optional(),
  redirect_uris: RedirectUrisSchema,
});

export const registerRoute = new Hono();

registerRoute.post("/register", async (c) => {
  // Rate-limit: open registration → easy spam vector if uncapped.
  if (!checkRateLimit(oauthRegisterBucket, getClientIp(c))) {
    return c.json({ error: "too_many_requests" }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request", error_description: "JSON body required" }, 400);
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues.some(issue => issue.path[0] === 'redirect_uris') ? 'invalid_redirect_uri' : 'invalid_client_metadata' },
      400,
    );
  }

  // Une inscription publique reste gratuite. Son email n'est pas vérifié et
  // ne permet jamais de récupérer les droits d'un acheteur. Les abonnements
  // créent une application distincte ; le champ tier reçu est ignoré.
  const tier: Tier = "free";

  const clientId = generateClientId();
  const clientSecret = generateClientSecret();
  const scopes = TIER_DEFAULT_SCOPES[tier];

  try { insertClient({
    client_id: clientId,
    client_secret_hash: hashToken(clientSecret),
    name: parsed.data.name,
    email: parsed.data.email,
    tier,
    scopes,
    redirect_uris: parsed.data.redirect_uris,
  }); } catch {
    c.header('Retry-After', '1');
    return c.json({error: 'temporarily_unavailable'}, 503);
  }

  const baseUrl = process.env.MCP_BASE_URL ?? "https://mcp.openswissdata.com";

  return c.json(
    {
      client_id: clientId,
      client_secret: clientSecret,
      tier,
      scopes: serializeScopes(scopes),
      redirect_uris: parsed.data.redirect_uris,
      token_endpoint: `${baseUrl}/oauth/token`,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      revoke_endpoint: `${baseUrl}/oauth/revoke`,
    },
    201,
  );
});
