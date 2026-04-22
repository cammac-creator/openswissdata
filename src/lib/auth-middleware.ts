import type { MiddlewareHandler } from "hono";
import { getDb } from "./db.js";

/**
 * Authenticates via `osd_session` cookie. On success, sets `c.var.customer_id`.
 * Returns 401 on missing/invalid/expired session.
 */
export const requireAuth: MiddlewareHandler<{ Variables: { customer_id: number } }> = async (c, next) => {
  const cookie = c.req.header("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)osd_session=([A-Za-z0-9_-]{43})/);
  if (!m) return c.json({ error: "unauthorized" }, 401);
  const token = m[1];
  const db = getDb();
  const session = db.prepare("SELECT customer_id, expires_at FROM sessions WHERE token = ?").get(token) as { customer_id: number; expires_at: number } | undefined;
  if (!session || session.expires_at < Date.now()) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("customer_id", session.customer_id);
  await next();
};
