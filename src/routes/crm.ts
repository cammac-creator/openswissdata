import { orderLegalSummary } from "../lib/order-legal.js";
import { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import { getDb } from "../lib/db.js";
import { requireAdmin } from "../lib/admin-middleware.js";
import { cached, sourceJson, searchConsole } from "../lib/crm-source.js";
import { customerLanguage, setCustomerLanguage } from "../lib/crm-language.js";
import { isLanguage } from "../lib/languages.js";
import { crmMailRoute } from "./crm-mail.js";
import { deliveryStatus } from "../lib/order-delivery.js";
import { financialStatus } from "../lib/stripe-financial.js";

export const crmRoute = new Hono<{ Variables: { customer_id: number; customer_email: string } }>();
crmRoute.use("*", requireAdmin);
crmRoute.use("*", bodyLimit({ maxSize: 16_384, onError: c => c.json({ error: "body_too_large" }, 413) }));
crmRoute.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  if (!["GET", "HEAD"].includes(c.req.method)) {
    // Les écritures sont réservées à l'interface de même origine ; aucun secret dans le navigateur.
    const expected = new URL(process.env.BASE_URL ?? c.req.url).origin;
    if (c.req.header("origin") !== expected || c.req.header("x-osd-csrf") !== "dashboard" || !c.req.header("content-type")?.startsWith("application/json")) return c.json({ error: "origin_forbidden" }, 403);
    if (Number(c.req.header("content-length") ?? 0) > 16_384) return c.json({ error: "body_too_large" }, 413);
  }
  await next();
});
const daysOf = (v?: string) => [7, 30, 90, 365].includes(Number(v)) ? Number(v) : 30;
const validId = (v: string) => /^\d{1,10}$/.test(v) && Number(v) > 0;
const internalEmails = () => [...new Set(`${process.env.ADMIN_EMAILS ?? ""},${process.env.CRM_INTERNAL_EMAILS ?? ""}`.split(",").map(s => s.trim().toLowerCase()).filter(Boolean))];
export function realCustomerSql(alias = "c"): { sql: string; params: string[] } {
  const emails = internalEmails();
  return { sql: `COALESCE(p.internal,0)=0${emails.length ? ` AND lower(${alias}.email) NOT IN (${emails.map(() => "?").join(",")})` : ""}`, params: emails };
}
function profiles(id?: number) {
  const db = getDb();
  const rows = db.prepare(`SELECT c.id,c.email,c.locale,c.created_at,COALESCE(p.display_name,'') display_name,COALESCE(p.company,'') company,COALESCE(p.stage,'nouveau') stage,COALESCE(p.internal,0) internal,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.status='paid' AND o.stripe_session_id LIKE 'cs_live_%') paid_orders,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.stripe_session_id LIKE 'cs_test_%') test_orders,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.stripe_session_id LIKE 'cs_live_%') live_orders,
    (SELECT COALESCE(SUM(amount_chf-refunded_chf),0) FROM orders o WHERE o.customer_id=c.id AND o.status='paid' AND o.stripe_session_id LIKE 'cs_live_%') revenue_cents,
    (SELECT MAX(created_at) FROM orders o WHERE o.customer_id=c.id) last_order_at,
    (SELECT MAX(created_at) FROM sessions s WHERE s.customer_id=c.id AND s.expires_at-s.created_at > 86400000) last_login_at,
    (SELECT COUNT(*) FROM crm_tasks t WHERE t.customer_id=c.id AND t.done_at IS NULL) open_tasks
    FROM customers c LEFT JOIN crm_profiles p ON p.customer_id=c.id ${id ? "WHERE c.id=?" : ""} ORDER BY last_order_at DESC,c.created_at DESC LIMIT 1000`).all(...(id ? [id] : [])) as Array<Record<string, unknown> & { id: number; email: string; internal: number }>;
  const owners = internalEmails();
  return rows.map(r => ({ ...r, language: customerLanguage(r.id, r.locale), internal: Boolean(r.internal || owners.includes(r.email.toLowerCase()) || (Number(r.test_orders) > 0 && Number(r.live_orders) === 0)) }));
}
crmRoute.get("/overview", c => {
  const db = getDb(), days = daysOf(c.req.query("days")), since = Date.now() - days * 86400_000;
  const real = realCustomerSql();
  const rollup = (from: number) => db.prepare(`SELECT COUNT(*) orders,COUNT(DISTINCT o.customer_id) customers,COALESCE(SUM(o.amount_chf-o.refunded_chf),0) revenue_cents FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN crm_profiles p ON p.customer_id=c.id WHERE o.status='paid' AND o.stripe_session_id LIKE 'cs_live_%' AND o.created_at>=? AND ${real.sql}`).get(from, ...real.params);
  const daily = db.prepare(`SELECT strftime('%Y-%m-%d',o.created_at/1000,'unixepoch') day,SUM(o.amount_chf-o.refunded_chf) revenue_cents,COUNT(*) orders FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN crm_profiles p ON p.customer_id=c.id WHERE o.status='paid' AND o.stripe_session_id LIKE 'cs_live_%' AND o.created_at>=? AND ${real.sql} GROUP BY day ORDER BY day`).all(since, ...real.params);
  const traffic = db.prepare(`SELECT COUNT(*) requests,COALESCE(ROUND(AVG(duration_ms)),0) average_ms,COALESCE(SUM(status>=500),0) errors FROM events WHERE kind='api_request' AND ts>=?`).get(since);
  const web = db.prepare(`SELECT COUNT(*) pageviews,COUNT(DISTINCT visitor_hash) visitor_days,MIN(ts) first_event FROM events WHERE kind='custom' AND name='page_view' AND ua_class IN ('desktop','mobile') AND ts>=?`).get(since);
  const coverage = db.prepare("SELECT MIN(ts) first_event FROM events WHERE kind='custom' AND name='page_view'").get();
  const tasks = db.prepare(`SELECT t.*,c.email,COALESCE(p.display_name,'') display_name FROM crm_tasks t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN crm_profiles p ON p.customer_id=c.id WHERE t.done_at IS NULL ORDER BY t.due_on IS NULL,t.due_on,t.created_at DESC LIMIT 100`).all();
  return c.json({ checked_at: Date.now(), days, revenue: rollup(since), all_time: rollup(0), daily, traffic, web, coverage, tasks, customers: profiles(), revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? "local" });
});
crmRoute.get("/customers/:id", c => {
  if (!validId(c.req.param("id"))) return c.json({ error: "invalid_id" }, 400);
  const id = Number(c.req.param("id")), db = getDb();
  const customer = profiles(id)[0];
  if (!customer) return c.json({ error: "not_found" }, 404);
  const orders = db.prepare("SELECT id,amount_chf,refunded_chf,dispute_status,financial_checked_at,items_json,status,created_at,stripe_payment_intent,stripe_session_id FROM orders WHERE customer_id=? ORDER BY created_at DESC").all(id);
  const entitlements = db.prepare("SELECT e.dataset_id,e.updates_until,d.current_version FROM entitlements e JOIN datasets d ON d.id=e.dataset_id WHERE e.customer_id=?").all(id);
  const notes = db.prepare("SELECT id,body,created_at FROM crm_notes WHERE customer_id=? ORDER BY created_at DESC").all(id);
  const tasks = db.prepare("SELECT * FROM crm_tasks WHERE customer_id=? ORDER BY done_at IS NOT NULL,due_on,created_at DESC").all(id);
  const downloads = db.prepare("SELECT dataset_id,version,created_at,used_at FROM download_tokens WHERE customer_id=? ORDER BY created_at DESC LIMIT 30").all(id);
  return c.json({ customer, orders: (orders as Array<{id:number}>).map(order => ({ ...order, legal: orderLegalSummary(db, order.id) })), entitlements, notes, tasks, downloads });
});
crmRoute.patch("/customers/:id", async c => {
  if (!validId(c.req.param("id"))) return c.json({ error: "invalid_id" }, 400);
  const input = z.object({ display_name: z.string().trim().max(120), company: z.string().trim().max(180), stage: z.enum(["nouveau", "actif", "a_recontacter", "en_attente", "clos"]), internal: z.boolean() }).strict().safeParse(await c.req.json().catch(error => { if (error instanceof SyntaxError) return null; throw error; }));
  if (!input.success) return c.json({ error: "invalid_body" }, 400);
  const db = getDb(), id = Number(c.req.param("id"));
  if (!db.prepare("SELECT id FROM customers WHERE id=?").get(id)) return c.json({ error: "not_found" }, 404);
  const r = input.data;
  db.prepare("INSERT INTO crm_profiles(customer_id,display_name,company,stage,internal,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET display_name=excluded.display_name,company=excluded.company,stage=excluded.stage,internal=excluded.internal,updated_at=excluded.updated_at").run(id, r.display_name, r.company, r.stage, Number(r.internal), Date.now());
  return c.json({ ok: true });
});
crmRoute.patch("/customers/:id/language", async c => {
  if (!validId(c.req.param("id"))) return c.json({ error: "invalid_id" }, 400);
  const input = z.object({ code: z.string().refine(isLanguage).nullable() }).strict().safeParse(await c.req.json().catch(error => { if (error instanceof SyntaxError) return null; throw error; }));
  if (!input.success) return c.json({ error: "invalid_body" }, 400);
  const db = getDb(), id = Number(c.req.param("id"));
  if (!db.prepare("SELECT id FROM customers WHERE id=?").get(id)) return c.json({ error: "not_found" }, 404);
  setCustomerLanguage(id, input.data.code);
  return c.json({ ok: true, language: customerLanguage(id, (db.prepare("SELECT locale FROM customers WHERE id=?").get(id) as {locale:string}).locale) });
});
crmRoute.post("/customers/:id/notes", async c => {
  if (!validId(c.req.param("id"))) return c.json({ error: "invalid_id" }, 400);
  const input = z.object({ body: z.string().trim().min(1).max(8000) }).strict().safeParse(await c.req.json().catch(error => { if (error instanceof SyntaxError) return null; throw error; }));
  if (!input.success) return c.json({ error: "invalid_body" }, 400);
  const db = getDb(), id = Number(c.req.param("id"));
  if (!db.prepare("SELECT id FROM customers WHERE id=?").get(id)) return c.json({ error: "not_found" }, 404);
  const result = db.prepare("INSERT INTO crm_notes(customer_id,body,author_id,created_at) VALUES(?,?,?,?)").run(id, input.data.body, c.get("customer_id"), Date.now());
  return c.json({ ok: true, id: Number(result.lastInsertRowid) }, 201);
});
crmRoute.post("/tasks", async c => {
  const input = z.object({ title: z.string().trim().min(1).max(240), customer_id: z.number().int().positive().nullable().default(null), due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null) }).strict().safeParse(await c.req.json().catch(error => { if (error instanceof SyntaxError) return null; throw error; }));
  if (!input.success) return c.json({ error: "invalid_body" }, 400);
  const db = getDb(), r = input.data;
  if (r.customer_id && !db.prepare("SELECT id FROM customers WHERE id=?").get(r.customer_id)) return c.json({ error: "not_found" }, 404);
  const result = db.prepare("INSERT INTO crm_tasks(customer_id,title,due_on,created_at) VALUES(?,?,?,?)").run(r.customer_id, r.title, r.due_on, Date.now());
  return c.json({ ok: true, id: Number(result.lastInsertRowid) }, 201);
});
crmRoute.patch("/tasks/:id", async c => {
  if (!validId(c.req.param("id"))) return c.json({ error: "invalid_id" }, 400);
  const body = z.object({ done: z.boolean() }).strict().safeParse(await c.req.json().catch(error => { if (error instanceof SyntaxError) return null; throw error; }));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const r = getDb().prepare("UPDATE crm_tasks SET done_at=? WHERE id=?").run(body.data.done ? Date.now() : null, Number(c.req.param("id")));
  return c.json({ ok: r.changes === 1 }, r.changes === 1 ? 200 : 404);
});
crmRoute.get("/audience", c => {
  const db = getDb(), since = Date.now() - daysOf(c.req.query("days")) * 86400_000;
  const daily = db.prepare(`SELECT strftime('%Y-%m-%d',ts/1000,'unixepoch') day,COUNT(*) views,COUNT(DISTINCT visitor_hash) visitors FROM events WHERE name='page_view' AND kind='custom' AND ua_class IN ('desktop','mobile') AND ts>=? GROUP BY day ORDER BY day`).all(since);
  const groups = (column: string) => db.prepare(`SELECT COALESCE(${column},'inconnu') label,COUNT(*) count FROM events WHERE name='page_view' AND kind='custom' AND ua_class IN ('desktop','mobile') AND ts>=? GROUP BY label ORDER BY count DESC LIMIT 12`).all(since);
  const split = db.prepare("SELECT COALESCE(ua_class,'inconnu') label,COUNT(*) count FROM events WHERE name='page_view' AND kind='custom' AND ts>=? GROUP BY label ORDER BY count DESC").all(since);
  const api = db.prepare("SELECT COALESCE(ua_class,'inconnu') label,COUNT(*) count FROM events WHERE kind='api_request' AND ts>=? GROUP BY label ORDER BY count DESC").all(since);
  const actions = db.prepare("SELECT name label,COUNT(*) count FROM events WHERE kind IN ('custom','conversion') AND name NOT IN ('page_view','mcp_tool_call') AND ts>=? GROUP BY name ORDER BY count DESC LIMIT 15").all(since);
  return c.json({ checked_at: Date.now(), daily, pages: groups("json_extract(meta_json,'$.path')"), sources: groups("referer"), countries: groups("country"), split, api, actions });
});
crmRoute.get("/visibility", async c => {
  try { return c.json(await searchConsole(daysOf(c.req.query("days")))); }
  catch { return c.json({ available: false, reason: "Google Search Console ne répond pas. Réessayer dans quelques minutes." }); }
});
crmRoute.get("/operations", async c => {
  const db = getDb();
  const datasets = db.prepare("SELECT d.id,d.name,d.current_version,v.released_at,v.size_bytes FROM datasets d LEFT JOIN versions v ON v.dataset_id=d.id AND v.version=d.current_version").all();
  const checks = (db.prepare("SELECT name,checked_at,details_json FROM operation_checks").all() as Array<{ name: string; checked_at: number; details_json: string }>).map(r => { const d = JSON.parse(r.details_json); return { name: r.name, checked_at: r.checked_at, encrypted: d.encrypted, restore_check: d.restore_check, size_bytes: d.size_bytes }; });
  let workflows: { available: boolean; checked_at?: number; items?: unknown[]; runs?: unknown[] } = { available: false };
  try {
    workflows = await cached("workflows", 600_000, async () => {
      const base = "https://api.github.com/repos/cammac-creator/openswissdata/actions", headers = { Accept: "application/vnd.github+json", "User-Agent": "OpenSwissData-dashboard" };
      const [flow, runs] = await Promise.all([sourceJson<{ workflows: Array<{ id: number; name: string; state: string; html_url: string }> }>("github", `${base}/workflows`, { headers }), sourceJson<{ workflow_runs: Array<{ id: number; workflow_id: number; name: string; status: string; conclusion: string | null; created_at: string; html_url: string }> }>("github", `${base}/runs?per_page=30`, { headers })]);
      return { available: true, checked_at: Date.now(), items: flow.workflows.map(({ id, name, state, html_url }) => ({ id, name, state, html_url })), runs: runs.workflow_runs.map(({ id, workflow_id, name, status, conclusion, created_at, html_url }) => ({ id, workflow_id, name, status, conclusion, created_at, html_url })) };
    });
  } catch { /* L'indisponibilité reste visible, aucun succès n'est inventé. */ }
  return c.json({ checked_at: Date.now(), datasets, checks, workflows, deliveries: deliveryStatus(), financial:financialStatus(), revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? "local" });
});
crmRoute.route("/mail", crmMailRoute);
