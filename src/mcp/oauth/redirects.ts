import {z} from 'zod';
import {getDb} from '../../lib/db.js';

/** Destinations confidentielles exactes ; HTTP réservé à la boucle locale. Aucun appel réseau. */
export function isValidRedirectUri(value: string): boolean {
  if (value.length > 2048 || /[\s\\\u0000-\u001f\u007f#]/u.test(value) || /%(?![0-9a-f]{2})|%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(url.hostname)) return false;
    if (url.hostname.length > 253 || url.hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) return false;
    // Éviter les formes que le parseur réinterprète (ports, chemins ou hôtes ambigus).
    if (url.href !== value) return false;
    return !['code','state','error','error_description','error_uri','iss'].some(key => url.searchParams.has(key));
  } catch { return false; }
}

/** Le navigateur applique aussi form-action à la redirection du POST. */
export function authorizationCsp(redirectUri?: string): string {
  const destination = redirectUri && isValidRedirectUri(redirectUri) ? ' ' + new URL(redirectUri).origin : '';
  return `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${destination}; base-uri 'none'; frame-ancestors 'none'`;
}

export const RedirectUrisSchema = z.array(z.string().refine(isValidRedirectUri)).min(1).max(10)
  .refine(values => new Set(values).size === values.length);

export function clientRedirectUris(clientId: string): string[] {
  return (getDb().prepare('SELECT redirect_uri FROM mcp_client_redirect_uris WHERE client_id=? ORDER BY redirect_uri').all(clientId) as {redirect_uri: string}[]).map(row => row.redirect_uri);
}

export function isRegisteredRedirectUri(clientId: string, uri: string): boolean {
  return isValidRedirectUri(uri) && Boolean(getDb().prepare('SELECT 1 FROM mcp_client_redirect_uris WHERE client_id=? AND redirect_uri=?').get(clientId, uri));
}

/** Appel dans la transaction de création ou de configuration authentifiée du client. */
export function replaceClientRedirectUris(clientId: string, uris: readonly string[]): void {
  const parsed = RedirectUrisSchema.parse(uris);
  const db = getDb();
  db.prepare('DELETE FROM mcp_client_redirect_uris WHERE client_id=?').run(clientId);
  const insert = db.prepare('INSERT INTO mcp_client_redirect_uris (client_id,redirect_uri,created_at) VALUES (?,?,?)');
  for (const uri of parsed) insert.run(clientId, uri, Date.now());
}
