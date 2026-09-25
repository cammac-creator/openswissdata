// Stripe → bronze chiffré → état financier et droits privés, sans opération de paiement.
import type Stripe from "stripe";
import type Database from "better-sqlite3";
import { z } from "zod";
import { getDb } from "./db.js";
import { sourceJson } from "./crm-source.js";
import { refreshOrderRights } from "./order-rights.js";

export const FINANCIAL_EVENTS = new Set([
  "charge.refunded", "refund.created", "refund.updated", "refund.failed",
  "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
  "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated",
]);
const idOf = (value: unknown): string | null => typeof value === "string" ? value :
  value && typeof value === "object" && "id" in value && typeof value.id === "string" ? value.id : null;
const money = z.number().int().nonnegative().safe();
const ref = z.union([z.string(), z.object({ id: z.string() })]).nullable();
const chargeShape = z.object({ id:z.string(), payment_intent:ref, currency:z.literal("chf"),
  amount:money, paid:z.literal(true), livemode:z.boolean() });
const refundShape = z.object({ id:z.string(), charge:ref, currency:z.literal("chf"), amount:money,
  status:z.enum(["pending","requires_action","succeeded","failed","canceled"]) });
const disputeShape = z.object({ id:z.string(), charge:ref, currency:z.literal("chf"),
  status:z.enum(["warning_needs_response","warning_under_review","warning_closed","needs_response","under_review","won","lost","prevented"]) });
type Job = {charge_id:string;payment_intent:string|null;livemode:number;revision:number;attempts:number;lease_until:number};
type ChargeState = {charge_id:string;payment_intent:string;amount_chf:number;refunded_chf:number;dispute_status:string|null;livemode:number;checked_at:number};
const LEASE_MS = 300_000;

/** Notification signée : accusé après écriture durable, dédoublonné par événement. */
export function enqueueFinancialEvent(event: Stripe.Event): boolean {
  const object = event.data.object as unknown as Record<string, unknown>;
  const chargeId = event.type === "charge.refunded" ? idOf(object.id) : idOf(object.charge);
  if (!chargeId || !/^ch_[A-Za-z0-9_]+$/.test(chargeId) || typeof event.livemode !== "boolean") throw new Error("invalid_financial_event");
  const intent = idOf(object.payment_intent), now = Date.now(), db = getDb();
  return db.transaction(() => {
    const inserted = db.prepare("INSERT OR IGNORE INTO stripe_financial_events(id,charge_id,created_at) VALUES(?,?,?)")
      .run(event.id, chargeId, now);
    if (!inserted.changes) return false;
    db.prepare(`INSERT INTO stripe_financial_jobs(charge_id,payment_intent,livemode,next_attempt_at) VALUES(?,?,?,?)
      ON CONFLICT(charge_id) DO UPDATE SET payment_intent=COALESCE(excluded.payment_intent,payment_intent),
      revision=revision+1,state='pending',lease_until=NULL,next_attempt_at=excluded.next_attempt_at,last_error=NULL`)
      .run(chargeId, intent, Number(event.livemode), now);
    return true;
  })();
}

