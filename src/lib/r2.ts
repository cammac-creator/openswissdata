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

export async function signedDownloadUrl(
  r2Key: string,
  expiresSeconds = 300
): Promise<string> {
  const client = buildClient();
  return await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: requireBucket(),
      Key: r2Key,
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
