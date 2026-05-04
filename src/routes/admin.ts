import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { seedDatasets } from "../db/seed.js";
import { constantTimeEqual } from "../lib/tokens.js";
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

export const adminRoute = new Hono();

const ReleaseSchema = z.object({
  dataset_id: z.string().min(1),
  version: z.string().regex(/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/),
  r2_key: z.string().min(1),
  sha256: z.string().length(64).regex(/^[0-9a-f]{64}$/i),
  size_bytes: z.number().int().positive(),
  changelog: z.string().default(""),
});

adminRoute.post("/seed", async (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const result = seedDatasets();
  return c.json({ ok: true, ...result });
});

/**
 * POST /api/admin/backup-to-r2
 *
 * Snapshot the live SQLite DB and upload to R2 under `backups/db-YYYY-MM-DD.sqlite`,
 * then prune backups older than 30 days. Runs ON Railway (where the DB volume
 * is mounted) — the GitHub Actions cron only fires a curl with ADMIN_SECRET
 * because the runner has no access to the Railway volume.
 *
 * Why better-sqlite3's .backup() and not a simple file copy: backup yields a
 * consistent snapshot even while the live DB is accepting writes (essential
 * because the Hono server runs against the same file in WAL mode).
 */
adminRoute.post("/backup-to-r2", async (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const dbPath = process.env.DATABASE_PATH ?? "./data/openswissdata.sqlite";
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return c.json({ error: "r2_credentials_missing" }, 500);
  }

  const dateKey = new Date().toISOString().slice(0, 10);
  const tmp = await mkdir(join(tmpdir(), `osd-backup-${Date.now()}`), { recursive: true });
  const snapshotPath = join(tmp!, "snapshot.sqlite");
  const r2Key = `backups/db-${dateKey}.sqlite`;

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  let uploadedBytes = 0;
  let prunedCount = 0;
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      await db.backup(snapshotPath);
    } finally {
      db.close();
    }
    uploadedBytes = statSync(snapshotPath).size;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: r2Key,
        Body: createReadStream(snapshotPath),
        ContentType: "application/x-sqlite3",
        ContentLength: uploadedBytes,
      }),
    );

    // Retention: prune backups older than 30 days
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "backups/" }),
    );
    for (const obj of listed.Contents ?? []) {
      if (!obj.Key) continue;
      if ((obj.LastModified?.getTime() ?? 0) < cutoff) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
        prunedCount += 1;
      }
    }
  } catch (err) {
    return c.json(
      { error: "backup_failed", details: err instanceof Error ? err.message : String(err) },
      500,
    );
  } finally {
    await rm(snapshotPath, { force: true }).catch(() => {});
  }

  return c.json({
    ok: true,
    r2_key: r2Key,
    size_bytes: uploadedBytes,
    pruned_count: prunedCount,
    backed_up_at: new Date().toISOString(),
  });
});

adminRoute.post("/release", async (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let parsed;
  try {
    parsed = ReleaseSchema.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "invalid_body", details: String(err) }, 400);
  }

  const db = getDb();
  const now = Date.now();

  const datasetExists = db.prepare("SELECT id FROM datasets WHERE id=?").get(parsed.dataset_id);
  if (!datasetExists) {
    return c.json({ error: "unknown_dataset" }, 404);
  }

  db.prepare(`
    INSERT INTO versions (dataset_id, version, r2_key, sha256, size_bytes, changelog, released_at)
    VALUES (@dataset_id, @version, @r2_key, @sha256, @size_bytes, @changelog, @released_at)
  `).run({ ...parsed, released_at: now });

  db.prepare("UPDATE datasets SET current_version = ? WHERE id = ?")
    .run(parsed.version, parsed.dataset_id);

  return c.json({ ok: true, dataset_id: parsed.dataset_id, version: parsed.version });
});
