import type {Context} from 'hono';

/** Configuration partagée par les cookies et les décisions de connexion. */
export function loginOrigin(): URL {
  const origin = new URL(process.env.BASE_URL || 'http://localhost:3000');
  const local = ['test','development'].includes(process.env.NODE_ENV ?? '') &&
    ['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
  if ((!local && origin.protocol !== 'https:') || !['http:','https:'].includes(origin.protocol) ||
    origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('login_origin_unavailable');
  }
  return origin;
}

/** Le nom d'hôte vient de la requête ; l'origine attendue vient de la configuration. */
export function isLoginHost(c: Context): boolean {
  const expected = loginOrigin().host;
  return new URL(c.req.url).host === expected && (!c.req.header('host') || c.req.header('host') === expected);
}
export function isLoginPostOrigin(c: Context): boolean {
  const site = c.req.header('sec-fetch-site');
  return isLoginHost(c) && c.req.header('origin') === loginOrigin().origin && (!site || site === 'same-origin');
}
