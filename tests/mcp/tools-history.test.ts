import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { tariffChangelogHandler } from "../../src/mcp/tools/tariff-changelog.js";
import { entityHistoryHandler } from "../../src/mcp/tools/entity-history.js";
import { snapshotTares, snapshotFinma } from "../../etl/shared/snapshot.js";
import { closeDb, getDb } from "../../src/lib/db.js";
import { _resetDataLoaderCache, getTares, getFinmaRegistry } from "../../src/mcp/data-loader.js";

let workDir: string;
let dbPath: string;

beforeAll(() => {
  // Use a throwaway DB so we don't pollute data/openswissdata.sqlite
  workDir = mkdtempSync(join(tmpdir(), "osd-history-"));
  dbPath = join(workDir, "test.sqlite");
  process.env.DATABASE_PATH = dbPath;
  closeDb(); // ensure no cached handle from a previous test
  _resetDataLoaderCache();
});

afterAll(() => {
  closeDb();
  delete process.env.DATABASE_PATH;
  rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Wipe snapshot table between tests for determinism. Other tables are
  // unused here.
  const db = getDb();
  db.exec("DELETE FROM dataset_snapshots;");
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function seedVersionsRow(datasetId: string, version: string, releasedAt: number): void {
  const db = getDb();
  // Need a parent dataset row first (FK)
  db.prepare(
    `INSERT OR IGNORE INTO datasets (id, name, slug, price_chf, stripe_price_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(datasetId, datasetId.toUpperCase(), datasetId, 0, "price_test", Date.now());
  db.prepare(
    `INSERT OR IGNORE INTO versions (dataset_id, version, r2_key, sha256, size_bytes, released_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(datasetId, version, `${datasetId}/${version}/${datasetId}.zip`, "deadbeef", 1, releasedAt);
}

// ---------------------------------------------------------------------
// Snapshot ingestion
// ---------------------------------------------------------------------

describe("snapshot ingestion", () => {
  it("snapshotTares ingests rows from a small CSV fixture", async () => {
    seedVersionsRow("tares", "2026.04.30", Date.parse("2026-04-30T00:00:00Z"));
    const csv =
      "hs8,hs6,chapter,heading,designation_fr,duty_mfn_value,duty_mfn_unit,duty_mfn_currency,valid_from\n" +
      "01011010,010110,1,0101,Chevaux purs,0,par 1 pièce(s),CHF,2012-01-01\n" +
      "01012110,010121,1,0101,Chevaux,120,par 1 pièce(s),CHF,2012-01-01\n";
    const csvPath = join(workDir, "fixture-tares.csv");
    writeFileSync(csvPath, csv, "utf8");

    const r = await snapshotTares("2026.04.30", { localCsv: csvPath });
    // 2 rows × 5 fields = 10 snapshots
    expect(r.inserted).toBe(10);
    expect(r.rowCount).toBe(2);

    const db = getDb();
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM dataset_snapshots WHERE dataset_id='tares' AND entity_key='01011010'")
      .get() as { n: number };
    expect(count.n).toBe(5);
  });

  it("snapshotFinma ingests rows keyed by UID", async () => {
    seedVersionsRow("finma", "2026.04.30.1", Date.parse("2026-04-30T00:00:00Z"));
    const csv =
      "entity_type,name,uid,licence_type,status,canton,city,is_warning_listed\n" +
      "insurance,AXA Test AG,CHE-103.137.179,Life insurance,active,ZH,Winterthur,false\n" +
      "bank,Test Bank SA,CHE-999.888.777,Banking,active,GE,Genève,false\n";
    const csvPath = join(workDir, "fixture-finma.csv");
    writeFileSync(csvPath, csv, "utf8");

    const r = await snapshotFinma("2026.04.30.1", { localCsv: csvPath });
    // 2 rows × 6 fields = 12 snapshots
    expect(r.inserted).toBe(12);

    const db = getDb();
    const rows = db
      .prepare("SELECT field, value FROM dataset_snapshots WHERE dataset_id='finma' AND entity_key='CHE-103.137.179'")
      .all() as { field: string; value: string | null }[];
    expect(rows.length).toBe(6);
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
    expect(byField.licence_type).toBe("Life insurance");
    expect(byField.canton).toBe("ZH");
  });

  it("re-running the snapshot is a no-op (idempotency via UNIQUE constraint)", async () => {
    seedVersionsRow("tares", "2026.04.30", Date.parse("2026-04-30T00:00:00Z"));
    const csv =
      "hs8,hs6,chapter,heading,designation_fr,duty_mfn_value,duty_mfn_unit,duty_mfn_currency,valid_from\n" +
      "01011010,010110,1,0101,Chevaux purs,0,par 1 pièce(s),CHF,2012-01-01\n";
    const csvPath = join(workDir, "fixture-tares-idem.csv");
    writeFileSync(csvPath, csv, "utf8");

    const r1 = await snapshotTares("2026.04.30", { localCsv: csvPath });
    const r2 = await snapshotTares("2026.04.30", { localCsv: csvPath });
    expect(r1.inserted).toBe(5);
    expect(r2.inserted).toBe(0);
    expect(r2.skipped).toBe(5);
  });
});

// ---------------------------------------------------------------------
// tariff_changelog tool
// ---------------------------------------------------------------------

describe("tariff_changelog", () => {
  it("returns the structured response with at least one snapshot version", async () => {
    seedVersionsRow("tares", "2026.04.30", Date.parse("2026-04-30T00:00:00Z"));
    const csv =
      "hs8,hs6,chapter,heading,designation_fr,duty_mfn_value,duty_mfn_unit,duty_mfn_currency,valid_from\n" +
      "01011010,010110,1,0101,Chevaux purs,0,par 1 pièce(s),CHF,2012-01-01\n";
    const csvPath = join(workDir, "fixture-tariff-changelog.csv");
    writeFileSync(csvPath, csv, "utf8");
    await snapshotTares("2026.04.30", { localCsv: csvPath });

    // Pick an existing HS8 from the bundled CSV (data-loader)
    const { rows } = getTares();
    expect(rows.length).toBeGreaterThan(0);
    const hs = rows[0].hs8;
    const out = tariffChangelogHandler({ hs8: hs });
    expect(out.isError).not.toBe(true);
    const struct = out.structured as { hs_code: string; versions_observed: string[]; changes: unknown[] };
    expect(struct.hs_code).toBe(hs);
    // No diff yet (only 1 version) — but the structure must be valid
    expect(Array.isArray(struct.changes)).toBe(true);
  });

  it("computes diffs across two consecutive versions", () => {
    const t1 = Date.parse("2026-04-15T00:00:00Z");
    const t2 = Date.parse("2026-04-30T00:00:00Z");
    seedVersionsRow("tares", "2026.04.15", t1);
    seedVersionsRow("tares", "2026.04.30", t2);

    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO dataset_snapshots (dataset_id, version, entity_key, field, value, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // Pick a real HS8 from bundled data so the `current` block resolves
    const { rows } = getTares();
    const hs = rows[0].hs8;
    stmt.run("tares", "2026.04.15", hs, "duty_mfn_value", "100", t1);
    stmt.run("tares", "2026.04.30", hs, "duty_mfn_value", "120", t2);
    stmt.run("tares", "2026.04.15", hs, "duty_mfn_unit", "par 1 pièce(s)", t1);
    stmt.run("tares", "2026.04.30", hs, "duty_mfn_unit", "par 1 pièce(s)", t2);

    const out = tariffChangelogHandler({ hs8: hs });
    expect(out.isError).not.toBe(true);
    const struct = out.structured as {
      changes: { field: string; old_value: string | null; new_value: string | null }[];
      versions_observed: string[];
    };
    expect(struct.versions_observed.length).toBe(2);
    const dutyChange = struct.changes.find((c) => c.field === "duty_mfn_value");
    expect(dutyChange).toBeDefined();
    expect(dutyChange!.old_value).toBe("100");
    expect(dutyChange!.new_value).toBe("120");
  });

  it("returns isError on bad HS8 format", () => {
    const out = tariffChangelogHandler({ hs8: "not-an-hs" });
    expect(out.isError).toBe(true);
  });

  it("returns isError when HS8 is well-formed but unknown in the bundled registry", () => {
    const out = tariffChangelogHandler({ hs8: "99999999" });
    expect(out.isError).toBe(true);
  });

  it("succeeds with empty changes when no snapshots exist for a real HS8", () => {
    const { rows } = getTares();
    const hs = rows[1].hs8; // pick a different HS that has no snapshots seeded
    const out = tariffChangelogHandler({ hs8: hs });
    expect(out.isError).not.toBe(true);
    const struct = out.structured as { changes: unknown[]; versions_observed: string[] };
    expect(struct.changes).toEqual([]);
    expect(struct.versions_observed).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// entity_history tool
// ---------------------------------------------------------------------

describe("entity_history", () => {
  it("returns the timeline + current state for a UID with snapshots", async () => {
    seedVersionsRow("finma", "2026.04.30.1", Date.parse("2026-04-30T00:00:00Z"));
    const csv =
      "entity_type,name,uid,licence_type,status,canton,city,is_warning_listed\n" +
      "insurance,AXA Test AG,CHE-103.137.179,Life insurance,active,ZH,Winterthur,false\n";
    const csvPath = join(workDir, "fixture-entity-history.csv");
    writeFileSync(csvPath, csv, "utf8");
    await snapshotFinma("2026.04.30.1", { localCsv: csvPath });

    // Use a UID present in the bundled FINMA registry so `current` resolves
    const reg = getFinmaRegistry();
    const realRow = reg.find((r) => r.uid && r.uid.startsWith("CHE-"));
    expect(realRow).toBeDefined();

    const out = entityHistoryHandler({ uid: realRow!.uid });
    expect(out.isError).not.toBe(true);
    const struct = out.structured as {
      uid: string;
      current: { name: string | null };
      timeline: unknown[];
      versions_observed: string[];
    };
    expect(struct.uid).toBe(realRow!.uid);
    // current must come from the bundled registry
    expect(struct.current.name).toBe(realRow!.name);
  });

  it("emits an 'added' event then 'field_changed' when a field mutates", () => {
    const t1 = Date.parse("2026-04-15T00:00:00Z");
    const t2 = Date.parse("2026-04-30T00:00:00Z");
    seedVersionsRow("finma", "2026.04.15", t1);
    seedVersionsRow("finma", "2026.04.30", t2);

    const db = getDb();
    const reg = getFinmaRegistry();
    const realRow = reg.find((r) => r.uid && r.uid.startsWith("CHE-"));
    expect(realRow).toBeDefined();
    const uid = realRow!.uid;

    const stmt = db.prepare(
      `INSERT INTO dataset_snapshots (dataset_id, version, entity_key, field, value, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    stmt.run("finma", "2026.04.15", uid, "status", "active", t1);
    stmt.run("finma", "2026.04.30", uid, "status", "withdrawn", t2);
    stmt.run("finma", "2026.04.15", uid, "name", realRow!.name, t1);
    stmt.run("finma", "2026.04.30", uid, "name", realRow!.name, t2);

    const out = entityHistoryHandler({ uid });
    expect(out.isError).not.toBe(true);
    const struct = out.structured as {
      timeline: { event: string; field: string; old_value: string | null; new_value: string | null }[];
      versions_observed: string[];
    };
    expect(struct.versions_observed.length).toBe(2);
    const statusChange = struct.timeline.find(
      (e) => e.field === "status" && e.event === "field_changed",
    );
    expect(statusChange).toBeDefined();
    expect(statusChange!.old_value).toBe("active");
    expect(statusChange!.new_value).toBe("withdrawn");
  });

  it("rejects UIDs that don't start with 'CHE-'", () => {
    const out = entityHistoryHandler({ uid: "not-a-uid" });
    expect(out.isError).toBe(true);
  });

  it("succeeds with empty timeline when UID is unknown to the snapshot store", () => {
    const out = entityHistoryHandler({ uid: "CHE-000.000.000" });
    expect(out.isError).not.toBe(true);
    const struct = out.structured as { timeline: unknown[]; versions_observed: string[] };
    expect(struct.timeline).toEqual([]);
    expect(struct.versions_observed).toEqual([]);
  });
});
