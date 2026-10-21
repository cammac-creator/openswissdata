import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { entityHistoryHandler, entityHistoryTool } from "../../src/mcp/tools/entity-history.js";
import { closeDb, getDb } from "../../src/lib/db.js";
import { _resetDataLoaderCache } from "../../src/mcp/data-loader.js";

// 21.10.2026 : les instantanés d'avant le 25.09.2026 portent un drapeau « liste d'alerte » obtenu par un
// rapprochement APPROCHÉ des noms (retiré depuis). La règle du projet n'admet qu'une correspondance exacte
// avec la liste d'alerte FINMA : l'historique ne doit donc jamais servir ce champ, même présent en base.
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "osd-history-alerte-"));
  process.env.DATABASE_PATH = join(dir, "t.sqlite");
  closeDb();
  _resetDataLoaderCache();
});

afterAll(() => {
  closeDb();
  delete process.env.DATABASE_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("entity_history et la liste d'alerte", () => {
  it("ne sert jamais le drapeau de liste d'alerte, même enregistré dans les instantanés", () => {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO datasets (id, name, slug, price_chf, stripe_price_id, created_at) VALUES ('finma','FINMA','finma',0,'price_test',?)").run(Date.now());
    const t1 = Date.parse("2026-08-01T00:00:00Z");
    const t2 = Date.parse("2026-09-25T00:00:00Z");
    for (const [v, t] of [["2026.08.01", t1], ["2026.09.25", t2]] as const) {
      db.prepare("INSERT OR IGNORE INTO versions (dataset_id, version, r2_key, sha256, size_bytes, released_at) VALUES ('finma', ?, ?, 'deadbeef', 1, ?)").run(v, `finma/${v}/finma.zip`, t);
    }
    const ins = db.prepare("INSERT INTO dataset_snapshots (dataset_id, version, entity_key, field, value, recorded_at) VALUES ('finma', ?, 'CHE-000.000.001', ?, ?, ?)");
    ins.run("2026.08.01", "name", "Exemple fictif SA", t1);
    ins.run("2026.08.01", "is_warning_listed", "true", t1);
    ins.run("2026.09.25", "name", "Exemple fictif SA", t2);
    ins.run("2026.09.25", "is_warning_listed", null, t2);

    const out = entityHistoryHandler({ uid: "CHE-000.000.001" });
    expect(out.isError).not.toBe(true);
    const struct = out.structured as { timeline: { field: string }[] };
    expect(struct.timeline.some((e) => e.field === "is_warning_listed")).toBe(false);
    expect(struct.timeline.some((e) => e.field === "name")).toBe(true);
    const texte = out.content.map((c) => c.text).join("\n");
    expect(texte).not.toMatch(/is_warning_listed/);
  });

  it("ne promet ni adresses ni liste d'alerte dans sa description", () => {
    expect(entityHistoryTool.description).toMatch(/Addresses and warning-list membership are not reported/);
    expect(entityHistoryTool.description).not.toMatch(/address moves|warning-list flag transitions/);
  });
});
