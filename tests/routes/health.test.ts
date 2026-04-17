import { describe, it, expect } from "vitest";
import { createApp } from "../../src/index.js";

describe("GET /api/health", () => {
  it("returns 200 with {status:'ok'} and app version", async () => {
    const app = createApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
  });
});
