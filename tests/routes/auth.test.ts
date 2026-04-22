import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { sendMagicLinkMock } = vi.hoisted(() => ({
  sendMagicLinkMock: vi.fn().mockResolvedValue({ sent: false, reason: "no_api_key" }),
}));

vi.mock("../../src/lib/email.js", () => ({
  sendMagicLinkEmail: sendMagicLinkMock,
  sendDownloadEmail: vi.fn(),
}));

import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("auth routes", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-auth-r-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.BASE_URL = "https://www.openswissdata.com";
    process.env.NODE_ENV = "test";
    const db = getDb();
    db.prepare("INSERT INTO customers (email, created_at) VALUES (?, ?)").run("alice@example.com", Date.now());
    closeDb();
    sendMagicLinkMock.mockClear();
  });
  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.BASE_URL;
  });

  describe("POST /api/auth/magic-link", () => {
    it("creates a short-TTL token and emails known customer", async () => {
      const app = createApp();
      const res = await app.request("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com" }),
      });
      expect(res.status).toBe(200);
      expect(sendMagicLinkMock).toHaveBeenCalled();
      const db = getDb();
      const sessions = db.prepare("SELECT * FROM sessions").all();
      expect(sessions).toHaveLength(1);
    });

    it("returns 200 silently for unknown email (no enumeration)", async () => {
      const app = createApp();
      const res = await app.request("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ghost@example.com" }),
      });
      expect(res.status).toBe(200);
      expect(sendMagicLinkMock).not.toHaveBeenCalled();
    });

    it("rejects invalid email format", async () => {
      const app = createApp();
      const res = await app.request("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/auth/verify", () => {
    it("rotates magic-link → long session and sets cookie, redirects to /account", async () => {
      const app = createApp();
      // First, request a magic link
      await app.request("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com" }),
      });
      const db = getDb();
      const token = (db.prepare("SELECT token FROM sessions").get() as any).token;
      closeDb();

      const res = await app.request(`/api/auth/verify?token=${token}`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/account?auth=ok");
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toMatch(/osd_session=[A-Za-z0-9_-]{43}/);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");

      // Original magic-link token must be gone; a new long-lived token must exist
      const db2 = getDb();
      const s = db2.prepare("SELECT token, expires_at FROM sessions").all() as any[];
      expect(s).toHaveLength(1);
      expect(s[0].token).not.toBe(token);
      expect(s[0].expires_at).toBeGreaterThan(Date.now() + 10 * 24 * 3600 * 1000); // > 10 days
    });

    it("redirects to /account?auth=invalid when token is malformed", async () => {
      const app = createApp();
      const res = await app.request("/api/auth/verify?token=short");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/account?auth=invalid");
    });

    it("redirects to /account?auth=expired when token not found", async () => {
      const app = createApp();
      const res = await app.request(`/api/auth/verify?token=${"Z".repeat(43)}`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/account?auth=expired");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("clears the session cookie and deletes session row", async () => {
      const db = getDb();
      const cust = db.prepare("SELECT id FROM customers WHERE email = ?").get("alice@example.com") as any;
      const token = "X".repeat(43);
      db.prepare("INSERT INTO sessions (token, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .run(token, cust.id, Date.now() + 3600_000, Date.now());
      closeDb();
      const app = createApp();
      const res = await app.request("/api/auth/logout", {
        method: "POST",
        headers: { cookie: `osd_session=${token}` },
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain("osd_session=;");
      expect(setCookie).toContain("Max-Age=0");
      const db2 = getDb();
      const s = db2.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
      expect(s).toBeUndefined();
    });
  });
});
