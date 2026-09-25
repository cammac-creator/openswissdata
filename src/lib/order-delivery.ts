import { getDb } from "./db.js";
import { generateToken } from "./tokens.js";
import { prepareDownloadEmail, sendPreparedEmail, parseLocale, type PreparedEmail } from "./email.js";

const LEASE_MS = 120_000;
// Resend conserve ses clés pendant 24 h : une marge évite un second envoi incertain.
const SAFE_RETRY_WINDOW_MS = 23 * 3600_000;
const TOKEN_TTL_MS = 48 * 3600_000;

type Delivery = {
  id: number; order_id: number; dataset_id: string; locale: string; state: string;
  attempts: number; first_attempt_at: number | null; payload_json: string | null;
  download_token: string | null; customer_id: number; email: string; order_status: string;
  stripe_session_id: string;
};

async function deliver(id: number): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const job = db.transaction(() => {
    const claimed = db.prepare(`UPDATE order_deliveries SET state='processing',lease_until=?,attempts=attempts+1
      WHERE id=? AND ((state='pending' AND next_attempt_at<=?) OR (state='processing' AND lease_until<=?))`)
      .run(now + LEASE_MS, id, now, now);
    if (!claimed.changes) return undefined;
    return db.prepare(`SELECT d.*,o.customer_id,o.status order_status,o.stripe_session_id,c.email FROM order_deliveries d
      JOIN orders o ON o.id=d.order_id JOIN customers c ON c.id=o.customer_id WHERE d.id=?`).get(id) as Delivery;
  })();
  if (!job) return;

  const finish = (state: string, error: string | null, sent = false) => {
    const delay = Math.min(3600_000, 60_000 * 2 ** Math.min(job.attempts - 1, 6));
    const clear = ["sent", "review", "cancelled"].includes(state) ? 1 : 0;
    db.prepare(`UPDATE order_deliveries SET state=?,last_error=?,lease_until=NULL,next_attempt_at=?,sent_at=?,
      payload_json=CASE WHEN ?=1 THEN NULL ELSE payload_json END,
      download_token=CASE WHEN ?=1 THEN NULL ELSE download_token END
      WHERE id=? AND state='processing' AND attempts=?`)
      .run(state, error, Date.now() + delay, sent ? Date.now() : null, clear, clear, id, job.attempts);
  };
  try {
    const financialPending = db.prepare(`SELECT 1 FROM stripe_financial_jobs f JOIN orders o
      ON o.stripe_payment_intent=f.payment_intent WHERE o.id=? AND f.checked_revision<f.revision`).get(job.order_id);
    if (financialPending) return finish("pending", "financial_sync_pending");
    if (job.order_status !== "paid") return finish("cancelled", "order_not_paid");
    if (job.first_attempt_at !== null && now - job.first_attempt_at >= SAFE_RETRY_WINDOW_MS) {
      return finish("review", "delivery_confirmation_required");
    }
    let payload: PreparedEmail;
    if (job.payload_json) {
      payload = JSON.parse(job.payload_json) as PreparedEmail;
    } else {
      const version = db.prepare(`SELECT d.name,v.version FROM datasets d
        JOIN versions v ON v.dataset_id=d.id AND v.version=d.current_version
        JOIN entitlements e ON e.dataset_id=d.id AND e.customer_id=?
        WHERE d.id=? AND (e.updates_until IS NULL OR v.released_at<=e.updates_until)`)
        .get(job.customer_id, job.dataset_id) as {name: string; version: string} | undefined;
      if (!version) return finish("pending", "version_unavailable");
      const token = generateToken();
      const base = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
      const locale = parseLocale(job.locale);
      payload = prepareDownloadEmail({ to: job.email, datasetName: version.name, version: version.version, locale,
        downloadUrl: `${base}/api/delivery/${token}?lang=${locale}`, accountUrl: `${base}${locale === "fr" ? "" : `/${locale}`}/account` });
      db.transaction(() => {
        db.prepare(`INSERT INTO download_tokens(token,customer_id,dataset_id,version,expires_at,created_at) VALUES(?,?,?,?,?,?)`)
          .run(token, job.customer_id, job.dataset_id, version.version, now + TOKEN_TTL_MS, now);
        db.prepare("UPDATE order_deliveries SET payload_json=?,download_token=?,first_attempt_at=? WHERE id=? AND state='processing' AND attempts=?")
          .run(JSON.stringify(payload), token, now, id, job.attempts);
      })();
    }

    const result = await sendPreparedEmail(payload, `osd-download-${job.stripe_session_id}-${job.dataset_id}`);
    if (result.sent) {
      finish("sent", null, true);
    } else {
      if (job.first_attempt_at === null && (result.reason === "no_api_key" || result.reason === "placeholder_key")) {
        // Aucun appel externe : le prochain essai peut préparer un nouveau lien de 48 h.
        db.transaction(() => {
          db.prepare("DELETE FROM download_tokens WHERE token=(SELECT download_token FROM order_deliveries WHERE id=? AND state='processing' AND attempts=?)").run(id, job.attempts);
          db.prepare("UPDATE order_deliveries SET payload_json=NULL,download_token=NULL,first_attempt_at=NULL WHERE id=? AND state='processing' AND attempts=?").run(id, job.attempts);
        })();
      }
      finish("pending", result.reason ?? "send_failed");
    }
  } catch {
    // Une panne après acceptation conserve la requête et la même clé d'idempotence.
    finish("pending", "delivery_error");
  }
}

/** Reprise bornée, utilisable au démarrage, périodiquement et après le webhook. */
export async function processOrderDeliveries(orderId?: number): Promise<void> {
  const now = Date.now();
  const jobs = getDb().prepare(`SELECT id FROM order_deliveries
    WHERE ((state='pending' AND next_attempt_at<=?) OR (state='processing' AND lease_until<=?))
    ${orderId === undefined ? "" : "AND order_id=?"} ORDER BY next_attempt_at,id LIMIT 20`)
    .all(now, now, ...(orderId === undefined ? [] : [orderId])) as Array<{id: number}>;
  for (const job of jobs) await deliver(job.id);
}

export function deliveryStatus(orderId?: number) {
  return getDb().prepare(`SELECT id,order_id,dataset_id,state,attempts,next_attempt_at,last_error,sent_at,created_at
    FROM order_deliveries ${orderId === undefined ? "" : "WHERE order_id=?"}
    ORDER BY CASE state WHEN 'review' THEN 0 WHEN 'pending' THEN 1 WHEN 'processing' THEN 2 ELSE 3 END,id DESC LIMIT 100`)
    .all(...(orderId === undefined ? [] : [orderId]));
}

export function startOrderDeliveryWorker(): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processOrderDeliveries(); }
    catch { console.error("[livraison] reprise interrompue ; nouvel essai dans une minute"); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
