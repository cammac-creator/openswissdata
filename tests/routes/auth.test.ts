import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { sendMagicLinkMock } = vi.hoisted(() => ({
  sendMagicLinkMock: vi.fn().mockResolvedValue({ sent: false, reason: "no_api_key" }),
}));

vi.mock("../../src/lib/email.js", () => ({
  sendMagicLinkEmail: sendMagicLinkMock,
  sendDownloadEmail: vi.fn(),
  parseLocale: (v: unknown) => (v === "de" || v === "en" ? v : "fr"),
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
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "environnement-fictif");
    vi.stubEnv("SESSION_SECRET", "cle-de-limitation-fictive-pour-tests");
  });
  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.BASE_URL;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("POST /api/auth/magic-link — rate limiting (H3)", () => {
    it("H3: returns 429 on second request from same IP within 10 seconds", async () => {
      const app = createApp();
      // First request — should succeed
      const r1 = await app.request("/api/auth/magic-link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": "1.2.3.4",
        },
        body: JSON.stringify({ email: "alice@example.com" }),
      });
      expect(r1.status).toBe(200);

      // Second request from same IP within 10s — should be rate limited
      const r2 = await app.request("/api/auth/magic-link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": "1.2.3.4",
        },
        body: JSON.stringify({ email: "alice@example.com" }),
      });
      expect(r2.status).toBe(429);
    });

    it("Des IP différentes restent indépendantes pour des adresses différentes", async () => {
      const app = createApp();
      const r1 = await app.request("/api/auth/magic-link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": "10.0.0.1",
        },
        body: JSON.stringify({ email: "alice@example.com" }),
      });
      expect(r1.status).toBe(200);

      // Different IP — should not be rate limited
      const r2 = await app.request("/api/auth/magic-link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": "10.0.0.2",
        },
        body: JSON.stringify({ email: "autre@example.test" }),
      });
      expect(r2.status).toBe(200);
    });
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

  describe("Limites persistantes de demande de connexion", () => {
    const now = 1_790_415_000_000;
    const request = (app: ReturnType<typeof createApp>, email: string, ip: string, extra = {}) => app.request("/api/auth/magic-link", {
      method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip, ...extra }, body: JSON.stringify({ email }),
    });
    it("protège la même adresse malgré un changement de réseau et après réouverture de la base", async () => {
      vi.spyOn(Date, 'now').mockReturnValue(now);
      expect((await request(createApp(), 'alice@example.com', '192.0.2.1')).status).toBe(200);
      closeDb();
      const refused = await request(createApp(), 'alice@example.com', '192.0.2.2');
      expect(refused.status).toBe(429);expect(refused.headers.get('cache-control')).toBe('no-store');
      expect(refused.headers.get('retry-after')).toBe('60');expect(sendMagicLinkMock).toHaveBeenCalledTimes(1);
    });
    it("la limite IP survit à une réouverture et ignore un préfixe X-Forwarded-For forgé", async () => {
      vi.spyOn(Date, 'now').mockReturnValue(now);
      expect((await request(createApp(), 'inconnu1@example.test', '192.0.2.3', {'x-forwarded-for':'198.51.100.1'})).status).toBe(200);
      closeDb();
      expect((await request(createApp(), 'inconnu2@example.test', '192.0.2.3', {'x-forwarded-for':'198.51.100.2'})).status).toBe(429);
    });
    it("applique le même refus aux adresses inconnues et à leurs variantes de casse", async () => {
      vi.spyOn(Date, 'now').mockReturnValue(now);
      const first = await request(createApp(), 'inconnu@example.test', '192.0.2.4');
      const second = await request(createApp(), 'INCONNU@example.test', '192.0.2.5');
      expect(first.status).toBe(200);expect(await first.json()).toEqual({ok:true});
      expect(second.status).toBe(429);expect(await second.json()).toEqual({error:'too_many_requests'});
      expect(sendMagicLinkMock).not.toHaveBeenCalled();
    });
    it("un refus ne retire ni les liens reçus ni les sessions déjà actives", async () => {
      vi.spyOn(Date, 'now').mockReturnValue(now);
      const app=createApp();await request(app, 'alice@example.com', '192.0.2.6');
      const token=(getDb().prepare('SELECT token FROM sessions').get() as {token:string}).token;
      expect((await request(app, 'alice@example.com', '192.0.2.7')).status).toBe(429);
      const verified=await app.request('/api/auth/verify?token='+token);
      expect(verified.status).toBe(302);expect(verified.headers.get('location')).toBe('/account?auth=ok');
      const cookie=verified.headers.get('set-cookie')!.split(';')[0];
      expect((await app.request('/api/account',{headers:{cookie}})).status).toBe(200);
    });
    it("refuse un corps trop volumineux avant de créer un jeton", async () => {
      const response=await createApp().request('/api/auth/magic-link',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'alice@example.com',extra:'x'.repeat(5000)})});
      expect(response.status).toBe(413);expect(sendMagicLinkMock).not.toHaveBeenCalled();
      expect((getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get() as {n:number}).n).toBe(0);
    });
    it("ne permet pas de varier des en-têtes invalides pour changer le compteur commun", async () => {
      const app=createApp();
      expect((await request(app,'inconnu-a@example.test','invalide-a')).status).toBe(200);
      expect((await request(app,'inconnu-b@example.test','invalide-b')).status).toBe(429);
      expect(sendMagicLinkMock).not.toHaveBeenCalled();
    });
    it("borne aussi un corps transmis en flux sans longueur déclarée", async () => {
      const bytes=new TextEncoder().encode(JSON.stringify({email:'alice@example.com',extra:'x'.repeat(5000)}));
      const stream=new ReadableStream({start(controller){controller.enqueue(bytes);controller.close()}});
      const init={method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'} as RequestInit & {duplex:'half'};
      const response=await createApp().request('/api/auth/magic-link',init);
      expect(response.status).toBe(413);expect(sendMagicLinkMock).not.toHaveBeenCalled();
    });
    it("reste fermé si le stockage des limites est indisponible", async () => {
      getDb().exec('DROP TABLE auth_request_limits');
      const response=await request(createApp(),'alice@example.com','192.0.2.8');
      expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'temporarily_unavailable'});
      expect(sendMagicLinkMock).not.toHaveBeenCalled();
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
