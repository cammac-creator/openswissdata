import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getDb } from "./db.js";
import { queueEvent, reportEventFailure } from "./event-budget.js";

/**
 * Mesures du bureau : l’origine décrit qui a enregistré la trace.
 * « server » atteste une observation applicative, pas la présence d’un humain.
 * Les identifiants temporaires sont pseudonymes et tournent encore à minuit UTC.
 * L’écriture différée reste facultative ; une panne de mesure ne bloque pas le service.
 */

export type { TrackArgs } from './event-types.js';
import type { TrackArgs } from './event-types.js';

export function track(args: TrackArgs): void {
  try { queueEvent(getDb(), args, Date.now()); }
  catch { reportEventFailure(); }
}

export function visitorHashFromRequest(c: Context): string {
  const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ua = c.req.header("user-agent") ?? "";
  const salt = process.env.SESSION_SECRET ?? "dev-salt";
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}|${ua}|${salt}|${day}`).digest("hex").slice(0, 24);
}

export function countryFromRequest(c: Context): string | null {
  // Valeur déclarée et bornée, pas une géolocalisation vérifiée par l’application.
  const country = c.req.header('cf-ipcountry') ?? c.req.header('x-vercel-ip-country');
  return country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null;
}

export function uaClassFromRequest(c: Context): string {
  const raw = c.req.header("user-agent") ?? '';
  if (!raw || raw.length > 1024) return 'other';
  const ua = raw.toLowerCase();
  if (/bot|crawl|spider|slurp|preview|fetch/.test(ua)) return "bot";
  if (/curl|wget|python|node|postman|httpie|go-http|headless|scanner|okhttp|dalvik|libwww|httpclient/.test(ua)) return "automation";
  // La présence d’un nom de navigateur reste une déclaration, jamais une preuve humaine.
  const browser = /mozilla\//.test(ua) && (/(firefox|fxios|chrome|crios|edg|edga|edgios|opr)\/[\d.]+/.test(ua) || (/version\/[\d.]+/.test(ua) && /safari\/[\d.]+/.test(ua)) || /trident\/[\d.]+/.test(ua));
  if (!browser) return 'other';
  if (/mobile|android|iphone|ipad/.test(ua)) return "mobile";
  return "desktop";
}

export function refererOrigin(c: Context): string | null {
  const ref = c.req.header("referer") ?? c.req.header("referrer");
  if (!ref || ref.length > 2048) return null;
  try {
    const url = new URL(ref);
    return ['https:', 'http:'].includes(url.protocol) && Buffer.byteLength(url.origin, 'utf8') <= 255 ? url.origin : null;
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
  const duration_ms = Math.max(0, Date.now() - started);

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
    origin: 'server',
    // Un lien de livraison porte un droit d'accès ; seul le type de route est mesuré.
    name: path.replace(/^\/api\/(download|delivery)\/.*/, "/api/$1/:token"),
    status: c.res.status,
    duration_ms,
    customer_id,
    visitor_hash: visitorHashFromRequest(c),
    country: countryFromRequest(c),
    referer: refererOrigin(c),
    ua_class: uaClassFromRequest(c),
  });
};

// Pages publiques servies : mesure séparée des appels API, sans paramètres d'URL.
// Les identifiants tournent chaque jour : il s'agit de visiteurs-jours estimés.
export const trackPageView: MiddlewareHandler = async (c, next) => {
  await next();
  const path = new URL(c.req.url).pathname;
  if (c.req.method !== "GET" || c.res.status !== 200 || !c.res.headers.get("content-type")?.includes("text/html")) return;
  if (/^\/(api|admin|account|_astro)(\/|$)/.test(path) || /^\/(en|de)\/account/.test(path)) return;
  const referer = refererOrigin(c);
  const own = referer && /\/(www\.)?openswissdata\.com$/.test(referer);
  track({ kind: "custom", name: "page_view", origin: 'server', visitor_hash: visitorHashFromRequest(c), ua_class: uaClassFromRequest(c), country: countryFromRequest(c), referer: own ? null : referer, meta_json: JSON.stringify({ path }) });
};
