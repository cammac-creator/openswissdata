import { Hono, type Context } from "hono";
import { z } from "zod";
import { oauthWrite } from "../mcp/oauth/transaction.js";
import type { Stripe } from "stripe";
import { getDb } from "../lib/db.js";
import { stripe } from "../lib/stripe.js";
import { checkoutLanguage } from "../lib/crm-language.js";
import { recordOrderLegal } from "../lib/order-legal.js";
import { sendMcpCredentialsEmail, parseLocale } from "../lib/email.js";
import { deliveryStatus } from "../lib/order-delivery.js";
import { FINANCIAL_EVENTS, enqueueFinancialEvent, applyOrderFinancialState } from "../lib/stripe-financial.js";
import { UPDATE_PERIOD_MS, refreshOrderRights } from "../lib/order-rights.js";
import { generateClientId, generateClientSecret, hashToken } from "../mcp/oauth/crypto.js";
import {
  insertClient,
  findClientBySubscriptionId,
  setClientTier,
} from "../mcp/oauth/store.js";
import { TIER_DEFAULT_SCOPES, SKU_TO_TIER, MCP_PROVISIONING_VERSION, type Tier } from "../mcp/oauth/scopes.js";

export const stripeWebhookRoute = new Hono();

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

/** Accepte aussi les références développées par Stripe, sans les enregistrer comme objets. */
function stripeReference(value: unknown, prefix: string): string | null {
  const id = typeof value === "string" ? value
    : value && typeof value === "object" && "id" in value ? value.id : null;
  return typeof id === "string" && id.length <= 255 &&
    new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(id) ? id : null;
}

/**
 * L'email déclaré à l'inscription d'une application n'est jamais une preuve
 * de propriété. Chaque nouvel abonnement reçoit une application et un secret
 * distincts. Le reçu durable dédoublonne aussi les rejeux après résiliation.
 */
