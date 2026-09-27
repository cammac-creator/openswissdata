import {loginOrigin} from './login-origin.js';

export const SESSION_COOKIE = '__Host-osd_session';
export const LOCAL_SESSION_COOKIE = 'osd_dev_session';
export const sessionCookieName = () => loginOrigin().protocol === 'https:' ? SESSION_COOKIE : LOCAL_SESSION_COOKIE;

/** Aucun Domain, aucune promotion de l'ancien osd_session. */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return prepareSessionCookie(maxAgeSeconds)(token);
}

/** La configuration est lue avant la transaction ; ensuite seule la valeur aléatoire est ajoutée. */
export function prepareSessionCookie(maxAgeSeconds: number): (token: string) => string {
  const secure = loginOrigin().protocol === 'https:';
  const name = secure ? SESSION_COOKIE : LOCAL_SESSION_COOKIE;
  const attributes = `HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=${maxAgeSeconds}; Path=/`;
  return token => `${name}=${token}; ${attributes}`;
}

/** Nettoyage du seul cookie historique host-only à Path=/ ; ses variantes sont ignorées. */
export function clearLegacySessionCookie(): string {
  return `osd_session=; HttpOnly; ${loginOrigin().protocol === 'https:' ? 'Secure; ' : ''}SameSite=Lax; Max-Age=0; Path=/`;
}
