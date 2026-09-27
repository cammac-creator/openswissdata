import { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { authRequestIp, consumeAuthLimit, reportAuthLimitFailure } from "../lib/auth-limits.js";
import { getDb } from "../lib/db.js";
import {isValidTokenFormat} from '../lib/tokens.js';
import {issueMagicLink, exchangeMagicLink, deleteAccountSession, SESSION_TTL_MS} from '../lib/account-session.js';
import { sendMagicLinkEmail, parseLocale } from "../lib/email.js";

export const authRoute = new Hono();

// Réponses de connexion privées, y compris les redirections et les refus.
authRoute.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
authRoute.use('/magic-link', bodyLimit({ maxSize: 4096, onError: c => c.json({ error: 'body_too_large' }, 413) }));

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

authRoute.post("/magic-link", async (c) => {
  let db;
  try {
    db = getDb();
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
  let row;
  let token;
  try {
    row = db.prepare("SELECT id,locale FROM customers WHERE email=?").get(email) as {id: number; locale: string | null} | undefined;
    if (row) token = issueMagicLink(row.id, parsed.return_to === 'admin' ? 'admin' : 'account');
  } catch {
    console.warn('[connexion] lien non enregistré');
    c.header('Retry-After', '1');
    return c.json({error: 'temporarily_unavailable'}, 503);
  }
  if (row && token) {
    const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const magicUrl = `${baseUrl}/api/auth/verify?token=${token}`;
    try { await sendMagicLinkEmail({to: email, magicUrl, locale: parseLocale(row.locale)}); }
    catch { console.warn('[connexion] remise du lien non confirmée'); }
  }
  // Même réponse pour une adresse connue ou inconnue.
  return c.json({ ok: true });
});

authRoute.get("/verify", (c) => {
  const query = new URL(c.req.url).searchParams;
  const tokens = query.getAll('token');
  const targets = query.getAll('return_to');
  if (c.req.url.length > 4096 || tokens.length !== 1 || !isValidTokenFormat(tokens[0]) || targets.length > 1) {
    return c.redirect('/account?auth=invalid', 302);
  }
  let session;
  try { session = exchangeMagicLink(tokens[0], targets[0] === 'admin' ? 'admin' : 'account'); }
  catch {
    console.warn('[connexion] échange non enregistré ; lien conservé');
    c.header('Retry-After', '1');
    return c.json({error: 'temporarily_unavailable'}, 503);
  }
  if (!session) return c.redirect('/account?auth=expired', 302);
  // Le cookie n'est émis qu'après la validation de toute la transaction.
  c.header('Set-Cookie', `osd_session=${session.token}; HttpOnly; ${isProd() ? 'Secure; ' : ''}SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/`);
  if (session.target === 'admin') return c.redirect('/admin', 302);
  const locale = parseLocale(session.locale);
  return c.redirect(`${locale === 'fr' ? '' : '/' + locale}/account?auth=ok`, 302);
});

authRoute.post('/logout', (c) => {
  try { deleteAccountSession(c.req.header('cookie')); }
  catch {
    console.warn('[connexion] déconnexion non enregistrée');
    c.header('Retry-After', '1');
    return c.json({error: 'temporarily_unavailable'}, 503);
  }
  c.header('Set-Cookie', `osd_session=; HttpOnly; ${isProd() ? 'Secure; ' : ''}SameSite=Lax; Max-Age=0; Path=/`);
  return c.json({ok: true});
});
