import { Hono } from "hono";
import { z } from "zod";
import {
  track,
  visitorHashFromRequest,
  countryFromRequest,
  uaClassFromRequest,
  refererOrigin,
} from "../lib/track.js";

export const eventsRoute = new Hono();

const Body = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9_.\-:]+$/i),
  kind: z.enum(["custom", "conversion"]).default("custom"),
  meta: z.record(z.unknown()).optional(),
});

// Caps to keep meta_json bounded — stops a hostile client from filling the DB.
const MAX_META_BYTES = 2048;

// Per-IP token bucket: 60 events / 60 s. Capped at 10k IPs (oldest evicted).
// Without this a script can fill the events table arbitrarily fast since the
// endpoint is unauthenticated by design (front-end CTA tracking).
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 60;
const RATE_MAX_ENTRIES = 10_000;
type Bucket = { count: number; windowStart: number };
const rateMap = new Map<string, Bucket>();

function rateLimitIp(c: { req: { header: (n: string) => string | undefined } }): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

eventsRoute.post("/track", async (c) => {
  // Rate limit before parsing body so a flood is cheap to reject.
  const ip = rateLimitIp(c);
  const now = Date.now();
  let bucket = rateMap.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    rateMap.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX_PER_WINDOW) {
    return c.json({ error: "too_many_requests" }, 429);
  }
  if (rateMap.size > RATE_MAX_ENTRIES) {
    const oldest = rateMap.keys().next().value;
    if (oldest !== undefined) rateMap.delete(oldest);
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await c.req.json());
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }

  let meta_json: string | null = null;
  if (body.meta) {
    const s = JSON.stringify(body.meta);
    if (s.length > MAX_META_BYTES) {
      return c.json({ error: "meta_too_large" }, 413);
    }
    meta_json = s;
  }

  track({
    kind: body.kind,
    name: body.name,
    visitor_hash: visitorHashFromRequest(c),
    country: countryFromRequest(c),
    referer: refererOrigin(c),
    ua_class: uaClassFromRequest(c),
    meta_json,
  });

  return c.json({ ok: true });
});
