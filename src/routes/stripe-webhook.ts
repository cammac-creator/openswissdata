import { Hono } from "hono";
import type { Stripe } from "stripe";
import { getDb } from "../lib/db.js";
import { stripe } from "../lib/stripe.js";
import { signedDownloadUrl } from "../lib/r2.js";
import { sendDownloadEmail } from "../lib/email.js";

export const stripeWebhookRoute = new Hono();

const ENTITLEMENT_DAYS = 360;

stripeWebhookRoute.post("/", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "missing_signature" }, 400);
  }
  const rawBody = await c.req.text();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || webhookSecret === "whsec_xxx") {
    return c.json({ error: "webhook_secret_not_configured" }, 500);
  }

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err);
    return c.json({ error: "invalid_signature" }, 400);
  }

  if (event.type !== "checkout.session.completed") {
    return c.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const email = session.customer_email ?? session.customer_details?.email;
  if (!email) {
    console.warn(`[webhook] checkout ${session.id} had no email — skipping`);
    return c.json({ error: "no_email" }, 400);
  }

  const db = getDb();
  const now = Date.now();

  // Find or create customer
  const customerRow = db.prepare("SELECT id FROM customers WHERE email = ?").get(email) as { id: number } | undefined;
  let customerId: number;
  if (customerRow) {
    customerId = customerRow.id;
  } else {
    const info = db.prepare("INSERT INTO customers (email, stripe_customer_id, created_at) VALUES (?, ?, ?)")
      .run(email, (session.customer as string | null) ?? null, now);
    customerId = Number(info.lastInsertRowid);
  }

  // Decode dataset_ids from metadata
  const datasetIdsRaw = (session.metadata?.dataset_ids as string | undefined) ?? "";
  const datasetIds = datasetIdsRaw.split(",").filter(Boolean);

  // Idempotency: if order already exists for this session, return success without reprocessing
  const existing = db.prepare("SELECT id FROM orders WHERE stripe_session_id = ?").get(session.id) as { id: number } | undefined;
  if (existing) {
    console.log(`[webhook] duplicate event for session ${session.id}, ignoring`);
    return c.json({ received: true, idempotent: true, order_id: existing.id });
  }

  // Insert order
  const orderInfo = db.prepare(`
    INSERT INTO orders (customer_id, stripe_session_id, stripe_payment_intent, amount_chf, items_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'paid', ?)
  `).run(
    customerId,
    session.id,
    (session.payment_intent as string | null) ?? null,
    session.amount_total ?? 0,
    JSON.stringify(datasetIds),
    now
  );
  const orderId = Number(orderInfo.lastInsertRowid);

  // Expand bundle to 3 datasets
  const resolvedDatasets = Array.from(new Set(
    datasetIds.flatMap(id => id === "bundle" ? ["tares", "classifications", "finma"] : [id])
  ));

  // Create entitlements + send emails
  const updatesUntil = now + ENTITLEMENT_DAYS * 24 * 3600 * 1000;
  const entStmt = db.prepare(`
    INSERT INTO entitlements (customer_id, dataset_id, order_id, updates_until, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(customer_id, dataset_id) DO UPDATE SET
      updates_until = MAX(updates_until, excluded.updates_until),
      order_id = excluded.order_id
  `);

  const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  for (const datasetId of resolvedDatasets) {
    try {
      entStmt.run(customerId, datasetId, orderId, updatesUntil, now);
      const dataset = db.prepare("SELECT name, current_version FROM datasets WHERE id = ?").get(datasetId) as { name: string; current_version: string | null } | undefined;
      if (!dataset || !dataset.current_version) {
        console.warn(`[webhook] dataset ${datasetId} has no current_version — skipping download email`);
        continue;
      }
      const version = db.prepare("SELECT r2_key FROM versions WHERE dataset_id = ? AND version = ?").get(datasetId, dataset.current_version) as { r2_key: string } | undefined;
      if (!version) {
        console.warn(`[webhook] no version row for ${datasetId}@${dataset.current_version}`);
        continue;
      }

      const downloadUrl = await signedDownloadUrl(version.r2_key, 48 * 3600);
      const emailResult = await sendDownloadEmail({
        to: email,
        datasetName: dataset.name,
        downloadUrl,
        accountUrl: `${baseUrl}/account`,
        version: dataset.current_version,
      });
      if (!emailResult.sent) {
        console.warn(`[webhook] download email for ${datasetId} not sent: ${emailResult.reason}`);
      }
    } catch (err) {
      console.error(`[webhook] entitlement/email failed for ${datasetId}:`, err);
    }
  }

  return c.json({ received: true, order_id: orderId, datasets: resolvedDatasets });
});
