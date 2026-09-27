import {Hono} from 'hono';
import {timingSafeEqual} from 'node:crypto';
import {oauthWrite} from './transaction.js';
import {parseClientCredentials, rejectClientAuth} from './client-auth.js';
import {hashToken} from './crypto.js';
import {readOAuthForm} from './input.js';
import {findClientById} from './store.js';
import {RedirectUrisSchema, clientRedirectUris, replaceClientRedirectUris} from './redirects.js';

export const redirectConfigurationRoute = new Hono();

/** Le secret de l’application est exigé ; ni email déclaré ni cookie ne donnent ce droit. */
redirectConfigurationRoute.post('/redirect-uris', async c => {
  const body = await readOAuthForm(c);
  if (!body) return c.json({error: 'invalid_request'}, 400);
  const auth = parseClientCredentials(c.req.header('authorization'), body);
  if (!auth.ok) return rejectClientAuth(c, auth.error);
  let input: unknown;
  try { input = JSON.parse(typeof body.redirect_uris === 'string' ? body.redirect_uris : 'null'); }
  catch { return c.json({error: 'invalid_redirect_uri'}, 400); }
  const parsed = RedirectUrisSchema.safeParse(input);
  if (!parsed.success) return c.json({error: 'invalid_redirect_uri'}, 400);
  try {
    const authenticated = () => {
      const client = findClientById(auth.credentials.client_id);
      if (!client || client.revoked_at !== null) return null;
      const actual = Buffer.from(hashToken(auth.credentials.client_secret));
      const expected = Buffer.from(client.client_secret_hash);
      return actual.length === expected.length && timingSafeEqual(actual, expected) ? client : null;
    };
    // Refuser les inconnus avant de prendre le verrou ; revérifier dans la transaction.
    if (!authenticated()) return rejectClientAuth(c);
    return oauthWrite(() => {
      const client = authenticated();
      if (!client) return rejectClientAuth(c);
      replaceClientRedirectUris(client.client_id, parsed.data);
      return c.json({client_id: client.client_id, redirect_uris: clientRedirectUris(client.client_id)});
    });
  } catch {
    c.header('Retry-After', '1');
    return c.json({error: 'temporarily_unavailable'}, 503);
  }
});
