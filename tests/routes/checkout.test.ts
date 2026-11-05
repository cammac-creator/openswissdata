// Ces tests vérifient le métier ; checkout-limits.test.ts exerce la protection réelle sans désactivation globale.
vi.mock('../../src/lib/checkout-limits.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/lib/checkout-limits.js')>(), consumeCheckoutLimit: () => ({ allowed: true }),
}));
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
      metadata: expect.objectContaining({ dataset_ids: "tares", locale: "fr", terms_version: "2026-09-26", terms_locale: "fr" }),
      consent_collection: { terms_of_service: "required" },
    }));
  });

  it.each(["fr","de","en"])("impose le contrat %s côté serveur et ignore les métadonnées forgées par le navigateur", async locale => {
    const response = await createApp().request("/api/checkout/session", {
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({dataset_ids:["finma"],locale,metadata:{terms_version:"faux",terms_sha256:"faux"},consent_collection:{terms_of_service:"none"}}),
    });
    expect(response.status).toBe(200);
    const params = sessionCreateMock.mock.calls[0][0];
    expect(params.consent_collection).toEqual({terms_of_service:"required"});
    expect(params.metadata).toMatchObject({terms_version:"2026-09-26",terms_locale:locale,terms_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)});
    expect(params.custom_text.terms_of_service_acceptance.message).toContain(`https://www.openswissdata.com${locale === "fr" ? "" : "/"+locale}/legal/versions/2026-09-26/cgv`);
    expect(params.custom_text.submit.message).toContain("14");
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

  it("propagates locale to Stripe Checkout UI and metadata", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["tares"], email: "de@example.com", locale: "de" }),
    });
    expect(res.status).toBe(200);
    const call = sessionCreateMock.mock.calls[0][0];
    expect(call.locale).toBe("de");
    expect(call.metadata.locale).toBe("de");
    expect(call.success_url).toContain("/de/account?checkout=success");
    expect(call.cancel_url).toContain("/de/bundle");
    expect(call.billing_address_collection).toBe("required");
    expect(call.custom_fields[0].key).toBe("company");
    expect(call.customer_creation).toBe("always");
    expect(call.invoice_creation).toBeUndefined();
  });

  it("fixe le français si la langue est absente pour aligner le paiement et le contrat", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["tares"], email: "x@y.com" }),
    });
    expect(res.status).toBe(200);
    const call = sessionCreateMock.mock.calls[0][0];
    expect(call.locale).toBe("fr");
    expect(call.metadata.locale).toBe("fr");
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

