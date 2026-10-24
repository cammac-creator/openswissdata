// Migration zod 4 (24.10.2026) : `meta` passe de `z.record(z.unknown())` (zod 3, clé textuelle implicite)
// à `z.record(z.string(), z.unknown())`. Ce test fige le comportement d'avant, comparé cas par cas
// avec zod/v3 : objet accepté et stocké tel quel, meta absente acceptée, tableau, texte, null et
// nombre refusés, clé `__proto__` écartée.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";

const track = (body: string) => createApp().request("/api/events/track", {
  method: "POST", headers: { "content-type": "application/json" }, body,
});
const stored = (name: string) => (getDb().prepare("SELECT meta_json FROM events WHERE name = ?").get(name) as
  { meta_json: string | null } | undefined)?.meta_json;

describe("POST /api/events/track : métadonnées libres sous zod 4", () => {
  let tmp: string;
  let turn = 0;
  beforeEach(() => {
    // Une fenêtre de limite de fréquence neuve à chaque cas.
    vi.spyOn(Date, "now").mockReturnValue(1790500000000 + (++turn) * 60001);
    tmp = mkdtempSync(join(tmpdir(), "osd-events-meta-"));
    vi.stubEnv("DATABASE_PATH", join(tmp, "t.sqlite"));
    vi.stubEnv("SESSION_SECRET", "test-session-secret-123456");
  });
  afterEach(async () => {
    await new Promise(r => setImmediate(r));
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("accepte un objet imbriqué et le stocke à l'identique", async () => {
    const meta = { variant: "v4", depth: { list: [1, "deux", null], ok: true } };
    const res = await track(JSON.stringify({ name: "meta_objet_fictif", meta }));
    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));
    expect(JSON.parse(stored("meta_objet_fictif")!)).toEqual(meta);
  });

  it("accepte l'absence de meta", async () => {
    const res = await track(JSON.stringify({ name: "meta_absent_fictif" }));
    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));
    expect(stored("meta_absent_fictif")).toBeNull();
  });

  it.each([["un tableau", "[1,2]"], ["un texte", "\"texte\""], ["null", "null"], ["un nombre", "3"]])(
    "refuse %s en meta par invalid_body", async (_label, meta) => {
      const res = await track(`{"name":"meta_refus_fictif","meta":${meta}}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_body" });
    });

  it("écarte une clé __proto__ sans toucher au reste", async () => {
    const res = await track('{"name":"meta_proto_fictif","meta":{"__proto__":{"pollue":true},"k":1}}');
    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));
    expect(JSON.parse(stored("meta_proto_fictif")!)).toEqual({ k: 1 });
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
  });
});
