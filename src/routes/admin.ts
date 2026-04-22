import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { seedDatasets } from "../db/seed.js";

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
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const result = seedDatasets();
  return c.json({ ok: true, ...result });
});

adminRoute.post("/release", async (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || secret !== process.env.ADMIN_SECRET) {
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
