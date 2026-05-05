import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getDb } from "./db.js";

/**
 * Event tracking for the /admin dashboard.
 *
 * Privacy model: visitor_hash = SHA256(ip + ua + SESSION_SECRET + day-bucket).
 * The day-bucket suffix means the same IP+UA produces a *different* hash each
 * day — sufficient to count unique visitors over a window without persisting a
 * stable identifier. Aligned with /legal/privacy ("statistiques anonymes").
 *
 * Writes are best-effort and never block the request: we wrap the INSERT in a
 * setImmediate + try/catch so a tracking failure (disk full, schema drift)
 * never breaks the user-facing route.
 */

type EventKind = "api_request" | "custom" | "conversion";

export type TrackArgs = {
  kind: EventKind;
  name?: string | null;
  status?: number | null;
  duration_ms?: number | null;
  customer_id?: number | null;
  visitor_hash?: string | null;
  country?: string | null;
  referer?: string | null;
  ua_class?: string | null;
  meta_json?: string | null;
};

export function track(args: TrackArgs): void {
  setImmediate(() => {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO events (
          kind, name, status, duration_ms, customer_id,
          visitor_hash, country, referer, ua_class, meta_json, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        args.kind,
        args.name ?? null,
        args.status ?? null,
        args.duration_ms ?? null,
        args.customer_id ?? null,
        args.visitor_hash ?? null,
        args.country ?? null,
        args.referer ?? null,
        args.ua_class ?? null,
        args.meta_json ?? null,
        Date.now(),
      );
    } catch (err) {
      // Best-effort tracking — never break the response. We silence
      // SQLITE_CONSTRAINT_* (FK on stale rows from older schemas, CHECK on
      // unknown kind) since those are deterministic and non-actionable; any
      // other error is logged once.
      const code = (err as { code?: string } | undefined)?.code;
      if (typeof code !== "string" || !code.startsWith("SQLITE_CONSTRAINT")) {
        console.warn("[track] insert failed", err);
      }
    }
  });
}

export function visitorHashFromRequest(c: Context): string {
  const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ua = c.req.header("user-agent") ?? "";
  const salt = process.env.SESSION_SECRET ?? "dev-salt";
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}|${ua}|${salt}|${day}`).digest("hex").slice(0, 24);
}

export function countryFromRequest(c: Context): string | null {
  // Cloudflare proxy header (preferred), then Vercel-style, then null.
  return (
    c.req.header("cf-ipcountry") ??
    c.req.header("x-vercel-ip-country") ??
    null
  );
}

export function uaClassFromRequest(c: Context): string {
  const ua = (c.req.header("user-agent") ?? "").toLowerCase();
  if (!ua) return "other";
  if (/bot|crawl|spider|slurp|preview|fetch/.test(ua)) return "bot";
  if (/mobile|android|iphone|ipad/.test(ua)) return "mobile";
  return "desktop";
}

export function refererOrigin(c: Context): string | null {
  const ref = c.req.header("referer") ?? c.req.header("referrer");
  if (!ref) return null;
  try {
    return new URL(ref).origin;
  } catch {
    return null;
  }
}

/**
 * Hono middleware that logs every API request as an event row.
 * Skips: health probes (high frequency, low signal), Stripe webhook (Stripe
 * retries can hammer this), admin routes (don't track our own dashboard hits).
 */
export const trackApiRequest: MiddlewareHandler = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const skip =
    path.startsWith("/api/health") ||
    path.startsWith("/api/admin") ||
    path.startsWith("/api/webhook/") ||
    // Don't double-track: /api/events/track already inserts an event row.
    path.startsWith("/api/events/");
  if (skip) return next();

  const started = Date.now();
  await next();
  const duration_ms = Date.now() - started;

  // c.var.customer_id is set by requireAuth; may be undefined for anon routes.
  // We read defensively because not all routes mount that middleware.
  let customer_id: number | null = null;
  try {
    const v = (c as unknown as { var: { customer_id?: number } }).var.customer_id;
    if (typeof v === "number") customer_id = v;
  } catch {
    customer_id = null;
  }

  track({
    kind: "api_request",
    name: path,
    status: c.res.status,
    duration_ms,
    customer_id,
    visitor_hash: visitorHashFromRequest(c),
    country: countryFromRequest(c),
    referer: refererOrigin(c),
    ua_class: uaClassFromRequest(c),
  });
};
