import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("GET /api/admin/stats", () => {
  let tmp: string;
  let token: string;
  let cid: number;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-admstats-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.SESSION_SECRET = "test-session-secret-1234";
    process.env.ADMIN_EMAILS = "admin@osd.com";
    delete process.env.PLAUSIBLE_API_KEY; // ensure available=false branch

    const db = getDb();
    const now = Date.now();
    const info = db.prepare("INSERT INTO customers (email, created_at) VALUES (?, ?)")
      .run("admin@osd.com", now);
    cid = Number(info.lastInsertRowid);
    token = "Z".repeat(43);
    db.prepare("INSERT INTO sessions (token, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(token, cid, now + 3600_000, now);
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, current_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("tares", "TARES", "tares", 29900, "p_t", "2026.04.22", now);
    // Live order
    const order = db.prepare("INSERT INTO orders (customer_id, stripe_session_id, amount_chf, items_json, status, created_at) VALUES (?, ?, ?, ?, 'paid', ?)")
      .run(cid, "cs_live_abc", 29900, JSON.stringify(["tares"]), now);
    // Test-mode order — must NOT be counted in live revenue.
    db.prepare("INSERT INTO orders (customer_id, stripe_session_id, amount_chf, items_json, status, created_at) VALUES (?, ?, ?, ?, 'paid', ?)")
      .run(cid, "cs_test_xyz", 29900, JSON.stringify(["tares"]), now);
    db.prepare("INSERT INTO entitlements (customer_id, dataset_id, order_id, updates_until, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(cid, "tares", Number(order.lastInsertRowid), now + 360 * 24 * 3600 * 1000, now);
    db.prepare(`INSERT INTO events (kind, name, status, duration_ms, ts, country, ua_class, visitor_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("api_request", "/api/account", 200, 12, now, "CH", "desktop", "abc123");
    db.prepare(`INSERT INTO events (kind, name, ts) VALUES (?, ?, ?)`).run("custom", "cta_pricing", now);
    closeDb();
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_EMAILS;
  });

  it("returns 401 without session cookie", async () => {
    const app = createApp();
    const res = await app.request("/api/admin/stats");
    expect(res.status).toBe(401);
  });

  it("returns full payload for an authenticated admin", async () => {
    const app = createApp();
    const res = await app.request("/api/admin/stats?days=30", {
      headers: { cookie: `osd_session=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.window.days).toBe(30);
    // Revenue split: 1 live + 1 test. Live KPI must show only the live one.
    expect(body.revenue.orders_count).toBe(1);
    expect(body.revenue.revenue_chf).toBe(29900);
    expect(body.revenue.test_orders_count).toBe(1);
    expect(body.revenue.test_revenue_chf).toBe(29900);
    expect(body.revenueAllTime.revenue_chf).toBe(29900);
    expect(body.revenueAllTime.test_revenue_chf).toBe(29900);
    expect(body.customers.total).toBeGreaterThanOrEqual(1);
    expect(body.entitlementsPerDataset.find((d: { id: string }) => d.id === "tares").count).toBe(1);
    expect(body.apiTraffic.total_requests).toBeGreaterThanOrEqual(1);
    expect(body.topPaths[0].path).toBe("/api/account");
    expect(body.topCountries[0].country).toBe("CH");
    expect(body.customEvents[0].name).toBe("cta_pricing");
    expect(body.plausible.available).toBe(false);
  });

  it("clamps days param to allowed range", async () => {
    const app = createApp();
    const res = await app.request("/api/admin/stats?days=99999", {
      headers: { cookie: `osd_session=${token}` },
    });
    const body = await res.json();
    expect(body.window.days).toBe(30); // fallback
  });
});
