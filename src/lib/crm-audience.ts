import type Database from 'better-sqlite3';
import { periodRanges, type CrmPeriod } from './crm-period.js';
import { EVENT_RETENTION_DAYS, EVENT_RETENTION_MS } from './event-retention.js';
import { readEventCoverage } from './event-budget.js';

export function readCrmAudience(db: Database.Database, period: CrmPeriod, details = true) {
  const retainedSince = period.end_at - 1 - EVENT_RETENTION_MS;
  const since = Math.max(period.start_at, retainedSince), until = period.end_at;
  const collection = readEventCoverage(db, until - 1, since, until);
  const incompleteDays = new Set(collection.gaps.map(g => g.day));
  const first = (db.prepare("SELECT MIN(ts) AS first_event FROM events WHERE kind='custom' AND name='page_view' AND origin IN ('server','legacy') AND ts>=? AND ts<?")
    .get(retainedSince, until) as { first_event: number | null }).first_event;
  const dayQuery = db.prepare("SELECT COUNT(*) views,COUNT(DISTINCT visitor_hash) visitors FROM events WHERE kind='custom' AND name='page_view' AND origin IN ('server','legacy') AND ua_class IN ('desktop','mobile') AND ts>=? AND ts<?");
  const daily = periodRanges(period).map(range => {
    const start = Math.max(range.start, since);
    const incomplete = incompleteDays.has(range.day);
    if (first === null || range.end <= first || range.end <= start) return { day: range.day, views: null, visitors: null, partial: false, incomplete };
    const counts = dayQuery.get(start, range.end) as { views: number; visitors: number };
    return { day: range.day, ...counts, partial: range.start < Math.max(first, since) || range.day === period.end, incomplete };
  });
  const traffic = db.prepare("SELECT COUNT(*) requests,COALESCE(ROUND(AVG(duration_ms)),0) average_ms,COALESCE(SUM(status>=500),0) errors FROM events WHERE kind='api_request' AND origin IN ('server','legacy') AND ts>=? AND ts<?").get(since, until);
  const groups = (column: string) => details ? db.prepare(`SELECT COALESCE(${column},'inconnu') label,COUNT(*) count FROM events WHERE name='page_view' AND kind='custom' AND origin IN ('server','legacy') AND ua_class IN ('desktop','mobile') AND ts>=? AND ts<? GROUP BY label ORDER BY count DESC LIMIT 12`).all(since, until) : [];
  const split = details ? db.prepare("SELECT COALESCE(ua_class,'inconnu') label,COUNT(*) count FROM events WHERE name='page_view' AND kind='custom' AND origin IN ('server','legacy') AND ts>=? AND ts<? GROUP BY label ORDER BY count DESC").all(since, until) : [];
  const api = details ? db.prepare("SELECT COALESCE(ua_class,'inconnu') label,COUNT(*) count FROM events WHERE kind='api_request' AND origin IN ('server','legacy') AND ts>=? AND ts<? GROUP BY label ORDER BY count DESC").all(since, until) : [];
  const actions = details ? db.prepare("SELECT name label,origin,COUNT(*) count FROM events WHERE kind IN ('custom','conversion') AND name NOT IN ('page_view','mcp_tool_call') AND ts>=? AND ts<? GROUP BY name,origin ORDER BY count DESC LIMIT 15").all(since, until) : [];
  const pageOrigins = details ? db.prepare("SELECT origin label,COUNT(*) count FROM events WHERE kind='custom' AND name='page_view' AND origin IN ('server','legacy') AND ua_class IN ('desktop','mobile') AND ts>=? AND ts<? GROUP BY origin").all(since, until) : [];
  return {
    period, daily, traffic, collection, page_origins: pageOrigins,
    web: { pageviews: daily.reduce((s, d) => s + (d.views ?? 0), 0), visitor_days: daily.reduce((s, d) => s + (d.visitors ?? 0), 0) },
    coverage: { first_event: first, retained_since: retainedSince, effective_since: since, retention_days: EVENT_RETENTION_DAYS },
    pages: groups("json_extract(meta_json,'$.path')"), sources: groups('referer'), countries: groups("CASE WHEN length(country)=2 AND upper(country) GLOB '[A-Z][A-Z]' THEN upper(country) END"), split, api, actions,
  };
}
