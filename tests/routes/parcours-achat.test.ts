// tâche osd.T06 : une commande fictive de FINMA suivie de bout en bout, à travers les routes réelles.
//
// Les autres tests exercent chaque étape séparément (checkout.test.ts, stripe-webhook*.test.ts,
// order-legal-version.test.ts, delivery-contract.test.ts, download.test.ts, account.test.ts).
// Celui-ci enchaîne UNE SEULE commande : session de paiement → webhook signé localement
// (comme stripe-webhook-signature.test.ts) → preuve des CGV en base → livraison prête (lien R2
// simulé) → la commande visible dans le compte du client. Stripe et R2 sont simulés ; aucun
// appel réseau réel, aucune vraie clé.
import '../helpers/session-origin.js';

// Même protection contournée que checkout.test.ts : le métier est testé ici, pas le plafond de débit.
vi.mock('../../src/lib/checkout-limits.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/lib/checkout-limits.js')>(), consumeCheckoutLimit: () => ({ allowed: true }),
}));
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Stripe from "stripe";

// La création de session Stripe est simulée (pas de réseau) ; la vérification de signature
// du webhook, elle, reste réelle : on réutilise le même `webhooks` que stripe-webhook-signature.test.ts,
// construit avec une clé d'en-tête purement factice (elle ne sert qu'à instancier le SDK).
const sessionCreateMock = vi.fn();
const realWebhooks = new Stripe("sk_test_en_tete_seulement").webhooks;
vi.mock("../../src/lib/stripe.js", () => ({
  stripe: () => ({
    checkout: { sessions: { create: sessionCreateMock } },
    webhooks: realWebhooks,
  }),
  resetStripeClient: vi.fn(),
}));

// Même simulation de l'envoi mail que stripe-webhook.test.ts : aucun appel Resend réel.
vi.mock("../../src/lib/email.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/lib/email.js")>(),
  sendPreparedEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

// Même simulation R2 que delivery-contract.test.ts et download.test.ts : aucun objet réel signé.
const { signedUrlMock } = vi.hoisted(() => ({ signedUrlMock: vi.fn() }));
vi.mock("../../src/lib/r2.js", () => ({ signedDownloadUrl: signedUrlMock, uploadZip: vi.fn() }));

import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { processOrderDeliveries } from "../../src/lib/order-delivery.js";
import { sendPreparedEmail } from "../../src/lib/email.js";
import { termsDigest } from "../../src/lib/order-legal.js";

const send = vi.mocked(sendPreparedEmail);
const WEBHOOK_SECRET = "whsec_" + "a1".repeat(16);
const sign = (payload: string) => realWebhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

