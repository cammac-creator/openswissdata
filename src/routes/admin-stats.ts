import { Hono } from "hono";
import { getDb } from "../lib/db.js";
import { requireAdmin } from "../lib/admin-middleware.js";

export const adminStatsRoute = new Hono<{
  Variables: { customer_id: number; customer_email: string };
}>();

adminStatsRoute.use("*", requireAdmin);

/**
 * GET /api/admin/stats?days=30
 *
 * Aggregates everything the /admin dashboard needs into one payload:
 *
 *   - Revenue & orders (from `orders`)
 *   - Customers & sessions (`customers`, `sessions`)
 *   - Entitlements per dataset (`entitlements` × `datasets`)
 *   - API traffic, latency, status mix (`events` kind=api_request)
 *   - Custom events & conversions (`events` kind=custom|conversion)
 *   - Top countries, referers, paths
 *   - MCP usage (`mcp_usage`)
 *   - Plausible web stats (visitors/pageviews) if PLAUSIBLE_API_KEY set
 *
 * One round-trip → simpler frontend, simpler caching policy.
 */
adminStatsRoute.get("/", async (c) => {
  const days = clampInt(c.req.query("days"), 1, 365, 30);
  const since = Date.now() - days * 24 * 3600 * 1000;
  const db = getDb();

  // --- Revenue / orders ---
  // Stripe distinguishes test vs live by the session ID prefix:
  //   cs_test_*  → test-mode dashboard (fake money)
  //   cs_live_*  → production (real money)
  // We split the rollup so a pre-launch dashboard isn't drowned in fake revenue.
  const isTest = `stripe_session_id LIKE 'cs_test_%'`;
  const isLive = `stripe_session_id LIKE 'cs_live_%'`;

  const revenue = db.prepare(`
    SELECT
      SUM(CASE WHEN ${isLive} THEN 1 ELSE 0 END)                         AS orders_count,
      COALESCE(SUM(CASE WHEN ${isLive} THEN amount_chf ELSE 0 END),0)    AS revenue_chf,
      COUNT(DISTINCT CASE WHEN ${isLive} THEN customer_id END)           AS paying_customers,
      SUM(CASE WHEN ${isTest} THEN 1 ELSE 0 END)                         AS test_orders_count,
      COALESCE(SUM(CASE WHEN ${isTest} THEN amount_chf ELSE 0 END),0)    AS test_revenue_chf
    FROM orders
    WHERE created_at >= ? AND status = 'paid'
  `).get(since) as {
    orders_count: number; revenue_chf: number; paying_customers: number;
    test_orders_count: number; test_revenue_chf: number;
  };

  const revenueAllTime = db.prepare(`
    SELECT
      SUM(CASE WHEN ${isLive} THEN 1 ELSE 0 END)                         AS orders_count,
      COALESCE(SUM(CASE WHEN ${isLive} THEN amount_chf ELSE 0 END),0)    AS revenue_chf,
      COUNT(DISTINCT CASE WHEN ${isLive} THEN customer_id END)           AS paying_customers,
      SUM(CASE WHEN ${isTest} THEN 1 ELSE 0 END)                         AS test_orders_count,
      COALESCE(SUM(CASE WHEN ${isTest} THEN amount_chf ELSE 0 END),0)    AS test_revenue_chf
    FROM orders
    WHERE status = 'paid'
  `).get() as {
    orders_count: number; revenue_chf: number; paying_customers: number;
    test_orders_count: number; test_revenue_chf: number;
  };

  // Daily revenue for the bar chart — live only (test mode would distort it).
  const revenueDaily = db.prepare(`
    SELECT
      strftime('%Y-%m-%d', datetime(created_at/1000, 'unixepoch')) AS day,
      COUNT(*)              AS orders,
      SUM(amount_chf)       AS revenue_chf
    FROM orders
    WHERE created_at >= ? AND status = 'paid' AND ${isLive}
    GROUP BY day
    ORDER BY day ASC
  `).all(since) as Array<{ day: string; orders: number; revenue_chf: number }>;

  // --- Customers ---
  const customers = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM customers)                                AS total,
      (SELECT COUNT(*) FROM customers WHERE created_at >= ?)          AS new_in_window,
      (SELECT COUNT(*) FROM sessions WHERE expires_at > ?)            AS active_sessions
  `).get(since, Date.now()) as { total: number; new_in_window: number; active_sessions: number };

  // --- Entitlements per dataset ---
  const entitlementsPerDataset = db.prepare(`
    SELECT d.id, d.name, COUNT(e.id) AS count
    FROM datasets d
    LEFT JOIN entitlements e ON e.dataset_id = d.id
    GROUP BY d.id, d.name
    ORDER BY count DESC, d.name ASC
  `).all() as Array<{ id: string; name: string; count: number }>;

  // --- API traffic ---
  const apiTraffic = db.prepare(`
    SELECT
      COUNT(*)                                       AS total_requests,
      COUNT(DISTINCT visitor_hash)                   AS unique_visitors,
      COALESCE(AVG(duration_ms),0)                   AS avg_ms,
      SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS errors_5xx,
      SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) AS errors_4xx
    FROM events
    WHERE kind='api_request' AND ts >= ?
  `).get(since) as {
    total_requests: number;
    unique_visitors: number;
    avg_ms: number;
    errors_5xx: number;
    errors_4xx: number;
  };

  const apiDaily = db.prepare(`
    SELECT
      strftime('%Y-%m-%d', datetime(ts/1000, 'unixepoch')) AS day,
      COUNT(*) AS requests,
      COUNT(DISTINCT visitor_hash) AS visitors
    FROM events
    WHERE kind='api_request' AND ts >= ?
    GROUP BY day
    ORDER BY day ASC
  `).all(since) as Array<{ day: string; requests: number; visitors: number }>;

  const topPaths = db.prepare(`
    SELECT name AS path, COUNT(*) AS hits, COALESCE(AVG(duration_ms),0) AS avg_ms
    FROM events
    WHERE kind='api_request' AND ts >= ?
    GROUP BY name
    ORDER BY hits DESC
    LIMIT 15
  `).all(since) as Array<{ path: string; hits: number; avg_ms: number }>;

  const topCountries = db.prepare(`
    SELECT COALESCE(country,'??') AS country, COUNT(*) AS hits
    FROM events
    WHERE kind='api_request' AND ts >= ?
    GROUP BY country
    ORDER BY hits DESC
    LIMIT 10
  `).all(since) as Array<{ country: string; hits: number }>;

  const topReferers = db.prepare(`
    SELECT COALESCE(referer,'(direct)') AS referer, COUNT(*) AS hits
    FROM events
    WHERE kind='api_request' AND ts >= ?
    GROUP BY referer
    ORDER BY hits DESC
    LIMIT 10
  `).all(since) as Array<{ referer: string; hits: number }>;

  const uaSplit = db.prepare(`
    SELECT COALESCE(ua_class,'other') AS ua, COUNT(*) AS hits
    FROM events
    WHERE kind='api_request' AND ts >= ?
    GROUP BY ua
    ORDER BY hits DESC
  `).all(since) as Array<{ ua: string; hits: number }>;

  // --- Custom events ---
  const customEvents = db.prepare(`
    SELECT name, COUNT(*) AS count
    FROM events
    WHERE kind IN ('custom','conversion') AND ts >= ?
    GROUP BY name
    ORDER BY count DESC
    LIMIT 20
  `).all(since) as Array<{ name: string; count: number }>;

  // --- MCP usage ---
  let mcpUsage: Array<Record<string, unknown>> = [];
  try {
    mcpUsage = db.prepare(`
      SELECT
        client_id,
        day_count,
        month_count,
        total_count,
        updated_at
      FROM mcp_usage
      ORDER BY total_count DESC
      LIMIT 20
    `).all() as Array<Record<string, unknown>>;
  } catch {
    // mcp_usage may not exist yet on a brand-new DB; ignore.
    mcpUsage = [];
  }

  // --- Plausible (optional, server-side fetch) ---
  const plausible = await fetchPlausibleStats(days);

  return c.json({
    ok: true,
    window: { days, since_iso: new Date(since).toISOString() },
    revenue,
    revenueAllTime,
    revenueDaily,
    customers,
    entitlementsPerDataset,
    apiTraffic,
    apiDaily,
    topPaths,
    topCountries,
    topReferers,
    uaSplit,
    customEvents,
    mcpUsage,
    plausible,
  });
});

function clampInt(v: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return Math.floor(n);
}

type PlausibleStats =
  | { available: false; reason: string }
  | {
      available: true;
      site: string;
      visitors: number;
      pageviews: number;
      bounce_rate: number;
      visit_duration: number;
      top_sources: Array<{ source: string; visitors: number }>;
      top_pages: Array<{ page: string; visitors: number }>;
      top_countries: Array<{ country: string; visitors: number }>;
    };

async function fetchPlausibleStats(days: number): Promise<PlausibleStats> {
  const key = process.env.PLAUSIBLE_API_KEY;
  const site = process.env.PLAUSIBLE_SITE_ID ?? "openswissdata.com";
  if (!key) return { available: false, reason: "no_api_key" };

  const period = `${days}d`;
  const headers = { Authorization: `Bearer ${key}` };
  const base = "https://plausible.io/api/v1/stats";

  // 5 s cap so a slow Plausible doesn't hang the dashboard.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);

  try {
    const aggregateUrl = `${base}/aggregate?site_id=${encodeURIComponent(site)}&period=${period}&metrics=visitors,pageviews,bounce_rate,visit_duration`;
    const sourcesUrl = `${base}/breakdown?site_id=${encodeURIComponent(site)}&period=${period}&property=visit:source&limit=10`;
    const pagesUrl = `${base}/breakdown?site_id=${encodeURIComponent(site)}&period=${period}&property=event:page&limit=10`;
    const countriesUrl = `${base}/breakdown?site_id=${encodeURIComponent(site)}&period=${period}&property=visit:country&limit=10`;

    const [aggRes, srcRes, pgRes, ctyRes] = await Promise.all([
      fetch(aggregateUrl, { headers, signal: ctrl.signal }),
      fetch(sourcesUrl, { headers, signal: ctrl.signal }),
      fetch(pagesUrl, { headers, signal: ctrl.signal }),
      fetch(countriesUrl, { headers, signal: ctrl.signal }),
    ]);

    if (!aggRes.ok) {
      return { available: false, reason: `plausible_${aggRes.status}` };
    }
    const agg = (await aggRes.json()) as {
      results: {
        visitors: { value: number };
        pageviews: { value: number };
        bounce_rate: { value: number };
        visit_duration: { value: number };
      };
    };
    const sources = srcRes.ok
      ? ((await srcRes.json()) as { results: Array<{ source: string; visitors: number }> }).results
      : [];
    const pages = pgRes.ok
      ? ((await pgRes.json()) as { results: Array<{ page: string; visitors: number }> }).results
      : [];
    const countries = ctyRes.ok
      ? ((await ctyRes.json()) as { results: Array<{ country: string; visitors: number }> }).results
      : [];

    return {
      available: true,
      site,
      visitors: agg.results.visitors.value,
      pageviews: agg.results.pageviews.value,
      bounce_rate: agg.results.bounce_rate.value,
      visit_duration: agg.results.visit_duration.value,
      top_sources: sources,
      top_pages: pages,
      top_countries: countries,
    };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : "plausible_error" };
  } finally {
    clearTimeout(timer);
  }
}
