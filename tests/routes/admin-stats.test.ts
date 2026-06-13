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

  it("computes the MCP kill-gate metrics (human calls, caller split, paying)", async () => {
    const db = getDb();
    const now = Date.now();
    const ev = db.prepare(
      "INSERT INTO events (kind, name, status, ua_class, meta_json, visitor_hash, ts) VALUES ('custom','mcp_tool_call',200,?,?,?,?)",
    );
    // Human authenticated, non-admin: 2× client c1, 1× client c2 → 2 distinct clients.
    ev.run("human_authenticated", JSON.stringify({ admin: false, client_id: "c1" }), "v1", now);
    ev.run("human_authenticated", JSON.stringify({ admin: false, client_id: "c1" }), "v1", now);
    ev.run("human_authenticated", JSON.stringify({ admin: false, client_id: "c2" }), "v2", now);
    // mcp_client anonymous (client_id null) ×2.
    ev.run("mcp_client", JSON.stringify({ admin: false, client_id: null }), "v3", now);
    ev.run("mcp_client", JSON.stringify({ admin: false, client_id: null }), "v4", now);
    // Noise: scanner ×4, bot ×1.
    for (let i = 0; i < 4; i++) ev.run("scanner", JSON.stringify({ admin: false, client_id: null }), "vs" + i, now);
    ev.run("bot", JSON.stringify({ admin: false, client_id: null }), "vb", now);
    // Admin bypass (Claude-Alain) — must be EXCLUDED from human count.
    ev.run("human_authenticated", JSON.stringify({ admin: true, client_id: "adminc" }), "va", now);
    // Out of the 7-day window — must be EXCLUDED.
    ev.run("human_authenticated", JSON.stringify({ admin: false, client_id: "old" }), "vo", now - 8 * 24 * 3600 * 1000);

    // Paying MCP clients.
    const mc = db.prepare(
      "INSERT INTO mcp_clients (client_id, client_secret_hash, name, email, tier, scopes, customer_id, created_at, revoked_at, stripe_subscription_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
    );
    mc.run("osd_buyer", "h", "Buyer", "buyer@external.com", "business", "", null, now, null, "sub_b"); // counts: 199
    mc.run("osd_admin", "h", "Admin sub", "admin@osd.com", "standalone", "", null, now, null, "sub_a"); // excluded (ADMIN_EMAILS)
    mc.run("osd_admin2", "h", "Admin mixed-case", "ADMIN@OSD.com", "business", "", null, now, null, "sub_a2"); // excluded (case-insensitive)
    mc.run("osd_free", "h", "Free", "free@x.com", "free", "", null, now, null, null); // excluded (no sub)
    closeDb();

    const app = createApp();
    const res = await app.request("/api/admin/stats?days=30", {
      headers: { cookie: `osd_session=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // ONLY human_authenticated (non-admin) counts; mcp_client is anonymous/spoofable → excluded.
    expect(body.mcpHuman7d.human_calls).toBe(3); // c1, c1, c2 (excl. mcp_client/scanner/bot/admin/old)
    expect(body.mcpHuman7d.distinct_clients).toBe(2); // c1, c2 (nulls ignored)

    const split: Record<string, number> = {};
    for (const r of body.mcpCallerSplit) split[r.caller_class] = r.calls;
    expect(split.human_authenticated).toBe(4); // 3 non-admin + 1 admin, in-window
    expect(split.mcp_client).toBe(2);
    expect(split.scanner).toBe(4);
    expect(split.bot).toBe(1);

    expect(body.mcpPaying.paying_clients).toBe(1); // buyer only; admin email + free excluded
    expect(body.mcpPaying.mrr_chf).toBe(199);
  });
});
