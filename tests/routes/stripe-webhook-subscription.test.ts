/**
 * Subscription delivery path of the Stripe webhook (P0-1).
 *
 * Verifies that a PAID MCP subscription checkout provisions a distinct
 * OAuth client at the right tier, emails its credentials, is idempotent on
 * replay, and is downgraded on cancellation — and that the one-shot ZIP path
 * is untouched (non-regression).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/stripe.js", () => ({
  stripe: vi.fn(() => ({ webhooks: { constructEventAsync: vi.fn() } })),
}));

vi.mock("../../src/lib/r2.js", () => ({
  signedDownloadUrl: vi.fn().mockResolvedValue("https://signed.example.com/zip"),
  uploadZip: vi.fn(),
}));

vi.mock("../../src/lib/email.js", () => ({
  sendDownloadEmail: vi.fn().mockResolvedValue({ sent: true }),
  sendMagicLinkEmail: vi.fn(),
  sendMcpCredentialsEmail: vi.fn().mockResolvedValue({ sent: true }),
  parseLocale: (v: unknown) => (v === "de" || v === "en" ? v : "fr"),
}));

import { stripe } from "../../src/lib/stripe.js";
import { sendMcpCredentialsEmail as credsEmailMock } from "../../src/lib/email.js";

const constructEventAsyncMock = vi.fn();
(stripe as ReturnType<typeof vi.fn>).mockImplementation(() => ({
  webhooks: { constructEventAsync: constructEventAsyncMock },
}));

import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { insertClient, insertToken } from "../../src/mcp/oauth/store.js";
import {
  MCP_PROVISIONING_VERSION,
  TIER_DEFAULT_SCOPES,
  TIER_QUOTA,
  SKU_TO_TIER,
  serializeScopes,
  isValidTier,
} from "../../src/mcp/oauth/scopes.js";
import { _resetRateLimit } from "../../src/mcp/rate-limit.js";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { hashToken } from "../../src/mcp/oauth/crypto.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function subscriptionCheckoutEvent(over: Record<string, unknown> = {}) {
  return {
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_sub_1",
        payment_status: "paid", currency: "chf", amount_total: 4900, livemode: false,
        mode: "subscription",
        customer: "cus_1",
        subscription: "sub_1",
        customer_email: "newdev@example.com",
        customer_details: { email: "newdev@example.com", name: "New Dev" },
        metadata: { dataset_ids: "mcp_standalone", mcp_provisioning_version: MCP_PROVISIONING_VERSION },
        ...over,
      },
    },
  };
}

async function postWebhook(app: ReturnType<typeof createApp>) {
  return app.request("/api/webhook/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "ok" },
    body: "{}",
  });
}

describe("Stripe webhook — MCP subscription delivery", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-whsub-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.BASE_URL = "https://www.openswissdata.com";
    process.env.MCP_BASE_URL = "https://mcp.openswissdata.com";
    process.env.OAUTH_SIGNING_SECRET = "test-oauth-signing-secret-32char";
    process.env.NODE_ENV = "test";

    // Seed one one-shot dataset (for the non-regression test).
    const db = getDb();
    const now = Date.now();
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, current_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("tares", "TARES Dataset", "tares", 29900, "price_t", "2026.04.22", now);
    db.prepare("INSERT INTO versions (dataset_id, version, r2_key, sha256, size_bytes, released_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("tares", "2026.04.22", "tares/2026.04.22.zip", "a".repeat(64), 100, now);
    closeDb();

    constructEventAsyncMock.mockReset();
    (credsEmailMock as ReturnType<typeof vi.fn>).mockClear();
    (credsEmailMock as ReturnType<typeof vi.fn>).mockResolvedValue({ sent: true });
    _resetRateLimit();
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.BASE_URL;
    delete process.env.MCP_BASE_URL;
  });

  it("creates a standalone client + emails credentials for a new mcp_standalone subscriber", async () => {
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent());
    const app = createApp();
    const res = await postWebhook(app);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mcp).toMatchObject({ provisioned: true, action: "created", tier: "standalone" });

    const db = getDb();
    const client = db.prepare("SELECT * FROM mcp_clients WHERE email = ?").get("newdev@example.com") as any;
    expect(client).toBeDefined();
    expect(client.tier).toBe("standalone");
    expect(client.scopes).toBe(serializeScopes(TIER_DEFAULT_SCOPES.standalone));
    expect(client.stripe_subscription_id).toBe("sub_1");
    expect(client.client_id).toMatch(/^osd_/);

    expect(credsEmailMock).toHaveBeenCalledTimes(1);
    const arg = (credsEmailMock as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.to).toBe("newdev@example.com");
    expect(arg.tier).toBe("standalone");
    expect(typeof arg.clientSecret).toBe("string");
    expect(arg.clientSecret.length).toBeGreaterThan(20);
  });

  it("maps mcp_business → business tier (50k/mo)", async () => {
    constructEventAsyncMock.mockResolvedValueOnce(
      subscriptionCheckoutEvent({
        id: "cs_sub_biz",
        subscription: "sub_biz",
        customer_email: "biz@example.com",
        customer_details: { email: "biz@example.com" },
        metadata: { dataset_ids: "mcp_business", mcp_provisioning_version: MCP_PROVISIONING_VERSION },
      }),
    );
    const app = createApp();
    const res = await postWebhook(app);
    expect(res.status).toBe(200);

    const db = getDb();
    const client = db.prepare("SELECT * FROM mcp_clients WHERE email = ?").get("biz@example.com") as any;
    expect(client.tier).toBe("business");
    expect(TIER_QUOTA.business.month).toBe(50_000);
    expect(SKU_TO_TIER.mcp_business).toBe("business");
  });

  it("ne transmet aucun droit à l'application préinscrite sous l'email de l'acheteur", async () => {
    const app = createApp();
    const registration = await app.request("/mcp/oauth/register", {
      method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({name: "Application tierce fictive", email: "newdev@example.com",
        redirect_uris: ["https://tierce.example.test/retour"]}),
    });
    expect(registration.status).toBe(201);
    const registered = await registration.json();
    const db = getDb();
    const before = db.prepare("SELECT * FROM mcp_clients WHERE client_id=?").get(registered.client_id);
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent());
    const res = await postWebhook(app);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mcp).toMatchObject({provisioned: true, action: "created", tier: "standalone"});
    expect(body.mcp.client_id).not.toBe(registered.client_id);
    expect(db.prepare("SELECT * FROM mcp_clients WHERE client_id=?").get(registered.client_id)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) n FROM mcp_clients").get()).toEqual({n: 2});
    const arg = vi.mocked(credsEmailMock).mock.calls[0][0];
    expect(arg.clientSecret).toBeTruthy();
    expect(arg.clientSecret).not.toBe(registered.client_secret);
    expect(db.prepare("SELECT client_secret_hash FROM mcp_clients WHERE client_id=?").get(body.mcp.client_id))
      .toEqual({client_secret_hash: hashToken(arg.clientSecret!)});
    expect(JSON.stringify(body)).not.toContain(arg.clientSecret);
  });

  it("is idempotent on event replay (same subscription id)", async () => {
    constructEventAsyncMock.mockResolvedValue(subscriptionCheckoutEvent());
    const app = createApp();
    const r1 = await postWebhook(app);
    expect(r1.status).toBe(200);
    const r2 = await postWebhook(app);
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.mcp.idempotent).toBe(true);

    const db = getDb();
    const rows = db.prepare("SELECT * FROM mcp_clients WHERE stripe_subscription_id = ?").all("sub_1") as any[];
    expect(rows).toHaveLength(1);
    expect(credsEmailMock).toHaveBeenCalledTimes(1); // not re-sent on replay
  });

  it("downgrades a client to free on customer.subscription.deleted", async () => {
    const app = createApp();
    // First provision.
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent());
    await postWebhook(app);

    // Then cancel.
    constructEventAsyncMock.mockResolvedValueOnce({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1" } },
    });
    const res = await postWebhook(app);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mcp).toMatchObject({ downgraded: true });

    const db = getDb();
    const client = db.prepare("SELECT * FROM mcp_clients WHERE email = ?").get("newdev@example.com") as any;
    expect(client.tier).toBe("free");
    expect(client.scopes).toBe(serializeScopes(TIER_DEFAULT_SCOPES.free));
    expect(client.stripe_subscription_id).toBeNull();
  });

  it("refuse un abonnement sans email sans créer de droit", async () => {
    constructEventAsyncMock.mockResolvedValueOnce(
      subscriptionCheckoutEvent({
        id: "cs_sub_noemail",
        subscription: "sub_noemail",
        customer_email: null,
        customer_details: null,
      }),
    );
    const app = createApp();
    const res = await postWebhook(app);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({error: "invalid_subscription_email"});

    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) AS n FROM mcp_clients").get() as { n: number };
    expect(count.n).toBe(0);
    expect(credsEmailMock).not.toHaveBeenCalled();
  });

  it("non-regression: a one-shot ZIP checkout (mode=payment) does NOT touch mcp_clients", async () => {
    constructEventAsyncMock.mockResolvedValueOnce({
      id: "evt_oneshot", created: 1790400000,
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: "cs_oneshot",
          payment_status: "paid", currency: "chf", livemode: false,
          mode: "payment",
          customer_email: "zipbuyer@example.com",
          payment_intent: "pi_z",
          amount_total: 29900,
          metadata: { dataset_ids: "tares" },
        },
      },
    });
    const app = createApp();
    const res = await postWebhook(app);
    expect(res.status).toBe(200);

    const db = getDb();
    const ents = db.prepare("SELECT * FROM entitlements").all();
    expect(ents).toHaveLength(1); // dataset path ran
    const mcp = db.prepare("SELECT COUNT(*) AS n FROM mcp_clients").get() as { n: number };
    expect(mcp.n).toBe(0); // MCP path did NOT run
    expect(credsEmailMock).not.toHaveBeenCalled();
  });

  it("E2E: a provisioned standalone client can call an advanced MCP tool (not scope-blocked)", async () => {
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent());
    const app = createApp();
    await postWebhook(app);

    // Mint an access token for the freshly provisioned client (skips the PKCE
    // dance — same shape oauthVerify sees in prod after /authorize → /token).
    const db = getDb();
    const client = db.prepare("SELECT client_id FROM mcp_clients WHERE email = ?").get("newdev@example.com") as { client_id: string };
    const accessToken = randomBytes(32).toString("base64url");
    insertToken({
      client_id: client.client_id,
      access_token_plain: accessToken,
      refresh_token_plain: null,
      scope: serializeScopes(TIER_DEFAULT_SCOPES.standalone),
    });

    const res = await app.request("/mcp/jsonrpc", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "tariff_changelog", arguments: { hs8: "84820010" } },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: { code: number } };
    if (body.error) {
      // -32001 = scope/forbidden. The whole point: standalone now has it.
      expect(body.error.code).not.toBe(-32001);
    }
  });

  it("does NOT hijack a client already tied to a different subscription (creates a fresh one)", async () => {
    const app = createApp();
    // Existing PAID client for sub_A under the same email.
    insertClient({
      client_id: "osd_subA",
      client_secret_hash: "hash",
      name: "Dev A",
      email: "newdev@example.com",
      tier: "standalone",
      scopes: TIER_DEFAULT_SCOPES.standalone,
      stripe_subscription_id: "sub_A",
    });

    // A second, DIFFERENT subscription (sub_1) checks out under the same email.
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent());
    const res = await postWebhook(app);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mcp.action).toBe("created"); // not "upgraded"

    const db = getDb();
    const rows = db.prepare("SELECT client_id, stripe_subscription_id FROM mcp_clients WHERE email = ?").all("newdev@example.com") as any[];
    expect(rows).toHaveLength(2); // sub_A client preserved, sub_1 client created
    const subA = rows.find((r) => r.client_id === "osd_subA");
    expect(subA.stripe_subscription_id).toBe("sub_A"); // NOT orphaned
  });

  it("a replay with the same subId but a different payer email stays idempotent (no 2nd client)", async () => {
    const app = createApp();
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent());
    await postWebhook(app);

    constructEventAsyncMock.mockResolvedValueOnce(
      subscriptionCheckoutEvent({ customer_email: "someoneelse@example.com", customer_details: { email: "someoneelse@example.com" } }),
    );
    const res = await postWebhook(app);
    const body = await res.json();
    expect(body.mcp.idempotent).toBe(true);

    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) AS n FROM mcp_clients WHERE stripe_subscription_id = ?").get("sub_1") as { n: number };
    expect(count.n).toBe(1);
  });
  it.each([
    {mode: "payment"}, {subscription: null}, {subscription: ""},
    {subscription: {id: "cus_erreur"}}, {customer: null}, {customer: {id: 23}},
    {id: ""}, {metadata: {dataset_ids: "mcp_standalone,mcp_business"}},
    {metadata: {dataset_ids: "mcp_standalone,tares"}},
    {metadata: {dataset_ids: "mcp_standalone,mcp_standalone"}},
  ])("refuse une attribution ambiguë ou sans référence Stripe (%j)", async over => {
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent(over));
    expect((await postWebhook(createApp())).status).toBe(400);
    expect(getDb().prepare("SELECT COUNT(*) n FROM mcp_clients").get()).toEqual({n: 0});
    expect(getDb().prepare("SELECT COUNT(*) n FROM customers").get()).toEqual({n: 0});
    expect(credsEmailMock).not.toHaveBeenCalled();
  });

  it("ignore un abonnement d'un autre projet et les propriétés héritées", async () => {
    const app = createApp();
    for (const sku of ["autre_projet", "toString", "constructor", "__proto__"]) {
      constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent({metadata: {dataset_ids: sku}}));
      const res = await postWebhook(app);
      expect(res.status).toBe(200);
      expect((await res.json()).mcp).toEqual({provisioned: false, reason: "unknown_sku"});
    }
    expect(getDb().prepare("SELECT COUNT(*) n FROM customers").get()).toEqual({n: 0});
    expect(credsEmailMock).not.toHaveBeenCalled();
  });

  it("accepte les références Stripe développées et les coordonnées finales", async () => {
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent({
      subscription: {id: "sub_1"}, customer: {id: "cus_1"},
      customer_email: "prefill@example.test", customer_details: {email: "final@example.test"},
    }));
    expect((await postWebhook(createApp())).status).toBe(200);
    expect(vi.mocked(credsEmailMock).mock.calls[0][0].to).toBe("final@example.test");
    expect(getDb().prepare("SELECT stripe_subscription_id FROM mcp_clients").get()).toEqual({stripe_subscription_id: "sub_1"});
    expect(getDb().prepare("SELECT stripe_customer_id FROM customers").get()).toEqual({stripe_customer_id: "cus_1"});
  });

  it("ne réattribue pas un ancien achat après résiliation, même après redémarrage", async () => {
    const app = createApp();
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent());
    const original = await (await postWebhook(app)).json();
    constructEventAsyncMock.mockResolvedValueOnce({type: "customer.subscription.deleted", data: {object: {id: "sub_1"}}});
    expect((await postWebhook(app)).status).toBe(200);
    closeDb();
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent());
    const replay = await (await postWebhook(app)).json();
    expect(replay.mcp).toMatchObject({idempotent: true, client_id: original.mcp.client_id, tier: "free"});
    expect(getDb().prepare("SELECT COUNT(*) n FROM mcp_clients").get()).toEqual({n: 1});
    expect(getDb().prepare("SELECT COUNT(*) n FROM mcp_subscription_checkouts").get()).toEqual({n: 1});
    expect(credsEmailMock).toHaveBeenCalledTimes(1);
  });

  it("préserve aussi une application révoquée lors du rejeu", async () => {
    constructEventAsyncMock.mockResolvedValue(subscriptionCheckoutEvent());
    const app = createApp(); await postWebhook(app);
    getDb().exec("UPDATE mcp_clients SET revoked_at=1");
    const before = getDb().prepare("SELECT * FROM mcp_clients").all();
    expect((await (await postWebhook(app)).json()).mcp.idempotent).toBe(true);
    expect(getDb().prepare("SELECT * FROM mcp_clients").all()).toEqual(before);
    expect(credsEmailMock).toHaveBeenCalledTimes(1);
  });

  it("revient intégralement en arrière si l'enregistrement du reçu échoue puis accepte le rejeu", async () => {
    const db = getDb();
    db.exec("CREATE TRIGGER panne_fictive BEFORE INSERT ON mcp_subscription_checkouts BEGIN SELECT RAISE(ABORT,'detail-prive-fictif'); END");
    constructEventAsyncMock.mockResolvedValue(subscriptionCheckoutEvent());
    const app = createApp(); const res = await postWebhook(app);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({error: "subscription_not_saved"});
    for (const table of ["customers", "mcp_clients", "crm_languages", "mcp_subscription_checkouts"]) {
      expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n: 0});
    }
    expect(credsEmailMock).not.toHaveBeenCalled();
    db.exec("DROP TRIGGER panne_fictive");
    expect((await postWebhook(app)).status).toBe(200);
    expect(credsEmailMock).toHaveBeenCalledTimes(1);
  });

  it("refuse rapidement un verrou puis restaure le délai SQLite et permet la reprise", async () => {
    const db = getDb(); const other = new Database(join(tmp, "t.sqlite"));
    other.exec("BEGIN IMMEDIATE");
    try {
      constructEventAsyncMock.mockResolvedValue(subscriptionCheckoutEvent());
      const app = createApp(); const start = Date.now();
      const res = await postWebhook(app);
      expect(res.status).toBe(503); expect(Date.now() - start).toBeLessThan(1000);
      expect(db.pragma("busy_timeout", {simple: true})).toBe(5000);
      expect(db.prepare("SELECT COUNT(*) n FROM customers").get()).toEqual({n: 0});
      expect(credsEmailMock).not.toHaveBeenCalled();
    } finally { other.exec("ROLLBACK"); other.close(); }
    expect((await postWebhook(createApp())).status).toBe(200);
  });

  it("deux notifications concurrentes créent une seule application et un seul envoi", async () => {
    constructEventAsyncMock.mockResolvedValue(subscriptionCheckoutEvent());
    const app = createApp();
    const results = await Promise.all([postWebhook(app), postWebhook(app)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(getDb().prepare("SELECT COUNT(*) n FROM mcp_subscription_checkouts").get()).toEqual({n: 1});
    expect(getDb().prepare("SELECT COUNT(*) n FROM mcp_clients").get()).toEqual({n: 1});
    expect(credsEmailMock).toHaveBeenCalledTimes(1);
  });

  it("une session déjà reçue ne peut pas créer un deuxième abonnement", async () => {
    const app = createApp();
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent()); await postWebhook(app);
    const before = getDb().prepare("SELECT * FROM mcp_clients").all();
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent({subscription: "sub_autre"}));
    expect((await postWebhook(app)).status).toBe(503);
    expect(getDb().prepare("SELECT * FROM mcp_clients").all()).toEqual(before);
    expect(credsEmailMock).toHaveBeenCalledTimes(1);
  });

  it("un échec de livraison n'invente pas une panne d'écriture ni un nouvel envoi au rejeu", async () => {
    constructEventAsyncMock.mockResolvedValue(subscriptionCheckoutEvent());
    vi.mocked(credsEmailMock).mockRejectedValueOnce(new Error("prestataire-fictif"));
    const app = createApp(); const res = await postWebhook(app);
    expect(res.status).toBe(200);
    expect((await res.json()).mcp).toMatchObject({provisioned: true, delivery: "review"});
    expect((await (await postWebhook(app)).json()).mcp.idempotent).toBe(true);
    expect(credsEmailMock).toHaveBeenCalledTimes(1);
  });

  it("conserve l'association Stripe historique sans se servir de l'email", async () => {
    insertClient({client_id: "osd_ancien", client_secret_hash: "fictif", name: "Fictif",
      email: "ancien@example.test", tier: "standalone", scopes: TIER_DEFAULT_SCOPES.standalone,
      stripe_subscription_id: "sub_1"});
    constructEventAsyncMock.mockResolvedValue(subscriptionCheckoutEvent({metadata: {dataset_ids: "mcp_standalone"}}));
    const app = createApp();
    const res = await postWebhook(app);
    expect(res.status).toBe(200);
    expect((await res.json()).mcp).toMatchObject({idempotent: true, client_id: "osd_ancien"});
    expect(getDb().prepare("SELECT COUNT(*) n FROM customers").get()).toEqual({n: 0});
    expect(getDb().prepare("SELECT COUNT(*) n FROM mcp_subscription_checkouts").get()).toEqual({n: 1});
    expect(credsEmailMock).not.toHaveBeenCalled();
  });

  it("un nouvel abonnement après résiliation reste un achat distinct", async () => {
    const app = createApp();
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent()); await postWebhook(app);
    constructEventAsyncMock.mockResolvedValueOnce({type: "customer.subscription.deleted", data: {object: {id: "sub_1"}}});
    await postWebhook(app);
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent({id: "cs_nouveau", subscription: "sub_nouveau"}));
    expect((await (await postWebhook(app)).json()).mcp.action).toBe("created");
    expect(getDb().prepare("SELECT tier,COUNT(*) n FROM mcp_clients GROUP BY tier ORDER BY tier").all())
      .toEqual([{tier: "free", n: 1}, {tier: "standalone", n: 1}]);
    expect(credsEmailMock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(credsEmailMock).mock.calls[0][0].clientSecret)
      .not.toBe(vi.mocked(credsEmailMock).mock.calls[1][0].clientSecret);
  });

  it("le rollback conserve aussi le compte et la préférence préexistants", async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers(email,locale,created_at) VALUES(?,?,?)").run("newdev@example.com", "de", 1);
    const before = db.prepare("SELECT * FROM customers").all();
    db.exec("CREATE TRIGGER panne_fictive BEFORE INSERT ON mcp_subscription_checkouts BEGIN SELECT RAISE(ABORT,'fictif'); END");
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent({metadata: {dataset_ids: "mcp_standalone", locale: "fr", mcp_provisioning_version: MCP_PROVISIONING_VERSION}}));
    expect((await postWebhook(createApp())).status).toBe(503);
    expect(db.prepare("SELECT * FROM customers").all()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) n FROM crm_languages").get()).toEqual({n: 0});
    expect(credsEmailMock).not.toHaveBeenCalled();
  });

  it("ne repart pas hors transaction après une annulation SQLite globale avalée par le suivi de langue", async () => {
    const db = getDb();
    db.prepare("INSERT INTO customers(email,locale,created_at) VALUES(?,?,?)").run("newdev@example.com", "de", 1);
    const before = db.prepare("SELECT * FROM customers").all();
    db.exec("CREATE TRIGGER rollback_fictif BEFORE INSERT ON crm_languages BEGIN SELECT RAISE(ROLLBACK,'rollback-global-fictif'); END");
    constructEventAsyncMock.mockResolvedValue(subscriptionCheckoutEvent({metadata: {dataset_ids: "mcp_standalone", locale: "fr", mcp_provisioning_version: MCP_PROVISIONING_VERSION}}));
    const app = createApp(); const res = await postWebhook(app);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({error: "subscription_not_saved"});
    expect(db.prepare("SELECT * FROM customers").all()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) n FROM mcp_clients").get()).toEqual({n: 0});
    expect(db.prepare("SELECT COUNT(*) n FROM mcp_subscription_checkouts").get()).toEqual({n: 0});
    expect(credsEmailMock).not.toHaveBeenCalled();
    expect(db.inTransaction).toBe(false);
    db.exec("DROP TRIGGER rollback_fictif");
    expect((await postWebhook(app)).status).toBe(200);
  });

  it("le nom reçu du paiement ne conserve ni contrôles ni valeur excessive", async () => {
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent({
      customer_details: {email: "newdev@example.com", name: "\u202e\u0000" + "x".repeat(180)},
    }));
    expect((await postWebhook(createApp())).status).toBe(200);
    expect(getDb().prepare("SELECT name FROM mcp_clients").get()).toEqual({name: "x".repeat(120)});
  });

  it.each([undefined, "ancien", "2027-01-01"])("un ancien paiement sans association ne peut pas recréer des droits (%s)", async version => {
    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent({metadata: {
      dataset_ids: "mcp_standalone", mcp_provisioning_version: version,
    }}));
    const res = await postWebhook(createApp());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({error: "subscription_requires_review"});
    for (const table of ["customers", "mcp_clients", "mcp_subscription_checkouts"]) {
      expect(getDb().prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n: 0});
    }
    expect(credsEmailMock).not.toHaveBeenCalled();
  });

  it("ajoute la table sur une base antérieure sans attribuer de propriétaire", async () => {
    const db = getDb();
    insertClient({client_id: "osd_historique", client_secret_hash: "fictif", name: "Fictif",
      email: "fictif@example.test", tier: "free", scopes: TIER_DEFAULT_SCOPES.free});
    const before = db.prepare("SELECT * FROM mcp_clients").all();
    db.exec("DROP TABLE mcp_subscription_checkouts"); closeDb();
    expect(getDb().prepare("SELECT COUNT(*) n FROM mcp_subscription_checkouts").get()).toEqual({n: 0});
    expect(getDb().prepare("SELECT * FROM mcp_clients").all()).toEqual(before);
    closeDb();
    expect(getDb().prepare("SELECT * FROM mcp_clients").all()).toEqual(before);
    expect(getDb().pragma("foreign_key_check")).toEqual([]);
  });

});

describe("scopes — business tier wiring", () => {
  it("isValidTier accepts business", () => {
    expect(isValidTier("business")).toBe(true);
  });
  it("standalone (Pro 49) grants the full 8-scope premium surface", () => {
    expect(TIER_DEFAULT_SCOPES.standalone).toHaveLength(8);
    expect(TIER_DEFAULT_SCOPES.business).toHaveLength(8);
  });
  it("quota: standalone 5k/mo, business 50k/mo", () => {
    expect(TIER_QUOTA.standalone.month).toBe(5_000);
    expect(TIER_QUOTA.business.month).toBe(50_000);
  });
});
