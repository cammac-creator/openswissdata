import { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { authRequestIp } from '../lib/auth-limits.js';
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
}).strict();

// Limiter le corps et les métadonnées avant tout stockage.
const MAX_META_BYTES = 2048;

// Fenêtre fixe : 60 déclarations par minute et origine du proxy, en mémoire.
// Limite locale au processus, pas une protection durable ou distribuée.
// Les statistiques restent déclaratives même si cette limite est respectée.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 60;
const RATE_MAX_ENTRIES = 10_000;
type Bucket = { count: number; windowStart: number };
const rateMap = new Map<string, Bucket>();
const reserved = new Set(['page_view', 'mcp_tool_call', 'checkout_started', 'payment_paid', 'delivery_sent', 'download_authorized']);
eventsRoute.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
eventsRoute.use('*', bodyLimit({ maxSize: 4096, onError: c => c.json({ error: 'body_too_large' }, 413) }));

eventsRoute.post("/track", async (c) => {
  // Refuser les demandes trop nombreuses avant de décoder le JSON.
  const ip = authRequestIp(c);
  const now = Date.now();
  let bucket = rateMap.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
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
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    return c.json({ error: "invalid_body" }, 400);
  }
  if (reserved.has(body.name.toLowerCase()) || body.name.toLowerCase().startsWith('server.')) return c.json({ error: 'reserved_event' }, 400);

  let meta_json: string | null = null;
  if (body.meta) {
    const s = JSON.stringify(body.meta);
    if (Buffer.byteLength(s, 'utf8') > MAX_META_BYTES) {
      return c.json({ error: "meta_too_large" }, 413);
    }
    meta_json = s;
  }

  const recordedAt = Date.now();
  track({
    kind: body.kind,
    origin: 'client',
    name: body.name,
    visitor_hash: visitorHashFromRequest(c, recordedAt),
    country: countryFromRequest(c),
    referer: refererOrigin(c),
    ua_class: uaClassFromRequest(c),
    meta_json,
  }, recordedAt);

  return c.json({ ok: true });
});
