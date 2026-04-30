import { describe, expect, it } from "vitest";
import { Client } from "../src/index.js";
import {
  AuthError,
  NetworkError,
  RateLimitError,
  ServerError,
  ToolError,
} from "../src/errors.js";
import { makeMock, rpcError, rpcOk, rpcToolError } from "./_mock.js";

describe("Client", () => {
  it("attaches Authorization header when apiKey is set", async () => {
    const { fetch, calls } = makeMock(() => ({ body: rpcOk(1, { ok: true }) }));
    const client = new Client({ apiKey: "test-key", fetch, maxRetries: 0 });
    await client.callTool("tariff_lookup", { hs8: "00000000" });
    expect(calls).toHaveLength(1);
    const auth = (calls[0]!.init!.headers as Headers).get("authorization");
    expect(auth).toBe("Bearer test-key");
  });

  it("does not send Authorization header when anonymous", async () => {
    const { fetch, calls } = makeMock(() => ({ body: rpcOk(1, { ok: true }) }));
    const client = new Client({ fetch, maxRetries: 0 });
    await client.callTool("tariff_lookup", { hs8: "00000000" });
    expect((calls[0]!.init!.headers as Headers).get("authorization")).toBeNull();
  });

  it("uses the custom baseUrl with trailing slash trimmed", async () => {
    const { fetch, calls } = makeMock(() => ({ body: rpcOk(1, {}) }));
    const client = new Client({ baseUrl: "https://staging.example.com/", fetch, maxRetries: 0 });
    await client.callTool("noop", {});
    expect(calls[0]!.url).toBe("https://staging.example.com/jsonrpc");
  });

  it("throws AuthError on 401", async () => {
    const { fetch } = makeMock(() => ({ status: 401, body: { error: "missing token" } }));
    const client = new Client({ fetch, maxRetries: 0 });
    await expect(client.callTool("x", {})).rejects.toBeInstanceOf(AuthError);
  });

  it("throws RateLimitError on 429 and exposes header echo", async () => {
    const { fetch } = makeMock(() => ({
      status: 429,
      body: { error: "too many" },
      headers: {
        "x-ratelimit-limit": "100",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1714512000",
        "retry-after": "60",
      },
    }));
    const client = new Client({ fetch, maxRetries: 0 });
    try {
      await client.callTool("x", {});
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      const r = e as RateLimitError;
      expect(r.retryAfterSeconds).toBe(60);
      expect(r.limit).toBe(100);
      expect(r.remaining).toBe(0);
    }
  });

  it("retries on 503 then succeeds", async () => {
    let n = 0;
    const { fetch, calls } = makeMock(() => {
      n++;
      if (n < 3) return { status: 503, body: { error: "down" } };
      return { body: rpcOk(1, { ok: true }) };
    });
    const client = new Client({ fetch, maxRetries: 3, retryBackoffMs: 1 });
    const r = await client.callTool<{ ok: boolean }>("x", {});
    expect(r.ok).toBe(true);
    expect(calls.length).toBe(3);
  });

  it("gives up after maxRetries on 500", async () => {
    const { fetch, calls } = makeMock(() => ({ status: 500, body: { error: "boom" } }));
    const client = new Client({ fetch, maxRetries: 2, retryBackoffMs: 1 });
    await expect(client.callTool("x", {})).rejects.toBeInstanceOf(ServerError);
    expect(calls.length).toBe(3); // 1 initial + 2 retries
  });

  it("wraps fetch network errors as NetworkError", async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError("ECONNREFUSED");
    };
    const client = new Client({ fetch: failing, maxRetries: 1, retryBackoffMs: 1 });
    await expect(client.callTool("x", {})).rejects.toBeInstanceOf(NetworkError);
  });

  it("propagates JSON-RPC protocol errors as OpenSwissDataError", async () => {
    const { fetch } = makeMock(() => ({ body: rpcError(1, -32601, "unknown method") }));
    const client = new Client({ fetch, maxRetries: 0 });
    await expect(client.rpc("foo")).rejects.toThrowError(/unknown method/);
  });

  it("surfaces tool errors as ToolError", async () => {
    const { fetch } = makeMock(() => ({ body: rpcToolError(1, "No TARES row found for HS8 00000000") }));
    const client = new Client({ fetch, maxRetries: 0 });
    try {
      await client.callTool("tariff_lookup", { hs8: "00000000" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      expect((e as ToolError).tool).toBe("tariff_lookup");
      expect((e as ToolError).message).toMatch(/No TARES row/);
    }
  });

  it("captures rate-limit headers in lastRateLimit", async () => {
    const { fetch } = makeMock(() => ({
      body: rpcOk(1, { ok: true }),
      headers: {
        "x-ratelimit-limit": "100",
        "x-ratelimit-remaining": "73",
        "x-ratelimit-reset": "1714512000",
      },
    }));
    const client = new Client({ fetch, maxRetries: 0 });
    await client.callTool("x", {});
    expect(client.lastRateLimit.limit).toBe(100);
    expect(client.lastRateLimit.remaining).toBe(73);
    expect(client.lastRateLimit.reset).toBe(1714512000);
  });

  it("calls /discovery on the discovery() method", async () => {
    const { fetch, calls } = makeMock(() => ({
      body: {
        protocol_version: "2025-06-18",
        server_info: { name: "openswissdata-mcp", version: "0.2.0" },
        capabilities: { tools: { list_changed: false } },
        tools: ["tariff_lookup", "kyc_check"],
      },
    }));
    const client = new Client({ fetch, maxRetries: 0 });
    const info = await client.discovery();
    expect(info.protocol_version).toBe("2025-06-18");
    expect(calls[0]!.url).toMatch(/\/discovery$/);
    expect(calls[0]!.init?.method).toBe("GET");
  });
});
