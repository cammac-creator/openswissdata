import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../../src/index.js";
import { _resetRateLimit } from "../../src/mcp/rate-limit.js";

describe("MCP HTTP routes", () => {
  beforeEach(() => {
    _resetRateLimit();
    delete process.env.MCP_BEARER_TOKEN;
  });
  afterEach(() => {
    _resetRateLimit();
    delete process.env.MCP_BEARER_TOKEN;
  });

  it("GET /mcp/health returns 200 without auth", async () => {
    const app = createApp();
    const res = await app.request("/mcp/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("GET /mcp returns server info when auth is disabled (dev)", async () => {
    const app = createApp();
    const res = await app.request("/mcp");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      protocol_version: string;
      tools: string[];
      server_info: { name: string };
    };
    expect(body.protocol_version).toBe("2025-06-18");
    expect(body.server_info.name).toBe("openswissdata-mcp");
    expect(body.tools).toEqual(
      expect.arrayContaining(["tariff_lookup", "kyc_check", "cross_walk"]),
    );
  });

  it("GET /mcp returns 401 when MCP_BEARER_TOKEN is set and no auth header", async () => {
    process.env.MCP_BEARER_TOKEN = "test-secret";
    const app = createApp();
    const res = await app.request("/mcp");
    expect(res.status).toBe(401);
  });

  it("GET /mcp returns 200 with valid Bearer token", async () => {
    process.env.MCP_BEARER_TOKEN = "test-secret";
    const app = createApp();
    const res = await app.request("/mcp", {
      headers: { authorization: "Bearer test-secret" },
    });
    expect(res.status).toBe(200);
  });

  it("POST /mcp/jsonrpc — initialize returns protocol version", async () => {
    const app = createApp();
    const res = await app.request("/mcp/jsonrpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { protocolVersion: string };
    };
    expect(body.result.protocolVersion).toBe("2025-06-18");
  });

  it("POST /mcp/jsonrpc — tools/list returns the 3 MVP tools", async () => {
    const app = createApp();
    const res = await app.request("/mcp/jsonrpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const body = (await res.json()) as {
      result: { tools: { name: string }[] };
    };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["tariff_lookup", "kyc_check", "cross_walk"]),
    );
  });

  it("POST /mcp/jsonrpc — tools/call dispatches to cross_walk", async () => {
    const app = createApp();
    const res = await app.request("/mcp/jsonrpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "cross_walk",
          arguments: { code: "01", source: "NOGA_2025", target: "NACE_2.1" },
        },
      }),
    });
    const body = (await res.json()) as {
      result: { content: { text: string }[]; structured: { count: number } };
    };
    expect(body.result.content[0].text).toContain("NOGA_2025:01");
  });

  it("POST /mcp/jsonrpc — unknown tool returns JSON-RPC error", async () => {
    const app = createApp();
    const res = await app.request("/mcp/jsonrpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "does_not_exist" },
      }),
    });
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32601);
  });

  it("POST /mcp/jsonrpc — bad JSON returns parse error", async () => {
    const app = createApp();
    const res = await app.request("/mcp/jsonrpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("POST /mcp/jsonrpc — supports JSON-RPC batches", async () => {
    const app = createApp();
    const res = await app.request("/mcp/jsonrpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: "a", method: "ping" },
        { jsonrpc: "2.0", id: "b", method: "tools/list" },
      ]),
    });
    const body = (await res.json()) as { id: string }[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });
});
