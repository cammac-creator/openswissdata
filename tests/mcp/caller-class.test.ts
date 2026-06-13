import { describe, it, expect } from "vitest";
import { mcpCallerClass } from "../../src/mcp/caller-class.js";

describe("mcpCallerClass", () => {
  it("authenticated dominates the UA (empty UA → human_authenticated)", () => {
    expect(mcpCallerClass("", true)).toBe("human_authenticated");
  });

  it("authenticated dominates even a scanner-looking UA", () => {
    expect(mcpCallerClass("python-requests/2.31", true)).toBe("human_authenticated");
  });

  it("recognizes real MCP clients on anonymous calls", () => {
    expect(mcpCallerClass("claude-desktop/1.0", false)).toBe("mcp_client");
    expect(mcpCallerClass("Mozilla/5.0 (Cursor)", false)).toBe("mcp_client");
    expect(mcpCallerClass("cline/3.2", false)).toBe("mcp_client");
    expect(mcpCallerClass("mcp-remote/0.1", false)).toBe("mcp_client");
  });

  it("classifies declared crawlers as bot — even when the name contains a client keyword", () => {
    expect(mcpCallerClass("Googlebot/2.1", false)).toBe("bot");
    expect(mcpCallerClass("SomeCrawler spider", false)).toBe("bot");
    // ClaudeBot is a crawler, not a real MCP client → must NOT be mcp_client.
    expect(mcpCallerClass("ClaudeBot/1.0 (+https://anthropic.com/claudebot)", false)).toBe("bot");
  });

  it("does not let a scanner spoof its way to mcp_client by appending a keyword", () => {
    // python-requests pretending to be claude → still scanner (tested before mcp_client).
    expect(mcpCallerClass("python-requests/2.31 claude", false)).toBe("scanner");
  });

  it("classifies generic tooling as scanner", () => {
    expect(mcpCallerClass("curl/8.4.0", false)).toBe("scanner");
    expect(mcpCallerClass("python-requests/2.31", false)).toBe("scanner");
    expect(mcpCallerClass("Go-http-client/2.0", false)).toBe("scanner");
    expect(mcpCallerClass("nuclei", false)).toBe("scanner");
  });

  it("classifies empty/unknown anonymous UA as unknown (excluded from human count)", () => {
    expect(mcpCallerClass("", false)).toBe("unknown");
    expect(mcpCallerClass("totally-unrecognized/1.0", false)).toBe("unknown");
  });
});
