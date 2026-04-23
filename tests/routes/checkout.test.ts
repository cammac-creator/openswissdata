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

  it("accepts JSON body without email (Stripe will collect it)", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["tares"] }),
    });
    expect(res.status).toBe(200);
    const call = sessionCreateMock.mock.calls[0][0];
    expect(call.customer_email).toBeUndefined();
  });

  // H4: Stripe error must not leak internals to the client
  it("H4: Stripe error response contains only {error: 'checkout_failed'} — no Stripe internals", async () => {
    sessionCreateMock.mockRejectedValueOnce(new Error("rate limited by stripe raised by: api.stripe.com"));
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["tares"], email: "x@y.com" }),
    });
    expect(res.status).toBe(502);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("checkout_failed");
    // Must NOT contain any Stripe internals
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("rate limited");
    expect(bodyStr).not.toContain("stripe.com");
    expect(bodyStr).not.toContain("raised by");
    expect(Object.keys(body)).toEqual(["error"]); // only 'error' key
  });

  // H4: Zod validation error must not expose schema internals
  it("H4: Zod validation error returns {error: 'invalid_body'} without details", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: [] }), // Zod: min(1) violation
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("invalid_body");
    expect(body.details).toBeUndefined(); // no schema leak
  });
});

describe("POST /api/checkout/start (form-encoded → 303 redirect)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-start-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.BASE_URL = "https://www.openswissdata.com";
    process.env.STRIPE_PRICE_BUNDLE = "price_test_bundle";
    process.env.NODE_ENV = "test";
    const db = getDb();
    const now = Date.now();
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("tares", "TARES", "tares", 29900, "price_test_tares", now);
    db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("finma", "FINMA", "finma", 29900, "price_test_finma", now);
    closeDb();
    sessionCreateMock.mockResolvedValue({ id: "cs_test_xyz", url: "https://checkout.stripe.com/pay/cs_test_xyz" });
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.STRIPE_PRICE_BUNDLE;
    sessionCreateMock.mockReset();
  });

  it("redirects (303) to Stripe Checkout URL for a single dataset", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/start", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "dataset_ids=tares",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://checkout.stripe.com/pay/cs_test_xyz");
    const call = sessionCreateMock.mock.calls[0][0];
    expect(call.line_items).toEqual([{ price: "price_test_tares", quantity: 1 }]);
    expect(call.customer_email).toBeUndefined();
    expect(call.metadata.dataset_ids).toBe("tares");
  });

  it("redirects for bundle", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/start", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "dataset_ids=bundle",
    });
    expect(res.status).toBe(303);
    const call = sessionCreateMock.mock.calls[0][0];
    expect(call.line_items).toEqual([{ price: "price_test_bundle", quantity: 1 }]);
  });

  it("forwards optional email when provided via form", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/start", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "dataset_ids=tares&email=test%40example.com",
    });
    expect(res.status).toBe(303);
    const call = sessionCreateMock.mock.calls[0][0];
    expect(call.customer_email).toBe("test@example.com");
  });

  it("rejects invalid dataset_id with 400", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/start", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "dataset_ids=pokemon",
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing dataset_ids with 400", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/start", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(400);
  });

  it("rejects bundle combined with individual dataset via form with 400", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/start", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "dataset_ids=bundle%2Ctares",  // "bundle,tares"
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("bundle_cannot_be_combined");
  });

  // H4: Stripe error on /start must redirect to error page, not render raw error text
  it("H4: Stripe error on /start redirects to /bundle?checkout=error instead of leaking internals", async () => {
    sessionCreateMock.mockRejectedValueOnce(new Error("stripe internal: api key invalid raised by api.stripe.com"));
    const app = createApp();
    const res = await app.request("/api/checkout/start", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "dataset_ids=tares",
    });
    // Should redirect to error page, NOT return a text body with Stripe internals
    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("checkout=error");
    expect(location).not.toContain("stripe");
    expect(location).not.toContain("raised by");
  });
});
