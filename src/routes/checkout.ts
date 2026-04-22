import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { stripe } from "../lib/stripe.js";

export const checkoutRoute = new Hono();

const DATASET_IDS = ["tares", "classifications", "finma", "bundle"] as const;

const CheckoutSchema = z.object({
  dataset_ids: z.array(z.enum(DATASET_IDS)).min(1).max(4),
  email: z.string().email(),
});

checkoutRoute.post("/session", async (c) => {
  let parsed;
  try {
    parsed = CheckoutSchema.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "invalid_body", details: String(err) }, 400);
  }
  const { dataset_ids, email } = parsed;
  const db = getDb();
  const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  // Build line items from the request.
  // If "bundle" is requested alongside others → reject to avoid double-charging.
  const hasBundle = dataset_ids.includes("bundle");
  const individualIds = dataset_ids.filter((id) => id !== "bundle");
  if (hasBundle && individualIds.length > 0) {
    return c.json({ error: "bundle_cannot_be_combined_with_individual_datasets" }, 400);
  }

  const line_items: Array<{ price: string; quantity: number }> = [];
  if (hasBundle) {
    const bundlePrice = process.env.STRIPE_PRICE_BUNDLE;
    if (!bundlePrice) return c.json({ error: "bundle_price_not_configured" }, 500);
    line_items.push({ price: bundlePrice, quantity: 1 });
  } else {
    for (const id of individualIds) {
      const row = db
        .prepare("SELECT stripe_price_id FROM datasets WHERE id = ?")
        .get(id) as { stripe_price_id: string } | undefined;
      if (!row) return c.json({ error: "unknown_dataset", dataset_id: id }, 400);
      if (!row.stripe_price_id)
        return c.json({ error: "dataset_missing_stripe_price_id", dataset_id: id }, 500);
      line_items.push({ price: row.stripe_price_id, quantity: 1 });
    }
  }

  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_email: email,
      success_url: `${baseUrl}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/bundle?checkout=cancelled`,
      metadata: { dataset_ids: dataset_ids.join(",") },
      allow_promotion_codes: true,
    });
    return c.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error("[checkout] stripe error:", err);
    return c.json({ error: "stripe_error", details: String(err) }, 502);
  }
});
