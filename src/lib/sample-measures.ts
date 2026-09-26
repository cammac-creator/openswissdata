import type Database from 'better-sqlite3';
import type { MiddlewareHandler } from 'hono';
import type { CrmPeriod } from './crm-period.js';
import { EVENT_RETENTION_DAYS, EVENT_RETENTION_MS } from './event-retention.js';
import { track, uaClassFromRequest, visitorHashFromRequest } from './track.js';
import { reportEventFailure } from './event-budget.js';

export const SAMPLE_DATASETS = ['finma', 'tares', 'classifications'] as const;
type SampleDataset = typeof SAMPLE_DATASETS[number];
export type SampleCounts = {
  requests: number;
  browser_requests: number;
  browser_visitor_days: number | null;
  unidentified_browser_requests: number;
  bot_requests: number;
  automation_requests: number;
  unclassified_requests: number;
};
export type SampleMeasures = {
  total: SampleCounts;
  products: Array<SampleCounts & { dataset: SampleDataset }>;
  first_retained_event: number | null;
  retained_since: number;
  effective_since: number;
  retention_days: number;
};

/** Réponse préparée par le serveur, sans déduire sa réception ni une présence humaine. */
export const trackSampleResponse: MiddlewareHandler = async (c, next) => {
  await next();
  try {
    if (c.req.method !== 'GET' || c.res.status !== 200 || c.req.query('format') !== 'csv'
      || c.res.headers.get('content-type')?.split(';')[0].trim() !== 'text/csv') return;
    const dataset = SAMPLE_DATASETS.find(id => c.req.path === `/api/catalog/${id}`);
    if (!dataset) return;
    const now = Date.now();
    track({
      kind: 'conversion', origin: 'server', name: 'sample_served', status: 200,
      visitor_hash: visitorHashFromRequest(c, now), ua_class: uaClassFromRequest(c),
      meta_json: JSON.stringify({ schema: 1, dataset }),
    }, now);
  } catch {
    // Une erreur de préparation des mesures ne remplace jamais le CSV déjà construit.
    reportEventFailure();
  }
};

/** Agrégats privés uniquement. La première trace conservée n'est pas une date d'activation. */
export function readSampleMeasures(db: Database.Database, period: CrmPeriod, now: number): SampleMeasures {
  const retainedSince = now - EVENT_RETENTION_MS;
  const since = Math.max(period.start_at, retainedSince), until = Math.min(period.end_at, now + 1);
  const safeMeta = "CASE WHEN json_valid(meta_json) THEN meta_json ELSE '{}' END";
  const validMeta = (meta: string) => `json_type(${meta})='object' AND json_type(${meta},'$.schema')='integer'
    AND json_extract(${meta},'$.schema')=1 AND json_extract(${meta},'$.dataset') IN ('finma','tares','classifications')`;
  // L’index permet de s’arrêter à la première trace valide, sans matérialiser 180 jours.
  const first = db.prepare(`SELECT ts FROM events WHERE name='sample_served' AND kind='conversion'
    AND origin='server' AND status=200 AND typeof(ts)='integer' AND ts>=? AND ts<?
    AND ${validMeta(safeMeta)} ORDER BY ts LIMIT 1`).get(retainedSince, now + 1) as { ts: number } | undefined;
  // Le CASE protège aussi les appels JSON quand une ancienne ligne est altérée.
  const rows = db.prepare(`WITH candidates AS MATERIALIZED (
    SELECT ts, ua_class, visitor_hash, ${safeMeta} meta
    FROM events WHERE name='sample_served' AND kind='conversion' AND origin='server' AND status=200
      AND typeof(ts)='integer' AND ts>=? AND ts<?
  ), valid AS MATERIALIZED (
    SELECT ts, ua_class, visitor_hash, json_extract(meta,'$.dataset') dataset FROM candidates
    WHERE ${validMeta('meta')}
  ), scoped AS MATERIALIZED (
    SELECT *, ua_class IN ('desktop','mobile') browser,
      CASE WHEN ua_class IN ('desktop','mobile') AND length(visitor_hash)=27
        AND substr(visitor_hash,1,3)='v2:' AND substr(visitor_hash,4) NOT GLOB '*[^0-9a-f]*'
        THEN visitor_hash END identity
    FROM valid
  ), grouped AS (
    SELECT dataset, COUNT(*) requests, COALESCE(SUM(browser),0) browser_requests,
      COUNT(DISTINCT identity) browser_visitor_days,
      COALESCE(SUM(browser AND identity IS NULL),0) unidentified_browser_requests,
      COALESCE(SUM(ua_class='bot'),0) bot_requests,
      COALESCE(SUM(ua_class='automation'),0) automation_requests,
      COALESCE(SUM(ua_class IS NULL OR ua_class NOT IN ('desktop','mobile','bot','automation')),0) unclassified_requests
    FROM scoped GROUP BY dataset
    UNION ALL
    SELECT 'total', COUNT(*), COALESCE(SUM(browser),0), COUNT(DISTINCT identity),
      COALESCE(SUM(browser AND identity IS NULL),0), COALESCE(SUM(ua_class='bot'),0),
      COALESCE(SUM(ua_class='automation'),0),
      COALESCE(SUM(ua_class IS NULL OR ua_class NOT IN ('desktop','mobile','bot','automation')),0) FROM scoped
  ) SELECT * FROM grouped`)
    .all(since, until) as Array<SampleCounts & { dataset: string }>;
  const counts = (dataset: string): SampleCounts => {
    const row = rows.find(r => r.dataset === dataset);
    if (!row) return { requests: 0, browser_requests: 0, browser_visitor_days: 0, unidentified_browser_requests: 0, bot_requests: 0, automation_requests: 0, unclassified_requests: 0 };
    return {
      requests: row.requests, browser_requests: row.browser_requests,
      browser_visitor_days: row.browser_requests > 0 && row.browser_visitor_days === 0 ? null : row.browser_visitor_days,
      unidentified_browser_requests: row.unidentified_browser_requests,
      bot_requests: row.bot_requests, automation_requests: row.automation_requests, unclassified_requests: row.unclassified_requests,
    };
  };
  return {
    total: counts('total'), products: SAMPLE_DATASETS.map(dataset => ({ dataset, ...counts(dataset) })),
    first_retained_event: first?.ts ?? null,
    retained_since: retainedSince, effective_since: since, retention_days: EVENT_RETENTION_DAYS,
  };
}
