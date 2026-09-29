import '../helpers/session-origin.js';
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Contrat de /api/delivery/:token, écrit le 29.09.2026 AVANT la refonte Atlas de la page
// et relancé après : pour chaque état, statut, en-têtes, redirection, formulaire et traces
// en base restent identiques. Seuls le corps (présentation) et son content-type peuvent changer.

const { signedUrlMock } = vi.hoisted(() => ({ signedUrlMock: vi.fn() }));
vi.mock("../../src/lib/r2.js", () => ({ signedDownloadUrl: signedUrlMock, uploadZip: vi.fn() }));

import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SIGNED = "https://compte-fictif.r2.cloudflarestorage.com/osd/tares.zip?X-Amz-Signature=fictive";
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; base-uri 'none'";
const DAY = 86_400_000;

// En-têtes relevés sur le code d'avant la refonte, communs à toutes les réponses de la route.
const COMMON = {
  "content-security-policy": CSP,
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "permissions-policy": 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")',
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=15552000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-dns-prefetch-control": "off",
  "x-download-options": "noopen",
  "x-frame-options": "DENY",
  "x-permitted-cross-domain-policies": "none",
  "x-xss-protection": "0",
};
const PREVIEW = { ...COMMON, "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" };
const WITH_BODY = { ...COMMON, "cache-control": "no-store", vary: "Accept-Encoding" };
const REDIRECT = { ...COMMON, "cache-control": "no-store", location: SIGNED };

// Deux façons de soumettre : un vrai formulaire de navigateur (Origin null à cause de
// no-referrer) et un client minimal, comme les tests historiques.
const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "de-CH,de;q=0.9,fr;q=0.8",
  "content-type": "application/x-www-form-urlencoded",
  origin: "null",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
};
const CLIENTS = { navigateur: BROWSER, minimal: {} } as const;

function headerMap(res: Response): Record<string, string> {
  const map: Record<string, string> = {};
  res.headers.forEach((value, key) => { if (key !== "content-type") map[key] = value; });
  return map;
}

/** Ce que le formulaire soumet réellement : méthode, cible et champs (y compris un bouton nommé). */
function formContract(html: string) {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  return forms.map(([, attrs, inner]) => ({
    method: /\bmethod="([^"]*)"/i.exec(attrs)?.[1]?.toLowerCase() ?? null,
    action: /\baction="([^"]*)"/i.exec(attrs)?.[1] ?? null,
    fields: [...inner.matchAll(/<(input|select|textarea)\b[^>]*>/gi)].length
      + [...inner.matchAll(/<button\b[^>]*\bname=/gi)].length,
  }));
}

