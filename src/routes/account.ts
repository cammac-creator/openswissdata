import { Hono } from "hono";
import { getDb } from "../lib/db.js";
import { requireAuth } from "../lib/auth-middleware.js";

export const accountRoute = new Hono<{ Variables: { customer_id: number } }>();

accountRoute.use("*", requireAuth);

accountRoute.get("/", (c) => {
  const customerId = c.get("customer_id");
  const db = getDb();
  const customer = db.prepare("SELECT id, email, created_at FROM customers WHERE id = ?").get(customerId);
  return c.json({ customer });
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
