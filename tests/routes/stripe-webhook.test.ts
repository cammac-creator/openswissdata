import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/stripe.js", () => ({
  stripe: vi.fn(() => ({
    webhooks: { constructEventAsync: vi.fn() },
  })),
}));

vi.mock("../../src/lib/r2.js", () => ({
  signedDownloadUrl: vi.fn().mockResolvedValue("https://signed.example.com/zip"),
  uploadZip: vi.fn(),
}));

vi.mock("../../src/lib/email.js", () => ({
  sendDownloadEmail: vi.fn().mockResolvedValue({ sent: true }),
  sendMagicLinkEmail: vi.fn(),
}));

import { stripe } from "../../src/lib/stripe.js";
import { signedDownloadUrl as signedUrlMock } from "../../src/lib/r2.js";
import { sendDownloadEmail as sendEmailMock } from "../../src/lib/email.js";

// Typed accessors for mock functions
const constructEventAsyncMock = vi.fn();
(stripe as ReturnType<typeof vi.fn>).mockImplementation(() => ({
  webhooks: { constructEventAsync: constructEventAsyncMock },
}));

import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("POST /api/webhook/stripe", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-wh-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.BASE_URL = "https://www.openswissdata.com";
    process.env.NODE_ENV = "test";

    const db = getDb();
    const now = Date.now();
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, current_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("tares", "TARES Dataset", "tares", 29900, "price_t", "2026.04.22", now);
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, current_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("classifications", "Classifications", "classifications", 39900, "price_c", "2026.04.22", now);
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, current_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("finma", "FINMA", "finma", 29900, "price_f", "2026.04.22", now);
    db.prepare("INSERT INTO versions (dataset_id, version, r2_key, sha256, size_bytes, released_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("tares", "2026.04.22", "tares/2026.04.22.zip", "a".repeat(64), 100, now);
    db.prepare("INSERT INTO versions (dataset_id, version, r2_key, sha256, size_bytes, released_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("classifications", "2026.04.22", "classifications/2026.04.22.zip", "b".repeat(64), 100, now);
    db.prepare("INSERT INTO versions (dataset_id, version, r2_key, sha256, size_bytes, released_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("finma", "2026.04.22", "finma/2026.04.22.zip", "c".repeat(64), 100, now);
    closeDb();

    constructEventAsyncMock.mockReset();
    signedUrlMock.mockClear();
    sendEmailMock.mockClear();
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.BASE_URL;
  });

  it("returns 400 without stripe-signature header", async () => {
    const app = createApp();
    const res = await app.request("/api/webhook/stripe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "checkout.session.completed" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid signature", async () => {
    constructEventAsyncMock.mockRejectedValueOnce(new Error("bad signature"));
    const app = createApp();
    const res = await app.request("/api/webhook/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "xxx" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  it("creates customer/order/entitlement for single dataset", async () => {
    constructEventAsyncMock.mockResolvedValueOnce({
      type: "checkout.session.completed",
      data: { object: {
        id: "cs_test_1",
        customer_email: "alice@example.com",
        payment_intent: "pi_t1",
        amount_total: 29900,
        metadata: { dataset_ids: "tares" },
      }},
    });
    const app = createApp();
    const res = await app.request("/api/webhook/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "ok" },
      body: "{}",
    });
    expect(res.status).toBe(200);

    const db = getDb();
    const cust = db.prepare("SELECT id FROM customers WHERE email = ?").get("alice@example.com") as any;
    expect(cust).toBeDefined();
    const order = db.prepare("SELECT * FROM orders WHERE stripe_session_id = ?").get("cs_test_1") as any;
    expect(order.amount_chf).toBe(29900);
    const ent = db.prepare("SELECT * FROM entitlements WHERE customer_id = ?").all(cust.id) as any[];
    expect(ent).toHaveLength(1);
    expect(ent[0].dataset_id).toBe("tares");

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe("alice@example.com");
    expect(sendEmailMock.mock.calls[0][0].datasetName).toBe("TARES Dataset");
  });

  it("expands bundle to 3 datasets with 3 entitlements and 3 emails", async () => {
    constructEventAsyncMock.mockResolvedValueOnce({
      type: "checkout.session.completed",
      data: { object: {
        id: "cs_test_bundle",
        customer_email: "bob@example.com",
        payment_intent: "pi_tb",
        amount_total: 79900,
        metadata: { dataset_ids: "bundle" },
      }},
    });
    const app = createApp();
    const res = await app.request("/api/webhook/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "ok" },
      body: "{}",
    });
    expect(res.status).toBe(200);

    const db = getDb();
    const cust = db.prepare("SELECT id FROM customers WHERE email = ?").get("bob@example.com") as any;
    const ents = db.prepare("SELECT dataset_id FROM entitlements WHERE customer_id = ?").all(cust.id) as any[];
    expect(ents.map((e: any) => e.dataset_id).sort()).toEqual(["classifications", "finma", "tares"]);
    expect(sendEmailMock).toHaveBeenCalledTimes(3);
  });

  it("is idempotent — second delivery of same event does not duplicate", async () => {
    constructEventAsyncMock.mockResolvedValue({
      type: "checkout.session.completed",
      data: { object: {
        id: "cs_test_dup",
        customer_email: "carol@example.com",
        payment_intent: "pi_tc",
        amount_total: 29900,
        metadata: { dataset_ids: "finma" },
      }},
    });
    const app = createApp();
    const r1 = await app.request("/api/webhook/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "ok" },
      body: "{}",
    });
    expect(r1.status).toBe(200);
    const r2 = await app.request("/api/webhook/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "ok" },
      body: "{}",
    });
    expect(r2.status).toBe(200);
    const body2 = await r2.json();
    expect(body2.idempotent).toBe(true);

    const db = getDb();
    const orders = db.prepare("SELECT * FROM orders WHERE stripe_session_id = ?").all("cs_test_dup");
    expect(orders).toHaveLength(1);
  });

  it("still returns 200 when Resend is unconfigured (graceful degradation)", async () => {
    sendEmailMock.mockResolvedValueOnce({ sent: false, reason: "no_api_key" });
    constructEventAsyncMock.mockResolvedValueOnce({
      type: "checkout.session.completed",
      data: { object: {
        id: "cs_test_noresend",
        customer_email: "dave@example.com",
        payment_intent: "pi_d",
        amount_total: 29900,
        metadata: { dataset_ids: "tares" },
      }},
    });
    const app = createApp();
    const res = await app.request("/api/webhook/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "ok" },
      body: "{}",
    });
    expect(res.status).toBe(200);

    const db = getDb();
    const ent = db.prepare("SELECT * FROM entitlements").all();
    expect(ent).toHaveLength(1);
  });

  it("ignores non-checkout events gracefully", async () => {
    constructEventAsyncMock.mockResolvedValueOnce({
      type: "customer.created",
      data: { object: { id: "cus_1" } },
    });
    const app = createApp();
    const res = await app.request("/api/webhook/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "ok" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ignored).toBe("customer.created");
  });
});
