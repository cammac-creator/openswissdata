---
title: "I built an MCP server without the @modelcontextprotocol/sdk — here's what I learned"
published: false
description: "Why I ditched Anthropic's official MCP SDK for a 200-line Hono dispatcher, and what the wire protocol actually demands."
tags: mcp, typescript, ai, indiehacker
cover_image: ""
canonical_url: ""
---

I shipped a Model Context Protocol server last month. It's live on Anthropic's official registry as `io.github.cammac-creator/openswissdata`. It exposes nine tools over JSON-RPC 2.0 to any MCP-compatible client (Claude Desktop, Cursor, Cline, you name it).

I built it without `@modelcontextprotocol/sdk`.

Not because the SDK is bad — it isn't. But because for my stack, the friction of fitting it in wasn't paid back by any feature I needed. This post is the honest write-up of that decision, the wire protocol I had to implement instead, and why I'd do it the same way again.

## The hook: SDK ≠ obligation

There's an implicit assumption when you discover a new protocol: "I need to install the SDK." The SDK is the blessed path. It's in the docs. It's what every blog post imports on line 1.

But an SDK is a particular set of tradeoffs frozen into code. Sometimes those tradeoffs match yours. Sometimes they don't. The MCP wire protocol — the thing the SDK ultimately speaks to clients — is published, small, and stable. So before reaching for the import, it's worth asking: what does the SDK *give me* that I can't get by reading the spec?

For my project, the honest answer was: nothing I needed for the MVP.

## What the SDK actually wants from you

The `@modelcontextprotocol/sdk` exports a `Server` class. To use it, you give it two things: a server identity, and a `Transport`. The Transport is where the friction lives.

There are basically two production transports:

1. **STDIO** — designed for child processes spawned by desktop clients. Claude Desktop or Cursor launch your server as a subprocess and talk to it over stdin/stdout. Not what you want if you're hosting a public HTTP endpoint.
2. **StreamableHTTPServerTransport** — the SDK's HTTP transport. It expects Express-style `req`/`res` objects and runs its own session manager. Sessions, SSE channels, the whole envelope.

