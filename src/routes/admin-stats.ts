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
  // Exclude mcp_tool_call: it has its own dedicated gate blocks below and would
  // otherwise saturate this top-20 and bury the real cta_* conversion events.
  const customEvents = db.prepare(`
    SELECT name, COUNT(*) AS count
    FROM events
    WHERE kind IN ('custom','conversion') AND name <> 'mcp_tool_call' AND ts >= ?
    GROUP BY name
    ORDER BY count DESC
    LIMIT 20
  `).all(since) as Array<{ name: string; count: number }>;

  // --- MCP kill-gate metrics (FIXED 7-day window, independent of ?days) ---
  // The Sept 15 2026 gate: ~20 human MCP calls/week (excl. bots), 0 third-party
  // paying clients, <10 GSC clicks/week (GSC = manual, not measurable here).
  const since7d = Date.now() - 7 * 24 * 3600 * 1000;

  // (a) Human MCP tool calls over 7d. ONLY `human_authenticated` (valid OAuth
  //     bearer, non-admin) counts — anonymous UA-based classes are spoofable
  //     (curl -A "claude") and must not inflate the gate (the "117" mistake).
  //     Excludes the admin bypass (Claude-Alain) via meta_json.admin.
  const mcpHuman7d = db.prepare(`
    SELECT
      COUNT(*)                                              AS human_calls,
      COUNT(DISTINCT json_extract(meta_json,'$.client_id')) AS distinct_clients
    FROM events
    WHERE kind='custom' AND name='mcp_tool_call' AND ts >= ?
      AND ua_class = 'human_authenticated'
      AND COALESCE(json_extract(meta_json,'$.admin'), 0) = 0
  `).get(since7d) as { human_calls: number; distinct_clients: number };

  // (b) Full caller-class split over 7d (diagnostic: signal vs noise ratio).
  const mcpCallerSplit = db.prepare(`
    SELECT COALESCE(ua_class,'unknown') AS caller_class, COUNT(*) AS calls
    FROM events
    WHERE kind='custom' AND name='mcp_tool_call' AND ts >= ?
    GROUP BY caller_class
    ORDER BY calls DESC
  `).all(since7d) as Array<{ caller_class: string; calls: number }>;

  // (c) Real third-party paying MCP clients: live Stripe subscriptions, excluding
  //     Claude-Alain's own test subs (ADMIN_EMAILS). Subs live in mcp_clients,
  //     NOT orders (which are one-shot ZIP purchases). try/catch: the
  //     stripe_subscription_id column is absent on a pre-P0-1 database.
  let mcpPaying = { paying_clients: 0, mrr_chf: 0, measured: true };
  try {
    // Lower-cased for a case-insensitive exclusion (requireAdmin normalises
    // emails to lowercase; mcp_clients.email casing may differ).
    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const emailFilter = adminEmails.length
      ? `AND lower(email) NOT IN (${adminEmails.map(() => "?").join(",")})`
      : "";
    const row = db.prepare(`
      SELECT
        COUNT(*)                       AS paying_clients,
        COALESCE(SUM(CASE
          WHEN tier='business'   THEN 199
          WHEN tier IN ('standalone','pro') THEN 49
          ELSE 0 END), 0)              AS mrr_chf
      FROM mcp_clients
      WHERE revoked_at IS NULL
        AND stripe_subscription_id IS NOT NULL
        AND tier IN ('standalone','pro','business')
        ${emailFilter}
    `).get(...adminEmails) as { paying_clients: number; mrr_chf: number };
    mcpPaying = { ...row, measured: true };
  } catch (err) {
    // Only the pre-P0-1 "missing column" case is expected & silent. Anything
    // else is a real measurement failure: log it and flag measured=false so a
    // SQL error can't masquerade as a confident "0 paying" (a fake gate PASS).
    const msg = err instanceof Error ? err.message : String(err);
    if (!/no such column: stripe_subscription_id/.test(msg)) {
      console.warn("[admin-stats] mcpPaying query failed", err);
      mcpPaying = { paying_clients: 0, mrr_chf: 0, measured: false };
    }
  }

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
    mcpHuman7d,
    mcpCallerSplit,
    mcpPaying,
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
