import { describe, it, expect } from "vitest";
import { createApp } from "../../src/index.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("static frontend serving", () => {
  it("serves /datasets/tares/index.html when present", async () => {
    // Create the specific stub file the test needs. If web/dist exists already
    // (e.g. a real Astro build is checked out) we still ensure the test
    // fixture is present at the expected path — otherwise the test can fail
    // for orthogonal reasons (Astro's build skipped that page, or the build
    // was partial).
    const webDist = "./web/dist";
    const stubPath = join(webDist, "datasets/tares/index.html");
    const stubAlreadyExists = existsSync(stubPath);
    if (!stubAlreadyExists) {
      mkdirSync(join(webDist, "datasets/tares"), { recursive: true });
      writeFileSync(stubPath, "<html><body>TARES page</body></html>");
    }
    try {
      const app = createApp();
      const res = await app.request("/datasets/tares");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("<html");
    } finally {
      // Only clean up if we created the stub ourselves.
      if (!stubAlreadyExists) {
        rmSync(stubPath, { force: true });
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
