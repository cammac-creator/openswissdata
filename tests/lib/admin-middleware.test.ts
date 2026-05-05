import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { requireAdmin } from "../../src/lib/admin-middleware.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("requireAdmin middleware", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-admin-mw-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    const db = getDb();
    db.prepare("INSERT INTO customers (email, created_at) VALUES (?, ?)").run("admin@osd.com", Date.now());
    db.prepare("INSERT INTO customers (email, created_at) VALUES (?, ?)").run("user@osd.com", Date.now());
    closeDb();
  });
  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.ADMIN_EMAILS;
  });

  function makeApp() {
    const app = new Hono<{ Variables: { customer_id: number; customer_email: string } }>();
    app.get("/admin-only", requireAdmin, (c) =>
      c.json({ cid: c.get("customer_id"), email: c.get("customer_email") }),
    );
    return app;
  }

  function seedSession(email: string, token: string, expiresInMs: number) {
    const db = getDb();
    const cust = db.prepare("SELECT id FROM customers WHERE email = ?").get(email) as { id: number };
    db.prepare("INSERT INTO sessions (token, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(token, cust.id, Date.now() + expiresInMs, Date.now());
    closeDb();
    return cust.id;
  }

  it("returns 503 when ADMIN_EMAILS is unset", async () => {
    const res = await makeApp().request("/admin-only");
    expect(res.status).toBe(503);
  });

  it("returns 401 with no cookie", async () => {
    process.env.ADMIN_EMAILS = "admin@osd.com";
    const res = await makeApp().request("/admin-only");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a logged-in non-admin", async () => {
    process.env.ADMIN_EMAILS = "admin@osd.com";
    const token = "A".repeat(43);
    seedSession("user@osd.com", token, 60_000);
    const res = await makeApp().request("/admin-only", {
      headers: { cookie: `osd_session=${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 200 for a logged-in admin and sets variables", async () => {
    process.env.ADMIN_EMAILS = "admin@osd.com,other@x.com";
    const token = "B".repeat(43);
    const cid = seedSession("admin@osd.com", token, 60_000);
    const res = await makeApp().request("/admin-only", {
      headers: { cookie: `osd_session=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cid).toBe(cid);
    expect(body.email).toBe("admin@osd.com");
  });

  it("admin matching is case-insensitive", async () => {
    process.env.ADMIN_EMAILS = "ADMIN@OSD.COM";
    const token = "C".repeat(43);
    seedSession("admin@osd.com", token, 60_000);
    const res = await makeApp().request("/admin-only", {
      headers: { cookie: `osd_session=${token}` },
    });
    expect(res.status).toBe(200);
  });
});
