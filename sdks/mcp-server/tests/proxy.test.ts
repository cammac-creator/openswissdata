import { describe, expect, it } from "vitest";
import { RemoteProxy } from "../src/proxy.js";

interface MockCall {
  url: string;
  init: RequestInit | undefined;
}

function makeFetch(handler: (call: MockCall) => { status?: number; body: unknown }) {
  const calls: MockCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const r = handler({ url, init });
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

describe("RemoteProxy", () => {
  it("calls /discovery on discovery()", async () => {
    const { fetch, calls } = makeFetch(() => ({
      body: {
        protocol_version: "2025-06-18",
        server_info: { name: "openswissdata-mcp", version: "0.2.0" },
        capabilities: { tools: { list_changed: false } },
        tools: ["tariff_lookup", "kyc_check"],
      },
    }));
    const proxy = new RemoteProxy({ fetch });
    const info = await proxy.discovery();
    expect(info.tools).toContain("tariff_lookup");
    expect(calls[0]!.url).toMatch(/\/discovery$/);
  });

  it("forwards tools/list as JSON-RPC", async () => {
    const { fetch, calls } = makeFetch(() => ({
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: {
          tools: [
            {
              name: "tariff_lookup",
              description: "Lookup HS8",
              inputSchema: { type: "object", properties: { hs8: { type: "string" } } },
            },
          ],
        },
      },
    }));
    const proxy = new RemoteProxy({ fetch });
    const r = await proxy.listTools();
    expect(r.tools).toHaveLength(1);
    expect(r.tools[0]!.name).toBe("tariff_lookup");
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.method).toBe("tools/list");
  });

  it("forwards tools/call and unwraps result", async () => {
    const { fetch, calls } = makeFetch(() => ({
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: "AVIS NON-OFFICIEL ..." }],
          structured: { hs8: "84620010", designation: "Machines" },
        },
      },
    }));
    const proxy = new RemoteProxy({ fetch });
    const r = await proxy.callTool("tariff_lookup", { hs8: "84620010" });
    expect(r.content[0]!.text).toMatch(/AVIS NON-OFFICIEL/);
    expect((r.structured as { hs8: string }).hs8).toBe("84620010");

    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("tariff_lookup");
    expect(body.params.arguments).toEqual({ hs8: "84620010" });
  });

  it("attaches Authorization header when apiKey is set", async () => {
    const { fetch, calls } = makeFetch(() => ({
      body: { jsonrpc: "2.0", id: 1, result: { tools: [] } },
    }));
    const proxy = new RemoteProxy({ fetch, apiKey: "sk_live_xyz" });
    await proxy.listTools();
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk_live_xyz");
  });

  it("throws on JSON-RPC error envelope", async () => {
    const { fetch } = makeFetch(() => ({
      body: { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Unknown tool" } },
    }));
    const proxy = new RemoteProxy({ fetch });
    await expect(proxy.callTool("nope", {})).rejects.toThrow(/Unknown tool/);
  });

  it("throws on non-2xx HTTP", async () => {
    const { fetch } = makeFetch(() => ({ status: 503, body: { error: "down" } }));
    const proxy = new RemoteProxy({ fetch });
    await expect(proxy.discovery()).rejects.toThrow(/HTTP 503/);
  });

  it("trims trailing slash from baseUrl", async () => {
    const { fetch, calls } = makeFetch(() => ({
      body: { jsonrpc: "2.0", id: 1, result: { tools: [] } },
    }));
    const proxy = new RemoteProxy({ fetch, baseUrl: "https://staging.example.com/" });
    await proxy.listTools();
    expect(calls[0]!.url).toBe("https://staging.example.com/jsonrpc");
  });
});
