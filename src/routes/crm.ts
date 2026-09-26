import { isCalendarDate } from '../lib/calendar-date.js';
import { readTaskOverview, taskOrderSql } from '../lib/crm-tasks.js';
import { readBackupChecks } from "../lib/backup-state.js";
import { readCleanupProof } from "../lib/cleanup.js";
import { orderService, accountDownloadHistory } from "../lib/customer-service.js";
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
import { crmPeriod, periodRanges } from "../lib/crm-period.js";
import { readCrmAudience } from "../lib/crm-audience.js";

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
  const db = getDb(), now = Date.now(), days = daysOf(c.req.query("days")), period = crmPeriod(days, now);
  const real = realCustomerSql();
  return c.json(db.transaction(() => {
    const selection = `FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN crm_profiles p ON p.customer_id=c.id WHERE o.status='paid' AND o.stripe_session_id LIKE 'cs_live_%' AND o.created_at>=? AND o.created_at<? AND ${real.sql}`;
    const rollup = (from: number) => db.prepare(`SELECT COUNT(*) orders,COUNT(DISTINCT o.customer_id) customers,COALESCE(SUM(o.amount_chf-o.refunded_chf),0) revenue_cents ${selection}`).get(from, period.end_at, ...real.params);
    const dayQuery = db.prepare(`SELECT COALESCE(SUM(o.amount_chf-o.refunded_chf),0) revenue_cents,COUNT(*) orders ${selection}`);
    const daily = periodRanges(period).map(range => ({ day: range.day, ...dayQuery.get(range.start, range.end, ...real.params) as { revenue_cents: number; orders: number } }));
    const { traffic, web, coverage } = readCrmAudience(db, period, false);
    const taskOverview = readTaskOverview(db, period.end), customers = profiles();
    const customerTotal = (db.prepare('SELECT COUNT(*) total FROM customers').get() as {total:number}).total;
    return { checked_at: now, days, period, revenue: rollup(period.start_at), all_time: rollup(0), daily, traffic, web, coverage, ...taskOverview, customers, customer_list: { returned: customers.length, total: customerTotal, limit: 1000, truncated: customerTotal > customers.length }, revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? "local" };
  })());
});
crmRoute.get("/customers/:id", c => {
  if (!validId(c.req.param("id"))) return c.json({ error: "invalid_id" }, 400);
  const id = Number(c.req.param("id")), db = getDb();
  const customer = profiles(id)[0];
  if (!customer) return c.json({ error: "not_found" }, 404);
  const orders = db.prepare("SELECT id,amount_chf,refunded_chf,dispute_status,financial_checked_at,items_json,status,created_at,stripe_payment_intent,stripe_session_id FROM orders WHERE customer_id=? ORDER BY created_at DESC").all(id);
  const entitlements = db.prepare("SELECT e.dataset_id,e.updates_until,d.current_version FROM entitlements e JOIN datasets d ON d.id=e.dataset_id WHERE e.customer_id=?").all(id);
  const notes = db.prepare("SELECT id,body,created_at FROM crm_notes WHERE customer_id=? ORDER BY created_at DESC").all(id);
  const tasks = db.prepare(`SELECT t.* FROM crm_tasks t WHERE t.customer_id=? ORDER BY t.done_at IS NOT NULL,${taskOrderSql}`).all(id);
  return c.json({ customer, orders: (orders as Array<{id:number}>).map(order => ({ ...order, service: orderService(db, id, order.id), legal: orderLegalSummary(db, order.id) })), entitlements, notes, tasks, account_downloads: accountDownloadHistory(db, id) });
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
  const input = z.object({ title: z.string().trim().min(1).max(240), customer_id: z.number().int().positive().nullable().default(null), due_on: z.string().refine(isCalendarDate).nullable().default(null) }).strict().safeParse(await c.req.json().catch(error => { if (error instanceof SyntaxError) return null; throw error; }));
  if (!input.success) return c.json({ error: "invalid_body" }, 400);
  const db = getDb(), r = input.data;
  if (r.customer_id && !db.prepare("SELECT id FROM customers WHERE id=?").get(r.customer_id)) return c.json({ error: "not_found" }, 404);
  const result = db.prepare("INSERT INTO crm_tasks(customer_id,title,due_on,created_at) VALUES(?,?,?,?)").run(r.customer_id, r.title, r.due_on, Date.now());
  return c.json({ ok: true, id: Number(result.lastInsertRowid) }, 201);
});
crmRoute.patch("/tasks/:id", async c => {
  if (!validId(c.req.param("id"))) return c.json({ error: "invalid_id" }, 400);
  const body = z.object({ done: z.boolean().optional(), due_on: z.string().refine(isCalendarDate).nullable().optional() }).strict().refine(value => value.done !== undefined || value.due_on !== undefined).safeParse(await c.req.json().catch(error => { if (error instanceof SyntaxError) return null; throw error; }));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const fields: string[] = [], values: Array<string | number | null> = [];
  if (body.data.done !== undefined) { fields.push(body.data.done ? 'done_at=COALESCE(done_at,?)' : 'done_at=?'); values.push(body.data.done ? Date.now() : null); }
  if (body.data.due_on !== undefined) { fields.push('due_on=?'); values.push(body.data.due_on); }
  const r = getDb().prepare(`UPDATE crm_tasks SET ${fields.join(',')} WHERE id=?`).run(...values, Number(c.req.param("id")));
  return c.json({ ok: r.changes === 1 }, r.changes === 1 ? 200 : 404);
});
crmRoute.get("/audience", c => {
  const db = getDb(), now = Date.now(), period = crmPeriod(daysOf(c.req.query("days")), now);
  return c.json(db.transaction(() => ({ checked_at: now, ...readCrmAudience(db, period) }))());
});
crmRoute.get("/visibility", async c => {
  try { return c.json(await searchConsole(daysOf(c.req.query("days")))); }
  catch { return c.json({ available: false, reason: "Google Search Console ne répond pas. Réessayer dans quelques minutes." }); }
});
crmRoute.get("/operations", async c => {
  const db = getDb();
  const datasets = db.prepare("SELECT d.id,d.name,d.current_version,v.released_at,v.size_bytes FROM datasets d LEFT JOIN versions v ON v.dataset_id=d.id AND v.version=d.current_version").all();
  const checks = readBackupChecks(db);
  let workflows: { available: boolean; checked_at?: number; items?: unknown[]; runs?: unknown[] } = { available: false };
  try {
    workflows = await cached("workflows", 600_000, async () => {
      const base = "https://api.github.com/repos/cammac-creator/openswissdata/actions", headers = { Accept: "application/vnd.github+json", "User-Agent": "OpenSwissData-dashboard" };
      const [flow, runs] = await Promise.all([sourceJson<{ workflows: Array<{ id: number; name: string; state: string; html_url: string }> }>("github", `${base}/workflows`, { headers }), sourceJson<{ workflow_runs: Array<{ id: number; workflow_id: number; name: string; status: string; conclusion: string | null; created_at: string; html_url: string }> }>("github", `${base}/runs?per_page=30`, { headers })]);
      return { available: true, checked_at: Date.now(), items: flow.workflows.map(({ id, name, state, html_url }) => ({ id, name, state, html_url })), runs: runs.workflow_runs.map(({ id, workflow_id, name, status, conclusion, created_at, html_url }) => ({ id, workflow_id, name, status, conclusion, created_at, html_url })) };
    });
  } catch { /* L'indisponibilité reste visible, aucun succès n'est inventé. */ }
  return c.json({ checked_at: Date.now(), datasets, checks, cleanup: readCleanupProof(db), workflows, deliveries: deliveryStatus(), financial:financialStatus(), revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? "local" });
});
crmRoute.route("/mail", crmMailRoute);
