import { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { authRequestIp, consumeAuthLimit, reportAuthLimitFailure } from "../lib/auth-limits.js";
import { getDb } from "../lib/db.js";
import { generateToken, isValidTokenFormat } from "../lib/tokens.js";
import { sendMagicLinkEmail, parseLocale } from "../lib/email.js";

export const authRoute = new Hono();

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;      // 15 min
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;  // 30 days

// Réponses de connexion privées, y compris les redirections et les refus.
authRoute.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
authRoute.use('/magic-link', bodyLimit({ maxSize: 4096, onError: c => c.json({ error: 'body_too_large' }, 413) }));

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

authRoute.post("/magic-link", async (c) => {
  const db = getDb();
  try {
    if (!consumeAuthLimit(db, 'ip', authRequestIp(c))) {
      c.header('Retry-After', '60');
      return c.json({ error: 'too_many_requests' }, 429);
    }
  } catch (error) { reportAuthLimitFailure(error); return c.json({ error: 'temporarily_unavailable' }, 503); }

  let parsed;
  try {
    parsed = z.object({ email: z.string().trim().max(320).email(), return_to: z.literal("admin").optional() }).parse(await c.req.json());
  } catch (error) {
    if (error instanceof HTTPException && error.status === 413) return c.json({ error: "body_too_large" }, 413);
    return c.json({ error: "invalid_body" }, 400);
  }
  const { email } = parsed;
  // Même compteur pour une adresse connue ou inconnue, avant toute recherche de compte.
  try {
    if (!consumeAuthLimit(db, 'email', email)) {
      c.header('Retry-After', '60');
      return c.json({ error: 'too_many_requests' }, 429);
    }
  } catch (error) { reportAuthLimitFailure(error); return c.json({ error: 'temporarily_unavailable' }, 503); }
  const row = db.prepare("SELECT id, locale FROM customers WHERE email = ?").get(email) as
    | { id: number; locale: string | null }
    | undefined;
  if (row) {
    const token = generateToken();
    const now = Date.now();
    // sessions table is used both for login magic-links (short-TTL) and active sessions (long-TTL).
    // Magic links stored with expires_at = now + 15min. On verify, we rotate it to a long-lived one.
    db.prepare("INSERT INTO sessions (token, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(token, row.id, now + MAGIC_LINK_TTL_MS, now);
    const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const magicUrl = `${baseUrl}/api/auth/verify?token=${token}${parsed.return_to === "admin" ? "&return_to=admin" : ""}`;
    await sendMagicLinkEmail({ to: email, magicUrl, locale: parseLocale(row.locale) });
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
  // Land on the account page in the customer's language.
  const cust = db.prepare("SELECT locale FROM customers WHERE id = ?").get(session.customer_id) as
    | { locale: string | null }
    | undefined;
  const loc = parseLocale(cust?.locale);
  const accountPath = loc === "fr" ? "/account" : `/${loc}/account`;
  // Seul ce chemin interne fixe est accepté comme retour du bureau.
  if (c.req.query("return_to") === "admin") return c.redirect("/admin", 302);
  return c.redirect(`${accountPath}?auth=ok`, 302);
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
