/**
 * Integration: MCP tool calls write an events row (kind=custom,
 * name=mcp_tool_call) with the correct caller class, while discovery
 * (initialize/tools/list) writes nothing. Fire-and-forget via setImmediate.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { _resetRateLimit } from "../../src/mcp/rate-limit.js";
import { generateClientId, generateClientSecret, hashToken } from "../../src/mcp/oauth/crypto.js";
import { insertClient, insertToken } from "../../src/mcp/oauth/store.js";
import { TIER_DEFAULT_SCOPES, serializeScopes } from "../../src/mcp/oauth/scopes.js";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// trackMcpToolCall defers via setImmediate, then track() defers the INSERT via
// a nested setImmediate — drain several ticks to be safe.
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

function provisionProClient(): string {
  const clientId = generateClientId();
  const clientSecret = generateClientSecret();
  insertClient({
    client_id: clientId,
    client_secret_hash: hashToken(clientSecret),
    name: "track-test",
    email: "track@test.openswissdata.com",
    tier: "pro",
    scopes: TIER_DEFAULT_SCOPES.pro,
  });
  const accessToken = randomBytes(32).toString("base64url");
  insertToken({
    client_id: clientId,
    access_token_plain: accessToken,
    refresh_token_plain: null,
    scope: serializeScopes(TIER_DEFAULT_SCOPES.pro),
  });
  return accessToken;
}

async function jsonrpc(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request("/mcp/jsonrpc", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function mcpRows() {
  return getDb()
    .prepare("SELECT ua_class, status, meta_json FROM events WHERE kind='custom' AND name='mcp_tool_call' ORDER BY id")
    .all() as Array<{ ua_class: string; status: number; meta_json: string }>;
}

describe("MCP tool-call tracking", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-trackmcp-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.SESSION_SECRET = "test-session-secret-1234";
    process.env.OAUTH_SIGNING_SECRET = "test-oauth-signing-secret-32char";
    process.env.NODE_ENV = "test";
    delete process.env.MCP_BEARER_TOKEN;
    getDb();
    closeDb();
    _resetRateLimit();
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.SESSION_SECRET;
    delete process.env.MCP_BEARER_TOKEN;
    _resetRateLimit();
  });

  it("an authenticated tools/call is logged as human_authenticated", async () => {
    const app = createApp();
    const token = provisionProClient();
    const res = await jsonrpc(
      app,
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tariff_lookup", arguments: { hs8: "84820010" } } },
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(200);
    await flush();

    const rows = mcpRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].ua_class).toBe("human_authenticated");
    const meta = JSON.parse(rows[0].meta_json);
    expect(meta.tool).toBe("tariff_lookup");
    expect(meta.authenticated).toBe(true);
    expect(meta.admin).toBe(false);
    expect(meta.jsonrpc_method).toBe("tools/call");
  });

  it("an anonymous scanner tools/call is logged as scanner (excluded from human count)", async () => {
    const app = createApp();
    const res = await jsonrpc(
      app,
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tariff_lookup", arguments: { hs8: "84820010" } } },
      { "user-agent": "curl/8.4.0" },
    );
    expect(res.status).toBe(200);
    await flush();

    const rows = mcpRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].ua_class).toBe("scanner");
    expect(JSON.parse(rows[0].meta_json).authenticated).toBe(false);
  });

  it("tools/list and initialize do NOT create mcp_tool_call rows", async () => {
    const app = createApp();
    const token = provisionProClient();
    await jsonrpc(app, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${token}` });
    await jsonrpc(app, { jsonrpc: "2.0", id: 2, method: "initialize" }, { authorization: `Bearer ${token}` });
    await jsonrpc(app, { jsonrpc: "2.0", id: 3, method: "ping" }, { authorization: `Bearer ${token}` });
    await flush();
    expect(mcpRows()).toHaveLength(0);
  });

  it("a batch logs exactly one row per tools/call sub-request", async () => {
    const app = createApp();
    const token = provisionProClient();
    await jsonrpc(
      app,
      [
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tariff_lookup", arguments: { hs8: "84820010" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "kyc_check", arguments: { query: "x" } } },
      ],
      { authorization: `Bearer ${token}` },
    );
    await flush();
    expect(mcpRows()).toHaveLength(2);
  });

  it("admin bypass (MCP_BEARER_TOKEN) is human_authenticated but flagged admin", async () => {
    process.env.MCP_BEARER_TOKEN = "admin-bearer-token-very-long-1234567890";
    const app = createApp();
    const res = await jsonrpc(
      app,
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tariff_lookup", arguments: { hs8: "84820010" } } },
      { authorization: `Bearer ${process.env.MCP_BEARER_TOKEN}` },
    );
    expect(res.status).toBe(200);
    await flush();
    const rows = mcpRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].ua_class).toBe("human_authenticated");
    expect(JSON.parse(rows[0].meta_json).admin).toBe(true);
  });

  it("non-regression: an /api/* request does not create an mcp_tool_call row", async () => {
    const app = createApp();
    await app.request("/api/account", { method: "GET" }); // 401, but still tracked as api_request
    await flush();
    expect(mcpRows()).toHaveLength(0);
    const apiRows = getDb()
      .prepare("SELECT COUNT(*) AS n FROM events WHERE kind='api_request'")
      .get() as { n: number };
    expect(apiRows.n).toBeGreaterThanOrEqual(1);
  });
});
