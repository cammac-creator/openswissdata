import type Database from 'better-sqlite3';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { CrmPeriod } from './crm-period.js';
import { EVENT_RETENTION_DAYS, EVENT_RETENTION_MS } from './event-retention.js';
import { reportEventFailure } from './event-budget.js';
import { track, uaClassFromRequest, visitorHashFromRequest } from './track.js';

export const CHECKOUT_BASKETS = ['finma', 'tares', 'classifications', 'bundle', 'mixed'] as const;
const locales = ['fr', 'de', 'en'] as const;
type Basket = typeof CHECKOUT_BASKETS[number];
type Locale = typeof locales[number];
export type CheckoutObservation = { basket: Basket; locale: Locale };
type Counts = {
  sessions: number; browser_sessions: number; browser_visitor_days: number | null;
  unidentified_browser_sessions: number; bot_sessions: number; automation_sessions: number; unclassified_sessions: number;
};
export type CheckoutMeasures = {
  total: Counts;
  baskets: Array<Counts & { basket: Basket }>;
  locales: Array<{ locale: Locale; sessions: number }>;
  entries: Array<{ entry: 'form' | 'api'; sessions: number }>;
  first_retained_event: number | null; effective_since: number; retention_days: number;
};

function reportFailureSafely(): void {
  try { reportEventFailure(); }
  catch { /* Même un diagnostic défaillant ne doit pas interrompre un paiement déjà préparé. */ }
}

/** L’identifiant Stripe est seulement inspecté, jamais conservé dans la mesure. */
export function checkoutObservation(session: Stripe.Checkout.Session, ids: string[], locale: string): CheckoutObservation | null {
  try {
    if (session.livemode !== true || session.mode !== 'payment' || typeof session.id !== 'string'
      || !session.id.startsWith('cs_live_') || session.id.length <= 8
      || typeof session.url !== 'string' || !session.url.startsWith('https://')
      || !locales.includes(locale as Locale) || !ids.length || ids.length > 4
      || ids.some(id => !['finma', 'tares', 'classifications', 'bundle'].includes(id))) return null;
    const unique = [...new Set(ids)];
    if (unique.includes('bundle') && unique.length > 1) return null;
    return { basket: unique.length > 1 ? 'mixed' : unique[0] as Basket, locale: locale as Locale };
  } catch { reportFailureSafely(); return null; }
}

export function recordCheckoutCreated(c: Context, observation: CheckoutObservation | null, entry: 'form' | 'api'): void {
  if (!observation) return;
  try {
    const now = Date.now();
    track({
      kind: 'conversion', origin: 'server', name: 'checkout_started', status: entry === 'form' ? 303 : 200,
      visitor_hash: visitorHashFromRequest(c, now), ua_class: uaClassFromRequest(c),
      meta_json: JSON.stringify({ schema: 1, livemode: true, basket: observation.basket, locale: observation.locale, entry }),
    }, now);
  } catch { reportFailureSafely(); }
}

/** Créations observées, sans relier une visite, un panier ou une vente à une personne. */
export function readCheckoutMeasures(db: Database.Database, period: CrmPeriod, now: number): CheckoutMeasures {
  const retainedSince = now - EVENT_RETENTION_MS;
  const since = Math.max(period.start_at, retainedSince), until = Math.min(period.end_at, now + 1);
  const safeMeta = "CASE WHEN json_valid(meta_json) THEN meta_json ELSE '{}' END";
  const validMeta = (meta: string) => `json_type(${meta})='object' AND json_type(${meta},'$.schema')='integer'
    AND json_extract(${meta},'$.schema')=1 AND json_type(${meta},'$.livemode')='true'
    AND json_extract(${meta},'$.basket') IN ('finma','tares','classifications','bundle','mixed')
    AND json_extract(${meta},'$.locale') IN ('fr','de','en')
    AND ((status=200 AND json_extract(${meta},'$.entry')='api') OR (status=303 AND json_extract(${meta},'$.entry')='form'))`;
  const filter = "name='checkout_started' AND kind='conversion' AND origin='server' AND typeof(ts)='integer' AND ts>=? AND ts<?";
  const first = db.prepare(`SELECT ts FROM events WHERE ${filter} AND ${validMeta(safeMeta)} ORDER BY ts LIMIT 1`)
    .get(retainedSince, now + 1) as { ts: number } | undefined;
  const countsSql = `COUNT(*) sessions, COALESCE(SUM(browser),0) browser_sessions,
    COUNT(DISTINCT identity) browser_visitor_days,
    COALESCE(SUM(browser AND identity IS NULL),0) unidentified_browser_sessions,
    COALESCE(SUM(ua_class='bot'),0) bot_sessions, COALESCE(SUM(ua_class='automation'),0) automation_sessions,
    COALESCE(SUM(ua_class IS NULL OR ua_class NOT IN ('desktop','mobile','bot','automation')),0) unclassified_sessions`;
  const rows = db.prepare(`WITH candidates AS MATERIALIZED (
    SELECT status, ua_class, visitor_hash, ${safeMeta} meta FROM events WHERE ${filter}
  ), valid AS MATERIALIZED (
    SELECT ua_class, visitor_hash, json_extract(meta,'$.basket') basket,
      json_extract(meta,'$.locale') locale, json_extract(meta,'$.entry') entry
    FROM candidates WHERE ${validMeta('meta')}
  ), scoped AS MATERIALIZED (
    SELECT *, ua_class IN ('desktop','mobile') browser,
      CASE WHEN ua_class IN ('desktop','mobile') AND length(visitor_hash)=27
        AND substr(visitor_hash,1,3)='v2:' AND substr(visitor_hash,4) NOT GLOB '*[^0-9a-f]*'
        THEN visitor_hash END identity FROM valid
  ) SELECT 'total' grouping, 'total' label, ${countsSql} FROM scoped
    ${['basket', 'locale', 'entry'].map(key => `UNION ALL SELECT '${key}', ${key}, ${countsSql} FROM scoped GROUP BY ${key}`).join('\n')}`)
    .all(since, until) as Array<Counts & { grouping: string; label: string }>;
  const counts = (grouping: string, label: string): Counts => {
    const row = rows.find(r => r.grouping === grouping && r.label === label);
    if (!row) return { sessions: 0, browser_sessions: 0, browser_visitor_days: 0, unidentified_browser_sessions: 0, bot_sessions: 0, automation_sessions: 0, unclassified_sessions: 0 };
    return { sessions: row.sessions, browser_sessions: row.browser_sessions,
      browser_visitor_days: row.browser_sessions > 0 && row.browser_visitor_days === 0 ? null : row.browser_visitor_days,
      unidentified_browser_sessions: row.unidentified_browser_sessions, bot_sessions: row.bot_sessions,
      automation_sessions: row.automation_sessions, unclassified_sessions: row.unclassified_sessions };
  };
  return {
    total: counts('total', 'total'), baskets: CHECKOUT_BASKETS.map(basket => ({ basket, ...counts('basket', basket) })),
    locales: locales.map(locale => ({ locale, sessions: counts('locale', locale).sessions })),
    entries: (['form', 'api'] as const).map(entry => ({ entry, sessions: counts('entry', entry).sessions })),
    first_retained_event: first?.ts ?? null, effective_since: since, retention_days: EVENT_RETENTION_DAYS,
  };
}
