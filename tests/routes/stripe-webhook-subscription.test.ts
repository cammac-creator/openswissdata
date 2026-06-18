/**
 * Subscription delivery path of the Stripe webhook (P0-1).
 *
 * Verifies that a PAID MCP subscription checkout provisions / upgrades an
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
  TIER_DEFAULT_SCOPES,
  TIER_QUOTA,
  SKU_TO_TIER,
  serializeScopes,
  isValidTier,
} from "../../src/mcp/oauth/scopes.js";
import { _resetRateLimit } from "../../src/mcp/rate-limit.js";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function subscriptionCheckoutEvent(over: Record<string, unknown> = {}) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_sub_1",
        mode: "subscription",
        customer: "cus_1",
        subscription: "sub_1",
        customer_email: "newdev@example.com",
        customer_details: { email: "newdev@example.com", name: "New Dev" },
        metadata: { dataset_ids: "mcp_standalone" },
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
        metadata: { dataset_ids: "mcp_business" },
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

  it("upgrades an EXISTING free client (matched by email) without creating a new one", async () => {
    const app = createApp();
    // Pre-register a free client under the same email.
    insertClient({
      client_id: "osd_preexisting",
      client_secret_hash: "hash",
      name: "Existing Dev",
      email: "newdev@example.com",
      tier: "free",
      scopes: TIER_DEFAULT_SCOPES.free,
    });

    constructEventAsyncMock.mockResolvedValueOnce(subscriptionCheckoutEvent());
    const res = await postWebhook(app);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mcp).toMatchObject({ provisioned: true, action: "upgraded", client_id: "osd_preexisting", tier: "standalone" });

    const db = getDb();
    const rows = db.prepare("SELECT * FROM mcp_clients WHERE email = ?").all("newdev@example.com") as any[];
    expect(rows).toHaveLength(1); // upgraded, not duplicated
    expect(rows[0].tier).toBe("standalone");
    expect(rows[0].scopes).toBe(serializeScopes(TIER_DEFAULT_SCOPES.standalone));
    expect(rows[0].stripe_subscription_id).toBe("sub_1");

    // Upgrade email carries NO secret (client keeps its original).
    const arg = (credsEmailMock as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.clientSecret).toBeUndefined();
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

  it("returns 200 (not 500) and provisions nothing when the subscription has no email", async () => {
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
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mcp).toMatchObject({ provisioned: false, reason: "no_email" });

    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) AS n FROM mcp_clients").get() as { n: number };
    expect(count.n).toBe(0);
    expect(credsEmailMock).not.toHaveBeenCalled();
  });

  it("non-regression: a one-shot ZIP checkout (mode=payment) does NOT touch mcp_clients", async () => {
    constructEventAsyncMock.mockResolvedValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_oneshot",
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
