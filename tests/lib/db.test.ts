import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("lib/db", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "osd-db-"));
    dbPath = join(tmpDir, "test.sqlite");
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates database and returns connection with WAL mode", () => {
    const db = getDb(dbPath);
    const mode = db.pragma("journal_mode", { simple: true });
    expect(mode).toBe("wal");
  });

  it("runs schema.sql on first open — all 7 tables exist", () => {
    getDb(dbPath);
    const db = getDb(dbPath);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("datasets");
    expect(names).toContain("customers");
    expect(names).toContain("orders");
    expect(names).toContain("entitlements");
    expect(names).toContain("sessions");
    expect(names).toContain("versions");
    expect(names).toContain("download_tokens");
  });

  it("enforces foreign keys", () => {
    const db = getDb(dbPath);
    const result = db.pragma("foreign_keys", { simple: true });
    expect(result).toBe(1);
  });
});
