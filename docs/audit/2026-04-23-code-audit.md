# Code audit — openswissdata.com — 2026-04-23

**Auditor**: subagent code-reviewer (Claude Sonnet 4.6)
**Scope**: full prod codebase, ~50 commits up to HEAD (7caede8)
**Purpose**: validate readiness for Stripe Live switch

---

## Status 2026-04-23 T+0

**All critical + high findings fixed. READY for Stripe Live.**
- C1, C2, C3 fixed in `src/env.ts`, `src/lib/tokens.ts`, `src/routes/admin.ts`
- H1, H2, H3, H4 fixed in `src/routes/download.ts`, `src/routes/stripe-webhook.ts`, `src/routes/auth.ts`, `src/routes/checkout.ts`
- 15 regression tests added (180 total, all passing)
- Typecheck and build clean

---

## Executive verdict

**READY WITH MINOR FIXES** — The codebase is architecturally sound, correctly implements Stripe webhook signature verification, uses parameterized queries throughout, and has good cryptographic hygiene in `tokens.ts`. Three critical issues must be resolved before switching to Live mode: (1) Stripe and R2 credentials have no startup validation in production, meaning a misconfigured Railway deployment silently fails at request time rather than refusing to start; (2) `STRIPE_PRICE_BUNDLE` is entirely absent from env schema and will produce a silent HTTP 500 on bundle purchases if unset; (3) the admin secret comparison uses `!==` (string equality) instead of a timing-safe comparison, making it theoretically vulnerable to timing attacks from a collocated attacker.

---

## Statistics

- Files audited: 20 source, 27 test, 3 doc/legal
- Lines of TS code reviewed: ~3,820 (src + etl)
- Critical findings: 3
- High findings: 4
- Medium findings: 4
- Low findings: 5

---

## Critical findings (🔴)

### C1. Stripe and R2 credentials not fail-closed at startup in production

**File**: `src/env.ts:16-24`

**Observed**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` are all marked `z.string().optional()` in the Zod schema, including when `isProd === true`. The production server starts successfully without any of them. Failures only surface lazily at request time — `stripe()` throws an unhandled error on first checkout, `signedDownloadUrl()` throws on first download, and the webhook handler returns HTTP 500 for a missing webhook secret. The `CLAUDE.md` for this project explicitly states: *"The middleware must NOT fail-open. If WALLET_ADDRESS is not set in production, the server should refuse to start."* The same principle applies here and is violated.

**Why critical**: A Railway redeploy that accidentally drops an env var (key rotation, manual mistake) will start cleanly, accept incoming Stripe webhooks and checkout requests, and fail silently on all of them — entitlements never created, emails never sent, money already collected.

**Proposed fix**:

```typescript
// src/env.ts — replace the optional() calls for production-required vars