I run my backend on **Hono** (because it's tiny, edge-friendly, and fits on Bun/Node/workers). Hono doesn't speak Express's `req`/`res` shape — it gives you a `Context` with `c.req.json()` and `c.json()`. So integrating `StreamableHTTPServerTransport` would mean either (a) adapting between Hono and Express semantics inside every request, or (b) carving out a side-channel `http.createServer()` listener just for MCP. Both are uglier than what I ended up doing.

And the SSE / session resumption that the StreamableHTTPServerTransport exists to provide? My nine tools are all synchronous request/response. There's nothing to stream. No long-running task to resume. The transport's value proposition didn't apply to my use case.

So I read the spec.

## The wire protocol, minus the marketing

The MCP spec at [modelcontextprotocol.io](https://modelcontextprotocol.io) is more approachable than people assume. For a tools-only server like mine, you need to handle exactly three JSON-RPC 2.0 methods:

- `initialize` — client says hi, you respond with your protocol version and capabilities
- `tools/list` — client asks what you can do, you enumerate registered tools
- `tools/call` — client invokes a tool by name with arguments, you dispatch and return

Plus the standard JSON-RPC 2.0 error envelope (`-32700` parse error, `-32600` invalid request, `-32601` method not found, `-32602` invalid params, `-32603` internal error).

That's it. That's the protocol surface. Maybe 80 lines of types and 100 lines of dispatch logic.

## The minimalist code

Here's the entire JSON-RPC error/response shape — all you need to wire-conform:

```typescript
// 5 standard JSON-RPC 2.0 error codes — the whole error surface
const ERR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// Two helpers — every response goes through one of these
function err(id, code, message, data?) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}
function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}
```

Tools are just an interface — name, description, JSON schema for inputs, and a handler:

```typescript
interface Tool {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  // Handlers may be sync (CSV lookup) or async (embedding pipeline).
  // The dispatch layer awaits the return value uniformly.
  handler: (args: unknown) => ToolResult | Promise<ToolResult>;
}

const TOOLS: readonly Tool[] = [
  tariffLookupTool,
  kycCheckTool,
  crossWalkTool,
  // ... six more
] as const;
const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
```

The `initialize` handler advertises what you support. The spec is loud about `protocolVersion` — pin it to a known date:

```typescript
const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "openswissdata-mcp", version: "0.2.0" } as const;

// In the dispatch switch:
case "initialize":
  return ok(id, {
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: { ...SERVER_INFO },
    capabilities: { tools: { listChanged: false } },
  });
```

`tools/list` is a one-liner over the registry — clients use this to discover what's available, so the schema you emit here is the contract:

```typescript
function listTools() {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}
```

`tools/call` is where the actual work happens. Validate, look up, dispatch:

```typescript
case "tools/call": {
  const params = r.params as { name?: string; arguments?: unknown } | undefined;
  if (!params || typeof params.name !== "string") {
    return err(id, ERR.INVALID_PARAMS, "params.name (string) is required");
  }
  const tool = TOOLS_BY_NAME[params.name];
  if (!tool) {
    return err(id, ERR.METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
  }
  // Always await — handler can be sync or Promise-returning; await of a
  // non-promise is a no-op, so this is safe and uniform.
  const result = await tool.handler(params.arguments ?? {});
  return ok(id, result);
}
```

And mounting it inside Hono is one route:

```typescript
import { Hono } from "hono";
import { dispatch } from "../../mcp/server.js";

export const mcpRoute = new Hono();

mcpRoute.post("/jsonrpc", async (c) => {
  let body;
  try { body = await c.req.json(); }
  catch {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
    );
  }
  // JSON-RPC 2.0 supports batched requests — handle both shapes
  if (Array.isArray(body)) {
    return c.json(await Promise.all(body.map((r) => dispatch(r))));
  }
  return c.json(await dispatch(body));
});
```

That's the runtime path. Around 200 lines of TypeScript including the dispatch switch, the error helpers, the tool registry, and the route. Add OAuth and scope checks on top if you need them — but the protocol core stays at 200 lines.

## What I actually got out of doing it this way

**Total control of the request envelope.** When something goes wrong on the wire — and something always goes wrong on the wire when you launch — I'm reading my own code, not stepping through a Transport abstraction. The dispatch function is one switch statement. There's nowhere for a bug to hide.

**Zero dependencies I'm not using.** No SSE machinery, no session manager, no Express adapter, no schema validation library that overlaps with the Zod I already had. The `node_modules` footprint of the MCP code path is just Hono.

**Native Hono integration.** OAuth middleware, rate limiting, observability — all of it composes the same way it does for the rest of my API. My MCP route sits next to my Stripe webhook and my health probe and uses the same middleware stack. No special case.

**Easier mental model for testing.** `dispatch(rpcRequest, authContext)` is a pure-ish function. Vitest calls it with a fake request, asserts the response shape. No transport to mock, no port to bind, no subprocess to spawn.

## The trade-offs (be honest)

I'm not pretending this is free. Going SDK-less means:

- **No SSE / streaming.** If a tool needs to push partial results or resume an interrupted task, I'd have to build that. For nine synchronous lookups, I don't. If that changes — I'll switch.
- **No session manager.** Each request is independent. Stateful conversations (which MCP supports via session IDs) aren't on my surface.
- **No free updates.** When the spec evolves and adds a new method, I have to add a case to my switch. The SDK would have shipped that for me. So far the protocol has been stable enough that this hasn't bitten me.
- **You have to read the spec.** Which honestly I think is a feature, not a bug. If you're shipping an MCP server you should know what's on the wire.

There's also the STDIO question. Claude Desktop and Cursor launch MCP servers as child processes over stdin/stdout — they don't make HTTP calls. For that, I do use the SDK, in a separate `npx @openswissdata/mcp` binary that's *only* an STDIO bridge:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
// ...this binary just proxies STDIO → HTTPS over to the real server.
// Using the SDK here is correct — STDIO transport is exactly what it's for.
```

That's the right place for the SDK: a thin bridge between an OS-level subprocess transport and my HTTP endpoint. The SDK does the part it was designed for, and my dispatcher does the part it was designed for. Both files end up small.

## What this powers

The custom dispatcher runs in production at `mcp.openswissdata.com` — that's the live MCP endpoint behind [openswissdata.com](https://openswissdata.com), the first MCP server originating from Switzerland on Anthropic's registry. It serves Swiss customs tariffs, FINMA financial entities, and a few other Swiss reference datasets to AI agents.

Whole code is Apache-2.0 licensed and on GitHub: [github.com/cammac-creator/openswissdata](https://github.com/cammac-creator/openswissdata). The dispatcher I described lives at `src/mcp/server.ts` and the Hono route at `src/routes/mcp/index.ts`. Copy it, paste it, adapt it — that's literally why the license is what it is.

## When you should use the SDK anyway

I don't want to oversell this. The SDK is the right call when:

- You're shipping a **STDIO-launched desktop integration** — that's its native habitat.
- You need **SSE / streaming** for long-running tools or resumable sessions.
- You want **schema-validated request types** out of the box (the SDK ships Zod schemas for every wire message).
- You don't want to track spec drift in your own switch statement.

What the SDK is *not* the right call for: an HTTP server in a non-Express stack, with synchronous tools, where you want one set of middleware to handle everything. That's where the friction of fitting the SDK in starts costing more than reading the spec directly.

## Takeaway

"Should I use the SDK" is a real question, not a default. The MCP wire protocol is small enough that a custom dispatcher is a weekend, not a quarter. If the SDK gives you something concrete — STDIO, SSE, sessions — use it. If it gives you abstractions you'd have to fight to wedge into your stack, you have permission to write the 200 lines yourself.

The protocol is the interface. The SDK is one implementation of it. Sometimes the second one is yours.

---

Wire protocol spec: [modelcontextprotocol.io](https://modelcontextprotocol.io)
Source code (Apache-2.0): [github.com/cammac-creator/openswissdata](https://github.com/cammac-creator/openswissdata)
