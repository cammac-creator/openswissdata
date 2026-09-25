import { Hono, type Context } from "hono";
import type { Stripe } from "stripe";
import { getDb } from "../lib/db.js";
import { stripe } from "../lib/stripe.js";
import { checkoutLanguage } from "../lib/crm-language.js";
import { sendMcpCredentialsEmail, parseLocale } from "../lib/email.js";
import { deliveryStatus } from "../lib/order-delivery.js";
import { generateClientId, generateClientSecret, hashToken } from "../mcp/oauth/crypto.js";
import {
  insertClient,
  findClientByEmail,
  findClientBySubscriptionId,
  setClientTier,
} from "../mcp/oauth/store.js";
import { TIER_DEFAULT_SCOPES, SKU_TO_TIER, type Tier } from "../mcp/oauth/scopes.js";

export const stripeWebhookRoute = new Hono();

const ENTITLEMENT_DAYS = 360;

function mcpBaseUrl(): string {
  return (process.env.MCP_BASE_URL ?? "https://mcp.openswissdata.com").replace(/\/$/, "");
}

/** Map a Stripe price ID back to a tier (used on plan changes via the portal). */
function priceIdToTier(priceId: string | undefined): Tier | undefined {
  if (!priceId) return undefined;
  if (priceId === process.env.STRIPE_PRICE_MCP_STANDALONE) return "standalone";
  if (priceId === process.env.STRIPE_PRICE_MCP_BUSINESS) return "business";
  return undefined;
}

/**
 * A paid MCP subscription checkout completed → provision (or upgrade) the
 * client and email its credentials. Matching payer → client is done by EMAIL
 * (checkout carries no client_id). Always returns 200: a 500 here would make
 * Stripe retry-storm, and we've already been paid — failures are logged loudly
 * for manual recovery instead.
 */
async function handleSubscriptionCheckout(
  session: Stripe.Checkout.Session,
  datasetIds: string[],
  c: Context,
) {
  const email = session.customer_email ?? session.customer_details?.email ?? null;
  const sku = datasetIds.find((id) => id in SKU_TO_TIER);
  const tier = sku ? SKU_TO_TIER[sku] : undefined;

  if (!tier) {
    console.error(
      `[webhook] subscription checkout ${session.id} has no recognised MCP SKU (dataset_ids="${datasetIds.join(",")}") — cannot provision`,
    );
    return c.json({ received: true, mcp: { provisioned: false, reason: "unknown_sku" } });
  }
  if (!email) {
    console.error(
      `[webhook] ALERT subscription checkout ${session.id} (tier ${tier}) had NO email — paid but cannot deliver an MCP key`,
    );
    return c.json({ received: true, mcp: { provisioned: false, reason: "no_email" } });
  }

  try {
    const db = getDb();
    const now = Date.now();
    const subId = (session.subscription as string | null) ?? null;
    // Buyer language carried from the localized checkout page → drives the
    // language of the credentials email and is stored for future emails.
    const metaLocale = session.metadata?.locale;
    let locale = parseLocale(metaLocale);

    // Idempotency: Stripe replays events. If this subscription already
    // provisioned a client, do nothing (no duplicate client / duplicate email).
    if (subId) {
      const already = findClientBySubscriptionId(subId);
      if (already) {
        console.log(
          `[webhook] subscription ${subId} already provisioned (client ${already.client_id}) — idempotent`,
        );
        return c.json({
          received: true,
          mcp: { provisioned: true, idempotent: true, client_id: already.client_id, tier: already.tier },
        });
      }
    }

    // Upsert the customer (mirrors the one-shot path) so the MCP client can link
    // back to a /api/account customer and the billing portal can resolve it.
    const customerRow = db.prepare("SELECT id FROM customers WHERE email = ?").get(email) as
      | { id: number }
      | undefined;
    let customerId: number;
    if (customerRow) {
      customerId = customerRow.id;
      if (session.customer) {
        db.prepare(
          "UPDATE customers SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?",
        ).run(session.customer as string, customerId);
      }
    } else {
      const info = db
        .prepare("INSERT INTO customers (email, stripe_customer_id, locale, created_at) VALUES (?, ?, ?, ?)")
        .run(email, (session.customer as string | null) ?? null, locale, now);
      customerId = Number(info.lastInsertRowid);
    }

    locale = checkoutLanguage(customerId, metaLocale);

    const authorizationEndpoint = `${mcpBaseUrl()}/oauth/authorize`;
    const tokenEndpoint = `${mcpBaseUrl()}/oauth/token`;

    // Upgrade an existing client matched by email — BUT only if it isn't already
    // tied to a DIFFERENT live subscription (hijacking it would orphan the other
    // subscription, leaving it non-downgradable). Otherwise provision a fresh one.
    const existing = findClientByEmail(email);
    const canUpgrade =
      existing && (!existing.stripe_subscription_id || existing.stripe_subscription_id === subId);
    if (existing && canUpgrade) {
      setClientTier(existing.client_id, tier, {
        customer_id: customerId,
        stripe_subscription_id: subId,
      });
      const emailResult = await sendMcpCredentialsEmail({
        to: email,
        clientId: existing.client_id,
        tier,
        authorizationEndpoint,
        tokenEndpoint,
        locale,
      });
      if (!emailResult.sent) {
        console.error(
          `[webhook] ALERT activation email failed for upgraded client ${existing.client_id} (${email}): ${emailResult.reason}`,
        );
      }
      console.log(`[webhook] upgraded client ${existing.client_id} → tier ${tier} (sub ${subId})`);
      return c.json({
        received: true,
        mcp: { provisioned: true, action: "upgraded", client_id: existing.client_id, tier },
      });
    }

    const clientId = generateClientId();
    const clientSecret = generateClientSecret();
    insertClient({
      client_id: clientId,
      client_secret_hash: hashToken(clientSecret),
      name: session.customer_details?.name ?? email,
      email,
      tier,
      scopes: TIER_DEFAULT_SCOPES[tier],
      customer_id: customerId,
      stripe_subscription_id: subId,
    });
    const emailResult = await sendMcpCredentialsEmail({
      to: email,
      clientId,
      clientSecret,
      tier,
      authorizationEndpoint,
      tokenEndpoint,
      locale,
    });
    if (!emailResult.sent) {
      console.error(
        `[webhook] ALERT credentials email failed for NEW client ${clientId} (${email}): ${emailResult.reason} — secret NOT delivered, manual re-issue needed`,
      );
    }
    console.log(`[webhook] provisioned NEW client ${clientId} at tier ${tier} (sub ${subId})`);
    return c.json({
      received: true,
      mcp: { provisioned: true, action: "created", client_id: clientId, tier },
    });
  } catch (err) {
    // Never 500 on the subscription path: Stripe would retry-storm a customer
    // who has ALREADY been charged. Log loudly for manual recovery instead.
    // (This is also the guard that turns a pre-migration `tier='business'` CHECK
    // violation into a recoverable alert rather than a retry loop.)
    console.error(`[webhook] ALERT subscription provisioning db_error for session ${session.id}:`, err);
    return c.json({ received: true, mcp: { provisioned: false, reason: "db_error" } });
  }
}

