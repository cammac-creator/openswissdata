import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { generateToken, isValidTokenFormat } from "../lib/tokens.js";
import { sendMagicLinkEmail } from "../lib/email.js";

export const authRoute = new Hono();

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;      // 15 min
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;  // 30 days

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

authRoute.post("/magic-link", async (c) => {
  let parsed;
  try {
    parsed = z.object({ email: z.string().email() }).parse(await c.req.json());
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const { email } = parsed;
  const db = getDb();
  const row = db.prepare("SELECT id FROM customers WHERE email = ?").get(email) as { id: number } | undefined;
  if (row) {
    const token = generateToken();
    const now = Date.now();
    // sessions table is used both for login magic-links (short-TTL) and active sessions (long-TTL).
    // Magic links stored with expires_at = now + 15min. On verify, we rotate it to a long-lived one.
    db.prepare("INSERT INTO sessions (token, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(token, row.id, now + MAGIC_LINK_TTL_MS, now);
    const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const magicUrl = `${baseUrl}/api/auth/verify?token=${token}`;
    await sendMagicLinkEmail({ to: email, magicUrl });
  }
  // Always return 200 to avoid email enumeration.
  return c.json({ ok: true });
});

authRoute.get("/verify", async (c) => {
  const token = c.req.query("token");
  if (!token || !isValidTokenFormat(token)) {
    return c.redirect("/account?auth=invalid", 302);
  }
  const db = getDb();
  const now = Date.now();
  const session = db.prepare("SELECT token, customer_id, expires_at FROM sessions WHERE token = ?").get(token) as { token: string; customer_id: number; expires_at: number } | undefined;
  if (!session || session.expires_at < now) {
    return c.redirect("/account?auth=expired", 302);
  }
  // Rotate: delete the short-TTL magic link, create a long-TTL session.
  const longToken = generateToken();
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  db.prepare("INSERT INTO sessions (token, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(longToken, session.customer_id, now + SESSION_TTL_MS, now);

  const cookie = `osd_session=${longToken}; HttpOnly; ${isProd() ? "Secure; " : ""}SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/`;
  c.header("Set-Cookie", cookie);
  return c.redirect("/account?auth=ok", 302);
});

authRoute.post("/logout", async (c) => {
  const cookie = c.req.header("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)osd_session=([A-Za-z0-9_-]{43})/);
  if (m) {
    const db = getDb();
    db.prepare("DELETE FROM sessions WHERE token = ?").run(m[1]);
  }
  c.header("Set-Cookie", `osd_session=; HttpOnly; ${isProd() ? "Secure; " : ""}SameSite=Lax; Max-Age=0; Path=/`);
  return c.json({ ok: true });
});