async function handleSubscriptionCheckout(
  session: Stripe.Checkout.Session,
  datasetIds: string[],
  c: Context,
) {
  const sku = datasetIds.find(id => Object.hasOwn(SKU_TO_TIER, id));
  const tier = sku ? SKU_TO_TIER[sku] : undefined;
  // Le compte Stripe peut aussi recevoir des achats d'autres projets.
  if (!tier) return c.json({ received: true, mcp: { provisioned: false, reason: "unknown_sku" } });
  const subId = stripeReference(session.subscription, "sub");
  const stripeCustomerId = stripeReference(session.customer, "cus");
  const sessionId = stripeReference(session.id, "cs");
  if (session.mode !== "subscription" || datasetIds.length !== 1 || !subId || !stripeCustomerId || !sessionId) {
    console.error("[webhook] références ou mode MCP invalides ; vérification nécessaire", {session: sessionId});
    return c.json({ error: "invalid_subscription_checkout" }, 400);
  }
  // Les coordonnées finales de Checkout priment sur un préremplissage.
  const parsedEmail = z.string().max(320).email().safeParse(session.customer_details?.email ?? session.customer_email);
  if (!parsedEmail.success) {
    console.error("[webhook] coordonnées MCP inutilisables ; vérification nécessaire", {session: sessionId});
    return c.json({ error: "invalid_subscription_email" }, 400);
  }
  const email = parsedEmail.data;
  const metaLocale = session.metadata?.locale;

  let result;
  try {
    result = oauthWrite(() => {
      const db = getDb();
      const now = Date.now();
      const receipt = db.prepare(`SELECT c.client_id, c.tier FROM mcp_subscription_checkouts p
        JOIN mcp_clients c ON c.client_id=p.client_id WHERE p.subscription_id=?`).get(subId) as
        {client_id: string; tier: Tier} | undefined;
      if (receipt) return { idempotent: true as const, clientId: receipt.client_id, tier: receipt.tier };

      // Compatibilité des attributions antérieures : seul l'identifiant Stripe
      // déjà associé fait foi. Aucun rapprochement avec l'email d'une application.
      const already = findClientBySubscriptionId(subId);
      if (already) {
        db.prepare(`INSERT INTO mcp_subscription_checkouts(subscription_id,checkout_session_id,client_id,created_at)
          VALUES(?,?,?,?)`).run(subId, sessionId, already.client_id, now);
        return { idempotent: true as const, clientId: already.client_id, tier: already.tier };
      }
      // Un ancien achat sans association conservée pourrait avoir déjà été
      // résilié. Le nouveau parcours doit être attesté avant toute création.
      if (session.metadata?.mcp_provisioning_version !== MCP_PROVISIONING_VERSION) {
        return { requiresReview: true as const };
      }
      const customerRow = db.prepare("SELECT id FROM customers WHERE email=?").get(email) as {id: number} | undefined;
      const customerId = customerRow?.id ?? Number(db.prepare(
        "INSERT INTO customers(email,stripe_customer_id,locale,created_at) VALUES(?,?,?,?)"
      ).run(email, stripeCustomerId, parseLocale(metaLocale), now).lastInsertRowid);
      if (customerRow) db.prepare("UPDATE customers SET stripe_customer_id=COALESCE(stripe_customer_id,?) WHERE id=?")
        .run(stripeCustomerId, customerId);
      const locale = checkoutLanguage(customerId, metaLocale);
      // Ce suivi facultatif absorbe ses erreurs. Un ROLLBACK SQLite global
      // doit néanmoins interdire toute nouvelle écriture hors transaction.
      if (!db.inTransaction) throw new Error("subscription_transaction_aborted");
      const clientId = generateClientId();
      const clientSecret = generateClientSecret();
      insertClient({
        client_id: clientId,
        client_secret_hash: hashToken(clientSecret),
        name: (session.customer_details?.name ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 120) || "Application MCP",
        email, tier, scopes: TIER_DEFAULT_SCOPES[tier],
        customer_id: customerId, stripe_subscription_id: subId,
      });
      db.prepare(`INSERT INTO mcp_subscription_checkouts(subscription_id,checkout_session_id,client_id,created_at)
        VALUES(?,?,?,?)`).run(subId, sessionId, clientId, now);
      return { idempotent: false as const, clientId, clientSecret, tier, locale };
    });
  } catch {
    // Une écriture non enregistrée doit pouvoir être rejouée par Stripe.
    console.error("[webhook] attribution MCP non enregistrée ; rejeu Stripe nécessaire", {session: sessionId});
    c.header("Retry-After", "1");
    return c.json({ error: "subscription_not_saved" }, 503);
  }
  if ("requiresReview" in result) {
    console.error("[webhook] achat MCP ancien ou inconnu sans attribution conservée ; vérification nécessaire", {session: sessionId});
    return c.json({ error: "subscription_requires_review" }, 409);
  }
  if (result.idempotent) return c.json({ received: true,
    mcp: { provisioned: true, idempotent: true, client_id: result.clientId, tier: result.tier } });

  // La livraison durable reste un chantier distinct. Après enregistrement,
  // ne jamais recréer un secret ni renvoyer à l'aveugle sur un rejeu Stripe.
  let sent = false;
  try {
    sent = (await sendMcpCredentialsEmail({
      to: email, clientId: result.clientId, clientSecret: result.clientSecret,
      tier: result.tier, locale: result.locale,
      authorizationEndpoint: `${mcpBaseUrl()}/oauth/authorize`,
      tokenEndpoint: `${mcpBaseUrl()}/oauth/token`,
    })).sent;
  } catch { /* L'état enregistré reste acquis ; l'envoi demande une vérification. */ }
  if (!sent) console.error("[webhook] remise du secret MCP non confirmée ; vérification nécessaire",
    {session: sessionId, client: result.clientId});
  return c.json({ received: true,
    mcp: { provisioned: true, action: "created", client_id: result.clientId, tier: result.tier,
      delivery: sent ? "sent" : "review" } });
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

  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const expectedLive = /^(sk|rk)_live_/.test(key) ? true : /^(sk|rk)_test_/.test(key) ? false : null;
  if (expectedLive !== null && event.livemode !== expectedLive) return c.json({ error: "stripe_mode_mismatch" }, 400);
  if (FINANCIAL_EVENTS.has(event.type)) {
    try {
      return c.json({received:true,financial_sync_queued:enqueueFinancialEvent(event)});
    } catch {
      console.error("[webhook] notification financière non enregistrée ; rejeu Stripe nécessaire");
      return c.json({error:"financial_event_not_saved"},500);
    }
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
    session.mode === "subscription" || subscriptionDatasetIds.some((id) => Object.hasOwn(SKU_TO_TIER, id));
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
      recordOrderLegal(db, orderId, session, event);
      // Conserver un droit manuel existant avant l'ajout d'une nouvelle commande.
      db.prepare(`INSERT OR IGNORE INTO order_grants(order_id,dataset_id,updates_until,created_at)
        SELECT e.order_id,e.dataset_id,e.updates_until,e.created_at FROM entitlements e
        JOIN orders o ON o.id=e.order_id AND o.customer_id=e.customer_id JOIN datasets d ON d.id=e.dataset_id
        WHERE e.customer_id=?`).run(customerId);
      for (const datasetId of datasets) {
        db.prepare("INSERT INTO order_grants(order_id,dataset_id,updates_until,created_at) VALUES(?,?,?,?)")
          .run(orderId,datasetId,now + UPDATE_PERIOD_MS,now);
        db.prepare(`INSERT INTO order_deliveries(order_id,dataset_id,locale,next_attempt_at,created_at) VALUES(?,?,?,?,?)`)
          .run(orderId, datasetId, locale, now, now);
      }
      refreshOrderRights(db,customerId);
      applyOrderFinancialState(db,orderId,true);
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
