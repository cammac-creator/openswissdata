/**
 * GET /oauth/authorize — Authorization endpoint with PKCE.
 *
 * Query params (RFC 6749 §4.1.1 + RFC 7636):
 *   response_type=code               (required, only "code" is supported)
 *   client_id=<id>                   (required)
 *   redirect_uri=<absolute URL>      (required, http(s) or "localhost")
 *   code_challenge=<base64url(SHA256(verifier))>  (required, S256)
 *   code_challenge_method=S256       (required, only S256 supported)
 *   scope="tariff:read finma:read"   (optional, defaults to client tier scopes)
 *   state=<opaque>                   (optional but RECOMMENDED — echoed back)
 *
 * Behaviour:
 *   - If valid: render a minimal HTML "consent" page with an auto-submit form
 *     that POSTs to /oauth/authorize/decision. For an MVP/B2B flow we don't
 *     gate behind a login (the token-bearer is the dev who registered).
 *
 * POST /oauth/authorize/decision — issues the authorization code and 302's.
 *
 * Spec: OAuth 2.1 draft (https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/).
 */

import { Hono } from "hono";
import { z } from "zod";
import { generateAuthCode, hashToken } from "./crypto.js";
import { findClientById, insertAuthCode } from "./store.js";
import {
  parseScopes,
  serializeScopes,
  type Scope,
} from "./scopes.js";

const QuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.enum(["S256", "plain"]).default("S256"),
  scope: z.string().optional(),
  state: z.string().optional(),
});

export const authorizeRoute = new Hono();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

authorizeRoute.get("/authorize", (c) => {
  const parsed = QuerySchema.safeParse({
    response_type: c.req.query("response_type"),
    client_id: c.req.query("client_id"),
    redirect_uri: c.req.query("redirect_uri"),
    code_challenge: c.req.query("code_challenge"),
    code_challenge_method: c.req.query("code_challenge_method") ?? "S256",
    scope: c.req.query("scope"),
    state: c.req.query("state"),
  });
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", error_description: parsed.error.message },
      400,
    );
  }
  if (parsed.data.code_challenge_method !== "S256") {
    return c.json(
      { error: "invalid_request", error_description: "Only S256 PKCE is supported" },
      400,
    );
  }

  const client = findClientById(parsed.data.client_id);
  if (!client || client.revoked_at) {
    return c.json({ error: "invalid_client" }, 400);
  }

  // Intersect requested scope with client-allowed scope.
  const clientScopes = parseScopes(client.scopes);
  const requested = parsed.data.scope ? parseScopes(parsed.data.scope) : clientScopes;
  const granted: Scope[] = requested.filter((s) => clientScopes.includes(s));
  if (granted.length === 0) {
    return c.json(
      { error: "invalid_scope", error_description: "No requested scope is granted to this client" },
      400,
    );
  }

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Autoriser ${escapeHtml(client.name)} — openswissdata MCP</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; color: #111; }
    h1 { font-size: 22px; margin-bottom: 8px; }
    .scope { display:inline-block; padding: 2px 8px; border-radius: 4px; background: #eef; font-family: ui-monospace, monospace; font-size: 13px; margin: 2px; }
    button { background: #4f46e5; color: white; border: 0; padding: 12px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .deny { background: #999; margin-left: 8px; }
    p.muted { color:#666; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Autoriser <em>${escapeHtml(client.name)}</em>?</h1>
  <p class="muted">Cette application demande l'accès aux scopes suivants :</p>
  <p>${granted.map((s) => `<span class="scope">${escapeHtml(s)}</span>`).join(" ")}</p>
  <p class="muted">Tier : <strong>${escapeHtml(client.tier)}</strong></p>
  <form method="POST" action="/oauth/authorize/decision">
    <input type="hidden" name="client_id" value="${escapeHtml(parsed.data.client_id)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(parsed.data.redirect_uri)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(parsed.data.code_challenge)}">
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(parsed.data.code_challenge_method)}">
    <input type="hidden" name="scope" value="${escapeHtml(serializeScopes(granted))}">
    <input type="hidden" name="state" value="${escapeHtml(parsed.data.state ?? "")}">
    <button type="submit" name="decision" value="allow">Autoriser</button>
    <button type="submit" name="decision" value="deny" class="deny">Refuser</button>
  </form>
</body>
</html>`;

  return c.html(html);
});

authorizeRoute.post("/authorize/decision", async (c) => {
  const form = await c.req.parseBody();
  const decision = String(form.decision ?? "");
  const client_id = String(form.client_id ?? "");
  const redirect_uri = String(form.redirect_uri ?? "");
  const code_challenge = String(form.code_challenge ?? "");
  const code_challenge_method = String(form.code_challenge_method ?? "S256");
  const scope = String(form.scope ?? "");
  const state = (form.state ? String(form.state) : "") as string;

  if (decision !== "allow") {
    const params = new URLSearchParams({ error: "access_denied" });
    if (state) params.set("state", state);
    return c.redirect(`${redirect_uri}?${params.toString()}`, 302);
  }

  const client = findClientById(client_id);
  if (!client || client.revoked_at) {
    return c.json({ error: "invalid_client" }, 400);
  }

  // Generate the code; store its HASH so leaking the DB doesn't leak codes.
  const codePlain = generateAuthCode();
  insertAuthCode({
    code: hashToken(codePlain),
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method:
      code_challenge_method === "plain" ? "plain" : "S256",
    scope,
    state: state || null,
  });

  const params = new URLSearchParams({ code: codePlain });
  if (state) params.set("state", state);
  return c.redirect(`${redirect_uri}?${params.toString()}`, 302);
});
