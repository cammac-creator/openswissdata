import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("POST /api/admin/seed", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-seed-adm-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.ADMIN_SECRET = "test-secret-1234567890";
    process.env.STRIPE_PRICE_TARES = "price_test_tares";
    process.env.STRIPE_PRICE_TARES_UPDATES = "price_test_tares_up";
    process.env.STRIPE_PRICE_CLASSIFICATIONS = "price_test_class";
    process.env.STRIPE_PRICE_CLASSIFICATIONS_UPDATES = "price_test_class_up";
    process.env.STRIPE_PRICE_FINMA = "price_test_finma";
    process.env.STRIPE_PRICE_FINMA_UPDATES = "price_test_finma_up";
    process.env.STRIPE_PRICE_BUNDLE = "price_test_bundle";
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.ADMIN_SECRET;
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
  });

  it("returns 401 when admin secret is missing", async () => {
    const app = createApp();
    const res = await app.request("/api/admin/seed", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when admin secret is wrong", async () => {
    const app = createApp();
    const res = await app.request("/api/admin/seed", {
      method: "POST",
      headers: { "x-admin-secret": "wrong-secret-value" },
    });
    expect(res.status).toBe(401);
  });

  it("inserts 3 datasets on empty DB", async () => {
    const app = createApp();
    const res = await app.request("/api/admin/seed", {
      method: "POST",
      headers: { "x-admin-secret": "test-secret-1234567890" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toEqual(
      expect.arrayContaining(["tares", "classifications", "finma"])
    );
    expect(body.updated).toEqual([]);
    const db = getDb();
    const count = (
      db.prepare("SELECT COUNT(*) as n FROM datasets").get() as { n: number }
    ).n;
    expect(count).toBe(3);
  });

  it("is idempotent — second call returns only updated", async () => {
    const app = createApp();
    await app.request("/api/admin/seed", {
      method: "POST",
      headers: { "x-admin-secret": "test-secret-1234567890" },
    });
    const res2 = await app.request("/api/admin/seed", {
      method: "POST",
      headers: { "x-admin-secret": "test-secret-1234567890" },
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.inserted).toEqual([]);
    expect(body2.updated.length).toBe(3);
  });
});

describe("POST /api/admin/release", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-admin-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.ADMIN_SECRET = "test-secret-1234567890";
    process.env.NODE_ENV = "test";
    const db = getDb();
    db.prepare(
      "INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("tares", "TARES", "tares", 29900, "price_test", Date.now());
    closeDb();
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.ADMIN_SECRET;
  });

  it("returns 401 when admin secret is missing", async () => {
    const app = createApp();
    const res = await app.request("/api/admin/release", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dataset_id: "tares",
        version: "2026.04.17",
        r2_key: "tares/2026.04.17.zip",
        sha256: "a".repeat(64),
        size_bytes: 100,
        changelog: "",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when admin secret is wrong", async () => {
    const app = createApp();
    const res = await app.request("/api/admin/release", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-secret": "wrong",
      },
      body: JSON.stringify({
        dataset_id: "tares",
        version: "2026.04.17",
        r2_key: "tares/2026.04.17.zip",
        sha256: "a".repeat(64),
        size_bytes: 100,
        changelog: "",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("records a new version and sets current_version", async () => {
    const app = createApp();
    const res = await app.request("/api/admin/release", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-secret": "test-secret-1234567890",
      },
      body: JSON.stringify({
        dataset_id: "tares",
        version: "2026.04.17",
        r2_key: "tares/2026.04.17.zip",
        sha256: "a".repeat(64),
        size_bytes: 12345,
        changelog: "initial release",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dataset_id).toBe("tares");
    expect(body.version).toBe("2026.04.17");

    const db = getDb();
    const row = db.prepare("SELECT * FROM versions WHERE dataset_id=?").get("tares") as any;
    expect(row.version).toBe("2026.04.17");
    expect(row.r2_key).toBe("tares/2026.04.17.zip");
    expect(row.size_bytes).toBe(12345);
    const ds = db.prepare("SELECT current_version FROM datasets WHERE id=?").get("tares") as any;
    expect(ds.current_version).toBe("2026.04.17");
  });

  it("rejects invalid version format", async () => {
    const app = createApp();
    const res = await app.request("/api/admin/release", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-secret": "test-secret-1234567890",
      },
      body: JSON.stringify({
        dataset_id: "tares",
        version: "bad-version",
        r2_key: "tares/x.zip",
        sha256: "a".repeat(64),
        size_bytes: 100,
        changelog: "",
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("rejects sha256 with wrong length", async () => {
    const app = createApp();
    const res = await app.request("/api/admin/release", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-secret": "test-secret-1234567890",
      },
      body: JSON.stringify({
        dataset_id: "tares",
        version: "2026.04.17",
        r2_key: "tares/x.zip",
        sha256: "tooshort",
        size_bytes: 100,
        changelog: "",
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // C3: constant-time comparison — a secret with correct prefix but wrong suffix must be rejected
  it("C3: rejects a secret that shares a prefix but differs in final characters", async () => {
    const app = createApp();
    // ADMIN_SECRET is "test-secret-1234567890" — attacker guesses "test-secret-123456789X"
    const almostRight = "test-secret-123456789X";
    const res = await app.request("/api/admin/release", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-secret": almostRight,
      },
      body: JSON.stringify({
        dataset_id: "tares",
        version: "2026.04.17",
        r2_key: "tares/x.zip",
        sha256: "a".repeat(64),
        size_bytes: 100,
        changelog: "",
      }),
    });
    expect(res.status).toBe(401);
  });

  // C3: same for /seed endpoint
  it("C3: rejects a same-prefix wrong-suffix secret on /seed", async () => {
    const app = createApp();
    const almostRight = "test-secret-1234567890X"; // one extra char — also should fail
    const res = await app.request("/api/admin/seed", {
      method: "POST",
      headers: { "x-admin-secret": almostRight },
    });
    expect(res.status).toBe(401);
  });
});