/** Subscription cancelled / ended → downgrade the linked client to free. */
function handleSubscriptionDeleted(event: Stripe.Event, c: Context) {
  const sub = event.data.object as Stripe.Subscription;
  try {
    const client = findClientBySubscriptionId(sub.id);
    if (!client) {
      console.log(`[webhook] subscription.deleted ${sub.id} — no matching MCP client, nothing to do`);
      return c.json({ received: true, mcp: { downgraded: false, reason: "no_client" } });
    }
    setClientTier(client.client_id, "free", { stripe_subscription_id: null });
    console.log(`[webhook] subscription ${sub.id} cancelled → client ${client.client_id} downgraded to free`);
    return c.json({ received: true, mcp: { downgraded: true, client_id: client.client_id } });
  } catch (err) {
    console.error(`[webhook] ALERT subscription.deleted db_error for ${sub.id}:`, err);
    return c.json({ received: true, mcp: { downgraded: false, reason: "db_error" } });
  }
}

/** Plan change (Pro ↔ Business via the portal) → re-derive tier from the price. */
function handleSubscriptionUpdated(event: Stripe.Event, c: Context) {
  const sub = event.data.object as Stripe.Subscription;
  try {
    const client = findClientBySubscriptionId(sub.id);
    if (!client) {
      return c.json({ received: true, mcp: { updated: false, reason: "no_client" } });
    }
    // Leave downgrade-on-cancellation to subscription.deleted; only act on active.
    if (sub.status !== "active" && sub.status !== "trialing") {
      return c.json({ received: true, mcp: { updated: false, reason: `status_${sub.status}` } });
    }
    const tier = priceIdToTier(sub.items?.data?.[0]?.price?.id);
    if (!tier) {
      return c.json({ received: true, mcp: { updated: false, reason: "unknown_price" } });
    }
    if (tier === client.tier) {
      return c.json({ received: true, mcp: { updated: false, reason: "tier_unchanged", tier } });
    }
    setClientTier(client.client_id, tier, { stripe_subscription_id: sub.id });
    console.log(`[webhook] subscription ${sub.id} plan change → client ${client.client_id} now tier ${tier}`);
    return c.json({ received: true, mcp: { updated: true, client_id: client.client_id, tier } });
  } catch (err) {
    console.error(`[webhook] ALERT subscription.updated db_error for ${sub.id}:`, err);
    return c.json({ received: true, mcp: { updated: false, reason: "db_error" } });
  }
}

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

  // Subscription lifecycle events (MCP paid tiers).
  if (event.type === "customer.subscription.deleted") {
    return handleSubscriptionDeleted(event, c);
  }
  if (event.type === "customer.subscription.updated") {
    return handleSubscriptionUpdated(event, c);
  }

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return c.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // La fin du formulaire ne prouve pas le règlement (virements et moyens différés).
  const freePurchase = session.mode === "payment" && session.payment_status === "no_payment_required" && session.amount_total === 0;
  if (session.payment_status !== "paid" && !freePurchase) {
    return c.json({ received: true, pending_payment: true });
  }
  if (session.currency !== "chf" || !Number.isSafeInteger(session.amount_total) || session.amount_total! < 0) {
    return c.json({ error: "unsupported_payment" }, 400);
  }
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const expectedLive = /^(sk|rk)_live_/.test(key) ? true : /^(sk|rk)_test_/.test(key) ? false : null;
  if (expectedLive !== null && (event.livemode !== expectedLive || session.livemode !== expectedLive)) {
    return c.json({ error: "stripe_mode_mismatch" }, 400);
  }

  // Route paid MCP subscription checkouts to the provisioning path BEFORE the
  // one-shot ZIP logic — an MCP SKU has no dataset rows and would otherwise
  // fall through to `all_datasets_unresolvable` (500, retry storm).
  const subscriptionDatasetIds = ((session.metadata?.dataset_ids as string | undefined) ?? "")
    .split(",")
    .filter(Boolean);
  const isSubscriptionCheckout =
    session.mode === "subscription" || subscriptionDatasetIds.some((id) => id in SKU_TO_TIER);
  if (isSubscriptionCheckout) {
    return handleSubscriptionCheckout(session, subscriptionDatasetIds, c);
  }

  const email = session.customer_email ?? session.customer_details?.email;
  if (!email) return c.json({ error: "no_email" }, 400);
  const db = getDb();
  const datasetIds = subscriptionDatasetIds;
  const datasets = [...new Set(datasetIds.flatMap(id => id === "bundle" ? ["tares", "classifications", "finma"] : [id]))];
  if (!datasets.length || datasets.some(id => !["tares", "classifications", "finma"].includes(id))) {
    return c.json({ error: "unknown_datasets" }, 400);
  }
  if (datasets.some(id => !db.prepare("SELECT id FROM datasets WHERE id=?").get(id))) {
    return c.json({ error: "catalog_unavailable" }, 503);
  }
  try {
    const result = db.transaction(() => {
      const existing = db.prepare("SELECT id FROM orders WHERE stripe_session_id=?").get(session.id) as {id:number} | undefined;
      // Les commandes historiques ne sont jamais remises en livraison sur un rejeu.
      if (existing) return { orderId: existing.id, idempotent: true };
      const now = Date.now();
      const customer = db.prepare("SELECT id FROM customers WHERE email=?").get(email) as {id:number} | undefined;
      const customerId = customer?.id ?? Number(db.prepare(
        "INSERT INTO customers(email,stripe_customer_id,locale,created_at) VALUES(?,?,?,?)"
      ).run(email, typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
        parseLocale(session.metadata?.locale), now).lastInsertRowid);
      const locale = checkoutLanguage(customerId, session.metadata?.locale);
      const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
      const orderId = Number(db.prepare(`INSERT INTO orders
        (customer_id,stripe_session_id,stripe_payment_intent,amount_chf,items_json,status,created_at)
        VALUES(?,?,?,?,?,'paid',?)`).run(customerId, session.id, intent, session.amount_total,
          JSON.stringify(datasetIds), now).lastInsertRowid);
      for (const datasetId of datasets) {
        db.prepare(`INSERT INTO entitlements(customer_id,dataset_id,order_id,updates_until,created_at) VALUES(?,?,?,?,?)
          ON CONFLICT(customer_id,dataset_id) DO UPDATE SET
          updates_until=CASE WHEN updates_until IS NULL THEN NULL ELSE MAX(updates_until,excluded.updates_until) END,
          order_id=excluded.order_id`).run(customerId, datasetId, orderId, now + ENTITLEMENT_DAYS * 86400_000, now);
        db.prepare(`INSERT INTO order_deliveries(order_id,dataset_id,locale,next_attempt_at,created_at) VALUES(?,?,?,?,?)`)
          .run(orderId, datasetId, locale, now, now);
      }
      return { orderId, idempotent: false };
    })();
    // Accusé immédiat : le worker reprend la file durable chaque minute.
    return c.json({ received: true, order_id: result.orderId, idempotent: result.idempotent,
      datasets, deliveries: deliveryStatus(result.orderId) });
  } catch {
    console.error("[webhook] écriture atomique de la commande interrompue ; rejeu Stripe nécessaire");
    return c.json({ error: "db_transaction_failed" }, 500);
  }
});
