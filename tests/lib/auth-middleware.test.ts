import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { requireAuth } from "../../src/lib/auth-middleware.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("requireAuth middleware", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-auth-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    const db = getDb();
    db.prepare("INSERT INTO customers (email, created_at) VALUES (?, ?)").run("a@b.com", Date.now());
    closeDb();
  });
  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
  });

  function makeApp() {
    const app = new Hono<{ Variables: { customer_id: number } }>();
    app.get("/protected", requireAuth, c => c.json({ cid: c.get("customer_id") }));
    return app;
  }

  it("returns 401 when no cookie", async () => {
    const res = await makeApp().request("/protected");
    expect(res.status).toBe(401);
  });

  it("returns 401 when cookie is malformed", async () => {
    const res = await makeApp().request("/protected", { headers: { cookie: "osd_session=short" } });
    expect(res.status).toBe(401);
  });

  it("returns 401 when session not found", async () => {
    const fakeToken = "A".repeat(43);
    const res = await makeApp().request("/protected", { headers: { cookie: `osd_session=${fakeToken}` } });
    expect(res.status).toBe(401);
  });

  it("returns 401 when session expired", async () => {
    const db = getDb();
    const cust = db.prepare("SELECT id FROM customers WHERE email = ?").get("a@b.com") as any;
    const token = "B".repeat(43);
    db.prepare("INSERT INTO sessions (token, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(token, cust.id, Date.now() - 1000, Date.now() - 2000);
    closeDb();
    const res = await makeApp().request("/protected", { headers: { cookie: `osd_session=${token}` } });
    expect(res.status).toBe(401);
  });

  it("passes with valid session and sets customer_id", async () => {
    const db = getDb();
    const cust = db.prepare("SELECT id FROM customers WHERE email = ?").get("a@b.com") as any;
    const token = "C".repeat(43);
    db.prepare("INSERT INTO sessions (token, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(token, cust.id, Date.now() + 3600_000, Date.now());
    closeDb();
    const res = await makeApp().request("/protected", { headers: { cookie: `osd_session=${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cid).toBe(cust.id);
  });
});
