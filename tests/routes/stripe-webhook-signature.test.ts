// Vraie vérification de signature Stripe, sans simuler constructEventAsync.
// Témoin de la sonde de révocation du 28.09.2026 : un événement de type inconnu,
// hors mode live, ne déclenche aucun traitement même lorsqu'il est bien signé.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Stripe from "stripe";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { resetStripeClient } from "../../src/lib/stripe.js";

const SECRET = "whsec_" + "a1".repeat(16);
const webhooks = new Stripe("sk_test_en_tete_seulement").webhooks;
const probe = () => JSON.stringify({ id: "evt_sonde_revocation", object: "event", type: "openswissdata.revocation_probe",
  livemode: false, created: Math.floor(Date.now() / 1000), data: { object: { object: "probe" } } });
const post = (payload: string, signature: string) => createApp().request("/api/webhook/stripe", {
  method: "POST", body: payload, headers: { "content-type": "application/json", "stripe-signature": signature },
});
const signed = (payload: string, secret: string, timestamp?: number) =>
  webhooks.generateTestHeaderString({ payload, secret, ...(timestamp ? { timestamp } : {}) });
const TABLES = ["customers", "orders", "order_deliveries", "stripe_financial_events", "stripe_financial_jobs"];
const counts = () => Object.fromEntries(TABLES.map(t => [t, (getDb().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));

describe("Signature réelle des notifications Stripe", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-signature-"));
    vi.stubEnv("DATABASE_PATH", join(tmp, "test.sqlite"));
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("NODE_ENV", "test");
    resetStripeClient();
  });
  afterEach(() => { closeDb(); resetStripeClient(); rmSync(tmp, { recursive: true, force: true }); vi.unstubAllEnvs(); });

  it("refuse un autre secret comme une signature quelconque, sans rien écrire", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_factice");
    const before = counts();
    for (const secret of ["whsec_" + "b2".repeat(16), "whsec_" + "c3".repeat(15) + "d"]) {
      const res = await post(probe(), signed(probe(), secret));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_signature" });
    }
    expect(counts()).toEqual(before);
  });

  it("distingue une sonde bien signée : refus du mode test face à une clé live, sans effet", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_factice");
    const before = counts();
    const payload = probe();
    const res = await post(payload, signed(payload, SECRET));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "stripe_mode_mismatch" });
    expect(counts()).toEqual(before);
  });

  it("ignore un type inconnu bien signé en mode test, sans effet", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_factice");
    const before = counts();
    const payload = probe();
    const res = await post(payload, signed(payload, SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: "openswissdata.revocation_probe" });
    expect(counts()).toEqual(before);
  });

  it("refuse une signature valide trop ancienne et un corps modifié après signature", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_factice");
    const payload = probe();
    const old = await post(payload, signed(payload, SECRET, Math.floor(Date.now() / 1000) - 3600));
    expect(old.status).toBe(400);
    expect(await old.json()).toEqual({ error: "invalid_signature" });
    const altered = await post(payload.replace("probe\"}", "probe\",\"x\":1}"), signed(payload, SECRET));
    expect(altered.status).toBe(400);
    expect(await altered.json()).toEqual({ error: "invalid_signature" });
  });
});
