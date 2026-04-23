import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { signedUrlMock } = vi.hoisted(() => ({
  signedUrlMock: vi.fn().mockResolvedValue("https://signed.example.com/zip?s=abc"),
}));

vi.mock("../../src/lib/r2.js", () => ({
  signedDownloadUrl: signedUrlMock,
  uploadZip: vi.fn(),
}));

import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("download routes", () => {
  let tmp: string;
  let token: string;
  let custId: number;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-dl-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.BASE_URL = "https://www.openswissdata.com";
    const db = getDb();
    const now = Date.now();
    const info = db.prepare("INSERT INTO customers (email, created_at) VALUES (?, ?)").run("c@d.com", now);
    custId = Number(info.lastInsertRowid);
    token = "A".repeat(43);
    db.prepare("INSERT INTO sessions (token, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(token, custId, now + 3600_000, now);
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, current_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("tares", "TARES", "tares", 29900, "p_t", "2026.04.22", now);
    db.prepare("INSERT INTO versions (dataset_id, version, r2_key, sha256, size_bytes, released_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("tares", "2026.04.22", "tares/2026.04.22.zip", "x".repeat(64), 100, now);
    const oid = db.prepare("INSERT INTO orders (customer_id, stripe_session_id, amount_chf, items_json, status, created_at) VALUES (?, ?, ?, ?, 'paid', ?)")
      .run(custId, "cs_x", 29900, JSON.stringify(["tares"]), now);
    db.prepare("INSERT INTO entitlements (customer_id, dataset_id, order_id, updates_until, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(custId, "tares", Number(oid.lastInsertRowid), now + 360 * 24 * 3600 * 1000, now);
    closeDb();
    signedUrlMock.mockClear();
  });
  afterEach(() => { closeDb(); rmSync(tmp, { recursive: true, force: true }); delete process.env.DATABASE_PATH; delete process.env.BASE_URL; });

  it("POST /api/account/download-request returns signed URL for entitled dataset", async () => {
    const app = createApp();
    const res = await app.request("/api/account/download-request", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `osd_session=${token}` },
      body: JSON.stringify({ dataset_id: "tares" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.download_url).toContain("signed.example.com");
    expect(body.share_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.share_url).toContain("/api/download/");
    const db = getDb();
    const t = db.prepare("SELECT dataset_id, version FROM download_tokens WHERE token = ?").get(body.share_token) as any;
    expect(t.dataset_id).toBe("tares");
    expect(t.version).toBe("2026.04.22");
  });

  it("POST /api/account/download-request 403 without entitlement", async () => {
    const app = createApp();
    const res = await app.request("/api/account/download-request", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `osd_session=${token}` },
      body: JSON.stringify({ dataset_id: "finma" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/account/download-request 401 without auth", async () => {
    const app = createApp();
    const res = await app.request("/api/account/download-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_id: "tares" }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/download/:token redirects to signed URL when valid", async () => {
    const app = createApp();
    // Issue download token first
    const issue = await app.request("/api/account/download-request", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `osd_session=${token}` },
      body: JSON.stringify({ dataset_id: "tares" }),
    });
    const { share_token } = await issue.json();

    signedUrlMock.mockClear();
    const res = await app.request(`/api/download/${share_token}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("signed.example.com");
    // used_at must be set
    const db = getDb();
    const row = db.prepare("SELECT used_at FROM download_tokens WHERE token = ?").get(share_token) as any;
    expect(row.used_at).not.toBeNull();
  });

  it("GET /api/download/:token returns 410 when expired", async () => {
    const db = getDb();
    const expiredTok = "E".repeat(43);
    db.prepare("INSERT INTO download_tokens (token, customer_id, dataset_id, version, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(expiredTok, custId, "tares", "2026.04.22", Date.now() - 1000, Date.now() - 2000);
    closeDb();
    const app = createApp();
    const res = await app.request(`/api/download/${expiredTok}`);
    expect(res.status).toBe(410);
  });

  it("GET /api/download/:token returns 400 on malformed token", async () => {
    const app = createApp();
    const res = await app.request(`/api/download/short`);
    expect(res.status).toBe(400);
  });

  // H1: expired entitlement (updates_until < now) must return 403 subscription_expired
  it("H1: POST /api/account/download-request returns 403 when updates_until is in the past", async () => {
    const db = getDb();
    // Overwrite the entitlement with an expired updates_until
    db.prepare("UPDATE entitlements SET updates_until = ? WHERE customer_id = ? AND dataset_id = ?")
      .run(Date.now() - 1000, custId, "tares");
    closeDb();

    const app = createApp();
    const res = await app.request("/api/account/download-request", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `osd_session=${token}` },
      body: JSON.stringify({ dataset_id: "tares" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("subscription_expired");
  });

  // H1: null updates_until (perpetual entitlement) must still allow download
  it("H1: POST /api/account/download-request succeeds when updates_until is null (perpetual)", async () => {
    const db = getDb();
    db.prepare("UPDATE entitlements SET updates_until = NULL WHERE customer_id = ? AND dataset_id = ?")
      .run(custId, "tares");
    closeDb();

    const app = createApp();
    const res = await app.request("/api/account/download-request", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `osd_session=${token}` },
      body: JSON.stringify({ dataset_id: "tares" }),
    });
    expect(res.status).toBe(200);
  });
});
