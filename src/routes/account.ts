import { Hono } from "hono";
import { getDb } from "../lib/db.js";
import { stripe } from "../lib/stripe.js";
import { requireAuth } from "../lib/auth-middleware.js";

export const accountRoute = new Hono<{ Variables: { customer_id: number } }>();

accountRoute.use("*", requireAuth);

accountRoute.get("/", (c) => {
  const customerId = c.get("customer_id");
  const db = getDb();
  const customer = db.prepare("SELECT id, email, created_at FROM customers WHERE id = ?").get(customerId);
  return c.json({ customer });
});

// Current MCP subscription (if any) for the logged-in customer — surfaced in
// the account dashboard so a paid user can see their tier and client_id.
accountRoute.get("/mcp", (c) => {
  const customerId = c.get("customer_id");
  const db = getDb();
  const client = db
    .prepare(
      "SELECT client_id, tier, created_at FROM mcp_clients WHERE customer_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
    .get(customerId);
  return c.json({ mcp_client: client ?? null });
});

// Stripe Customer Portal — self-serve invoices, card changes, cancellation.
// Requires the Customer Portal to be activated in the Stripe Dashboard.
accountRoute.post("/billing-portal", async (c) => {
  const customerId = c.get("customer_id");
  const db = getDb();
  const row = db
    .prepare("SELECT stripe_customer_id FROM customers WHERE id = ?")
    .get(customerId) as { stripe_customer_id: string | null } | undefined;
  if (!row?.stripe_customer_id) {
    return c.json({ error: "no_subscription" }, 404);
  }
  const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  try {
    const portal = await stripe().billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${baseUrl}/account`,
    });
    return c.json({ url: portal.url });
  } catch (err) {
    console.error("[account] billing portal error:", err);
    return c.json({ error: "billing_portal_failed" }, 502);
  }
});

accountRoute.get("/datasets", (c) => {
  const customerId = c.get("customer_id");
  const db = getDb();
  const rows = db.prepare(`
    SELECT d.id, d.name, d.slug, d.current_version, e.updates_until
    FROM entitlements e
    JOIN datasets d ON d.id = e.dataset_id
    WHERE e.customer_id = ?
    ORDER BY d.id
  `).all(customerId);
  return c.json({ datasets: rows });
});
