import { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { authRequestIp, consumeAuthLimit, reportAuthLimitFailure } from "../lib/auth-limits.js";
import { getDb } from "../lib/db.js";
import {issueMagicLink, deleteAccountSession} from '../lib/account-session.js';
import { sendMagicLinkEmail, parseLocale } from "../lib/email.js";

import {authConfirmationRoute} from './auth-confirmation.js';
import {isLoginPostOrigin} from '../lib/login-origin.js';
import {sessionCookie, clearLegacySessionCookie} from '../lib/session-cookie.js';

export const authRoute = new Hono();

// Réponses de connexion privées, y compris les redirections et les refus.
authRoute.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
authRoute.use('/magic-link', bodyLimit({ maxSize: 4096, onError: c => c.json({ error: 'body_too_large' }, 413) }));

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

authRoute.route('/', authConfirmationRoute);

authRoute.post('/logout', (c) => {
  let cleared: string, legacy: string;
  try {
    if (!isLoginPostOrigin(c)) return c.json({error: 'invalid_origin'}, 403);
    cleared = sessionCookie('', 0); legacy = clearLegacySessionCookie();
    deleteAccountSession(c.req.header('cookie'));
  }
  catch {
    console.warn('[connexion] déconnexion non enregistrée');
    c.header('Retry-After', '1');
    return c.json({error: 'temporarily_unavailable'}, 503);
  }
  c.header('Set-Cookie', cleared);
  c.header('Set-Cookie', legacy, {append:true});
  return c.json({ok: true});
});
