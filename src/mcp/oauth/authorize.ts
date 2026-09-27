/** Validation commune à l’affichage et à la décision ; l’identité du titulaire reste distincte. */
import {Hono} from 'hono';
import {z} from 'zod';
import {oauthWrite} from './transaction.js';
import {generateAuthCode, hashToken} from './crypto.js';
import {findClientById, insertAuthCode} from './store.js';
import {readOAuthForm} from './input.js';
import {isRegisteredRedirectUri, authorizationCsp} from './redirects.js';
import {isValidScope, parseScopes, serializeScopes} from './scopes.js';

const QuerySchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1).max(2048),
  redirect_uri: z.string().min(1).max(2048),
  // Un SHA-256 encodé sans remplissage occupe exactement 43 caractères canoniques.
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine(value => Buffer.from(value, 'base64url').toString('base64url') === value),
  code_challenge_method: z.literal('S256'),
  scope: z.string().max(1024).optional(),
  state: z.string().max(2048).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).optional(),
});

function validate(input: Record<string, unknown>) {
  const parsed = QuerySchema.safeParse(input);
  if (!parsed.success) return {error: 'invalid_request'} as const;
  const request = parsed.data;
  const client = findClientById(request.client_id);
  if (!client || client.revoked_at !== null) return {error: 'invalid_client'} as const;
  if (!isRegisteredRedirectUri(client.client_id, request.redirect_uri)) return {error: 'invalid_redirect_uri'} as const;
  const allowed = parseScopes(client.scopes);
  const words = request.scope === undefined ? allowed : request.scope.split(' ');
  if (!words.length || words.some(word => !isValidScope(word) || !allowed.includes(word))) return {error: 'invalid_scope'} as const;
  return {request, client, granted: parseScopes(words.join(' '))};
}

export const authorizeRoute = new Hono();
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
}

authorizeRoute.get('/authorize', c => {
  if (c.req.url.length > 8192) return c.json({error: 'invalid_request'}, 400);
  const params = new URL(c.req.url).searchParams;
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) return c.json({error: 'invalid_request'}, 400);
  try {
    const valid = validate(Object.fromEntries(params));
    if ('error' in valid) return c.json({error: valid.error}, 400);
    const {client, granted} = valid;
    const displayName = client.name.replace(/[\p{Cc}\p{Cf}]/gu, '');
    const parsed = {data: valid.request};
    // Le sous-domaine réécrit le chemin en interne ; le navigateur garde le montage d’origine.
    const host = (c.req.header('host') ?? '').split(':')[0].toLowerCase();
    const base = ['mcp.openswissdata.com','mcp.localhost'].includes(host) ? '/oauth' : '/mcp/oauth';
    const action = base + '/authorize/decision';
  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Connecter ${escapeHtml(displayName)} · openswissdata MCP</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; color: #111; }
    h1 { font-size: 22px; margin-bottom: 8px; }
    .scope { display:inline-block; padding: 2px 8px; border-radius: 4px; background: #eef; font-family: ui-monospace, monospace; font-size: 13px; margin: 2px; }
    button { background: #4f46e5; color: white; border: 0; padding: 12px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .deny { background: #52636b; margin-left: 8px; }
    .destination,h1 { overflow-wrap:anywhere; }
    p.muted { color:#666; font-size: 14px; }
  </style>
</head>
<body><main>
  <p class="muted">Nom déclaré par l’application</p><h1>Connecter <em>${escapeHtml(displayName)}</em></h1>
  <p class="muted">Accès demandés par cette application :</p>
  <p>${granted.map((s) => `<span class="scope">${escapeHtml(s)}</span>`).join(" ")}</p>
  <p class="muted">Retour vers : <strong class="destination">${escapeHtml(parsed.data.redirect_uri)}</strong></p><p class="muted">L’application devra présenter son secret et sa preuve de connexion pour obtenir un accès. Cette étape ne modifie pas votre abonnement.</p>
  <form method="POST" action="${escapeHtml(action)}">
    <input type="hidden" name="response_type" value="code">
    <input type="hidden" name="client_id" value="${escapeHtml(parsed.data.client_id)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(parsed.data.redirect_uri)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(parsed.data.code_challenge)}">
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(parsed.data.code_challenge_method)}">
    <input type="hidden" name="scope" value="${escapeHtml(serializeScopes(granted))}">
${parsed.data.state === undefined ? "" : `<input type="hidden" name="state" value="${escapeHtml(parsed.data.state)}">`}
    <button type="submit" name="decision" value="allow">Continuer</button>
    <button type="submit" name="decision" value="deny" class="deny">Refuser</button>
  </form>
</main></body>
</html>`;

  c.header('Referrer-Policy', 'no-referrer');
  c.header('Content-Security-Policy', authorizationCsp(parsed.data.redirect_uri));
  return c.html(html);
  } catch {
    c.header('Retry-After', '1');
    return c.json({error: 'temporarily_unavailable'}, 503);
  }
});


authorizeRoute.post('/authorize/decision', async c => {
  const form = await readOAuthForm(c);
  if (!form || !['allow','deny'].includes(String(form.decision ?? ''))) return c.json({error: 'invalid_request'}, 400);
  try {
    const before = validate(form);
    if ('error' in before) return c.json({error: before.error}, 400);
    // Aucun await entre la relecture du client, de ses destinations et l’émission du code.
    return oauthWrite(() => {
      const valid = validate(form);
      if ('error' in valid) return c.json({error: valid.error}, 400);
      const {request, granted} = valid;
      const responseParams = new URLSearchParams();
      if (form.decision === 'deny') responseParams.set('error', 'access_denied');
      else {
        const code = generateAuthCode();
        insertAuthCode({code: hashToken(code), client_id: request.client_id, redirect_uri: request.redirect_uri,
          code_challenge: request.code_challenge, code_challenge_method: 'S256', scope: serializeScopes(granted), state: request.state ?? null});
        responseParams.set('code', code);
      }
      if (request.state !== undefined) responseParams.set('state', request.state);
      c.header('Referrer-Policy', 'no-referrer');
      // Garder les octets de la query déclarée, y compris %20 et les clés sans valeur.
      const separator = request.redirect_uri.includes('?') ? (/[?&]$/.test(request.redirect_uri) ? '' : '&') : '?';
      return c.redirect(request.redirect_uri + separator + responseParams.toString(), 302);
    });
  } catch {
    c.header('Retry-After', '1');
    return c.json({error: 'temporarily_unavailable'}, 503);
  }
});
