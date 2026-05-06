# @openswissdata/mcp

[![npm version](https://img.shields.io/npm/v/@openswissdata/mcp.svg)](https://www.npmjs.com/package/@openswissdata/mcp)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

Standalone MCP (Model Context Protocol) server that proxies STDIO ⇄ the live openswissdata HTTP MCP endpoint.

Plug-and-play for **Claude Desktop**, **Cursor**, **Cline**, **VS Code Copilot Chat** and any other MCP client. The package ships an executable named `openswissdata-mcp` which the client launches as a child process — no separate backend deploy needed.

> The MCP server you find in the openswissdata core repo at `src/mcp/` is HTTP-only (Hono-mounted at `mcp.openswissdata.com/jsonrpc`). This package is the STDIO bridge that talks to that remote on your behalf.

## What you get

- 9 tools: `tariff_lookup`, `tariff_semantic_search`, `tariff_changelog`, `cross_walk`, `classify_text`, `kyc_check`, `finma_search`, `entity_history`, `statent_lookup`.
- The mandatory non-official disclaimers (TARES) are passed through untouched in `content[].text`.
- Anonymous tier works out of the box (~100 requests/day per IP). Bring your own `OPENSWISSDATA_API_KEY` for higher quotas.

## Install

You don't need to install anything — `npx` will fetch the package on demand. To pin globally:

```bash
npm install -g @openswissdata/mcp
```

## Claude Desktop

Edit your config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```jsonc
{
  "mcpServers": {
    "openswissdata": {
      "command": "npx",
      "args": ["-y", "@openswissdata/mcp"],
      "env": {
        "OPENSWISSDATA_API_KEY": "sk_live_..." // optional, anonymous tier otherwise
      }
    }
  }
}
```

Restart Claude Desktop. The 9 tools should appear under the MCP tool icon.

A copy of the snippet ships in [`examples/claude-desktop-config.json`](./examples/claude-desktop-config.json).

## Cursor

Edit `~/.cursor/mcp.json` (global) or `<workspace>/.cursor/mcp.json`:

```jsonc
{
  "mcpServers": {
    "openswissdata": {
      "command": "npx",
      "args": ["-y", "@openswissdata/mcp"],
      "env": {
        "OPENSWISSDATA_API_KEY": "sk_live_..."
      }
    }
  }
}
```

See [`examples/cursor-mcp.json`](./examples/cursor-mcp.json).

## Cline

Add a stdio MCP server through Cline's UI (or directly in `.vscode/mcp.json`) with:

- Command: `npx`
- Args: `-y @openswissdata/mcp`
- Env: `OPENSWISSDATA_API_KEY=sk_live_...`

See [`examples/cline-config.json`](./examples/cline-config.json).

## Configuration

| Variable                      | Default                              | Description                            |
| ----------------------------- | ------------------------------------ | -------------------------------------- |
| `OPENSWISSDATA_API_KEY`       | (anonymous)                          | Bearer token for higher quotas / paid tools |
| `OPENSWISSDATA_BASE_URL`      | `https://mcp.openswissdata.com`      | Override (staging, self-host)          |
| `OPENSWISSDATA_TIMEOUT_MS`    | `30000`                              | Per-request timeout                    |

CLI flags:

```bash
openswissdata-mcp --version
openswissdata-mcp --help
```

## Docker

A two-stage non-root Dockerfile is included (Glama / Smithery friendly):

```bash
docker build -t openswissdata-mcp .
docker run --rm -i \
  -e OPENSWISSDATA_API_KEY=sk_live_... \
  openswissdata-mcp
```

(STDIO MCP servers are interactive — pass `-i` so stdin is open.)

## How it works

```
┌──────────────────┐  STDIO   ┌──────────────────┐  HTTPS   ┌────────────────────────┐
│ Claude Desktop   │  ───────▶│  openswissdata-  │  ──────▶│ mcp.openswissdata.com  │
│ Cursor / Cline   │ ◀────── │  mcp (this pkg)  │ ◀────── │  (Hono + 9 tools)      │
└──────────────────┘          └──────────────────┘          └────────────────────────┘
```

The standalone server uses the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) for STDIO transport and forwards every `tools/list` / `tools/call` to the remote JSON-RPC endpoint. Tool descriptors come from the remote so this binary stays trivially up-to-date when the API gains new tools.

## Disclaimers

OpenSwissData is a non-official mirror of public Swiss government datasets (TARES / NOGA / NACE / ISIC / FINMA registry). TARES tool calls return a mandatory non-official notice in their text content — the agent must surface this to the end user before customs decisions. Final decisions always go back to xtares.admin.ch / finma.ch.

## Development

```bash
npm install
npm run dev         # tsx — live STDIO server reading from your terminal (Ctrl-D to exit)
npm test            # vitest, mocked HTTP — no live API calls
npm run typecheck
npm run build
```

## License

Apache 2.0 — see [LICENSE](./LICENSE).
