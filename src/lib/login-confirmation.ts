import {createCipheriv, createDecipheriv, createHmac, createHash, randomBytes} from 'node:crypto';
import {z} from 'zod';
import {loginOrigin} from './login-origin.js';
export {loginOrigin, isLoginHost, isLoginPostOrigin} from './login-origin.js';
import {uniqueTokenCookie} from './account-session.js';

export const LOGIN_CONFIRMATION_TTL_MS = 5 * 60_000;
const DOMAIN = 'openswissdata:login-confirmation:v1';
const payloadSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  target: z.enum(['account','admin']),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  session: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  customerId: z.number().int().positive().safe(),
  switchAccount: z.boolean(),
  locale: z.enum(['fr','de','en']),
  issuedAt: z.number().int().safe(),
  expiresAt: z.number().int().safe(),
}).strict();
export type LoginConfirmation = z.infer<typeof payloadSchema>;

function confirmationKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('login_key_unavailable');
  return createHmac('sha256', secret).update(DOMAIN).digest();
}
export const confirmationCookieName = () => loginOrigin().protocol === 'https:' ? '__Host-osd_login' : 'osd_login';
export const confirmationNonce = (cookie: string | undefined) => uniqueTokenCookie(cookie, confirmationCookieName());
export const nonceFingerprint = (nonce: string) => createHash('sha256').update(nonce).digest('hex');

export function confirmationCookie(nonce: string, clear = false): string {
  return `${confirmationCookieName()}=${clear ? '' : nonce}; HttpOnly; ${loginOrigin().protocol === 'https:' ? 'Secure; ' : ''}SameSite=Lax; Max-Age=${clear ? 0 : LOGIN_CONFIRMATION_TTL_MS / 1000}; Path=/`;
}

/** Enveloppe authentifiée : aucun lien brut ni identifiant client dans le formulaire. */
export function sealLoginConfirmation(value: LoginConfirmation): string {
  const payload = payloadSchema.parse(value), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', confirmationKey(), iv);
  cipher.setAAD(Buffer.from(DOMAIN + ':' + loginOrigin().origin));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

export function openLoginConfirmation(value: string, now = Date.now()): LoginConfirmation | null {
  // Une configuration absente n'est pas assimilée à une confirmation invalide.
  const key = confirmationKey(), origin = loginOrigin().origin;
  if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.length < 29 || bytes.toString('base64url') !== value) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(DOMAIN + ':' + origin));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const clear = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    const valueParsed = payloadSchema.parse(JSON.parse(clear.toString('utf8')));
    if (!Number.isSafeInteger(now) || valueParsed.issuedAt > now || valueParsed.expiresAt <= now ||
      valueParsed.expiresAt <= valueParsed.issuedAt || valueParsed.expiresAt - valueParsed.issuedAt > LOGIN_CONFIRMATION_TTL_MS) return null;
    return valueParsed;
  } catch { return null; }
}