describe("contrat de la page de livraison /api/delivery/:token", () => {
  let tmp: string;
  let customerId: number;
  const now = Date.now();

  function issue(token: string, opts: { expiresAt?: number; version?: string; usedAt?: number | null } = {}) {
    const db = getDb();
    const version = opts.version ?? "2026.09.28";
    const activity = db.prepare("INSERT INTO download_activity(customer_id,dataset_id,version,order_id,source,created_at) VALUES(?,?,?,NULL,'email',?)")
      .run(customerId, "tares", version, now);
    db.prepare("INSERT INTO download_tokens(token,customer_id,dataset_id,version,expires_at,used_at,created_at,activity_id) VALUES(?,?,?,?,?,?,?,?)")
      .run(token, customerId, "tares", version, opts.expiresAt ?? now + 48 * 3600_000, opts.usedAt ?? null, now, Number(activity.lastInsertRowid));
    return token;
  }
  const trace = (token: string) => getDb().prepare(
    "SELECT t.used_at, a.authorized_at FROM download_tokens t LEFT JOIN download_activity a ON a.id=t.activity_id WHERE t.token=?",
  ).get(token) as { used_at: number | null; authorized_at: number | null } | undefined;
  const activityCount = () => (getDb().prepare("SELECT COUNT(*) AS n FROM download_activity").get() as { n: number }).n;
  const post = (token: string, headers: Record<string, string>) =>
    createApp().request(`/api/delivery/${token}`, { method: "POST", headers, body: "" });

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-livraison-"));
    process.env.DATABASE_PATH = join(tmp, "fictive.sqlite");
    const db = getDb();
    customerId = Number(db.prepare("INSERT INTO customers(email,created_at) VALUES('acheteur@example.test',?)").run(now).lastInsertRowid);
    db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,current_version,created_at) VALUES('tares','TARES','tares',29900,'price_fictif','2026.09.28',?)").run(now);
    db.prepare("INSERT INTO versions(dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES('tares','2026.09.28','fictif/tares.zip',?,1000,?)").run("0".repeat(64), now - DAY);
    db.prepare("INSERT INTO versions(dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES('tares','2027.01.10','fictif/tares-futur.zip',?,1000,?)").run("1".repeat(64), now + 400 * DAY);
    const order = db.prepare("INSERT INTO orders(customer_id,stripe_session_id,amount_chf,items_json,status,created_at) VALUES(?,'cs_fictif','29900','[\"tares\"]','paid',?)").run(customerId, now);
    db.prepare("INSERT INTO entitlements(customer_id,dataset_id,order_id,updates_until,created_at) VALUES(?,'tares',?,?,?)").run(customerId, Number(order.lastInsertRowid), now + 360 * DAY, now);
    signedUrlMock.mockReset();
    signedUrlMock.mockResolvedValue(SIGNED);
  });
  afterEach(() => { closeDb(); rmSync(tmp, { recursive: true, force: true }); delete process.env.DATABASE_PATH; });

  it("GET et HEAD : confirmation sans consommer le lien, formulaire inchangé, aucune ressource chargée", async () => {
    const token = issue("G".repeat(43));
    for (const lang of ["", "?lang=fr", "?lang=de", "?lang=en", "?lang=xx"]) {
      const res = await createApp().request(`/api/delivery/${token}${lang}`);
      expect(res.status).toBe(200);
      expect(headerMap(res)).toEqual({ ...PREVIEW, vary: "Accept-Encoding" });
      const html = await res.text();
      expect(formContract(html)).toEqual([{ method: "post", action: `/api/delivery/${token}`, fields: 0 }]);
      expect(html.split(token).length - 1).toBe(1);
      expect(html).not.toMatch(/<script|<link\b|<img\b|<iframe|\bsrc=|url\(|@import/i);
    }
    const head = await createApp().request(`/api/delivery/${token}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(headerMap(head)).toEqual(PREVIEW);
    expect(await head.text()).toBe("");
    expect(trace(token)).toEqual({ used_at: null, authorized_at: null });
  });

  it("lien mal formé : 400 en GET, HEAD et POST", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await createApp().request("/api/delivery/lien-coupe", { method });
      expect(res.status).toBe(400);
      expect(headerMap(res)).toEqual(method === "HEAD" ? { ...COMMON, "cache-control": "no-store" } : WITH_BODY);
    }
    for (const headers of Object.values(CLIENTS)) {
      const res = await post("lien-coupe", headers);
      expect(res.status).toBe(400);
      expect(headerMap(res)).toEqual(WITH_BODY);
      expect(formContract(await res.text())).toEqual([]);
    }
  });

  it("premier clic : 302 vers l'adresse signée, lien consommé et trace d'autorisation posée", async () => {
    for (const [kind, headers] of Object.entries(CLIENTS)) {
      const token = issue((kind === "navigateur" ? "N" : "M").repeat(43));
      const res = await post(token, headers);
      expect(res.status).toBe(302);
      expect(headerMap(res)).toEqual(REDIRECT);
      expect(res.headers.get("content-type")).toBeNull();
      expect(await res.text()).toBe("");
      expect(trace(token)).toMatchObject({ used_at: expect.any(Number), authorized_at: expect.any(Number) });
    }
    expect(signedUrlMock).toHaveBeenCalledWith("fictif/tares.zip", 300);
  });

  it("double clic dans les 90 s : second 302, sans prolonger ni réécrire la première trace", async () => {
    for (const [kind, headers] of Object.entries(CLIENTS)) {
      const token = issue((kind === "navigateur" ? "D" : "E").repeat(43));
      expect((await post(token, headers)).status).toBe(302);
      const first = trace(token);
      const second = await post(token, headers);
      expect(second.status).toBe(302);
      expect(headerMap(second)).toEqual(REDIRECT);
      expect(trace(token)).toEqual(first);
    }
  });

  it("déjà utilisé depuis plus de 90 s : 410, lien et trace inchangés", async () => {
    for (const [kind, headers] of Object.entries(CLIENTS)) {
      const token = issue((kind === "navigateur" ? "U" : "V").repeat(43), { usedAt: now - 91_000 });
      const res = await post(token, headers);
      expect(res.status).toBe(410);
      expect(headerMap(res)).toEqual(WITH_BODY);
      expect(formContract(await res.text())).toEqual([]);
      expect(trace(token)).toEqual({ used_at: now - 91_000, authorized_at: null });
    }
  });

  it("expiré mais pas encore purgé : 410 ; purgé ou inconnu : 404", async () => {
    for (const [kind, headers] of Object.entries(CLIENTS)) {
      const token = issue((kind === "navigateur" ? "X" : "Y").repeat(43), { expiresAt: now - 1000 });
      const expired = await post(token, headers);
      expect(expired.status).toBe(410);
      expect(headerMap(expired)).toEqual(WITH_BODY);
      expect(trace(token)).toEqual({ used_at: null, authorized_at: null });
      const unknown = await post("Z".repeat(43), headers);
      expect(unknown.status).toBe(404);
      expect(headerMap(unknown)).toEqual(WITH_BODY);
    }
    expect(signedUrlMock).not.toHaveBeenCalled();
  });

  it("droit retiré (remboursement complet, contestation) : 403 sans consommer ni autoriser", async () => {
    getDb().prepare("DELETE FROM entitlements").run();
    for (const [kind, headers] of Object.entries(CLIENTS)) {
      const token = issue((kind === "navigateur" ? "R" : "S").repeat(43));
      const res = await post(token, headers);
      expect(res.status).toBe(403);
      expect(headerMap(res)).toEqual(WITH_BODY);
      expect(formContract(await res.text())).toEqual([]);
      expect(trace(token)).toEqual({ used_at: null, authorized_at: null });
    }
  });

  it("droit retiré pendant la signature : 403 sans consommer", async () => {
    const token = issue("W".repeat(43));
    signedUrlMock.mockImplementationOnce(async () => { getDb().prepare("DELETE FROM entitlements").run(); return SIGNED; });
    const res = await post(token, BROWSER);
    expect(res.status).toBe(403);
    expect(headerMap(res)).toEqual(WITH_BODY);
    expect(trace(token)).toEqual({ used_at: null, authorized_at: null });
  });

  it("version hors de la période achetée : 403 ; version absente : 404", async () => {
    for (const [kind, headers] of Object.entries(CLIENTS)) {
      const outside = issue((kind === "navigateur" ? "O" : "P").repeat(43), { version: "2027.01.10" });
      const res = await post(outside, headers);
      expect(res.status).toBe(403);
      expect(headerMap(res)).toEqual(WITH_BODY);
      expect(trace(outside)).toEqual({ used_at: null, authorized_at: null });
      const missing = issue((kind === "navigateur" ? "H" : "I").repeat(43), { version: "2020.01.01" });
      const gone = await post(missing, headers);
      expect(gone.status).toBe(404);
      expect(headerMap(gone)).toEqual(WITH_BODY);
      expect(trace(missing)).toEqual({ used_at: null, authorized_at: null });
    }
  });

  it("stockage indisponible pendant la signature : 500, lien conservé et réutilisable", async () => {
    for (const [kind, headers] of Object.entries(CLIENTS)) {
      const token = issue((kind === "navigateur" ? "K" : "J").repeat(43));
      signedUrlMock.mockRejectedValueOnce(new Error("Stockage fictif indisponible"));
      const res = await post(token, headers);
      expect(res.status).toBe(500);
      expect(headerMap(res)).toEqual(WITH_BODY);
      expect(await res.text()).not.toContain("Stockage fictif indisponible");
      expect(trace(token)).toEqual({ used_at: null, authorized_at: null });
      expect((await post(token, headers)).status).toBe(302);
    }
  });

  it("course : le lien s'épuise pendant la signature, 410 sans nouvelle autorisation", async () => {
    const token = issue("C".repeat(43));
    signedUrlMock.mockImplementationOnce(async () => {
      getDb().prepare("UPDATE download_tokens SET used_at=? WHERE token=?").run(now - 91_000, token);
      return SIGNED;
    });
    const res = await post(token, BROWSER);
    expect(res.status).toBe(410);
    expect(headerMap(res)).toEqual(WITH_BODY);
    expect(trace(token)).toEqual({ used_at: now - 91_000, authorized_at: null });
  });

  it("aucune trace nouvelle ni aucun jeton dans les événements, quel que soit l'état", async () => {
    const tokens = [issue("A".repeat(43)), issue("B".repeat(43), { expiresAt: now - 1 }), issue("Q".repeat(43), { usedAt: now - 91_000 })];
    const before = activityCount();
    for (const token of tokens) {
      await createApp().request(`/api/delivery/${token}?lang=fr`);
      await post(token, BROWSER);
      await post(token, BROWSER);
    }
    await post("T".repeat(43), BROWSER);
    expect(activityCount()).toBe(before);
    const events = JSON.stringify(getDb().prepare("SELECT * FROM events").all());
    for (const token of [...tokens, "T".repeat(43)]) expect(events).not.toContain(token);
  });
});
