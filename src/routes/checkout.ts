import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type Stripe from "stripe";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { stripe } from "../lib/stripe.js";
import { checkoutBucket, checkRateLimit, getClientIp } from "../lib/rate-limit.js";

export const checkoutRoute = new Hono();

// Rate-limit guard applied to both POST /session and POST /start to prevent
// flooding the Stripe API with junk session creations.
checkoutRoute.use("/session", async (c, next) => {
  if (!checkRateLimit(checkoutBucket, getClientIp(c))) {
    return c.json({ error: "too_many_requests" }, 429);
  }
  return next();
});
checkoutRoute.use("/start", async (c, next) => {
  if (!checkRateLimit(checkoutBucket, getClientIp(c))) {
    return c.json({ error: "too_many_requests" }, 429);
  }
  return next();
});

const DATASET_IDS = ["tares", "classifications", "finma", "bundle"] as const;
type DatasetId = (typeof DATASET_IDS)[number];

const CheckoutSchema = z.object({
  dataset_ids: z.array(z.enum(DATASET_IDS)).min(1).max(4),
  email: z.string().email().optional(),
});

function isDatasetId(s: string): s is DatasetId {
  return (DATASET_IDS as readonly string[]).includes(s);
}

type SessionResult =
  | { ok: true; url: string; session_id: string }
  | { ok: false; status: number; error: string };

async function buildSession(
  dataset_ids: DatasetId[],
  email: string | undefined,
): Promise<SessionResult> {
  const db = getDb();
  const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  const hasBundle = dataset_ids.includes("bundle");
  const individualIds = dataset_ids.filter((id) => id !== "bundle");
  if (hasBundle && individualIds.length > 0) {
    return { ok: false, status: 400, error: "bundle_cannot_be_combined_with_individual_datasets" };
  }

  const line_items: Array<{ price: string; quantity: number }> = [];
  if (hasBundle) {
    const bundlePrice = process.env.STRIPE_PRICE_BUNDLE;
    if (!bundlePrice) return { ok: false, status: 500, error: "bundle_price_not_configured" };
    line_items.push({ price: bundlePrice, quantity: 1 });
  } else {
    for (const id of individualIds) {
      const row = db
        .prepare("SELECT stripe_price_id FROM datasets WHERE id = ?")
        .get(id) as { stripe_price_id: string } | undefined;
      if (!row) return { ok: false, status: 400, error: `unknown_dataset:${id}` };
      if (!row.stripe_price_id)
        return { ok: false, status: 500, error: `dataset_missing_stripe_price_id:${id}` };
      line_items.push({ price: row.stripe_price_id, quantity: 1 });
    }
  }

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items,
    success_url: `${baseUrl}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/bundle?checkout=cancelled`,
    metadata: { dataset_ids: dataset_ids.join(",") },
    allow_promotion_codes: true,
  };
  if (email) params.customer_email = email;

  try {
    const session = await stripe().checkout.sessions.create(params);
    if (!session.url) return { ok: false, status: 502, error: "stripe_no_session_url" };
    return { ok: true, url: session.url, session_id: session.id };
  } catch (err) {
    // H4: log full error server-side, never expose Stripe internals to clients
    console.error("[checkout] stripe error:", err);
    return { ok: false, status: 502, error: "checkout_failed" };
  }
}

// JSON API — used by tests, programmatic clients
checkoutRoute.post("/session", async (c) => {
  let parsed;
  try {
    parsed = CheckoutSchema.parse(await c.req.json());
  } catch {
    // H4: don't expose Zod validation internals to clients
    return c.json({ error: "invalid_body" }, 400);
  }
  const result = await buildSession(parsed.dataset_ids, parsed.email);
  if (!result.ok) {
    if (result.error === "bundle_cannot_be_combined_with_individual_datasets") {
      return c.json({ error: result.error }, 400);
    }
    if (result.error.startsWith("unknown_dataset:")) {
      return c.json({ error: "unknown_dataset", dataset_id: result.error.split(":")[1] }, 400);
    }
    if (result.error.startsWith("dataset_missing_stripe_price_id:")) {
      return c.json({ error: "dataset_missing_stripe_price_id", dataset_id: result.error.split(":")[1] }, 500);
    }
    if (result.error === "bundle_price_not_configured") {
      return c.json({ error: result.error }, 500);
    }
    if (result.error === "checkout_failed" || result.error.startsWith("stripe_error:")) {
      // H4: return a generic error without Stripe internals
      return c.json({ error: "checkout_failed" }, 502);
    }
    return c.json({ error: result.error }, result.status as ContentfulStatusCode);
  }
  return c.json({ url: result.url, session_id: result.session_id });
});

// Form-encoded redirect API — used by static HTML CTA buttons (no JS required)
checkoutRoute.post("/start", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const raw = body.dataset_ids ?? body["dataset_ids[]"];
  let parts: string[];
  if (Array.isArray(raw)) {
    parts = raw.map(String);
  } else if (typeof raw === "string") {
    parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    return c.text("missing dataset_ids", 400);
  }

  const dataset_ids = parts.filter(isDatasetId) as DatasetId[];
  if (dataset_ids.length === 0 || dataset_ids.length !== parts.length) {
    return c.text("invalid dataset_ids", 400);
  }
  if (dataset_ids.length > 4) {
    return c.text("too many dataset_ids", 400);
  }

  const emailRaw = body.email;
  const email = typeof emailRaw === "string" && emailRaw.trim() !== "" ? emailRaw.trim() : undefined;

  const result = await buildSession(dataset_ids, email);
  if (!result.ok) {
    // H4: redirect to error page instead of leaking internal error strings
    if (result.status >= 500 || result.error === "checkout_failed" || result.error.startsWith("stripe_error:")) {
      return c.redirect(`${(process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/bundle?checkout=error`, 303);
    }
    return c.text(result.error, result.status as ContentfulStatusCode);
  }
  return c.redirect(result.url, 303);
});