// Classifications et le lot sont retirés de la vente (décision du 05.11.2026, points 4 et sa précision).
// La base et le prix du lot sont bien présents : seul le retrait peut expliquer le refus.
describe("POST /api/checkout — fichiers retirés de la vente", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-retrait-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.BASE_URL = "https://www.openswissdata.com";
    process.env.STRIPE_PRICE_BUNDLE = "price_test_bundle";
    process.env.NODE_ENV = "test";
    const db = getDb();
    const now = Date.now();
    for (const [id, cents] of [["tares", 29900], ["classifications", 39900], ["finma", 29900]] as const) {
      db.prepare("INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, id, id, cents, `price_test_${id}`, now);
    }
    closeDb();
    sessionCreateMock.mockResolvedValue({ id: "cs_test_retrait", url: "https://checkout.stripe.com/pay/cs_test_retrait" });
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.STRIPE_PRICE_BUNDLE;
    sessionCreateMock.mockReset();
  });

  const postJson = (dataset_ids: string[], locale?: string) => createApp().request("/api/checkout/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataset_ids, ...(locale ? { locale } : {}) }),
  });
  const postForm = (body: string) => createApp().request("/api/checkout/start", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  it.each([
    [["classifications"]],
    [["bundle"]],
    [["tares", "classifications"]],
    [["classifications", "finma"]],
  ])("JSON : refuse %j avant tout appel à Stripe", async dataset_ids => {
    const res = await postJson(dataset_ids);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "dataset_not_for_sale" });
    expect(sessionCreateMock).not.toHaveBeenCalled();
  });

  it.each([
    ["dataset_ids=classifications", "https://www.openswissdata.com/datasets/classifications"],
    ["dataset_ids=bundle", "https://www.openswissdata.com/bundle"],
    ["dataset_ids=tares%2Cclassifications", "https://www.openswissdata.com/datasets/classifications"],
    ["dataset_ids=classifications&locale=de", "https://www.openswissdata.com/de/datasets/classifications"],
    ["dataset_ids=bundle&locale=en", "https://www.openswissdata.com/en/bundle"],
  ])("formulaire : %s renvoie vers la page du fichier, sans passer par Stripe", async (body, location) => {
    const res = await postForm(body);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(location);
    expect(sessionCreateMock).not.toHaveBeenCalled();
  });

  it.each(["tares", "finma"])("%s reste en vente, en JSON et par formulaire", async id => {
    const json = await postJson([id]);
    expect(json.status).toBe(200);
    const form = await postForm(`dataset_ids=${id}`);
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("https://checkout.stripe.com/pay/cs_test_retrait");
    expect(sessionCreateMock).toHaveBeenCalledTimes(2);
    for (const [params] of sessionCreateMock.mock.calls) {
      expect(params.line_items).toEqual([{ price: `price_test_${id}`, quantity: 1 }]);
    }
  });

  it("le panier TARES et FINMA reste possible", async () => {
    const res = await postJson(["tares", "finma"]);
    expect(res.status).toBe(200);
    expect(sessionCreateMock).toHaveBeenCalledTimes(1);
  });
});

// P0 safety valve: MCP subscription checkout is CLOSED unless MCP_SUBSCRIPTIONS_OPEN==="true".
describe("POST /api/checkout — subscription caisse fermée (MCP_SUBSCRIPTIONS_OPEN)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-close-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.BASE_URL = "https://www.openswissdata.com";
    process.env.STRIPE_PRICE_MCP_STANDALONE = "price_sub_standalone";
    process.env.NODE_ENV = "test";
    getDb();
    closeDb();
    sessionCreateMock.mockResolvedValue({ id: "cs_sub", url: "https://checkout.stripe.com/pay/cs_sub" });
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.STRIPE_PRICE_MCP_STANDALONE;
    delete process.env.MCP_SUBSCRIPTIONS_OPEN;
    sessionCreateMock.mockReset();
  });

  it("returns 503 on /session for mcp_standalone when closed (default)", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["mcp_standalone"], email: "x@y.com" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("subscriptions_temporarily_closed");
    expect(sessionCreateMock).not.toHaveBeenCalled();
  });

  it("redirects /start to /pricing?checkout=closed when closed", async () => {
    const app = createApp();
    const res = await app.request("/api/checkout/start", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "dataset_ids=mcp_standalone",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/pricing?checkout=closed");
    expect(sessionCreateMock).not.toHaveBeenCalled();
  });

  it("creates a subscription session when MCP_SUBSCRIPTIONS_OPEN=true", async () => {
    process.env.MCP_SUBSCRIPTIONS_OPEN = "true";
    const app = createApp();
    const res = await app.request("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_ids: ["mcp_standalone"], email: "x@y.com", client_id: "osd_tiers", metadata: {mcp_provisioning_version: "faux"} }),
    });
    expect(res.status).toBe(200);
    const call = sessionCreateMock.mock.calls[0][0];
    expect(call.mode).toBe("subscription");
    expect(call.metadata).toEqual({dataset_ids: "mcp_standalone", locale: "fr", mcp_provisioning_version: "2026-09-27"});
    expect(call.client_id).toBeUndefined();
    expect(call.line_items).toEqual([{ price: "price_sub_standalone", quantity: 1 }]);
  });
});
