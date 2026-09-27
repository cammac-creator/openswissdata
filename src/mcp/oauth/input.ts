import type {Context, MiddlewareHandler} from 'hono';

export const OAUTH_BODY_BYTES = 16_384;

/** Compte le flux réel avant les parseurs, même sans Content-Length ou s’il est faux. */
export const oauthInput: MiddlewareHandler = async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
  if (c.req.method === 'POST' && c.req.raw.body) {
    const declared = c.req.header('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > OAUTH_BODY_BYTES) return c.json({error: 'request_too_large'}, 413);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const chunks: Uint8Array[] = [];
    let size = 0, complete = false;
    try {
      reader = c.req.raw.body.getReader();
      for (;;) {
        const {done, value} = await reader.read();
        if (done) { complete = true; break; }
        size += value.byteLength;
        if (size > OAUTH_BODY_BYTES) return c.json({error: 'request_too_large'}, 413);
        chunks.push(value);
      }
    } catch {
      return c.json({error: 'invalid_request'}, 400);
    } finally {
      if (reader) {
        if (!complete) void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const headers = new Headers(c.req.raw.headers);
    headers.delete('content-length');
    headers.delete('transfer-encoding');
    c.req.raw = new Request(c.req.raw, {headers, body});
  }
  await next();
};

/** Une erreur de format ne doit pas devenir un diagnostic technique public. */
export async function readOAuthForm(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.parseBody({all: true});
    // Les paramètres répétés et fichiers ne sont pas des valeurs OAuth uniques.
    return Object.values(body).every(value => typeof value === 'string') ? body : null;
  } catch { return null; }
}
