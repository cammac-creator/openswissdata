import { Hono } from "hono";
import { createHash } from "node:crypto";
import { getDb } from "../lib/db.js";
import { getObjectBuffer } from "../lib/r2.js";
import { extractCsvFromZip } from "../mcp/r2-refresh.js";
import { stringify } from "csv-stringify/sync";

export const catalogRoute = new Hono();
let cached: { version: string; loaded: number; value: Record<string, unknown> } | undefined;
let pending: Promise<Record<string, unknown>> | undefined;

catalogRoute.get("/finma", async (c) => {
  const row = getDb().prepare(`SELECT v.version, v.r2_key, v.sha256 FROM datasets d JOIN versions v
    ON v.dataset_id=d.id AND v.version=d.current_version WHERE d.id='finma'`).get() as
    { version: string; r2_key: string; sha256: string } | undefined;
  if (!row) return c.json({ error: "no_version" }, 503);
  try {
    if (!cached || cached.version !== row.version || Date.now() - cached.loaded > 60_000) {
      pending ??= (async () => {
        const bytes = await getObjectBuffer(row.r2_key, { maxBytes: 20_000_000 });
        if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new Error("Empreinte de l'archive invalide");
        const quality = JSON.parse(await extractCsvFromZip(bytes, "quality.json"));
        const entities = JSON.parse(await extractCsvFromZip(bytes, "finma_registry.json")) as Array<Record<string, unknown>>;
        const selected = new Map<string, number>();
        const sample = entities.filter(entity => {
          const type = String(entity.entity_type);
          const count = selected.get(type) ?? 0;
          if (count >= 20) return false;
          selected.set(type, count + 1);
          return true;
        });
        const value = {
          version: row.version, collected_on: `${row.version.slice(0, 4)}-${row.version.slice(5, 7)}-${row.version.slice(8, 10)}`,
          registry_rows: quality.registry_rows, unique_uids: quality.unique_uids,
          warning_rows: quality.warning_rows, populated_fields: quality.populated_fields,
          history: quality.history, sample,
        };
        cached = { version: row.version, loaded: Date.now(), value };
        return value;
      })();
      try { await pending; } finally { pending = undefined; }
    }
    if (cached?.version !== row.version) return c.json({ error: "version_changed" }, 503);
    if (c.req.query("format") === "csv") {
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header("Content-Disposition", `attachment; filename="finma-sample-${row.version}.csv"`);
      c.header("Cache-Control", "no-store");
      return c.body(stringify(cached.value.sample as object[], { header: true, bom: true }));
    }
    c.header("Cache-Control", "no-cache");
    return c.json(cached.value);
  } catch {
    return c.json({ error: "quality_unavailable", version: row.version }, 503);
  }
});
