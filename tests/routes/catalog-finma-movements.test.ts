// /api/catalog/finma sert les mouvements mensuels (lot V1) là où ils vivent dans l'archive,
// `history.movements` de quality.json : aucune nouvelle clé de tête, aucun nom ni adresse.
// Archive et base fictives (même montage que catalog.test.ts, qui fige la liste des clés publiques).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import archiver from "archiver";
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("../../src/lib/r2.js", () => ({ getObjectBuffer: download, signedDownloadUrl: vi.fn() }));
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { buildMovements } from "../../etl/finma/movements.js";
import type { FinmaEntity } from "../../etl/finma/types.js";

const institution = (i: number): FinmaEntity => ({ entity_type: "bank", name: `Institution fictive ${i}`, uid: `CHE-900.000.${String(i).padStart(3, "0")}`, licence_type: "Bank", source_list: "finma-uid-csv", source_url: "https://registre.exemple/" });
const registry = Array.from({ length: 25 }, (_, i) => institution(i));
const movements = buildMovements([{ version: "2026.10.20", entities: registry.slice(1) }], { version: "2026.10.21", entities: registry });

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "osd-catalog-mouvements-")); process.env.DATABASE_PATH = join(tmp, "test.sqlite");
  getDb().prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES('finma','FINMA','finma',29900,'price',?)").run(Date.now());
  download.mockReset();
});
afterEach(async () => { await new Promise(r => setImmediate(r)); closeDb(); rmSync(tmp, { recursive: true, force: true }); delete process.env.DATABASE_PATH; vi.restoreAllMocks(); });

async function publish(history: Record<string, unknown>) {
  const zip = archiver("zip"); const chunks: Buffer[] = [];
  const ready = new Promise<Buffer>((resolve, reject) => { zip.on("data", c => chunks.push(c)); zip.on("error", reject); zip.on("end", () => resolve(Buffer.concat(chunks))); });
  zip.append(JSON.stringify({ registry_rows: 25, unique_uids: 25, warning_rows: 10, populated_fields: { lei: 0 }, history }), { name: "quality.json" });
  zip.append(JSON.stringify(registry), { name: "finma_registry.json" });
  await zip.finalize(); const bytes = await ready;
  getDb().prepare("INSERT INTO versions(dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES('finma','2026.10.21','finma/test.zip',?,?,?)").run(createHash("sha256").update(bytes).digest("hex"), bytes.length, Date.now());
  getDb().prepare("UPDATE datasets SET current_version='2026.10.21' WHERE id='finma'").run(); download.mockResolvedValue(bytes);
}

describe("Catalogue FINMA : mouvements mensuels", () => {
  it("sert history.movements tel que l'archive le porte, sans nouvelle clé de tête ni aucun nom", async () => {
    const history = { available_from: "2026-07-23", available_until: "2026-10-21", snapshots: 2, gaps: [], interpretation: "Fictif.", movements };
    await publish(history);
    const res = await createApp().request("/api/catalog/finma");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.history).toEqual(JSON.parse(JSON.stringify(history)));
    expect(body.history.movements.months[0].registry.totals.added).toBe(1);
    expect(Object.keys(body).sort()).toEqual(["collected_on", "entity_type_rows", "history", "populated_fields", "registry_rows", "sample", "supervisory_organisation_rows", "unique_uids", "version", "warning_rows"].sort());
    expect(JSON.stringify(body.history.movements)).not.toMatch(/Institution|CHE-\d|exemple|https?:\/\//);
  });
});
