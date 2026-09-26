import { createHmac } from 'node:crypto';
import type { Context } from 'hono';
import { trustedRequestIp } from './request-ip.js';
import { swissDay } from './crm-period.js';

/** Pseudonyme quotidien : aucune adresse ou chaîne de navigateur brute n’est retournée. */
export function visitorHashFromRequest(c: Context, timestamp = Date.now()): string | null {
  try {
    const ip = trustedRequestIp(c), ua = c.req.header('user-agent') ?? '', secret = process.env.SESSION_SECRET;
    if (!ip || !ua.trim() || ua.length > 1024 || !Number.isSafeInteger(timestamp) || timestamp < 0) return null;
    const local = !process.env.RAILWAY_ENVIRONMENT_ID && ['development', 'test'].includes(process.env.NODE_ENV ?? '');
    if ((!secret || secret.length < 16) && !local) return null;
    const key = secret && secret.length >= 16 ? secret : 'osd-local-visitors-development-only';
    return 'v2:' + createHmac('sha256', key).update('openswissdata:visitor:v2:').update(JSON.stringify([swissDay(timestamp), ip, ua])).digest('hex').slice(0, 24);
  } catch { return null; }
}
