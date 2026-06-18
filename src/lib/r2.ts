import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readFileSync } from "node:fs";

function buildClient(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 credentials missing: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY must all be set"
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function requireBucket(): string {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error("R2_BUCKET env var is not set");
  return b;
}

export async function uploadZip(
  localPath: string,
  r2Key: string
): Promise<void> {
  const body = readFileSync(localPath);
  const client = buildClient();
  await client.send(
    new PutObjectCommand({
      Bucket: requireBucket(),
      Key: r2Key,
      Body: body,
      ContentType: "application/zip",
    })
  );
}

/**
 * Download an object from R2 fully into memory. Used by the MCP data-refresh
 * engine to pull the current dataset ZIP at boot/release/timer (never on the
 * request path). Bounded use only — callers fetch small slices (FINMA ZIP
 * ~0.7 MB); do not use for large multi-format archives on hot paths.
 *
 * Two hard guarantees (this runs in the live server process):
 *   - TIMEOUT: an `AbortController` cuts the request after `timeoutMs`, so a
 *     half-open socket that stalls mid-body can never hang forever (which would
 *     otherwise wedge the caller's in-flight latch permanently).
 *   - SIZE CAP: rejects before/while buffering if the object exceeds `maxBytes`,
 *     so a wrong key pointing at a huge object (e.g. a DB backup in the same
 *     bucket) or a zip-bomb cannot OOM the process.
 */
export async function getObjectBuffer(
  r2Key: string,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<Buffer> {
  const { maxBytes, timeoutMs = 30_000 } = opts;
  const client = buildClient();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: requireBucket(), Key: r2Key }),
      { abortSignal: ac.signal },
    );
    if (!res.Body) throw new Error(`R2 object has no body: ${r2Key}`);
    const contentLength = typeof res.ContentLength === "number" ? res.ContentLength : undefined;
    if (maxBytes != null && contentLength != null && contentLength > maxBytes) {
      throw new Error(`R2 object ${r2Key} too large: ${contentLength} > ${maxBytes} bytes`);
    }
    // @aws-sdk v3 Node stream → Buffer, with a running size guard in case
    // Content-Length is absent or understates the real body.
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (maxBytes != null && total > maxBytes) {
        throw new Error(`R2 object ${r2Key} exceeded ${maxBytes} bytes mid-stream`);
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

export async function signedDownloadUrl(
  r2Key: string,
  expiresSeconds = 300
): Promise<string> {
  const client = buildClient();
  // Force download with a clean filename derived from the key (last path segment).
  // Without ResponseContentDisposition, browsers open a blank tab and silently drop
  // the file in Downloads — confusing UX. With it, the browser explicitly downloads
  // the file with the expected name.
  const filename = r2Key.split("/").filter(Boolean).pop() ?? "download.zip";
  return await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: requireBucket(),
      Key: r2Key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: expiresSeconds }
  );
}

/**
 * Manual smoke test (requires real R2 creds in .env):
 *
 *   npm run build
 *   node --env-file=.env -e "\
 *     import('./dist/lib/r2.js').then(async m => { \
 *       const key = 'smoke-test/' + Date.now() + '.txt'; \
 *       await m.uploadZip('./package.json', key); \
 *       const url = await m.signedDownloadUrl(key, 60); \
 *       console.log('uploaded key =', key); \
 *       console.log('signed url =', url); \
 *     })"
 *
 * Or use the existing scripts/test-r2.mjs which already covers upload + delete.
 */
