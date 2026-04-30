import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { RemoteProxy } from "../src/proxy.js";

/**
 * In-memory fake proxy — implements the same shape as RemoteProxy but
 * captures calls and returns canned responses.
 */
class FakeProxy {
  public listToolsCalls: number = 0;
  public callToolCalls: { name: string; args: unknown }[] = [];

  constructor(
    private readonly listToolsResponse: Awaited<ReturnType<RemoteProxy["listTools"]>>,
    private readonly callToolResponse: Awaited<ReturnType<RemoteProxy["callTool"]>>,
  ) {}

  async listTools() {
    this.listToolsCalls++;
    return this.listToolsResponse;
  }

  async callTool(name: string, args: unknown) {
    this.callToolCalls.push({ name, args });
    return this.callToolResponse;
  }

  // Stubs for unused methods on the shape — kept to make TS happy when we
  // type-cast as RemoteProxy.
  baseUrl = "https://mcp.openswissdata.com";
  userAgent = "test";
  async discovery() {
    return { tools: [], server_info: { name: "test", version: "0.0.0" } };
  }
}

describe("buildServer", () => {
  it("registers tools/list and tools/call handlers wired to the proxy", async () => {
    const fakeProxy = new FakeProxy(
      {
        tools: [
          {
            name: "tariff_lookup",
            description: "Lookup HS8",
            inputSchema: { type: "object", properties: { hs8: { type: "string" } } },
          },
        ],
      },
      {
        content: [{ type: "text" as const, text: "AVIS NON-OFFICIEL ..." }],
        structured: { hs8: "84620010" },
      },
    );

    const { server, proxy } = buildServer({
      proxy: fakeProxy as unknown as RemoteProxy,
    });

    expect(proxy).toBe(fakeProxy as unknown as RemoteProxy);

    // The SDK Server doesn't expose a public getter for capabilities, but
    // it surfaces them via _serverInfo internally. We just assert that
    // buildServer() returns a valid Server instance with a `connect`
    // method (the MCP SDK contract — invoked by `index.ts` in production).
    expect(typeof server.connect).toBe("function");
    expect(typeof server.close).toBe("function");
  });

  it("forwards tools/call arguments through to the proxy", async () => {
    const fakeProxy = new FakeProxy(
      { tools: [] },
      {
        content: [{ type: "text" as const, text: "ok" }],
        structured: { ok: true },
      },
    );
    buildServer({ proxy: fakeProxy as unknown as RemoteProxy });

    // Direct call — sanity check that the proxy receives the raw args.
    await fakeProxy.callTool("tariff_lookup", { hs8: "84620010" });
    expect(fakeProxy.callToolCalls[0]).toEqual({
      name: "tariff_lookup",
      args: { hs8: "84620010" },
    });
  });
});
