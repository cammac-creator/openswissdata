// Migration zod 4 (24.10.2026) : la relecture Stripe classe une réponse de forme inattendue à part
// (`financial_format_changed`), grâce à `error instanceof z.ZodError` dans src/lib/stripe-financial.ts.
// Ce test fige ce classement de l'extérieur, sans toucher au chemin financier ni au test qui le garde.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Stripe from "stripe";
vi.mock("../../src/lib/crm-source.js", async original => ({ ...await original<typeof import("../../src/lib/crm-source.js")>(), sourceJson: vi.fn() }));
import { sourceJson } from "../../src/lib/crm-source.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { processFinancialEvents, enqueueFinancialEvent } from "../../src/lib/stripe-financial.js";

const read = vi.mocked(sourceJson);
let sequence = 0;
const event = () => ({ id: `evt_format_${++sequence}`, type: "refund.updated", livemode: false,
  data: { object: { id: "re_1", charge: "ch_1", payment_intent: "pi_1" } } }) as unknown as Stripe.Event;
const charge = { id: "ch_1", payment_intent: "pi_1", currency: "chf", amount: 10000, paid: true, livemode: false };
const job = () => getDb().prepare("SELECT state,last_error,attempts FROM stripe_financial_jobs WHERE charge_id='ch_1'").get() as
  { state: string; last_error: string | null; attempts: number };
const states = () => getDb().prepare("SELECT COUNT(*) n FROM stripe_charge_states").get() as { n: number };

async function reconcile(answer: (path: string) => unknown) {
  read.mockImplementation(async (_source, url) => answer(new URL(url).pathname));
  expect(enqueueFinancialEvent(event())).toBe(true);
  await processFinancialEvents();
  return job();
}

describe("Relecture Stripe : réponse de forme inattendue", () => {
  let temp: string;
  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), "osd-format-financier-"));
    vi.stubEnv("DATABASE_PATH", join(temp, "fictif.sqlite"));
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_factice");
    vi.stubEnv("NODE_ENV", "test");
    read.mockReset();
  });
  afterEach(() => { closeDb(); rmSync(temp, { recursive: true, force: true }); vi.unstubAllEnvs(); });

  it("classe un paiement mal formé en financial_format_changed, sans écrire d'état", async () => {
    const result = await reconcile(path => {
      if (path.includes("/charges/")) return { ...charge, amount: "10000" };
      throw new Error("source inattendue");
    });
    expect(result).toMatchObject({ state: "pending", last_error: "financial_format_changed", attempts: 1 });
    expect(states().n).toBe(0);
  });

  it("classe une page de remboursements mal formée en financial_format_changed", async () => {
    const result = await reconcile(path => {
      if (path.includes("/charges/")) return charge;
      if (path.endsWith("/refunds")) return { data: [{ id: "re_1", charge: "ch_1", currency: "eur", amount: 100, status: "succeeded" }], has_more: false };
      return { data: [], has_more: false };
    });
    expect(result).toMatchObject({ state: "pending", last_error: "financial_format_changed" });
    expect(states().n).toBe(0);
  });

  it("garde financial_sync_failed pour une panne qui n'est pas une erreur de forme", async () => {
    const result = await reconcile(() => { throw new Error("panne fictive"); });
    expect(result).toMatchObject({ state: "pending", last_error: "financial_sync_failed" });
    expect(states().n).toBe(0);
  });

  it("une réponse bien formée reste rapprochée (témoin de la mise en place)", async () => {
    const result = await reconcile(path => path.includes("/charges/") ? charge : { data: [], has_more: false });
    expect(result).toMatchObject({ state: "synced", last_error: null });
    expect(states().n).toBe(1);
  });
});
