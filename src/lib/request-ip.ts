import { isIP } from 'node:net';
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

function ipv6Words(address: string): number[] {
  const [head, tail] = address.split('::');
  const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  return (tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]).map(x => parseInt(x, 16));
}
/** Adresse seule, sans port, liste, zone locale ou nom DNS ; formes équivalentes unifiées. */
export function canonicalIp(value: string): string | null {
  if (value.length > 64 || value.includes('%')) return null;
  if (isIP(value) === 4) return value;
  if (isIP(value) !== 6) return null;
  try {
    const address = new URL(`http://[${value}]/`).hostname.slice(1, -1), words = ipv6Words(address);
    if (words.length !== 8 || words.some(x => !Number.isInteger(x))) return null;
    if (words.slice(0, 5).every(x => x === 0) && words[5] === 0xffff) return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.');
    return address;
  } catch { return null; }
}
/** Préfixe réservé à la limitation des abus, pas à l’estimation d’un visiteur. */
export function abuseIp(value: string): string {
  const address = canonicalIp(value);
  return !address ? 'unknown' : isIP(address) === 4 ? address : ipv6Words(address).slice(0, 4).map(x => x.toString(16)).join(':') + '::/64';
}
/** Proxy Railway validé, sinon connexion réelle ; jamais le X-Forwarded-For libre. */
export function trustedRequestIp(c: Context): string | null {
  if (process.env.RAILWAY_ENVIRONMENT_ID) return canonicalIp(c.req.header('x-real-ip')?.trim() ?? '');
  try { return canonicalIp(getConnInfo(c).remote.address ?? ''); } catch { return null; }
}