const requiredInProd = isProd
  ? (s: z.ZodString) => s
  : (s: z.ZodString) => s.optional();

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().default("./data/openswissdata.sqlite"),
  BASE_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_SECRET: isProd
    ? z.string().min(32)
    : z.string().min(16).default("dev-admin-secret-change-me"),
  SESSION_SECRET: isProd
    ? z.string().min(32)
    : z.string().min(16).default("dev-session-secret-change-me"),
  STRIPE_SECRET_KEY: isProd ? z.string().min(1) : z.string().optional(),
  STRIPE_WEBHOOK_SECRET: isProd ? z.string().min(1) : z.string().optional(),
  STRIPE_PRICE_BUNDLE: isProd ? z.string().min(1) : z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  R2_ACCOUNT_ID: isProd ? z.string().min(1) : z.string().optional(),
  R2_ACCESS_KEY_ID: isProd ? z.string().min(1) : z.string().optional(),
  R2_SECRET_ACCESS_KEY: isProd ? z.string().min(1) : z.string().optional(),
  R2_BUCKET: isProd ? z.string().min(1) : z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
});
```

---

### C2. `STRIPE_PRICE_BUNDLE` not present in env schema at all

**File**: `src/routes/checkout.ts:41` / `src/env.ts` (absent)

**Observed**: `process.env.STRIPE_PRICE_BUNDLE` is read directly without going through the Zod schema or any startup validation. If this variable is absent in Railway, bundle purchases silently return HTTP 500 with `{ error: "bundle_price_not_configured" }`. There is no startup-time guard. This is the most commercially impactful failure: the bundle at 799 CHF is the primary offering.

**Why critical**: A missing env var causes silent loss of all bundle revenue with no alert. The error is never logged at startup — only at the moment a real customer clicks "Buy".

**Proposed fix**: Add `STRIPE_PRICE_BUNDLE` to `EnvSchema` (see C1 fix above). No changes needed in `checkout.ts` once the env schema validates it at startup.

---

### C3. Admin secret comparison is not timing-safe

**File**: `src/routes/admin.ts:19,28`

**Observed**:
```typescript
if (!secret || secret !== process.env.ADMIN_SECRET) {
```
Both `/api/admin/seed` and `/api/admin/release` use JavaScript's `!==` operator for secret comparison. JavaScript string equality short-circuits on the first differing byte, leaking timing information proportional to the length of the matching prefix.

**Why critical**: A collocated attacker (shared hosting, Railway shared infra) who can make high-frequency requests could brute-force a short or guessable secret character by character via timing. The `tokensEqual()` function in `src/lib/tokens.ts` already provides a correct `timingSafeEqual`-based comparison but is never used here.

**Proposed fix**:

```typescript
// src/lib/tokens.ts — add a generic constant-time compare that doesn't
// require the strict 43-char base64url format

import { timingSafeEqual } from "node:crypto";

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
```

```typescript
// src/routes/admin.ts — replace both occurrences

import { constantTimeEqual } from "../lib/tokens.js";

const secret = c.req.header("x-admin-secret") ?? "";
if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) {
  return c.json({ error: "unauthorized" }, 401);
}
```

This pattern must also be applied consistently to both `/admin/seed` (line 18-20) and `/admin/release` (lines 27-29).

---

## High findings (🟠)

### H1. Download endpoint does not enforce `updates_until` expiry — billing bypass

**File**: `src/routes/download.ts:29-31`

**Observed**: `POST /api/account/download-request` queries the entitlements table and returns 403 if no row exists, but never checks whether `ent.updates_until > Date.now()`. A customer whose 360-day update subscription expired can still log in and download the latest version indefinitely.

**Why high**: This is a direct billing bypass. The CGV (`/legal/cgv`) explicitly states that the updates period is time-limited and renewal costs 40% of the purchase price. On a codebase handling real money, this should be enforced in code, not trusted to customer goodwill.

**Proposed fix**:
```typescript
// src/routes/download.ts — after line 31, add:
if (ent.updates_until !== null && ent.updates_until < Date.now()) {
  return c.json({ error: "subscription_expired" }, 403);
}
```

---

### H2. Webhook order+entitlement inserts are not wrapped in a DB transaction

**File**: `src/routes/stripe-webhook.ts:67-125`

**Observed**: The handler inserts an order row (line 68) and then, in a `for` loop with individual `try/catch` blocks (lines 98-125), inserts entitlements and sends emails. The `try/catch` inside the loop swallows per-dataset exceptions. If the entitlement insert for dataset 2 of 3 throws (e.g., a transient constraint violation), dataset 1's entitlement exists, dataset 2's does not, but the order record is committed as fully `paid`. A second webhook delivery correctly short-circuits at the idempotency check (line 61) and never creates the missing entitlement.

**Why high**: A partially failed webhook delivery leaves the customer with a paid order missing one or more entitlements. Recovery requires manual DB intervention.

**Proposed fix**: Wrap the order insert and all entitlement inserts in a single `db.transaction()`. Move email sending (the only async operation) outside the transaction so the transaction is kept synchronous:

```typescript
const tx = db.transaction(() => {
  const orderInfo = db.prepare(`INSERT INTO orders ...`).run(...);
  const orderId = Number(orderInfo.lastInsertRowid);
  for (const datasetId of resolvedDatasets) {
    entStmt.run(customerId, datasetId, orderId, updatesUntil, now);
  }
  return orderId;
});
const orderId = tx();
// Then send emails outside the transaction
for (const datasetId of resolvedDatasets) { ... await sendDownloadEmail(...) }
```

---

### H3. No rate limiting on `/api/auth/magic-link`

**File**: `src/routes/auth.ts:16-38`

**Observed**: The magic-link endpoint deliberately returns HTTP 200 for unknown emails (correct anti-enumeration design), but this means an attacker can POST unlimited requests for any email address at unlimited speed. Each request for a known customer creates a new short-lived session row in the DB and calls `sendMagicLinkEmail`. There is no per-IP, per-email, or global rate limit.

**Why high**: Two attack vectors: (1) Resend quota exhaustion — an attacker floods a legitimate user's inbox with magic links, burning through the Resend free-tier limit and blocking real authentication; (2) DB row amplification — unconstrained inserts into the `sessions` table for a targeted user.

**Proposed fix**: Add a per-email cooldown (e.g., 60-second minimum between requests for the same address) by storing `last_magic_link_at` on the customers table, or use Hono's built-in `rateLimit` middleware from `hono/rate-limit` on the `/api/auth/magic-link` route (in-memory, suitable for a single-instance Railway deployment).

---

### H4. Stripe error details leaked to clients in `/api/checkout/session` and `/api/checkout/start`

**File**: `src/routes/checkout.ts:72,82,99,132`

**Observed**: Two separate leaks:
1. Line 72: `console.error("[checkout] stripe error:", err)` — logs the full Stripe error object, which may include raw API request details. The returned `result.error` string is then included verbatim in the HTTP response at line 99 (`details: result.error.slice("stripe_error:".length)`).
2. Line 82: Zod parse errors returned as `details: String(err)` — this exposes full Zod schema validation output to the API client.
3. Line 132 (`POST /start`, form-encoded path): `c.text(result.error, ...)` renders the raw internal error string — including `stripe_error:Error: ...` — as a plain-text browser response.

**Why high**: The `/start` endpoint is the form POST used by the HTML CTAs. A failed bundle checkout (e.g., missing `STRIPE_PRICE_BUNDLE`) would render the internal error string directly in the browser. Stripe error messages occasionally include rate-limit hints and API endpoint fragments useful to attackers.

**Proposed fix**:
```typescript
// checkout.ts line 99 — strip the Stripe error detail from the client response:
return c.json({ error: "stripe_error" }, 502);  // remove "details" field

