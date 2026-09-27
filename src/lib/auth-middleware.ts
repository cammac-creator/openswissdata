import type {MiddlewareHandler} from 'hono';
import {readAccountSession} from './account-session.js';

/** Le lien reçu par email doit être échangé ; seul le cookie de session ouvre le compte. */
export const requireAuth: MiddlewareHandler<{Variables: {customer_id: number}}> = async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  let session;
  try { session = readAccountSession(c.req.header('cookie')); }
  catch {
    console.warn('[connexion] vérification de session indisponible');
    return c.json({error: 'temporarily_unavailable'}, 503);
  }
  if (!session) return c.json({error: 'unauthorized'}, 401);
  c.set('customer_id', session.customer_id);
  await next();
};
