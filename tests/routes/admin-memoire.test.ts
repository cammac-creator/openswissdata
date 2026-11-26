import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { memoryReport, parseMemoryStat, readCgroupMemory } from "../../src/lib/memory-report.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Relevé de mémoire (26.11.2026) : des nombres seulement, derrière le secret d'administration.
const SECRET = "test-secret-1234567890";

describe("GET /api/admin/memoire", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-memoire-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.ADMIN_SECRET = SECRET;
    getDb();
  });
  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.ADMIN_SECRET;
  });

  it("refuse sans le secret d'administration, ou avec un faux", async () => {
    const app = createApp();
    expect((await app.request("/api/admin/memoire")).status).toBe(401);
    expect((await app.request("/api/admin/memoire", { headers: { "x-admin-secret": "test-secret-123456789X" } })).status).toBe(401);
  });

  it("rend des nombres, jamais un chemin ni une variable d'environnement", async () => {
    const res = await createApp().request("/api/admin/memoire", { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.process.rss_bytes).toBeGreaterThan(0);
    expect(body.process.heap_used_bytes).toBeGreaterThan(0);
    expect(body.database.file_bytes).toBeGreaterThan(0);
    expect(body.search_model_running).toBe(false);
    expect(body.file_cache_release).toBeNull();
    expect(body.tables).toBeUndefined();
    expect(text).not.toContain(tmp);
    expect(text).not.toContain(SECRET);
    expect(text).not.toMatch(/sqlite|\/sys\/|\/tmp|\/var\//);
  });

  it("?tables=1 : tailles par table du schéma, noms de tables seulement", async () => {
    const res = await createApp().request("/api/admin/memoire?tables=1", { headers: { "x-admin-secret": SECRET } });
    const text = await res.text();
    const body = JSON.parse(text) as { tables: Array<{ name: string; bytes: number }> | null };
    expect(res.status).toBe(200);
    // Le better-sqlite3 livré contient dbstat : son absence serait une régression de ce relevé.
    expect(body.tables).not.toBeNull();
    expect(body.tables!.length).toBeGreaterThan(0);
    expect(body.tables!.length).toBeLessThanOrEqual(12);
    for (const table of body.tables!) {
      expect(table.name).toMatch(/^[A-Za-z0-9_]+$/);
      expect(table.bytes).toBeGreaterThan(0);
    }
    expect(text).not.toContain(tmp);
    expect(text).not.toContain(SECRET);
    expect(text).not.toMatch(/\/sys\/|\/tmp|\/var\//);
  });
});

describe("memoryReport : compteurs du conteneur", () => {
  it("ne garde de memory.stat que les clés connues et les entiers", () => {
    expect(parseMemoryStat("anon 1048576\nfile 2097152\nfile_mapped 4096\npgfault 99\nslab abc\n")).toEqual({ anon: 1048576, file: 2097152, file_mapped: 4096 });
  });

  it("lit un dossier cgroup v2 ; « max » sans plafond donne null", () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-cgroup-"));
    try {
      writeFileSync(join(dir, "memory.current"), "734003200\n");
      writeFileSync(join(dir, "memory.max"), "max\n");
      writeFileSync(join(dir, "memory.stat"), "anon 314572800\nfile 419430400\n");
      expect(readCgroupMemory(dir)).toEqual({ current_bytes: 734003200, max_bytes: null, stat: { anon: 314572800, file: 419430400 } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sans cgroup lisible (poste de développement) : null et objet vide, jamais une erreur", () => {
    const report = memoryReport({ databasePath: ":memory:", searchModelRunning: true, cgroupDir: "/dossier/absent" });
    expect(report.cgroup).toEqual({ current_bytes: null, max_bytes: null, stat: {} });
    expect(report.database).toEqual({ file_bytes: null, wal_bytes: null });
    expect(report.search_model_running).toBe(true);
  });
});
