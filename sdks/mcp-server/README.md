# @openswissdata/mcp

MCP server for Swiss federal reference data: the Swiss customs tariff (TARES), the FINMA register of supervised institutions and the FINMA warnings list, and NOGA / NACE / ISIC activity-code correspondences. Three tools work without any key or sign-up.

This package is a small STDIO bridge to the remote OpenSwissData MCP endpoint, for clients that only launch local processes. Clients that speak MCP over HTTP can connect directly to `https://mcp.openswissdata.com/jsonrpc` without it.

## Free tools (no key)

Limit: 100 calls per hour per IP address.

| Tool | What it answers |
| --- | --- |
| `tariff_lookup` | An 8-digit Swiss tariff number (dots allowed, e.g. `8471.3000`) returns the full TARES line: designations in FR/DE/IT/EN, MFN duty, preferential regimes, restrictions, customs relief codes. A 2- to 7-digit HS prefix (e.g. the international HS6 code `847130`) lists the Swiss 8-digit lines under it. |
| `kyc_check` | Searches the FINMA register and the FINMA warnings list by entity name. |
| `cross_walk` | Maps an activity code between NOGA 2008, NOGA 2025, NACE 2.0, NACE 2.1 and ISIC 4, with the relation type and its source. |

The other tools (`tariff_semantic_search`, `classify_text`, `finma_search`, `tariff_changelog`, `entity_history`) need existing access rights; new paid subscriptions are closed at the moment. Buying a dataset file does not create an API key. `statent_lookup` has been withdrawn.

## Setup

Claude Code, remote endpoint (no bridge needed):

```bash
claude mcp add --transport http openswissdata https://mcp.openswissdata.com/jsonrpc
```

Clients configured with `mcpServers` and a local process (Claude Desktop, Cline and others):

```json
{
  "mcpServers": {
    "openswissdata": {
      "command": "npx",
      "args": ["-y", "@openswissdata/mcp"]
    }
  }
}
```

Tools and their schemas come from the server at each listing.

| Variable | Default | Use |
| --- | --- | --- |
| `OPENSWISSDATA_API_KEY` | none | Existing OAuth token, for the rights it carries |
| `OPENSWISSDATA_BASE_URL` | `https://mcp.openswissdata.com` | Alternative server |
| `OPENSWISSDATA_TIMEOUT_MS` | `30000` | Timeout, including reading the whole response |

Keep a key in the client's private configuration. Diagnostics go to stderr; stdout is reserved for the protocol. `openswissdata-mcp --version` and `--help` print the version and help.

## Development

Node 22 is used for the checks. The runtime keeps its Node 18+ declaration; use a maintained version.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

The tests run a full MCP exchange with the official SDK and interrupt a response whose body stalls. A change in the repository does not publish a new npm version: check the registry separately before distribution.

The Dockerfile offers a local alternative: `docker build -t openswissdata-mcp .`, then `docker run --rm -i openswissdata-mcp`.

## Limits

OpenSwissData is an unofficial copy. Keep the notices shown to the user. An approximate correspondence needs expert validation; a missing tariff value does not mean duty-free; no FINMA result is not a compliance certificate. Check the original sources (xtares.admin.ch, finma.ch, the Swiss Federal Statistical Office) before any decision.

Full datasets are sold as signed files at [openswissdata.com](https://www.openswissdata.com/en/). A summary for AI agents lives at [openswissdata.com/llms.txt](https://www.openswissdata.com/llms.txt).

Apache-2.0 licence. [Documentation of the MCP SDK used](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x).
