import { Hono, type Context } from "hono";
import type { Stripe } from "stripe";
import { getDb } from "../lib/db.js";
import { stripe } from "../lib/stripe.js";
import { signedDownloadUrl } from "../lib/r2.js";
import { sendDownloadEmail, sendMcpCredentialsEmail, parseLocale } from "../lib/email.js";
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
    const locale = parseLocale(metaLocale);

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
      // Follow the buyer's latest checkout language (only when explicitly set).
      if (metaLocale) {
        db.prepare("UPDATE customers SET locale = ? WHERE id = ?").run(locale, customerId);
      }
    } else {
      const info = db
        .prepare("INSERT INTO customers (email, stripe_customer_id, locale, created_at) VALUES (?, ?, ?, ?)")
        .run(email, (session.customer as string | null) ?? null, locale, now);
      customerId = Number(info.lastInsertRowid);
    }

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

  if (event.type !== "checkout.session.completed") {
    return c.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;

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
  if (!email) {
    console.warn(`[webhook] checkout ${session.id} had no email — skipping`);
    return c.json({ error: "no_email" }, 400);
  }

  const db = getDb();
  const now = Date.now();
  const metaLocale = session.metadata?.locale;
  const locale = parseLocale(metaLocale);

  // Find or create customer
  const customerRow = db.prepare("SELECT id FROM customers WHERE email = ?").get(email) as { id: number } | undefined;
  let customerId: number;
  if (customerRow) {
    customerId = customerRow.id;
    if (metaLocale) {
      db.prepare("UPDATE customers SET locale = ? WHERE id = ?").run(locale, customerId);
    }
  } else {
    const info = db.prepare("INSERT INTO customers (email, stripe_customer_id, locale, created_at) VALUES (?, ?, ?, ?)")
      .run(email, (session.customer as string | null) ?? null, locale, now);
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

  // Expand bundle to 3 datasets
  const resolvedDatasets = Array.from(new Set(
    datasetIds.flatMap(id => id === "bundle" ? ["tares", "classifications", "finma"] : [id])
  ));

  const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const updatesUntil = now + ENTITLEMENT_DAYS * 24 * 3600 * 1000;

  // H2 (relaxed for fail-safe partial delivery):
  // Pre-resolve dataset+version rows. If a dataset has no current_version
  // (e.g. ETL not yet run), DON'T fail the whole webhook — log loud and
  // skip just that dataset. Stripe retries the whole webhook on 500, so a
  // permanent dataset gap would block ALL emails for the order, including
  // the datasets that ARE ready. Better: deliver what we can, raise an
  // alert on the missing one. The customer can email support to claim the
  // missing dataset; the order/entitlement stays in DB.
  type EmailPayload = { datasetId: string; datasetName: string; r2Key: string; version: string };
  const emailPayloads: EmailPayload[] = [];
  const skippedDatasets: Array<{ id: string; reason: string }> = [];

  for (const datasetId of resolvedDatasets) {
    const dataset = db.prepare("SELECT name, current_version FROM datasets WHERE id = ?")
      .get(datasetId) as { name: string; current_version: string | null } | undefined;
    if (!dataset?.current_version) {
      console.error(`[webhook] ALERT dataset ${datasetId} has no current_version — skipping in this delivery (order ${session.id})`);
      skippedDatasets.push({ id: datasetId, reason: "no_current_version" });
      continue;
    }
    const versionRow = db.prepare("SELECT r2_key FROM versions WHERE dataset_id = ? AND version = ?")
      .get(datasetId, dataset.current_version) as { r2_key: string } | undefined;
    if (!versionRow) {
      console.error(`[webhook] ALERT no version row for ${datasetId}@${dataset.current_version} — skipping (order ${session.id})`);
      skippedDatasets.push({ id: datasetId, reason: "version_row_missing" });
      continue;
    }
    emailPayloads.push({ datasetId, datasetName: dataset.name, r2Key: versionRow.r2_key, version: dataset.current_version });
  }

  if (emailPayloads.length === 0) {
    // Every dataset failed pre-resolution — that's catastrophic, retry is OK.
    console.error(`[webhook] no datasets could be resolved for order ${session.id} — returning 500 to trigger Stripe retry`);
    return c.json({ error: "all_datasets_unresolvable", skipped: skippedDatasets }, 500);
  }

  // H2: Wrap order + ALL entitlement inserts in one atomic transaction.
  // better-sqlite3 transactions are synchronous — emails are sent outside.
  const insertOrderAndEntitlements = db.transaction(() => {
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
    const txOrderId = Number(orderInfo.lastInsertRowid);

    const entStmt = db.prepare(`
      INSERT INTO entitlements (customer_id, dataset_id, order_id, updates_until, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(customer_id, dataset_id) DO UPDATE SET
        updates_until = MAX(updates_until, excluded.updates_until),
        order_id = excluded.order_id
    `);
    for (const { datasetId } of emailPayloads) {
      entStmt.run(customerId, datasetId, txOrderId, updatesUntil, now);
    }
    return txOrderId;
  });

  let orderId: number;
  try {
    orderId = insertOrderAndEntitlements();
  } catch (err) {
    console.error("[webhook] transaction failed — rolling back:", err);
    return c.json({ error: "db_transaction_failed" }, 500);
  }

  // Send emails outside the transaction (async — transaction is already committed)
  for (const { datasetId, datasetName, r2Key, version } of emailPayloads) {
    try {
      const downloadUrl = await signedDownloadUrl(r2Key, 48 * 3600);
      const emailResult = await sendDownloadEmail({
        to: email,
        datasetName,
        downloadUrl,
        accountUrl: `${baseUrl}${locale === "fr" ? "/account" : "/" + locale + "/account"}`,
        version,
        locale,
      });
      if (!emailResult.sent) {
        console.warn(`[webhook] download email for ${datasetId} not sent: ${emailResult.reason}`);
      }
    } catch (err) {
      console.error(`[webhook] email failed for ${datasetId}:`, err);
    }
  }

  return c.json({
    received: true,
    order_id: orderId,
    datasets: emailPayloads.map((p) => p.datasetId),
    skipped: skippedDatasets.length > 0 ? skippedDatasets : undefined,
  });
});
