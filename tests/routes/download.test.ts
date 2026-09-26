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
    expect(body.share_url).toContain("/api/delivery/");
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

  it("conserve le lien si la signature du fichier échoue", async () => {
    const app=createApp();
    const issue=await app.request('/api/account/download-request',{method:'POST',headers:{'content-type':'application/json',cookie:`osd_session=${token}`},body:JSON.stringify({dataset_id:'tares'})});
    const {share_token}=await issue.json();
    signedUrlMock.mockRejectedValueOnce(new Error('Stockage indisponible'));
    expect((await app.request(`/api/download/${share_token}`)).status).toBe(500);
    expect(getDb().prepare('SELECT used_at FROM download_tokens WHERE token=?').get(share_token)).toEqual({used_at:null});
    expect((await app.request(`/api/download/${share_token}`)).status).toBe(302);
  });

  it("refuse un droit retiré pendant la signature et ne consomme pas le lien", async () => {
    const app=createApp();
    const issue=await app.request('/api/account/download-request',{method:'POST',headers:{'content-type':'application/json',cookie:`osd_session=${token}`},body:JSON.stringify({dataset_id:'tares'})});
    const {share_token}=await issue.json();
    signedUrlMock.mockImplementationOnce(async()=>{getDb().prepare('DELETE FROM entitlements').run();return 'https://signed.example.test';});
    expect((await app.request(`/api/download/${share_token}`)).status).toBe(403);
    expect(getDb().prepare('SELECT used_at FROM download_tokens WHERE token=?').get(share_token)).toEqual({used_at:null});
  });

  it("ne permet qu'une utilisation même en concurrence",async()=>{
    const app=createApp();
    const issue=await app.request('/api/account/download-request',{method:'POST',headers:{'content-type':'application/json',cookie:`osd_session=${token}`},body:JSON.stringify({dataset_id:'tares'})});
    const {share_token}=await issue.json();
    const responses=await Promise.all([app.request(`/api/download/${share_token}`),app.request(`/api/download/${share_token}`)]);
    expect(responses.map(r=>r.status).sort()).toEqual([302,410]);
  });

  it("la prévisualisation d'un mail ne consomme pas le lien, puis le bouton le télécharge",async()=>{
    const app=createApp();
    const issue=await app.request('/api/account/download-request',{method:'POST',headers:{'content-type':'application/json',cookie:`osd_session=${token}`},body:JSON.stringify({dataset_id:'tares'})});
    const {share_token}=await issue.json();
    const preview=await app.request(`/api/delivery/${share_token}?lang=de`);
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('Datei herunterladen');
    expect(preview.headers.get('referrer-policy')).toBe('no-referrer');
    expect(preview.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; base-uri 'none'");
    await app.request(`/api/delivery/${share_token}/`);
    expect(JSON.stringify(getDb().prepare("SELECT name FROM events WHERE kind='api_request'").all())).not.toContain(share_token);
    expect(getDb().prepare('SELECT used_at FROM download_tokens WHERE token=?').get(share_token)).toEqual({used_at:null});
    expect((await app.request(`/api/delivery/${share_token}`,{method:'POST'})).status).toBe(302);
    const first=getDb().prepare('SELECT used_at FROM download_tokens WHERE token=?').get(share_token);
    expect((await app.request(`/api/delivery/${share_token}`,{method:'POST'})).status).toBe(302);
    expect(getDb().prepare('SELECT used_at FROM download_tokens WHERE token=?').get(share_token)).toEqual(first);
    getDb().prepare('UPDATE download_tokens SET used_at=? WHERE token=?').run(Date.now()-91_000,share_token);
    expect((await app.request(`/api/delivery/${share_token}`,{method:'POST'})).status).toBe(410);
  });

  it("conserve la dernière version acquise après la fin des mises à jour, sans donner les suivantes", async () => {
    const db=getDb(); const end=Date.now()-1000;
    db.prepare("UPDATE entitlements SET updates_until=?").run(end);
    db.prepare("UPDATE versions SET released_at=? WHERE version='2026.04.22'").run(end-1000);
    db.prepare("INSERT INTO versions(dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES('tares','2026.05.01','tares/future.zip',?,100,?)").run('a'.repeat(64),end+1000);
    db.prepare("UPDATE datasets SET current_version='2026.05.01'").run();
    const app=createApp(); const headers={"content-type":"application/json",cookie:`osd_session=${token}`};
    const res=await app.request("/api/account/download-request",{method:"POST",headers,body:JSON.stringify({dataset_id:"tares"})});
    expect(res.status).toBe(200); expect(signedUrlMock).toHaveBeenLastCalledWith("tares/2026.04.22.zip",300);
    const body=await res.json(); expect((await app.request(`/api/download/${body.share_token}`)).status).toBe(302);
    const account=await (await app.request('/api/account/datasets',{headers})).json(); expect(account.datasets[0].current_version).toBe('2026.04.22');
    db.prepare("INSERT INTO download_tokens(token,customer_id,dataset_id,version,expires_at,created_at) VALUES(?,?,'tares','2026.05.01',?,?)").run('F'.repeat(43),custId,Date.now()+10000,Date.now());
    expect((await app.request('/api/download/'+ 'F'.repeat(43))).status).toBe(403);
    db.prepare("DELETE FROM entitlements WHERE customer_id=?").run(custId);
    expect((await app.request('/api/account/download-request',{method:'POST',headers,body:JSON.stringify({dataset_id:'tares'})})).status).toBe(403);
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
  it("sépare lien fourni, prévisualisation et autorisation, sans prolonger la première trace", async () => {
    const app=createApp(),db=getDb();
    const result=await app.request('/api/account/download-request',{method:'POST',headers:{'content-type':'application/json',cookie:`osd_session=${token}`},body:JSON.stringify({dataset_id:'tares'})});
    const {share_token}=await result.json();
    const activity=()=>db.prepare('SELECT source,order_id,authorized_at FROM download_activity').get();
    expect(activity()).toEqual({source:'account',order_id:null,authorized_at:null});
    await app.request('/api/delivery/'+share_token);
    expect(activity()).toEqual({source:'account',order_id:null,authorized_at:null});
    expect((await app.request('/api/delivery/'+share_token,{method:'POST'})).status).toBe(302);
    const first=activity();expect(first).toMatchObject({authorized_at:expect.any(Number)});
    await app.request('/api/delivery/'+share_token,{method:'POST'});
    expect(activity()).toEqual(first);
    db.prepare('DELETE FROM download_tokens').run();
    expect(activity()).toEqual(first);
  });

  it("ne produit aucune autorisation de téléchargement quand les droits sont retirés", async () => {
    const app=createApp(),db=getDb();
    const result=await app.request('/api/account/download-request',{method:'POST',headers:{'content-type':'application/json',cookie:`osd_session=${token}`},body:JSON.stringify({dataset_id:'tares'})});
    const {share_token}=await result.json();
    db.prepare('DELETE FROM entitlements').run();
    expect((await app.request('/api/delivery/'+share_token,{method:'POST'})).status).toBe(403);
    expect(db.prepare('SELECT authorized_at FROM download_activity').get()).toEqual({authorized_at:null});
  });

  it("revérifie les droits après la signature distante avant création ou consommation",async()=>{
    const app=createApp(),db=getDb();
    const result=await app.request('/api/account/download-request',{method:'POST',headers:{'content-type':'application/json',cookie:`osd_session=${token}`},body:JSON.stringify({dataset_id:'tares'})});
    const {share_token}=await result.json();
    signedUrlMock.mockImplementationOnce(async()=>{db.prepare('DELETE FROM entitlements').run();return 'https://signed.example.test/secret'});
    expect((await app.request('/api/delivery/'+share_token,{method:'POST'})).status).toBe(403);
    expect(db.prepare('SELECT authorized_at FROM download_activity').get()).toEqual({authorized_at:null});
    expect(db.prepare('SELECT used_at FROM download_tokens').get()).toEqual({used_at:null});
  });

});
