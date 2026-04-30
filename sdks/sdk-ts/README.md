# @openswissdata/sdk

[![npm version](https://img.shields.io/npm/v/@openswissdata/sdk.svg)](https://www.npmjs.com/package/@openswissdata/sdk)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Types: TypeScript](https://img.shields.io/badge/types-typescript-blue.svg)](https://www.typescriptlang.org/)

Official TypeScript SDK for [openswissdata.com](https://openswissdata.com) — Swiss customs (TARES), economic classifications (NOGA / NACE / ISIC) and the FINMA registry of supervised entities.

Works in Node.js 18+ and modern browsers, ships dual ESM + CJS exports, and uses the global `fetch` (no extra runtime dependencies).

## Install

```bash
npm install @openswissdata/sdk
```

## Quickstart

```ts
import { Client } from "@openswissdata/sdk";

const client = new Client({
  apiKey: process.env.OPENSWISSDATA_API_KEY, // optional — anonymous gets free-tier
});

const tariff = await client.tares.lookup({ hs8: "84620010", lang: "fr" });
console.log(tariff.designation, tariff.duty_mfn.value, tariff.duty_mfn.unit);

// Always surface the non-official disclaimer to your end users
console.log(tariff.disclaimer);
```

## Datasets

### TARES — Swiss customs tariffs

```ts
// Exact HS8 lookup
await client.tares.lookup({ hs8: "84620010", lang: "fr" });

// Free-text semantic search (FR embeddings)
await client.tares.search({ query: "couteau de cuisine", top_k: 5 });

// Historical changelog (rolling 12-24 months)
await client.tares.changelog({ hs8: "84620010", since: "2025-01-01" });
```

### Classifications — NOGA / NACE / ISIC

```ts
// Translate a code between schemes
await client.classifications.crossWalk({
  code: "62.01",
  source: "NACE_2.0",
  target: "NOGA_2025",
});

// Classify free-text business description
await client.classifications.classifyText({
  text: "vente de café en grain et torréfaction",
  top_k: 3,
});
```

### FINMA — supervised entities + warnings

```ts
// Substring KYC check
await client.finma.kycCheck({ name: "UBS", top_k: 10 });

// Fuzzy / typo-tolerant search
await client.finma.search({ name: "Cred Suisse", include_warnings: true });

// Timeline of a single entity
await client.finma.entityHistory({ uid: "CHE-103.137.179" });
```

## Authentication

| Tier        | How                                                     | Limits                          |
| ----------- | ------------------------------------------------------- | ------------------------------- |
| Anonymous   | `new Client()`                                          | ~100 req/day per IP, V1 tools   |
| Bearer      | `new Client({ apiKey: "sk_live_..." })`                 | Plan-dependent                  |
| OAuth 2.1   | Token issued via `/oauth/*` endpoints                   | All tools, scope-checked        |

The free tier is enough to evaluate the SDK without registering. Sign up at [openswissdata.com](https://openswissdata.com) for an API key.

## Error handling

```ts
import {
  Client,
  AuthError,
  RateLimitError,
  ServerError,
  NetworkError,
  ToolError,
} from "@openswissdata/sdk";

try {
  await client.tares.lookup({ hs8: "00000000" });
} catch (e) {
  if (e instanceof RateLimitError) {
    // e.retryAfterSeconds, e.remaining, e.limit, e.reset
  } else if (e instanceof AuthError) {
    // 401/403
  } else if (e instanceof ToolError) {
    // tool returned isError (e.g. unknown HS8)
  } else if (e instanceof ServerError) {
    // 5xx after retries exhausted
  } else if (e instanceof NetworkError) {
    // DNS / TCP / abort
  }
}
```

The client retries 5xx and network errors with exponential backoff + jitter (default 3 attempts, 250ms initial). Set `maxRetries: 0` to disable.

## Rate limiting

After every request the client exposes the latest `X-RateLimit-*` headers:

```ts
console.log(client.lastRateLimit);
// { limit: 100, remaining: 73, reset: 1714512000 }
```

## Configuration

```ts
new Client({
  apiKey: "sk_live_...",                       // optional
  baseUrl: "https://mcp.openswissdata.com",    // override for staging
  timeoutMs: 30_000,
  maxRetries: 3,
  retryBackoffMs: 250,
  fetch: globalThis.fetch,                     // inject custom fetch
  userAgent: "my-app/1.0",                     // suffix appended after the SDK UA
});
```

## Browser usage

```html
<script type="module">
  import { Client } from "https://esm.sh/@openswissdata/sdk@0.1.0";
  const client = new Client();
  const r = await client.tares.lookup({ hs8: "84620010" });
  console.log(r);
</script>
```

See [`examples/browser.html`](./examples/browser.html) for a fuller sample.

## Disclaimers

OpenSwissData is a non-official mirror of public Swiss government datasets. Every TARES result includes a mandatory disclaimer that you **MUST** surface to your end users — it is shipped inside `result.disclaimer` *and* prepended to the human-readable text content. Your application must not strip it.

For customs, classifications and FINMA decisions always check the original source linked in `source_url`.

## Development

```bash
npm install
npm test         # vitest, mocked fetch — no live API calls
npm run build    # emits ESM + CJS + .d.ts to dist/
npm run typecheck
```

## License

Apache 2.0 — see [LICENSE](./LICENSE).