// checkout.ts line 82 — hide Zod internals:
return c.json({ error: "invalid_body" }, 400);  // remove "details" field

// checkout.ts line 132 — /start error path:
return c.redirect(`${baseUrl}/bundle?checkout=error`, 303);  // redirect instead of raw text
```

---

## Medium findings (🟡)

### M1. `getDb()` singleton ignores `path` argument if already initialised

**File**: `src/lib/db.ts:10-13`

**Observed**: `getDb(path?)` returns `_db` immediately if it is already set, regardless of whether `path` matches the path used to open it. In tests, `DATABASE_PATH` is set via `process.env` before each test, and `closeDb()` is called in `afterEach`. This works today, but a caller who passes an explicit `path` argument after initialisation silently gets the wrong database. The `path` parameter is effectively a dead code path in production.

**Fix**: Either remove the `path` parameter (enforce env-var config only) or throw an error when called with a conflicting path.

---

### M2. `SESSION_SECRET` is validated in `env.ts` but never imported or used

**File**: `src/env.ts:12-14`

**Observed**: `SESSION_SECRET` (min 16 chars, required in prod) appears in the Zod schema and is validated at startup, but no file in `src/` ever reads `env.SESSION_SECRET` or `process.env.SESSION_SECRET`. Sessions are secured solely by the cryptographically random token stored in SQLite, which is correct — but the presence of an unused `SESSION_SECRET` suggests either a planned HMAC-signing feature that was never built, or a copy-paste artefact that could mislead future developers into thinking sessions are HMAC-signed.

**Fix**: Remove the `SESSION_SECRET` field from the schema, or add a comment explaining it is reserved for future JWT/HMAC signing.

---

### M3. Download tokens are reusable without a use-count cap

**File**: `src/routes/download.ts:65`

**Observed**: `publicDownload.get("/download/:token")` records `used_at` (line 65) but does not invalidate the token after first use. The token can be reused an unlimited number of times within its 48-hour window. Since the design intent ("Safe to share with an employee") is intentional, this is not inherently wrong, but there is no way for a customer to revoke a shared token if it leaks.

**Fix**: Add `used_count` to `download_tokens` and optionally cap at a configurable max (e.g., 10), or document the reuse behavior explicitly and add a `DELETE /api/download-token/:token` revocation endpoint.

---

### M4. ETL downloads (BAZG + FINMA) use bare `fetch()` without a `User-Agent` header

**Files**: `etl/tares/sources.ts:76`, `etl/finma/sources.ts:202`

**Observed**: Both `downloadAllSources()` and `downloadUidCsv()` call Node.js global `fetch()` without setting `User-Agent`. BAZG's free-data-delivery terms and FINMA's ToS both implicitly expect automated downloaders to identify themselves. Some government CDNs also reject requests without a recognisable UA.

**Fix**: Add a descriptive `User-Agent` header:
```typescript
const res = await fetch(src.url, {
  headers: { "User-Agent": "openswissdata-etl/0.1 (contact@openswissdata.com)" }
});
```

---

## Low findings (🟢)

- **`src/routes/health.ts:10`**: The `/api/health` endpoint exposes `APP_VERSION` (package.json version string). This is a minor information disclosure (version enumeration) — consider removing or gating behind `x-admin-secret`.
- **`src/routes/checkout.ts:82`**: `details: String(err)` on Zod parse failure exposes schema internals. Addressed more fully in H4, but worth noting as a separate surface.
- **`src/lib/r2.ts:56-58`**: `filename` derived from `r2Key.split("/").pop()` with no character sanitisation before embedding in `Content-Disposition`. An admin-controlled `r2_key` like `tares/2026/file"name".zip` would produce a malformed header. Low risk (admin-only write path), but add a sanitizer: `filename.replace(/[^\w.\-]/g, "_")`.
- **No `Content-Security-Policy` header**: The Hono backend serves HTML via `serveStatic`, but no CSP header is set. Astro's static output ships no inline scripts except `is:inline` blocks (which are intentional). A CSP would harden XSS surface. Add via Hono middleware on `*` routes before the static handler.
- **`allow_promotion_codes: true` on Stripe sessions** (`src/routes/checkout.ts:62`): A 100%-off coupon created in the Stripe dashboard grants full entitlements at zero cost. This is by-design operator functionality, but warrants a note in the operator runbook: Stripe coupon creation access should be limited to the account owner.

---

## Strengths worth highlighting

- **Webhook idempotency correctly keyed on `UNIQUE(stripe_session_id)`**: Even if the soft SELECT+INSERT check (lines 61-68) were bypassed by a race condition, the DB-level `UNIQUE` constraint on `orders.stripe_session_id` would reject the duplicate INSERT, making the idempotency guarantee hard at the persistence layer.
- **Cryptographic token generation is correct**: `src/lib/tokens.ts` uses `crypto.randomBytes(32)` for 256-bit entropy, base64url encoding, and `timingSafeEqual` in `tokensEqual()`. The pattern is textbook. The only issue is that `tokensEqual` is not applied to the admin secret (see C3).
- **Stripe webhook signature verification uses the raw body correctly**: `stripe-webhook.ts` calls `c.req.text()` to obtain the unparsed body and passes it directly to `constructEventAsync`. This is the correct approach — any JSON parsing before verification would invalidate signatures.
- **Session token rotation on magic-link verify**: `src/routes/auth.ts:53-56` deletes the short-lived magic-link token and issues a new long-lived session token atomically. This prevents replay of used magic links.
- **SQLite WAL mode + FK enforcement + schema auto-migration on connect**: `src/lib/db.ts` enables `journal_mode = WAL` and `foreign_keys = ON` before applying the schema. WAL mode ensures reads don't block writes during webhook processing. FK enforcement is a compile-time safety net against orphaned rows.
- **HTML injection in emails is prevented**: `src/lib/email.ts` applies `escapeHtml()` to all user-supplied values (`datasetName`, `version`, `accountUrl`) before interpolating into the HTML body.

---

## Pre-Stripe-Live checklist (derived from findings)

- [x] Fix C1: Add `isProd` guards to Stripe/R2 env vars in `src/env.ts` (fail-closed at startup)
- [x] Fix C2: Add `STRIPE_PRICE_BUNDLE` to `src/env.ts` schema with `isProd` required guard
- [x] Fix C3: Replace `!==` admin secret comparison with `constantTimeEqual()` in `src/routes/admin.ts` (both endpoints)
- [x] Fix H1: Add `updates_until > Date.now()` check in `src/routes/download.ts:31`
- [x] Fix H2: Wrap order + entitlement inserts in `db.transaction()` in `src/routes/stripe-webhook.ts`
- [x] Fix H3: Add per-IP rate limit (10s cooldown, Map-based, 10k cap) on `POST /api/auth/magic-link`
- [x] Fix H4: Remove Stripe error details from client responses in `src/routes/checkout.ts`

---

## Recommended next actions

1. **Resolve C1 and C2 together** in a single PR that hardens `src/env.ts` — these are the most impactful changes and have zero risk of regressions. Then trigger a Railway deployment with all required env vars set and verify startup logs show no warnings.
2. **Resolve C3 + H4 together** — add `constantTimeEqual` to `tokens.ts`, apply it in `admin.ts`, and clean up the error response shapes in `checkout.ts`. These are pure hardening with no functional change.
3. **Resolve H1** before the first real customer hits their 360-day renewal window — low urgency in the next 30 days but must be done before the expiry of the earliest purchase.
4. **Resolve H2** (transaction wrapping) and **H3** (rate limiting) in the sprint after launch, within 7 days of going live.
5. **Operator checklist** (not code changes): verify in Stripe Dashboard that the webhook endpoint URL is `https://www.openswissdata.com/api/webhook/stripe`, that only `checkout.session.completed` is subscribed, and that the Live mode webhook secret matches `STRIPE_WEBHOOK_SECRET` in Railway environment variables before flipping the Stripe Live switch.
