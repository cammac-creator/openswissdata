import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sessionCreateMock = vi.fn();
vi.mock("../../src/lib/stripe.js", () => ({
  stripe: () => ({
    checkout: { sessions: { create: sessionCreateMock } },
  }),
  resetStripeClient: vi.fn(),
}));

import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("POST /api/checkout/session", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-co-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.BASE_URL = "https://www.openswissdata.com";
    process.env.STRIPE_PRICE_BUNDLE = "price_test_bundle";
    process.env.NODE_ENV = "test";
    const db = getDb();
    const now = Date.now();
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("tares", "TARES", "tares", 29900, "price_test_tares", now);
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("classifications", "Classifications", "classifications", 39900, "price_test_class", now);
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("finma", "FINMA", "finma", 29900, "price_test_finma", now);
    closeDb();
    sessionCreateMock.mockResolvedValue({ id: "cs_test_abc", url: "https://checkout.stripe.com/pay/cs_test_abc" });
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.STRIPE_PRICE_BUNDLE;
    sessionCreateMock.mockReset();
  });

  it("creates a session for a single dataset and returns the URL", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["tares"], email: "alice@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://checkout.stripe.com/pay/cs_test_abc");
    expect(body.session_id).toBe("cs_test_abc");
    expect(sessionCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      mode: "payment",
      customer_email: "alice@example.com",
      line_items: [{ price: "price_test_tares", quantity: 1 }],
      metadata: { dataset_ids: "tares" },
    }));
  });

  it("creates a session for multiple datasets", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["tares", "finma"], email: "bob@example.com" }),
    });
    expect(res.status).toBe(200);
    const call = sessionCreateMock.mock.calls[0][0];
    expect(call.line_items).toEqual([
      { price: "price_test_tares", quantity: 1 },
      { price: "price_test_finma", quantity: 1 },
    ]);
    expect(call.metadata.dataset_ids).toBe("tares,finma");
  });

  it("uses bundle price when dataset_ids=['bundle']", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["bundle"], email: "carol@example.com" }),
    });
    expect(res.status).toBe(200);
    const call = sessionCreateMock.mock.calls[0][0];
    expect(call.line_items).toEqual([{ price: "price_test_bundle", quantity: 1 }]);
  });

  it("rejects bundle combined with individual datasets", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["bundle", "tares"], email: "x@y.com" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("bundle_cannot_be_combined_with_individual_datasets");
  });

  it("rejects empty dataset_ids", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: [], email: "x@y.com" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid email", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["tares"], email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects unknown dataset_id value", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["unknown"], email: "x@y.com" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 502 if Stripe throws", async () => {
    sessionCreateMock.mockRejectedValueOnce(new Error("rate limited"));
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["tares"], email: "x@y.com" }),
    });
    expect(res.status).toBe(502);
  });
});