describe("Parcours d'achat de bout en bout : une commande FINMA suivie à travers les routes réelles", () => {
  let tmp: string;
  const BUYER_EMAIL = "cliente-finma@example.test";

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-parcours-"));
    vi.stubEnv("DATABASE_PATH", join(tmp, "parcours.sqlite"));
    vi.stubEnv("BASE_URL", "https://www.openswissdata.com");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_factice");
    vi.stubEnv("NODE_ENV", "test");
    const db = getDb();
    const now = Date.now();
    db.prepare(`INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, current_version, created_at)
      VALUES ('finma', 'FINMA', 'finma', 29900, 'price_test_finma', '2026.10.01', ?)`).run(now);
    db.prepare(`INSERT INTO versions (dataset_id, version, r2_key, sha256, size_bytes, released_at)
      VALUES ('finma', '2026.10.01', 'finma/2026.10.01.zip', ?, 123456, ?)`).run("f".repeat(64), now - 1000);
    closeDb();
    sessionCreateMock.mockReset().mockResolvedValue({ id: "cs_test_parcours", url: "https://checkout.stripe.com/pay/cs_test_parcours" });
    send.mockClear().mockResolvedValue({ sent: true });
    signedUrlMock.mockReset().mockResolvedValue("https://compte-fictif.r2.cloudflarestorage.com/osd/finma.zip?X-Amz-Signature=fictive");
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("session → paiement confirmé → CGV prouvées → livraison prête → commande visible dans le compte", async () => {
    const app = createApp();

    // 1) La cliente démarre l'achat : la route réelle crée la session Stripe (simulée).
    const checkoutRes = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["finma"], email: BUYER_EMAIL, locale: "fr" }),
    });
    expect(checkoutRes.status).toBe(200);
    const checkoutBody = await checkoutRes.json() as { session_id: string; url: string };
    expect(checkoutBody.session_id).toBe("cs_test_parcours");
    expect(sessionCreateMock).toHaveBeenCalledTimes(1);
    const sessionParams = sessionCreateMock.mock.calls[0][0] as {
      metadata: Record<string, string>; consent_collection: { terms_of_service: string };
    };
    expect(sessionParams.consent_collection).toEqual({ terms_of_service: "required" });
    // Les métadonnées des CGV (version, langue, empreinte) sortent de la route réelle :
    // c'est elles, et non une valeur recalculée à part, que Stripe renverra signées au webhook.
    expect(sessionParams.metadata).toMatchObject({ dataset_ids: "finma", locale: "fr", terms_sha256: termsDigest("fr") });

    // 2) Stripe notifie le paiement : webhook signé localement avec une clé factice,
    // comme stripe-webhook-signature.test.ts — pas de mock de constructEventAsync.
    const paymentIntentId = "pi_parcours_finma_1";
    const webhookPayload = JSON.stringify({
      id: "evt_parcours_paiement", object: "event", type: "checkout.session.completed",
      livemode: false, created: Math.floor(Date.now() / 1000),
      data: { object: {
        id: "cs_test_parcours", object: "checkout.session", mode: "payment", payment_status: "paid",
        currency: "chf", livemode: false, customer_email: BUYER_EMAIL, payment_intent: paymentIntentId,
        amount_total: 29900, metadata: sessionParams.metadata, consent: { terms_of_service: "accepted" },
      } },
    });
    const webhookRes = await app.request("/api/webhook/stripe", {
      method: "POST", body: webhookPayload,
      headers: { "content-type": "application/json", "stripe-signature": sign(webhookPayload) },
    });
    expect(webhookRes.status).toBe(200);
    const webhookBody = await webhookRes.json() as { received: boolean; order_id: number; idempotent: boolean };
    expect(webhookBody).toMatchObject({ received: true, idempotent: false });
    const orderId = webhookBody.order_id;

    // La commande est payée en base.
    const db = getDb();
    const order = db.prepare("SELECT customer_id, status, amount_chf, items_json, stripe_payment_intent FROM orders WHERE id=?").get(orderId) as
      { customer_id: number; status: string; amount_chf: number; items_json: string; stripe_payment_intent: string };
    expect(order).toMatchObject({ status: "paid", amount_chf: 29900, stripe_payment_intent: paymentIntentId });
    expect(JSON.parse(order.items_json)).toEqual(["finma"]);
    const customerId = order.customer_id;
    expect(db.prepare("SELECT email FROM customers WHERE id=?").get(customerId)).toEqual({ email: BUYER_EMAIL });

    // La preuve des CGV (version, langue, empreinte) est enregistrée pour cette commande.
    const legal = db.prepare("SELECT status, terms_version, locale, document_sha256 FROM order_legal WHERE order_id=?").get(orderId);
    expect(legal).toEqual({ status: "accepted", terms_version: "2026-09-26", locale: "fr", document_sha256: termsDigest("fr") });

    // Un rejeu du même événement Stripe ne duplique ni la commande ni la preuve.
    const replay = await app.request("/api/webhook/stripe", {
      method: "POST", body: webhookPayload,
      headers: { "content-type": "application/json", "stripe-signature": sign(webhookPayload) },
    });
    expect(await replay.json()).toMatchObject({ received: true, order_id: orderId, idempotent: true });
    expect(db.prepare("SELECT COUNT(*) AS n FROM order_legal WHERE order_id=?").get(orderId)).toEqual({ n: 1 });

    // 3) La livraison est prête : le worker traite la commande payée et envoie le lien (mail simulé).
    await processOrderDeliveries();
    const delivery = db.prepare("SELECT state, provider_message_id FROM order_deliveries WHERE order_id=?").get(orderId) as
      { state: string; provider_message_id: string | null };
    expect(delivery.state).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    const tokenRow = db.prepare("SELECT token FROM download_tokens WHERE customer_id=? AND dataset_id='finma'").get(customerId) as { token: string } | undefined;
    expect(tokenRow).toBeDefined();
    const shareToken = tokenRow!.token;

    // Le lien de téléchargement est prêt : prévisualisation GET sans le consommer, puis
    // autorisation POST vers l'adresse signée (R2 simulé).
    const preview = await app.request(`/api/delivery/${shareToken}`);
    expect(preview.status).toBe(200);
    expect(db.prepare("SELECT used_at FROM download_tokens WHERE token=?").get(shareToken)).toEqual({ used_at: null });
    const authorize = await app.request(`/api/delivery/${shareToken}`, { method: "POST", body: "" });
    expect(authorize.status).toBe(302);
    expect(authorize.headers.get("location")).toBe("https://compte-fictif.r2.cloudflarestorage.com/osd/finma.zip?X-Amz-Signature=fictive");
    expect(signedUrlMock).toHaveBeenCalledWith("finma/2026.10.01.zip", 300);
    expect(db.prepare("SELECT used_at FROM download_tokens WHERE token=?").get(shareToken)).toMatchObject({ used_at: expect.any(Number) });

    // 4) Le compte de la cliente voit sa commande, avec la preuve des CGV et le jeu de données acquis.
    const sessionCookieToken = "C".repeat(43);
    db.prepare("INSERT INTO sessions(purpose,token,customer_id,expires_at,created_at) VALUES ('session',?,?,?,?)")
      .run(sessionCookieToken, customerId, Date.now() + 3600_000, Date.now());
    const accountHeaders = { cookie: `__Host-osd_session=${sessionCookieToken}` };
    const ordersRes = await app.request("/api/account/orders", { headers: accountHeaders });
    expect(ordersRes.status).toBe(200);
    const ordersBody = await ordersRes.json() as { orders: Array<{ id: number; status: string; amount_chf: number; legal: { status: string; locale: string } }> };
    expect(ordersBody.orders).toHaveLength(1);
    expect(ordersBody.orders[0]).toMatchObject({ id: orderId, status: "paid", amount_chf: 29900, legal: { status: "accepted", locale: "fr" } });
    const datasetsRes = await app.request("/api/account/datasets", { headers: accountHeaders });
    const datasetsBody = await datasetsRes.json() as { datasets: Array<{ id: string }> };
    expect(datasetsBody.datasets.map(d => d.id)).toEqual(["finma"]);
  });
});
