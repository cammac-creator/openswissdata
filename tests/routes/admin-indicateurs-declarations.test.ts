import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Clics « être prévenu » de la vitrine Mouvements FINMA (21.10.2026) : déclarations de visiteurs à nom
// FIXÉ d'avance, comptées à part ; aucun autre nom déclaré, ni robot, n'atteint la sortie.
const SECRET = "test-secret-1234567890";

describe("GET /api/admin/indicateurs — déclarations de visiteurs", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-indicateurs-decl-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.ADMIN_SECRET = SECRET;
  });
  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.ADMIN_SECRET;
  });

  it("compte etre_prevenu des navigateurs, et rien d'autre", async () => {
    const app = createApp();
    const ev = getDb().prepare(
      "INSERT INTO events (kind, name, status, visitor_hash, ua_class, meta_json, origin, ts) VALUES ('custom', ?, 200, ?, ?, NULL, ?, ?)",
    );
    const t = Date.now() - 60_000;
    ev.run("etre_prevenu", "v2:aaaa", "desktop", "client", t);
    ev.run("etre_prevenu", "v2:aaaa", "desktop", "client", t); // même visiteur-jour
    ev.run("etre_prevenu", "v2:bbbb", "mobile", "client", t);
    ev.run("etre_prevenu", "v2:cccc", "bot", "client", t); // robot : écarté
    ev.run("autre_nom_declare", "v2:dddd", "desktop", "client", t); // nom libre : écarté
    const d = await (await app.request("/api/admin/indicateurs", { headers: { "x-admin-secret": SECRET } })).json() as Record<string, any>;
    expect(d.declarations_visiteurs).toEqual([{ nom: "etre_prevenu", nombre: 3, visiteurs_jours: 2 }]);
    expect(JSON.stringify(d)).not.toContain("autre_nom_declare");
    expect(JSON.stringify(d)).not.toContain("v2:");
  });
});
