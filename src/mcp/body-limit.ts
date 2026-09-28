import type { MiddlewareHandler } from "hono";

/**
 * Plafond des corps JSON-RPC reçus par le serveur MCP. Un appel réel pèse quelques centaines
 * d'octets et un lot de 50 messages moins de 20 Kio ; au-delà, la requête est refusée avant
 * tout décodage, quota ou exécution.
 */
export const MCP_BODY_BYTES = 65_536;

const tooLarge = { jsonrpc: "2.0", id: null, error: { code: -32600, message: `Request too large (max ${MCP_BODY_BYTES} bytes)` } } as const;

/**
 * Compte les octets réellement reçus, même sans Content-Length ou s'il est faux (même méthode que
 * `oauthInput`), puis rend le corps lu au gestionnaire. Sans ce plafond, un seul POST anonyme de
 * quelques centaines de Kio pouvait occuper l'unique processus plusieurs secondes.
 */
export const mcpBodyLimit: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "POST" || !c.req.raw.body) return next();
  c.header("Cache-Control", "no-store");
  const declared = c.req.header("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MCP_BODY_BYTES) return c.json(tooLarge, 413);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const chunks: Uint8Array[] = [];
  let size = 0, complete = false;
  try {
    reader = c.req.raw.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > MCP_BODY_BYTES) return c.json(tooLarge, 413);
      chunks.push(value);
    }
  } catch {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
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
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  c.req.raw = new Request(c.req.raw, { headers, body });
  await next();
};
