import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("POST /api/events/track", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-events-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.SESSION_SECRET = "test-session-secret-123456";
  });
  afterEach(() => {
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
    const row = db.prepare("SELECT name, kind, meta_json FROM events WHERE name = ?")
      .get("cta_pricing_clicked") as { name: string; kind: string; meta_json: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.kind).toBe("custom");
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
});
