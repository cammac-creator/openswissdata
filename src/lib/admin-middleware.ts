import type { MiddlewareHandler } from "hono";
import { getDb } from "./db.js";

/**
 * Authenticates as an admin via:
 *   1. The same `osd_session` cookie used for /account, AND
 *   2. The session's customer.email is in the comma-separated ADMIN_EMAILS env.
 *
 * This piggybacks on the existing magic-link flow — no new credentials to
 * manage, no separate password store. To get admin access, an admin email
 * must be present in the customers table; if it's not, log in once via the
 * /account magic link to create the row.
 */
export const requireAdmin: MiddlewareHandler<{
  Variables: { customer_id: number; customer_email: string };
}> = async (c, next) => {
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length === 0) {
    return c.json({ error: "admin_disabled" }, 503);
  }

  const cookie = c.req.header("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)osd_session=([A-Za-z0-9_-]{43})/);
  if (!m) return c.json({ error: "unauthorized" }, 401);

  const db = getDb();
  const row = db.prepare(`
    SELECT s.customer_id, s.expires_at, c.email
    FROM sessions s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.token = ?
  `).get(m[1]) as
    | { customer_id: number; expires_at: number; email: string }
    | undefined;

  if (!row || row.expires_at < Date.now()) {
    return c.json({ error: "unauthorized" }, 401);
  }
  if (!adminEmails.includes(row.email.toLowerCase())) {
    return c.json({ error: "forbidden" }, 403);
  }

  c.set("customer_id", row.customer_id);
  c.set("customer_email", row.email);
  await next();
};
