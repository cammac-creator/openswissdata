# OpenSwissData MCP server (MVP)

> **Status:** Phase 2 first pass — scaffolding + 3 tools.
> **Endpoint:** `https://www.openswissdata.com/mcp/jsonrpc` (sub-domain `mcp.openswissdata.com` reserved, DNS pending).
> **Spec:** [Model Context Protocol 2025-06-18](https://modelcontextprotocol.io/).

## What is this?

A JSON-RPC 2.0 server that exposes OpenSwissData datasets as **MCP tools**, so Claude Code, Cursor, and any other MCP-aware client can call them natively (no scraping, no copy/paste).

## Tools shipped in the MVP

| Tool            | What it does                                                                 |
|-----------------|------------------------------------------------------------------------------|
| `tariff_lookup` | Lookup a Swiss customs tariff (HS8) and return the full TARES row + a non-stripable disclaimer. |
| `kyc_check`     | Search the FINMA registry of supervised entities + the FINMA warnings list by name. |
| `cross_walk`    | Translate an industry classification code between NOGA 2008/2025, NACE 2.0/2.1 and ISIC 4. |

Six more tools are planned for V2 — see *Roadmap* below.

## Quick start (curl)

```bash
# 1. Server info (no auth in dev)
curl https://www.openswissdata.com/mcp

# 2. List tools
curl -X POST https://www.openswissdata.com/mcp/jsonrpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 3. Call tariff_lookup
curl -X POST https://www.openswissdata.com/mcp/jsonrpc \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params":{
      "name":"tariff_lookup",
      "arguments":{"hs8":"01012110","lang":"fr"}
    }
  }'

# 4. KYC screening
curl -X POST https://www.openswissdata.com/mcp/jsonrpc \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":3,
    "method":"tools/call",
    "params":{"name":"kyc_check","arguments":{"name":"AXA"}}
  }'

# 5. Cross-walk NOGA_2025 → NACE_2.1
curl -X POST https://www.openswissdata.com/mcp/jsonrpc \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":4,
    "method":"tools/call",
    "params":{
      "name":"cross_walk",
      "arguments":{"code":"01","source":"NOGA_2025","target":"NACE_2.1"}
    }
  }'
```

If a `MCP_BEARER_TOKEN` is configured in the production env (it is), add `-H "authorization: Bearer <token>"` to every call. Public access without a token will return `401`.

## Use it from Claude Code

Add the server to your local `~/.claude.json` (or `~/.config/claude-code/mcp.json` depending on your install). Example:

```json
{
  "mcpServers": {
    "openswissdata": {
      "url": "https://www.openswissdata.com/mcp/jsonrpc",
      "transport": "http",
      "headers": {
        "authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Restart Claude Code and the three tools (`tariff_lookup`, `kyc_check`, `cross_walk`) will be available. The same config works for Cursor — it reads MCP servers from `Settings → Tools`.

## JSON-RPC methods supported

| Method         | Notes                                                               |
|----------------|---------------------------------------------------------------------|
| `initialize`   | Returns `protocolVersion: "2025-06-18"`, server info, capabilities. |
| `ping`         | Liveness check (returns `{}`).                                      |
| `tools/list`   | Returns the 3 tools with their JSON Schema input contracts.         |
| `tools/call`   | Dispatches to one tool. `params: { name, arguments }`.              |

Batch requests (a JSON array of calls) are supported.

## Authentication (MVP)

- **Bearer token** in `Authorization: Bearer <token>` header.
- Token configured via the `MCP_BEARER_TOKEN` env var on Railway.
- If the env var is unset (dev/test), auth is bypassed — same convention as Resend/R2 in `src/env.ts`.

**V2** will replace this with **OAuth 2.1** + **per-licence quotas**: each ZIP licence-holder gets a token bound to a quota tier (10 lookups/day free, 1k req/day for €39 standalone subs, 10k req/month bundled with Pro pack at 899 CHF).

## Rate limits (MVP)

- 100 requests / hour / IP, in-memory sliding window.
- Returns HTTP 429 + `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers.
- Single-process only (fine for one Railway replica). V2 = Redis + per-licence quotas.

## Disclaimer policy

`tariff_lookup` always prepends a **non-official disclaimer** to the textual content payload (not just a separate field). The disclaimer is in the user's chosen language and explicitly states OpenSwissData is not the official source — `xtares.admin.ch` is. We rely on this convention so an LLM that forwards `content[0].text` cannot silently drop the warning.

## Roadmap V2

These tools are specced (see `docs/perfectionnement-2026-04-29/PHASE-1-2-TECHNICAL-PREP.md`) and planned for the V2 milestone:

| Tool                     | Notes                                                                   |
|--------------------------|-------------------------------------------------------------------------|
| `tariff_semantic_search` | FAISS over BAAI/bge-m3 embeddings shipped with the TARES bundle.        |
| `tariff_changelog`       | Rolling 12-24 month diff of MFN + preferential rates per HS8.           |
| `classify_text`          | Free-text → top-K NOGA codes with confidence (uses bundled embeddings). |
| `statent_lookup`         | STATENT establishments + FTE per NOGA code per commune (Pro-tier only). |
| `entity_history`         | Timeline of changes for a FINMA-supervised entity (UID-keyed).          |
| `finma_search`           | Fuzzy / typo-tolerant FINMA registry search.                            |

V2 also introduces:

- **OAuth 2.1** server (PKCE + refresh tokens) replacing the simple Bearer.
- **Per-licence quotas** (Redis-backed).
- **SSE streaming** transport for long-running calls (semantic search, changelogs).
- **Sub-domain split**: `mcp.openswissdata.com` becomes its own Railway service with the dataset slice extracted from R2 at boot, and the main `www.openswissdata.com/mcp/*` mount becomes a redirect.

## Implementation notes (for maintainers)

- **No SDK runtime dep.** We don't import `@modelcontextprotocol/sdk`. The wire protocol we need (`initialize` / `tools/list` / `tools/call`) is small enough that wrapping it in Hono is cleaner than bridging the SDK's `StreamableHTTPServerTransport` (which expects Express-style req/res + a session manager). The MVP exposes a single `POST /mcp/jsonrpc` endpoint — no SSE, no session resumption. Real MCP clients accept this for non-streaming calls.
- **Data slice in `src/mcp/data/`.** The full `data/` tree is gitignored and railwayignored. We bundle a slice (~10 MB total) into the source tree so it ships with the deploy. The `npm run build` script copies the CSVs to `dist/mcp/data/`.
- **Lazy load.** `data-loader.ts` parses each CSV the first time it's queried and caches the result in module scope.
- **Mount order.** `src/index.ts` mounts `/mcp` *before* the static catch-all — otherwise the Astro 404 page would shadow the JSON-RPC endpoint.
