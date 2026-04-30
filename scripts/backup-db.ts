/**
 * Daily SQLite backup → Cloudflare R2.
 *
 * Backs up the production DB (./data/openswissdata.sqlite) to R2 under
 * `backups/db-YYYY-MM-DD.sqlite` with 30-day retention enforced by listing
 * and deleting older entries each run.
 *
 * Why this exists: Railway volumes are not snapshotted by Railway; if the
 * volume is corrupted or accidentally re-provisioned, the customer/order
 * tables are gone. Stripe events can be replayed for ~30d but rebuilding
 * entitlements + magic_links + sessions is painful. R2 EU/Frankfurt costs
 * ~$0.015/GB/month for storage, so 30 daily backups of a 100MB DB ≈ $0.05/yr.
 *
 * USAGE:
 *   tsx scripts/backup-db.ts           # backup + cleanup
 *   tsx scripts/backup-db.ts --dry-run # report what would happen
 *
 * Cron suggestion (Railway scheduled service or GitHub Actions):
 *   0 3 * * *  tsx scripts/backup-db.ts
 *
 * Restore:
 *   aws s3 cp s3://openswissdata/backups/db-2026-04-30.sqlite ./restored.sqlite \
 *     --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com
 */

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import Database from "better-sqlite3";
import { createReadStream, statSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RETENTION_DAYS = 30;
const BACKUP_PREFIX = "backups/";
const DB_PATH = process.env.DATABASE_PATH ?? "./data/openswissdata.sqlite";

const dryRun = process.argv.includes("--dry-run");

function buildClient(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 credentials missing: R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY required",
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
  if (!b) throw new Error("R2_BUCKET env var not set");
  return b;
}

/**
 * Use better-sqlite3's `.backup()` API rather than copying the file directly:
 * the backup API yields a consistent snapshot even while the live DB is
 * accepting writes (essential because the Hono server runs against the same
 * file in WAL mode).
 */
async function snapshotDb(srcPath: string): Promise<string> {
  const tmpDir = await mkdir(join(tmpdir(), `osd-backup-${Date.now()}`), {
    recursive: true,
  });
  const target = join(tmpDir!, "snapshot.sqlite");
  const db = new Database(srcPath, { readonly: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }
  return target;
}

async function uploadBackup(client: S3Client, snapshotPath: string, dateKey: string) {
  const key = `${BACKUP_PREFIX}db-${dateKey}.sqlite`;
  const size = statSync(snapshotPath).size;
  if (dryRun) {
    console.log(`[dry-run] would upload ${snapshotPath} (${size} bytes) → s3://${requireBucket()}/${key}`);
    return key;
  }
  await client.send(
    new PutObjectCommand({
      Bucket: requireBucket(),
      Key: key,
      Body: createReadStream(snapshotPath),
      ContentType: "application/x-sqlite3",
      ContentLength: size,
    }),
  );
  console.log(`[ok] uploaded ${size} bytes → s3://${requireBucket()}/${key}`);
  return key;
}

async function pruneOldBackups(client: S3Client) {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: requireBucket(), Prefix: BACKUP_PREFIX }),
  );
  const toDelete = (listed.Contents ?? []).filter((obj) => {
    if (!obj.Key) return false;
    const lastModified = obj.LastModified?.getTime() ?? 0;
    return lastModified < cutoff;
  });
  if (toDelete.length === 0) {
    console.log(`[ok] retention check: nothing to prune (cutoff = ${RETENTION_DAYS}d)`);
    return;
  }
  for (const obj of toDelete) {
    if (!obj.Key) continue;
    if (dryRun) {
      console.log(`[dry-run] would delete ${obj.Key} (last modified ${obj.LastModified?.toISOString()})`);
      continue;
    }
    await client.send(
      new DeleteObjectCommand({ Bucket: requireBucket(), Key: obj.Key }),
    );
    console.log(`[ok] pruned ${obj.Key}`);
  }
}

async function main() {
  console.log(`[backup-db] starting ${dryRun ? "(DRY RUN) " : ""}at ${new Date().toISOString()}`);
  console.log(`[backup-db] source: ${DB_PATH}`);

  const dateKey = new Date().toISOString().slice(0, 10);
  const client = buildClient();

  let snapshotPath: string | null = null;
  try {
    snapshotPath = await snapshotDb(DB_PATH);
    console.log(`[ok] snapshot created at ${snapshotPath}`);
    await uploadBackup(client, snapshotPath, dateKey);
    await pruneOldBackups(client);
    console.log(`[backup-db] done`);
  } finally {
    if (snapshotPath) {
      await rm(snapshotPath, { force: true }).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[backup-db] FATAL", err);
  process.exit(1);
});
