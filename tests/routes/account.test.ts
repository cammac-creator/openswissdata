import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("account routes", () => {
  let tmp: string;
  let token: string;
  let custId: number;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-acc-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    const db = getDb();
    const now = Date.now();
    const info = db.prepare("INSERT INTO customers (email, created_at) VALUES (?, ?)").run("bob@example.com", now);
    custId = Number(info.lastInsertRowid);
    token = "A".repeat(43);
    db.prepare("INSERT INTO sessions (token, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(token, custId, now + 3600_000, now);
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, current_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("tares", "TARES", "tares", 29900, "p_t", "2026.04.22", now);
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, current_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("finma", "FINMA", "finma", 29900, "p_f", "2026.04.22", now);
    const orderInfo = db.prepare("INSERT INTO orders (customer_id, stripe_session_id, amount_chf, items_json, status, created_at) VALUES (?, ?, ?, ?, 'paid', ?)")
      .run(custId, "cs_t", 29900, JSON.stringify(["tares"]), now);
    const orderId = Number(orderInfo.lastInsertRowid);
    db.prepare("INSERT INTO entitlements (customer_id, dataset_id, order_id, updates_until, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(custId, "tares", orderId, now + 360 * 24 * 3600 * 1000, now);
    closeDb();
  });
  afterEach(() => { closeDb(); rmSync(tmp, { recursive: true, force: true }); delete process.env.DATABASE_PATH; });

  it("GET /api/account returns customer info when authenticated", async () => {
    const app = createApp();
    const res = await app.request("/api/account", { headers: { cookie: `osd_session=${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.customer.email).toBe("bob@example.com");
  });

  it("GET /api/account returns 401 without session", async () => {
    const app = createApp();
    const res = await app.request("/api/account");
    expect(res.status).toBe(401);
  });

  it("GET /api/account/datasets returns entitled datasets only", async () => {
    const app = createApp();
    const res = await app.request("/api/account/datasets", { headers: { cookie: `osd_session=${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.datasets).toHaveLength(1);
    expect(body.datasets[0].id).toBe("tares");
    expect(body.datasets[0].current_version).toBe("2026.04.22");
  });
});
