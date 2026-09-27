import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {HTTPException} from 'hono/http-exception';
import {generateToken, isValidTokenFormat} from '../lib/tokens.js';
import {accountSessionSnapshot, inspectMagicLink, confirmMagicLink, LoginContextChanged, SESSION_TTL_MS} from '../lib/account-session.js';
import {confirmationNonce, confirmationCookie, isLoginHost, isLoginPostOrigin, nonceFingerprint,
  sealLoginConfirmation, openLoginConfirmation, LOGIN_CONFIRMATION_TTL_MS} from '../lib/login-confirmation.js';
import {loginConfirmationPage, loginNoticePage, loginAccountPath, type LoginLocale} from '../lib/login-confirmation-page.js';
import {parseLocale} from '../lib/email.js';
import {prepareSessionCookie, clearLegacySessionCookie} from '../lib/session-cookie.js';

export const authConfirmationRoute = new Hono();
const requestLocale = (header: string | undefined): LoginLocale => /^(de|en)(?:-|,|;|$)/i.exec(header ?? '')?.[1]?.toLowerCase() as 'de' | 'en' || 'fr';

authConfirmationRoute.use('/confirm', bodyLimit({maxSize:4096,
  onError: c => c.html(loginNoticePage(requestLocale(c.req.header('accept-language')), 'invalid'), 413)}));

authConfirmationRoute.get('/verify', c => {
  const locale = requestLocale(c.req.header('accept-language'));
  const query = new URL(c.req.url).searchParams, tokens = query.getAll('token'), targets = query.getAll('return_to');
  if (c.req.url.length > 4096 || tokens.length !== 1 || !isValidTokenFormat(tokens[0]) || targets.length > 1) return c.redirect('/account?auth=invalid', 302);
  try {
    if (!isLoginHost(c)) return c.html(loginNoticePage(locale, 'invalid'), 400);
    const link = inspectMagicLink(tokens[0], targets[0] === 'admin' ? 'admin' : 'account');
    if (!link) return c.redirect('/account?auth=expired', 302);
    const current = accountSessionSnapshot(c.req.header('cookie'));
    const nonce = confirmationNonce(c.req.header('cookie')) ?? generateToken(), now = Date.now();
    const switchAccount = current.session !== null && current.session.customer_id !== link.customerId;
    const language = parseLocale(link.locale);
    const confirmation = sealLoginConfirmation({token:tokens[0], target:link.target, nonce:nonceFingerprint(nonce),
      session:current.fingerprint, customerId:link.customerId, switchAccount, locale:language,
      issuedAt:now, expiresAt:Math.min(link.expiresAt, now + LOGIN_CONFIRMATION_TTL_MS)});
    // Cookie temporaire de navigateur uniquement ; aucune session n'est ouverte par GET ou HEAD.
    c.header('Set-Cookie', confirmationCookie(nonce));
    return c.html(loginConfirmationPage({locale:language, email:link.email, currentEmail:current.session?.email, switchAccount, confirmation}));
  } catch {
    console.warn('[connexion] confirmation non préparée');
    c.header('Retry-After', '1');
    return c.html(loginNoticePage(locale, 'unavailable'), 503);
  }
});

authConfirmationRoute.post('/confirm', async c => {
  let locale = requestLocale(c.req.header('accept-language'));
  try {
    if (!isLoginPostOrigin(c)) return c.html(loginNoticePage(locale, 'invalid'), 403);
  } catch {
    console.warn('[connexion] origine de confirmation indisponible');
    return c.html(loginNoticePage(locale, 'unavailable'), 503);
  }
  if (new URL(c.req.url).search || c.req.header('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return c.html(loginNoticePage(locale, 'invalid'), 400);
  let form: URLSearchParams;
  try {
    const text = new TextDecoder('utf-8', {fatal:true}).decode(await c.req.arrayBuffer());
    decodeURIComponent(text.replace(/\+/g, '%20'));
    form = new URLSearchParams(text);
  } catch (error) {
    return c.html(loginNoticePage(locale, 'invalid'), error instanceof HTTPException && error.status === 413 ? 413 : 400);
  }
  if ([...form.keys()].some(key => !['confirmation','decision','switch_account'].includes(key)) ||
    form.getAll('confirmation').length !== 1 || form.getAll('decision').length !== 1 ||
    form.getAll('switch_account').length > 1 || form.get('decision') !== 'connect') return c.html(loginNoticePage(locale, 'invalid'), 400);
  try {
    const proof = openLoginConfirmation(form.get('confirmation')!);
    if (!proof) return c.html(loginNoticePage(locale, 'invalid'), 403);
    locale = proof.locale;
    const nonce = confirmationNonce(c.req.header('cookie'));
    if (!nonce || nonceFingerprint(nonce) !== proof.nonce ||
      (proof.switchAccount && form.get('switch_account') !== 'yes') ||
      (!proof.switchAccount && form.has('switch_account'))) return c.html(loginNoticePage(locale, 'invalid'), 403);
    // Préparer les attributs avant la transaction évite une erreur de configuration après commit.
    const issueCookie = prepareSessionCookie(SESSION_TTL_MS / 1000);
    const legacyCookie = clearLegacySessionCookie(), loginClear = confirmationCookie('', true);
    const session = confirmMagicLink(proof.token, proof.target, c.req.header('cookie'), proof);
    if (!session) return c.html(loginNoticePage(locale, 'invalid'), 410);
    // Cookie de session seulement après validation du contexte et commit ; l'enveloppe n'est jamais réutilisable comme session.
    c.header('Set-Cookie', issueCookie(session.token));
    c.header('Set-Cookie', legacyCookie, {append:true});
    c.header('Set-Cookie', loginClear, {append:true});
    return c.redirect(session.target === 'admin' ? '/admin' : loginAccountPath(parseLocale(session.locale)) + '?auth=ok', 303);
  } catch (error) {
    if (error instanceof LoginContextChanged) return c.html(loginNoticePage(locale, 'changed'), 409);
    console.warn('[connexion] confirmation non enregistrée');
    c.header('Retry-After', '1');
    return c.html(loginNoticePage(locale, 'unavailable'), 503);
  }
});
