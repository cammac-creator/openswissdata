import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function stripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key === "sk_test_xxx") {
    throw new Error("STRIPE_SECRET_KEY is missing or placeholder");
  }
  _stripe = new Stripe(key);
  return _stripe;
}

/** Reset the cached client — for tests only. */
export function resetStripeClient(): void {
  _stripe = null;
}
