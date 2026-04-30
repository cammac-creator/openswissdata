#!/usr/bin/env node
/**
 * Entry point for the `openswissdata-mcp` CLI.
 *
 * Wires the proxy + server (`server.ts`) onto a STDIO transport so MCP
 * clients (Claude Desktop, Cursor, Cline, …) can spawn it as a subprocess.
 *
 * Configuration:
 *   - `OPENSWISSDATA_API_KEY`    optional Bearer token (default: anonymous)
 *   - `OPENSWISSDATA_BASE_URL`   override remote MCP base URL (default: prod)
 *   - `OPENSWISSDATA_TIMEOUT_MS` request timeout (default: 30000)
 *
 * Logs go to stderr only — stdout is reserved for the JSON-RPC stream.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

function parseTimeout(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function main(): Promise<void> {
  // CLI flags — single-purpose binary, only --version / --help.
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write(`${SERVER_NAME} ${SERVER_VERSION}\n`);
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      `${SERVER_NAME} ${SERVER_VERSION}\n\n` +
        "Standalone STDIO MCP server that proxies to https://mcp.openswissdata.com\n\n" +
        "Configuration via env:\n" +
        "  OPENSWISSDATA_API_KEY    Bearer token (optional, anonymous tier otherwise)\n" +
        "  OPENSWISSDATA_BASE_URL   override remote base URL\n" +
        "  OPENSWISSDATA_TIMEOUT_MS request timeout in ms (default 30000)\n\n" +
        "See https://openswissdata.com/docs/mcp for client setup (Claude Desktop, Cursor, Cline).\n",
    );
    return;
  }

  const apiKey = process.env.OPENSWISSDATA_API_KEY;
  const baseUrl = process.env.OPENSWISSDATA_BASE_URL;
  const timeoutMs = parseTimeout(process.env.OPENSWISSDATA_TIMEOUT_MS);

  const { server, proxy } = buildServer({
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  // Best-effort startup ping. We log to stderr (stdout is the JSON-RPC
  // pipe) so failures don't poison the protocol stream. Continue even if
  // the ping fails — the user might be offline at startup.
  try {
    const info = await proxy.discovery();
    process.stderr.write(
      `[${SERVER_NAME}] connected to ${proxy.baseUrl} (${info.server_info.name} ${info.server_info.version}) — ${info.tools.length} tools\n`,
    );
  } catch (e) {
    process.stderr.write(
      `[${SERVER_NAME}] WARNING: could not reach ${proxy.baseUrl}: ${(e as Error).message}\n`,
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`[${SERVER_NAME}] ready (STDIO transport)\n`);

  // Graceful shutdown on SIGINT/SIGTERM so the parent (Claude Desktop) sees
  // a clean exit instead of a hung subprocess.
  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // ignore — we're exiting anyway
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e: unknown) => {
  process.stderr.write(`[${SERVER_NAME}] FATAL: ${(e as Error).message ?? String(e)}\n`);
  process.exit(1);
});
