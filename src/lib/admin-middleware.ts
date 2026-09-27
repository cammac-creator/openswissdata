import type {MiddlewareHandler} from 'hono';
import {readAccountSession} from './account-session.js';

/** Session ouverte du compte et adresse présente dans la liste administrative. */
export const requireAdmin: MiddlewareHandler<{
  Variables: {customer_id: number; customer_email: string};
}> = async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!adminEmails.length) return c.json({error: 'admin_disabled'}, 503);
  let session;
  try { session = readAccountSession(c.req.header('cookie')); }
  catch {
    console.warn('[connexion] vérification de session administrative indisponible');
    return c.json({error: 'temporarily_unavailable'}, 503);
  }
  if (!session) return c.json({error: 'unauthorized'}, 401);
  if (!adminEmails.includes(session.email.toLowerCase())) return c.json({error: 'forbidden'}, 403);
  c.set('customer_id', session.customer_id);
  c.set('customer_email', session.email);
  await next();
};