/** Réutilisé par le checkout si le remboursement est arrivé avant la commande. */
export function applyOrderFinancialState(db: Database.Database, orderId: number, fromCheckout = false): void {
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as {
    id:number;customer_id:number;stripe_payment_intent:string|null;stripe_session_id:string;amount_chf:number;status:string;
  };
  if (!order.stripe_payment_intent) return;
  if (fromCheckout && db.prepare("SELECT 1 FROM stripe_financial_jobs WHERE payment_intent=? AND checked_revision<revision").get(order.stripe_payment_intent)) {
    db.prepare("UPDATE orders SET status='financial_pending' WHERE id=?").run(orderId);
    refreshOrderRights(db,order.customer_id);
    return;
  }
  const states = db.prepare("SELECT * FROM stripe_charge_states WHERE payment_intent=?").all(order.stripe_payment_intent) as ChargeState[];
  if (!states.length) return;
  const state = states[0];
  if (states.length !== 1 || state.amount_chf !== order.amount_chf ||
      !order.stripe_session_id.startsWith(state.livemode ? "cs_live_" : "cs_test_")) throw new Error("financial_order_mismatch");
  // Un statut manuel étranger à ce mécanisme ne doit pas être réactivé.
  if (!["paid","refunded","disputed","dispute_lost","financial_pending"].includes(order.status)) throw new Error("financial_manual_order_status");
  const status = state.refunded_chf >= order.amount_chf && order.amount_chf > 0 ? "refunded" :
    state.dispute_status === "lost" ? "dispute_lost" :
    ["needs_response","under_review"].includes(state.dispute_status ?? "") ? "disputed" : "paid";
  db.prepare("UPDATE orders SET status=?,refunded_chf=?,dispute_status=?,financial_checked_at=? WHERE id=?")
    .run(status, state.refunded_chf, state.dispute_status, state.checked_at, orderId);
  refreshOrderRights(db, order.customer_id);
  if (status !== "paid") {
    // Un mail déjà accepté reste dans l'historique. Ses liens vérifient les droits.
    db.prepare(`UPDATE order_deliveries SET state='cancelled',lease_until=NULL,payload_json=NULL,download_token=NULL,
      last_error='financial_access_suspended' WHERE order_id=? AND state IN ('pending','processing')`).run(orderId);
  } else if (order.status !== "paid") {
    // Reprise sans doublon : une tentative externe antérieure exige une vérification.
    db.prepare(`UPDATE order_deliveries SET state=CASE WHEN first_attempt_at IS NULL THEN 'pending' ELSE 'review' END,
      next_attempt_at=?,last_error=CASE WHEN first_attempt_at IS NULL THEN NULL ELSE 'delivery_confirmation_required' END
      WHERE order_id=? AND state='cancelled' AND last_error='financial_access_suspended'`).run(Date.now(), orderId);
  }
}

async function stripeRead(path: string): Promise<unknown> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^(sk|rk)_(live|test)_/.test(key)) throw new Error("financial_key_missing");
  return sourceJson("stripe-financial", `https://api.stripe.com/v1/${path}`, {headers:{Authorization:`Bearer ${key}`,"Stripe-Version":"2025-02-24.acacia"}});
}
async function listAll<T>(resource: string, chargeId: string, shape: z.ZodType<T>): Promise<T[]> {
  const result: T[] = [], ids = new Set<string>();
  let cursor: string | undefined;
  // Plafond explicite : une réponse tronquée ne doit jamais rétablir des droits.
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({charge:chargeId,limit:"100",...(cursor ? {starting_after:cursor} : {})});
    const list = z.object({data:z.array(shape),has_more:z.boolean()}).parse(await stripeRead(`${resource}?${params}`));
    for (const item of list.data) {
      const id = idOf(item);
      if (!id || ids.has(id)) throw new Error("financial_pagination_invalid");
      ids.add(id); result.push(item);
    }
    if (!list.has_more) return result;
    cursor = idOf(list.data.at(-1)) ?? undefined;
    if (!cursor) throw new Error("financial_pagination_invalid");
  }
  throw new Error("financial_pagination_limit");
}

