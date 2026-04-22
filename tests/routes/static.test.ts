import { describe, it, expect } from "vitest";
import { createApp } from "../../src/index.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("static frontend serving", () => {
  it("serves /datasets/tares/index.html when present", async () => {
    // Create a minimal web/dist just for this test if absent
    const webDist = "./web/dist";
    const tempCreated = !existsSync(webDist);
    if (tempCreated) {
      mkdirSync(join(webDist, "datasets/tares"), { recursive: true });
      writeFileSync(
        join(webDist, "datasets/tares/index.html"),
        "<html><body>TARES page</body></html>",
      );
    }
    try {
      const app = createApp();
      const res = await app.request("/datasets/tares");
      // Either the test created a stub, or a real web:build ran — either way, HTML must come back.
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("<html");
    } finally {
      if (tempCreated) {
        rmSync(webDist, { recursive: true, force: true });
      }
    }
  });

  it("/api/* routes still take precedence over static", async () => {
    const app = createApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
