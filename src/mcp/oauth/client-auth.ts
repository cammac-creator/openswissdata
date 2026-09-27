import type {Context} from 'hono';

interface ClientCredentials { client_id: string; client_secret: string }
type ClientAuth = {ok: true; credentials: ClientCredentials} | {ok: false; error: 'invalid_client' | 'invalid_request'};

function validValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Une seule méthode par demande ; un en-tête présent ne se replie jamais sur le corps. */
export function parseClientCredentials(header: string | undefined, body: Record<string, unknown>): ClientAuth {
  if (header === undefined) {
    return validValue(body.client_id) && validValue(body.client_secret)
      ? {ok: true, credentials: {client_id: body.client_id, client_secret: body.client_secret}}
      : {ok: false, error: 'invalid_client'};
  }
  if (Object.hasOwn(body, 'client_id') || Object.hasOwn(body, 'client_secret')) return {ok: false, error: 'invalid_request'};
  const invalid: ClientAuth = {ok: false, error: 'invalid_client'};
  if (header.length > 4096) return invalid;
  const match = /^Basic +([A-Za-z0-9+/]+={0,2})$/i.exec(header);
  if (!match) return invalid;
  try {
    const bytes = Buffer.from(match[1], 'base64');
    // Buffer.from tolère sinon des caractères ignorés et des encodages non canoniques.
    if (bytes.toString('base64') !== match[1]) return invalid;
    const decoded = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
    const separator = decoded.indexOf(':');
    if (separator < 1) return invalid;
    // RFC6749 : chaque composant Basic utilise l’encodage d’un formulaire, une seule fois.
    const decode = (value: string) => decodeURIComponent(value.replace(/\+/g, ' '));
    const client_id = decode(decoded.slice(0, separator));
    const client_secret = decode(decoded.slice(separator + 1));
    if (!validValue(client_id) || !validValue(client_secret)) return invalid;
    return {ok: true, credentials: {client_id, client_secret}};
  } catch {
    return invalid;
  }
}

/** Aucune valeur fournie par le demandeur n’apparaît dans l’erreur. */
export function rejectClientAuth(c: Context, error: 'invalid_client' | 'invalid_request' = 'invalid_client'): Response {
  if (error === 'invalid_client') c.header('WWW-Authenticate', 'Basic realm="openswissdata", charset="UTF-8"');
  return c.json({error}, error === 'invalid_client' ? 401 : 400);
}