async function reconcileCharge(chargeId: string): Promise<void> {
  const db = getDb(), now = Date.now();
  const job = db.transaction(() => {
    const claim = db.prepare(`UPDATE stripe_financial_jobs SET state='processing',attempts=attempts+1,lease_until=?
      WHERE charge_id=? AND ((state IN ('pending','synced') AND next_attempt_at<=?) OR (state='processing' AND lease_until<=?))`)
      .run(now + LEASE_MS, chargeId, now, now);
    return claim.changes ? db.prepare("SELECT * FROM stripe_financial_jobs WHERE charge_id=?").get(chargeId) as Job : undefined;
  })();
  if (!job) return;
  try {
    const charge = chargeShape.parse(await stripeRead(`charges/${encodeURIComponent(chargeId)}`));
    const intent = idOf(charge.payment_intent);
    if (charge.id !== chargeId || !intent || (job.payment_intent && job.payment_intent !== intent) || Number(charge.livemode) !== job.livemode) {
      throw new Error("financial_charge_mismatch");
    }
    const refunds = await listAll("refunds", chargeId, refundShape);
    const disputes = await listAll("disputes", chargeId, disputeShape);
    if ([...refunds,...disputes].some(item => idOf(item.charge) !== chargeId)) throw new Error("financial_charge_mismatch");
    const refunded = refunds.reduce((total, refund) => total + (refund.status === "succeeded" ? refund.amount : 0), 0);
    if (!Number.isSafeInteger(refunded) || refunded > charge.amount) throw new Error("financial_amount_invalid");
    const priority = ["lost","needs_response","under_review","warning_needs_response","warning_under_review","won","prevented","warning_closed"];
    const dispute = priority.find(status => disputes.some(item => item.status === status)) ?? null;
    db.transaction(() => {
      // Toute notification reçue pendant la lecture invalide cette photographie.
      const current = db.prepare(`SELECT 1 FROM stripe_financial_jobs WHERE charge_id=? AND revision=?
        AND state='processing' AND attempts=? AND lease_until=?`).get(chargeId, job.revision, job.attempts, job.lease_until);
      if (!current) return;
      const checked = Date.now();
      db.prepare(`INSERT INTO stripe_charge_states(charge_id,payment_intent,amount_chf,refunded_chf,dispute_status,livemode,checked_at)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(charge_id) DO UPDATE SET payment_intent=excluded.payment_intent,
        amount_chf=excluded.amount_chf,refunded_chf=excluded.refunded_chf,dispute_status=excluded.dispute_status,checked_at=excluded.checked_at`)
        .run(chargeId,intent,charge.amount,refunded,dispute,job.livemode,checked);
      const orders = db.prepare("SELECT id FROM orders WHERE stripe_payment_intent=?").all(intent) as Array<{id:number}>;
      for (const order of orders) applyOrderFinancialState(db, order.id);
      db.prepare(`UPDATE stripe_financial_jobs SET state='synced',payment_intent=?,checked_at=?,lease_until=NULL,
        checked_revision=revision,next_attempt_at=?,last_error=NULL WHERE charge_id=?`).run(intent,checked,checked + 6*3600_000,chargeId);
    })();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const reason = /^financial_[a-z_]+$/.test(message) ? message :
      /stripe-financial_http_(401|403)$/.test(message) ? "financial_permission_denied" :
      message === "crm_bronze_capacity" ? "financial_storage_full" :
      error instanceof z.ZodError ? "financial_format_changed" : "financial_sync_failed";
    db.prepare(`UPDATE stripe_financial_jobs SET state='pending',lease_until=NULL,next_attempt_at=?,last_error=?
      WHERE charge_id=? AND revision=? AND state='processing' AND attempts=? AND lease_until=?`)
      .run(Date.now() + Math.min(3600_000,60_000 * 2 ** Math.min(job.attempts - 1,6)),reason,chargeId,job.revision,job.attempts,job.lease_until);
  }
}

export async function processFinancialEvents(): Promise<void> {
  const now = Date.now();
  const jobs = getDb().prepare(`SELECT charge_id FROM stripe_financial_jobs WHERE
    (state IN ('pending','synced') AND next_attempt_at<=?) OR (state='processing' AND lease_until<=?)
    ORDER BY CASE state WHEN 'synced' THEN 1 ELSE 0 END,next_attempt_at LIMIT 5`).all(now,now) as Array<{charge_id:string}>;
  for (const job of jobs) await reconcileCharge(job.charge_id);
}
export function financialStatus() {
  return getDb().prepare(`SELECT j.charge_id,j.livemode,j.state,j.attempts,j.next_attempt_at,j.last_error,j.checked_at,
    (j.checked_revision<j.revision) notification_pending,
    o.id order_id,o.status order_status,o.refunded_chf,o.dispute_status
    FROM stripe_financial_jobs j LEFT JOIN orders o ON o.stripe_payment_intent=j.payment_intent
    ORDER BY CASE j.state WHEN 'synced' THEN 1 ELSE 0 END,j.checked_at DESC LIMIT 100`).all();
}
export function startFinancialWorker(): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processFinancialEvents(); }
    catch { console.error("[paiements] rapprochement interrompu ; nouvel essai dans une minute"); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(),60_000); timer.unref();
  return () => clearInterval(timer);
}
