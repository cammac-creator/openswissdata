import { readCrmWorkflows } from '../lib/crm-workflows.js';
import { createIncidentTask } from '../lib/incident-tasks.js';
import {readDeliveryIncidentPage,readDeliveryIncidentEvents} from '../lib/delivery-incidents.js';
import { customerPage, customerProfiles, internalEmails, prepareCustomerFunctions, searchText } from '../lib/crm-customers.js';
import { isCalendarDate } from '../lib/calendar-date.js';
import { readTaskOverview, taskOrderSql, readTaskPage, TASK_FILTERS } from '../lib/crm-tasks.js';
import { readBackupChecks } from "../lib/backup-state.js";
import { readCleanupProof } from "../lib/cleanup.js";
import { orderService, accountDownloadHistory } from "../lib/customer-service.js";
import { orderLegalSummary } from "../lib/order-legal.js";
import { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import { getDb } from "../lib/db.js";
import { requireAdmin } from "../lib/admin-middleware.js";
import { cached, searchConsole } from "../lib/crm-source.js";
import { customerLanguage, setCustomerLanguage } from "../lib/crm-language.js";
import { isLanguage } from "../lib/languages.js";
import { crmMailRoute } from "./crm-mail.js";
import { deliveryStatus } from "../lib/order-delivery.js";
import { financialStatus } from "../lib/stripe-financial.js";
import { crmPeriod, periodRanges, swissDay } from "../lib/crm-period.js";
import { readCrmAudience } from "../lib/crm-audience.js";
import { readOrderJourney } from "../lib/order-journey.js";
import { readSampleMeasures } from "../lib/sample-measures.js";

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
const searchQuery = z.string().trim().max(180).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)&&(value===''||searchText(value).trim().length>0)).default('');
const daysOf = (v?: string) => [7, 30, 90, 365].includes(Number(v)) ? Number(v) : 30;
const validId = (v: string) => /^\d{1,10}$/.test(v) && Number(v) > 0;
export function realCustomerSql(alias = "c"): { sql: string; params: string[] } {
  prepareCustomerFunctions(getDb());
  const emails = internalEmails();
  return { sql: `COALESCE(p.internal,0)=0${emails.length ? ` AND crm_email_key(${alias}.email) NOT IN (${emails.map(() => "?").join(",")})` : ""}`, params: emails };
}
crmRoute.get("/overview", c => {
  const db = getDb(), now = Date.now(), days = daysOf(c.req.query("days")), period = crmPeriod(days, now);
  const real = realCustomerSql();
  return c.json(db.transaction(() => {
    const selection = `FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN crm_profiles p ON p.customer_id=c.id WHERE o.status='paid' AND o.stripe_session_id GLOB 'cs_live_*' AND o.created_at>=? AND o.created_at<? AND ${real.sql}`;
    const rollup = (from: number) => db.prepare(`SELECT COUNT(*) orders,COUNT(DISTINCT o.customer_id) customers,COALESCE(SUM(o.amount_chf-o.refunded_chf),0) revenue_cents ${selection}`).get(from, period.end_at, ...real.params);
    const dayQuery = db.prepare(`SELECT COALESCE(SUM(o.amount_chf-o.refunded_chf),0) revenue_cents,COUNT(*) orders ${selection}`);
    const daily = periodRanges(period).map(range => ({ day: range.day, ...dayQuery.get(range.start, range.end, ...real.params) as { revenue_cents: number; orders: number } }));
    const { traffic, web, coverage } = readCrmAudience(db, period, false);
    const taskOverview = readTaskOverview(db, period.end), customers = customerProfiles();
    const customerTotal = (db.prepare('SELECT COUNT(*) total FROM customers').get() as {total:number}).total;
    return { checked_at: now, days, period, revenue: rollup(period.start_at), all_time: rollup(0), daily, traffic, web, coverage, ...taskOverview, customers, customer_list: { returned: customers.length, total: customerTotal, limit: 1000, truncated: customerTotal > customers.length }, revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? "local" };
  })());
});
// Le texte recherché reste dans le corps privé, jamais dans l’URL.
crmRoute.post('/customers/search',async c=>{
 if(c.req.raw.signal.aborted)return new Response(null,{status:499});
 const input=z.object({q:searchQuery,page:z.number().int().min(1).max(1_000_000).default(1),include_internal:z.boolean().default(false)}).strict().safeParse(await c.req.json().catch(error=>{if(error instanceof SyntaxError)return null;throw error}));
 if(!input.success)return c.json({error:'invalid_body'},400);
 if(c.req.raw.signal.aborted)return new Response(null,{status:499});
 return c.json(customerPage(input.data));
});
crmRoute.post('/incidents/:id/task',async c=>{
 if(!validId(c.req.param('id')))return c.json({error:'invalid_id'},400);
 const body=z.object({due_on:z.string().refine(isCalendarDate).nullable().default(null)}).strict().safeParse(await c.req.json().catch(error=>{if(error instanceof SyntaxError)return null;throw error}));
 if(!body.success)return c.json({error:'invalid_body'},400);
 const result=createIncidentTask(getDb(),Number(c.req.param('id')),c.get('customer_id'),body.data.due_on);
 if(result.status==='not_found')return c.json({error:'not_found'},404);
 if(result.status==='closed')return c.json({error:'incident_closed'},409);
 if(result.status==='clock')return c.json({error:'incident_clock_pending'},409);
 return c.json({ok:true,created:result.created,task:result.task},result.created?201:200);
});
crmRoute.get('/incidents',c=>{
 const input=z.object({state:z.enum(['open','accepted','cancelled']).default('open'),page:z.coerce.number().int().min(1).max(1_000_000).default(1)}).strict().safeParse(c.req.query());
 if(!input.success)return c.json({error:'invalid_filter'},400);
 return c.json(readDeliveryIncidentPage(getDb(),input.data.state,input.data.page));
});
crmRoute.get('/incidents/:id/events',c=>{
 if(!validId(c.req.param('id')))return c.json({error:'invalid_id'},400);
 const input=z.object({before:z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional()}).strict().safeParse(c.req.query());
 if(!input.success)return c.json({error:'invalid_filter'},400);
 const result=readDeliveryIncidentEvents(getDb(),Number(c.req.param('id')),input.data.before);
 return result?c.json(result):c.json({error:'not_found'},404);
});
crmRoute.get("/customers/:id", c => {
  if (!validId(c.req.param("id"))) return c.json({ error: "invalid_id" }, 400);
  const id = Number(c.req.param("id")), db = getDb(), now = Date.now();
  const customer = customerProfiles(id)[0];
  if (!customer) return c.json({ error: "not_found" }, 404);
  const orders = db.prepare("SELECT id,amount_chf,refunded_chf,dispute_status,financial_checked_at,items_json,status,created_at,stripe_payment_intent,stripe_session_id FROM orders WHERE customer_id=? ORDER BY created_at DESC").all(id);
  const entitlements = db.prepare("SELECT e.dataset_id,e.updates_until,d.current_version FROM entitlements e JOIN datasets d ON d.id=e.dataset_id WHERE e.customer_id=?").all(id);
  const notes = db.prepare("SELECT id,body,created_at FROM crm_notes WHERE customer_id=? ORDER BY created_at DESC").all(id);
  const tasks = db.prepare(`SELECT t.* FROM crm_tasks t WHERE t.customer_id=? ORDER BY t.done_at IS NOT NULL,${taskOrderSql}`).all(id);
  return c.json({ today: swissDay(now), customer, orders: (orders as Array<{id:number}>).map(order => ({ ...order, service: orderService(db, id, order.id), legal: orderLegalSummary(db, order.id) })), entitlements, notes, tasks, account_downloads: accountDownloadHistory(db, id) });
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
crmRoute.post('/tasks/search',async c=>{
 if(c.req.raw.signal.aborted)return new Response(null,{status:499});
 const input=z.object({q:searchQuery,page:z.number().int().min(1).max(1_000_000).default(1),status:z.enum(TASK_FILTERS).default('open')}).strict().safeParse(await c.req.json().catch(error=>{if(error instanceof SyntaxError)return null;throw error}));
 if(!input.success)return c.json({error:'invalid_body'},400);
 if(c.req.raw.signal.aborted)return new Response(null,{status:499});
 const now=Date.now();return c.json({checked_at:now,...readTaskPage(getDb(),input.data,swissDay(now))});
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
  const body=z.object({done:z.boolean().optional(),due_on:z.string().refine(isCalendarDate).nullable().optional(),expected_state:z.object({done_at:z.number().int().safe().nullable(),due_on:z.string().nullable()}).strict().optional()}).strict().refine(value=>value.done!==undefined||value.due_on!==undefined).safeParse(await c.req.json().catch(error=>{if(error instanceof SyntaxError)return null;throw error}));
  if(!body.success)return c.json({error:'invalid_body'},400);
  const db=getDb(),id=Number(c.req.param('id'));
  const result=db.transaction(()=>{
    const before=db.prepare('SELECT done_at,due_on FROM crm_tasks WHERE id=?').get(id) as {done_at:number|null;due_on:string|null}|undefined;
    if(!before)return {status:'not_found'} as const;
    const expected=body.data.expected_state;
    if(expected&&(expected.done_at!==before.done_at||expected.due_on!==before.due_on))return {status:'conflict'} as const;
    const done=body.data.done===undefined?before.done_at:body.data.done?(before.done_at??Date.now()):null;
    const due=body.data.due_on===undefined?before.due_on:body.data.due_on;
    if(done===before.done_at&&due===before.due_on)return {status:'ok',changed:false} as const;
    db.prepare('UPDATE crm_tasks SET done_at=?,due_on=? WHERE id=?').run(done,due,id);
    return {status:'ok',changed:true} as const;
  })();
  if(result.status==='not_found')return c.json({error:'not_found'},404);
  if(result.status==='conflict')return c.json({error:'task_conflict'},409);
  return c.json({ok:true,changed:result.changed});
});
crmRoute.get("/audience", c => {
  const db = getDb(), now = Date.now(), period = crmPeriod(daysOf(c.req.query("days")), now);
  const real = realCustomerSql();
  return c.json(db.transaction(() => {
    const audience = readCrmAudience(db, period);
    let journey: ReturnType<typeof readOrderJourney> | null = null;
    try { journey = readOrderJourney(db, period, real, now); }
    catch (error) {
      const code=(error as {code?:unknown})?.code;
      const category=typeof code==='string'&&['SQLITE_ERROR','SQLITE_BUSY','SQLITE_LOCKED','SQLITE_FULL','SQLITE_IOERR','SQLITE_CORRUPT','SQLITE_NOTADB','SQLITE_NOMEM'].includes(code)?code:'unknown';
      // Une catégorie fermée aide le diagnostic sans publier le SQL ou une valeur cliente.
      console.error("[crm] lecture des preuves après achat indisponible", {category});
    }
    let samples: ReturnType<typeof readSampleMeasures> | null = null;
    try { samples = readSampleMeasures(db, period, now); }
    catch (error) {
      const code=(error as {code?:unknown})?.code;
      const category=typeof code==='string'&&['SQLITE_ERROR','SQLITE_BUSY','SQLITE_LOCKED','SQLITE_FULL','SQLITE_IOERR','SQLITE_CORRUPT','SQLITE_NOTADB','SQLITE_NOMEM'].includes(code)?code:'unknown';
      console.error('[crm] lecture des mesures d’échantillons indisponible', {category});
    }
    return { checked_at: now, ...audience, journey, samples };
  })());
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
    workflows = await cached("workflows", 600_000, readCrmWorkflows);
  } catch { /* L'indisponibilité reste visible, aucun succès n'est inventé. */ }
  return c.json({ checked_at: Date.now(), datasets, checks, cleanup: readCleanupProof(db), incidents:(()=>{try{return readDeliveryIncidentPage(db,'open',1)}catch{return null}})(), workflows, deliveries: deliveryStatus(), financial:financialStatus(), revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? "local" });
});
crmRoute.route("/mail", crmMailRoute);
