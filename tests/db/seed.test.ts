import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { seedDatasets } from "../../src/db/seed.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("seedDatasets", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-seed-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.STRIPE_PRICE_TARES = "price_test_tares";
    process.env.STRIPE_PRICE_TARES_UPDATES = "price_test_tares_up";
    process.env.STRIPE_PRICE_CLASSIFICATIONS = "price_test_classif";
    process.env.STRIPE_PRICE_CLASSIFICATIONS_UPDATES = "price_test_classif_up";
    process.env.STRIPE_PRICE_FINMA = "price_test_finma";
    process.env.STRIPE_PRICE_FINMA_UPDATES = "price_test_finma_up";
    process.env.STRIPE_PRICE_BUNDLE = "price_test_bundle";
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    for (const k of [
      "STRIPE_PRICE_TARES",
      "STRIPE_PRICE_TARES_UPDATES",
      "STRIPE_PRICE_CLASSIFICATIONS",
      "STRIPE_PRICE_CLASSIFICATIONS_UPDATES",
      "STRIPE_PRICE_FINMA",
      "STRIPE_PRICE_FINMA_UPDATES",
      "STRIPE_PRICE_BUNDLE",
    ]) {
      delete process.env[k];
    }
    delete process.env.DATABASE_PATH;
  });

  it("inserts 3 datasets on first run", () => {
    const result = seedDatasets();
    expect(result.inserted.sort()).toEqual(["classifications", "finma", "tares"]);
    expect(result.updated).toEqual([]);
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT id, slug, price_chf, stripe_price_id, stripe_updates_price_id FROM datasets ORDER BY id"
      )
      .all();
    expect(rows).toHaveLength(3);
    expect((rows[2] as any).id).toBe("tares");
    expect((rows[2] as any).price_chf).toBe(29900);
    expect((rows[2] as any).stripe_price_id).toBe("price_test_tares");
    expect((rows[2] as any).stripe_updates_price_id).toBe("price_test_tares_up");
  });

  it("is idempotent (second run marks all as updated, not inserted)", () => {
    seedDatasets();
    const r2 = seedDatasets();
    expect(r2.inserted).toEqual([]);
    expect(r2.updated.sort()).toEqual(["classifications", "finma", "tares"]);
  });

  it("updates prices on re-run when env vars change", () => {
    seedDatasets();
    process.env.STRIPE_PRICE_TARES = "price_test_tares_NEW";
    seedDatasets();
    const db = getDb();
    const row = db
      .prepare("SELECT stripe_price_id FROM datasets WHERE id=?")
      .get("tares") as any;
    expect(row.stripe_price_id).toBe("price_test_tares_NEW");
  });

  it("throws when a required price env var is missing", () => {
    delete process.env.STRIPE_PRICE_FINMA;
    expect(() => seedDatasets()).toThrow(/STRIPE_PRICE_FINMA/);
  });

  it("throws when an env var is still a placeholder", () => {
    process.env.STRIPE_PRICE_CLASSIFICATIONS = "price_test_xxx";
    expect(() => seedDatasets()).toThrow(/STRIPE_PRICE_CLASSIFICATIONS/);
  });
});
