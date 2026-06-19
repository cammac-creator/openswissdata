import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, closeDb } from "../../src/lib/db.js";
import { getTares, getFinmaRegistry } from "../../src/mcp/data-loader.js";
import { buildSnapshotRows, snapshotFromRows } from "../../src/mcp/snapshots.js";
import { tariffChangelogHandler } from "../../src/mcp/tools/tariff-changelog.js";
import { entityHistoryHandler } from "../../src/mcp/tools/entity-history.js";

// Note: dataset_snapshots has no FK and snapshotFromRows takes recordedAt
// directly, so the roundtrip needs neither `datasets` nor `versions` rows.

describe("dataset snapshots — write side", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-snap-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    getDb(); // create schema (dataset_snapshots, versions, …)
  });
  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
  });

  it("buildSnapshotRows emits one row per tracked field per entity, null for empty", () => {
    const rows = buildSnapshotRows("finma", "2026.06.18", 1000, [
      { uid: "CHE-1", name: "Alpha AG", licence_type: "Bank", status: "", canton: "ZH", city: "Zurich", is_warning_listed: "false" },
    ]);
    expect(rows).toHaveLength(6); // 6 FINMA tracked fields
    expect(rows.every((r) => r.entity_key === "CHE-1" && r.version === "2026.06.18")).toBe(true);
    expect(rows.find((r) => r.field === "status")!.value).toBeNull(); // empty → null
    expect(rows.find((r) => r.field === "name")!.value).toBe("Alpha AG");
  });

  it("entity key falls back to name: when uid is absent", () => {
    const rows = buildSnapshotRows("finma", "v1", 1, [{ name: "NoUid Sàrl" }]);
    expect(rows[0].entity_key).toBe("name:NoUid Sàrl");
  });

  it("refuses a slice with schema drift (missing tracked column) — no false changes", () => {
    const db = getDb();
    // Real-world case: an old TARES slice with duty_mfn_chf_per_100kg instead of
    // the tracked duty_mfn_value/_unit/_currency columns.
    const driftedRows = [
      { hs8: "12345678", duty_mfn_chf_per_100kg: "5", designation_fr: "Test", valid_from: "2026-01-01" },
    ];
    expect(() => snapshotFromRows(db, "tares", "2026.04.23", 1, driftedRows)).toThrow(/schema drift/);
    const count = db.prepare("SELECT COUNT(*) n FROM dataset_snapshots").get() as { n: number };
    expect(count.n).toBe(0); // nothing written
  });

  it("snapshotFromRows is idempotent (re-run inserts nothing)", () => {
    const db = getDb();
    const rows = [{ uid: "CHE-1", name: "Alpha AG", licence_type: "Bank", status: "active", canton: "ZH", city: "Zurich", is_warning_listed: "false" }];
    const first = snapshotFromRows(db, "finma", "v1", 1000, rows);
    expect(first.inserted).toBe(6);
    const second = snapshotFromRows(db, "finma", "v1", 1000, rows);
    expect(second.inserted).toBe(0); // INSERT OR IGNORE on UNIQUE
    expect(second.skipped).toBe(6);
  });

  it("ROUNDTRIP FINMA: two versions with a status change → entity_history returns it", () => {
    const db = getDb();
    const uid = getFinmaRegistry()[0].uid; // a real uid (for the `current` lookup)
    snapshotFromRows(db, "finma", "2026.06.17", 1000, [
      { uid, name: "X AG", licence_type: "Portfolio manager", status: "pending", canton: "VD", city: "Lausanne", is_warning_listed: "false" },
    ]);
    snapshotFromRows(db, "finma", "2026.06.18", 2000, [
      { uid, name: "X AG", licence_type: "Portfolio manager", status: "authorised", canton: "VD", city: "Lausanne", is_warning_listed: "false" },
    ]);
    closeDb();

    const res = entityHistoryHandler({ uid });
    const changed = res.structured!.timeline.filter((e) => e.event === "field_changed" && e.field === "status");
    expect(changed).toHaveLength(1);
    expect(changed[0].old_value).toBe("pending");
    expect(changed[0].new_value).toBe("authorised");
    expect(res.structured!.versions_observed).toEqual(["2026.06.17", "2026.06.18"]);
  });

  it("ROUNDTRIP TARES: two versions with a duty change → tariff_changelog returns it", () => {
    const db = getDb();
    const hs8 = getTares().rows[0].hs8; // a real HS8 (for the `current` lookup)
    snapshotFromRows(db, "tares", "2026.05.01", 1000, [
      { hs8, duty_mfn_value: "0", duty_mfn_unit: "CHF/kg", duty_mfn_currency: "CHF", designation_fr: "Test", valid_from: "2026-01-01" },
    ]);
    snapshotFromRows(db, "tares", "2026.06.01", 2000, [
      { hs8, duty_mfn_value: "5", duty_mfn_unit: "CHF/kg", duty_mfn_currency: "CHF", designation_fr: "Test", valid_from: "2026-01-01" },
    ]);
    closeDb();

    const res = tariffChangelogHandler({ hs8 });
    const dutyChanges = res.structured!.changes.filter((ch) => ch.field === "duty_mfn_value");
    expect(dutyChanges).toHaveLength(1);
    expect(dutyChanges[0].old_value).toBe("0");
    expect(dutyChanges[0].new_value).toBe("5");
  });
});
