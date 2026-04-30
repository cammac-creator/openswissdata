import { Hono } from "hono";
import { createRequire } from "node:module";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getDb } from "../lib/db.js";
import { stripe } from "../lib/stripe.js";

const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require("../../package.json") as { version: string };

export const healthRoute = new Hono();

/**
 * Shallow health check — used by Railway's load balancer for routing decisions
 * and by external uptime monitors that just want a 200/non-200 signal.
 * Always returns 200 if the process is up. Does not exercise any dependency.
 */
healthRoute.get("/", (c) => {
  return c.json({ status: "ok", version: APP_VERSION });
});

/**
 * Deep health check — exercises every external dependency we depend on for a
 * paying customer to receive their dataset:
 *  - SQLite (read query)
 *  - Cloudflare R2 (HEAD bucket)
 *  - Stripe API (low-cost balance.retrieve)
 *
 * Returns 200 only if all checks pass. Use this endpoint for UptimeRobot /
 * BetterStack alerts, NOT the shallow `/`. The shallow endpoint will lie when
 * R2 keys are revoked or the DB file is locked.
 *
 * Each check has a hard 3 s timeout to keep the response fast and avoid
 * piling up requests when something is slow.
 */
healthRoute.get("/deep", async (c) => {
  const started = Date.now();
  const checks = await Promise.allSettled([
    timed("db", checkDb()),
    timed("r2", checkR2()),
    timed("stripe", checkStripe()),
  ]);

  const result: Record<string, { ok: boolean; ms: number; error?: string }> = {};
  let overallOk = true;
  for (const check of checks) {
    if (check.status === "fulfilled") {
      result[check.value.name] = {
        ok: check.value.ok,
        ms: check.value.ms,
        ...(check.value.error ? { error: check.value.error } : {}),
      };
      if (!check.value.ok) overallOk = false;
    } else {
      // timed() should have caught everything, but defend in depth
      overallOk = false;
    }
  }

  return c.json(
    {
      status: overallOk ? "ok" : "degraded",
      version: APP_VERSION,
      duration_ms: Date.now() - started,
      checks: result,
    },
    overallOk ? 200 : 503,
  );
});

async function timed(
  name: string,
  promise: Promise<void>,
): Promise<{ name: string; ok: boolean; ms: number; error?: string }> {
  const start = Date.now();
  try {
    await Promise.race([
      promise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("timeout_3s")), 3000),
      ),
    ]);
    return { name, ok: true, ms: Date.now() - start };
  } catch (err) {
    return {
      name,
      ok: false,
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkDb(): Promise<void> {
  const db = getDb();
  const row = db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
  if (row?.ok !== 1) throw new Error("db_select_failed");
}

async function checkR2(): Promise<void> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("r2_env_missing");
  }
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
}

async function checkStripe(): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("stripe_env_missing");
  // balance.retrieve is the cheapest authenticated Stripe call we can make.
  await stripe().balance.retrieve();
}
