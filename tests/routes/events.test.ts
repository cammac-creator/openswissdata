import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("POST /api/events/track", () => {
  let tmp: string;
  let turn = 0;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1790400000000 + (++turn) * 60001);
    tmp = mkdtempSync(join(tmpdir(), "osd-events-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.SESSION_SECRET = "test-session-secret-123456";
  });
  afterEach(async () => {
    await new Promise(r => setImmediate(r));
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.SESSION_SECRET;
  });

  it("rejects empty body", async () => {
    const app = createApp();
    const res = await app.request("/api/events/track", { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid event name", async () => {
    const app = createApp();
    const res = await app.request("/api/events/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "invalid name with spaces!" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts a valid custom event and persists it", async () => {
    const app = createApp();
    const res = await app.request("/api/events/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "cta_pricing_clicked", meta: { variant: "v4" } }),
    });
    expect(res.status).toBe(200);

    // setImmediate flushes the insert — wait one tick.
    await new Promise((r) => setImmediate(r));

    const db = getDb();
    const row = db.prepare("SELECT name, kind, origin, meta_json FROM events WHERE name = ?")
      .get("cta_pricing_clicked") as { name: string; kind: string; origin: string; meta_json: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.kind).toBe("custom");
    expect(row?.origin).toBe("client");
    expect(JSON.parse(row!.meta_json).variant).toBe("v4");
  });

  it("rejects oversized meta", async () => {
    const app = createApp();
    const big = { blob: "x".repeat(3000) };
    const res = await app.request("/api/events/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "huge_meta", meta: big }),
    });
    expect(res.status).toBe(413);
  });
  it.each(['page_view','PAGE_VIEW','mcp_tool_call','checkout_started','payment_paid','delivery_sent','download_authorized','server.commande'])('refuse le nom interne %s sans créer de preuve',async name=>{
    const r=await createApp().request('/api/events/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,kind:'conversion'})});
    expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'reserved_event'});await new Promise(r=>setImmediate(r));expect(getDb().prepare('SELECT COUNT(*) n FROM events').get()).toEqual({n:0});
  });
  it('ne laisse pas une déclaration choisir une origine serveur',async()=>{
    const app=createApp(),post=(body:unknown)=>app.request('/api/events/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    expect((await post({name:'cta_fictive',origin:'server'})).status).toBe(400);
    const r=await post({name:'cta_fictive',meta:{origin:'server',name:'page_view'}});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');await new Promise(r=>setImmediate(r));
    expect(getDb().prepare('SELECT name,origin FROM events').all()).toEqual([{name:'cta_fictive',origin:'client'}]);
  });
  it('borne réellement les métadonnées UTF-8',async()=>{
    const r=await createApp().request('/api/events/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'fictif',meta:{text:'界'.repeat(700)}})});
    expect(r.status).toBe(413);expect(await r.json()).toEqual({error:'meta_too_large'});
  });
  it('borne aussi un corps transmis en morceaux sans Content-Length',async()=>{
    const bytes=new TextEncoder().encode(JSON.stringify({name:'fictif',meta:{text:'x'.repeat(5000)}}));const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes.slice(0,2000));c.enqueue(bytes.slice(2000));c.close()}});
    const req=new Request('https://www.openswissdata.com/api/events/track',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'} as RequestInit);
    const r=await createApp().fetch(req);expect(r.status).toBe(413);expect(r.headers.get('cache-control')).toBe('no-store');await new Promise(r=>setImmediate(r));expect(getDb().prepare('SELECT COUNT(*) n FROM events').get()).toEqual({n:0});
  });
  it('ignore les préfixes X-Forwarded-For forgés pour la limite de l’origine',async()=>{
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID','fictif');const app=createApp();
    for(let i=0;i<61;i++){
      const r=await app.request('/api/events/track',{method:'POST',headers:{'content-type':'application/json','x-real-ip':'192.0.2.9','x-forwarded-for':`198.51.100.${i+1}`},body:JSON.stringify({name:'cta_fictive'})});expect(r.status).toBe(i<60?200:429);
    }
    await new Promise(r=>setImmediate(r));expect(getDb().prepare('SELECT COUNT(*) n FROM events').get()).toEqual({n:60});
  });

});
