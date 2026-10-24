// Inscription par e-mail « être prévenu quand l'historique détaillé sera disponible » (24.10.2026).
// POST /request (JSON de la vitrine) → mail avec lien → GET /confirm (page, n'écrit rien) → POST /confirm (bouton).
// GET /unsubscribe (page) → POST /unsubscribe (bouton, ou désinscription en un clic RFC 8058 depuis la messagerie).
// Règles : même réponse pour une adresse nouvelle, en attente ou confirmée ; limites par réseau et par adresse avant
// toute lecture ; envoi du mail APRÈS la réponse (la durée de réponse ne dit pas si un mail part) ; aucune adresse
// dans une réponse, un journal ou une erreur ; tout échec rend un message fixe.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db.js';
import { authRequestIp, consumeAuthLimit, reportAuthLimitFailure } from '../lib/auth-limits.js';
import { isLoginPostOrigin, loginOrigin } from '../lib/login-origin.js';
import { isValidTokenFormat } from '../lib/tokens.js';
import { prepareAnnouncementConfirmationEmail, sendPreparedEmail, type PreparedEmail } from '../lib/email.js';
import {
  ANNOUNCEMENT_LANGS, ANNOUNCEMENT_SUBJECTS, abandonAnnouncementDelivery, confirmAnnouncement, eraseAnnouncementSubscription,
  inspectAnnouncementConfirmation, inspectAnnouncementSubscription, openUnsubscribeReference, registerAnnouncementRequest,
  sealUnsubscribeReference, type AnnouncementDelivery, type AnnouncementLang,
} from '../lib/announcements.js';
import { announcementPage, announcementPrivacyPath, announcementRequestLang, type AnnouncementPageKind } from '../lib/announcement-page.js';

export const announcementsRoute = new Hono();

announcementsRoute.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  await next();
});

const RequestBody = z.object({
  email: z.string().trim().min(3).max(254).email(),
  lang: z.enum(ANNOUNCEMENT_LANGS),
  subject: z.enum(ANNOUNCEMENT_SUBJECTS),
  consent: z.literal(true),
}).strict();

const unavailableJson = (c: Context) => { c.header('Retry-After', '1'); return c.json({ error: 'temporarily_unavailable' }, 503); };
const tooMany = (c: Context, seconds: number) => { c.header('Retry-After', String(seconds)); return c.json({ error: 'too_many_requests' }, 429); };
const contentType = (c: Context) => c.req.header('content-type')?.split(';')[0].trim().toLowerCase() ?? '';

// Plafond commun atteint : un signal au plus par heure, sans adresse ni compte.
let lastCapReport = 0;
function reportCap(): void {
  const now = Date.now();
  if (lastCapReport && now >= lastCapReport && now - lastCapReport < 3_600_000) return;
  lastCapReport = now;
  console.warn('[annonce] plafond quotidien des mails de confirmation atteint ; demandes suivantes sans mail');
}

// Envois en cours, attendus par les tests et utilisables à l'arrêt du service ; aucun contenu n'y est gardé.
const inFlight = new Set<Promise<void>>();
export function settleAnnouncementDeliveries(): Promise<void> {
  return Promise.all([...inFlight]).then(() => undefined);
}

function scheduleDelivery(delivery: AnnouncementDelivery, payload: PreparedEmail): void {
  const task: Promise<void> = (async () => {
    let sent = false;
    try {
      sent = (await sendPreparedEmail(payload, `announcement-confirmation/${randomUUID()}`)).sent;
    } catch {
      sent = false;
    }
    if (sent) return;
    // Mail non parti : la demande neuve disparaît, un renvoi rend l'ancien lien ; nouvel essai possible.
    console.warn('[annonce] e-mail de confirmation non remis');
    try { abandonAnnouncementDelivery(getDb(), delivery); } catch { console.warn('[annonce] demande non retirée après un envoi manqué'); }
  })().finally(() => { inFlight.delete(task); });
  inFlight.add(task);
}

function confirmationPayload(delivery: AnnouncementDelivery): PreparedEmail {
  const origin = loginOrigin().origin;
  const unsubscribe = sealUnsubscribeReference({ id: delivery.id, requestedAt: delivery.requestedAt });
  return prepareAnnouncementConfirmationEmail({
    to: delivery.email,
    locale: delivery.lang,
    confirmUrl: `${origin}/api/announcements/confirm?token=${delivery.token}`,
    unsubscribeUrl: `${origin}/api/announcements/unsubscribe?token=${unsubscribe}`,
    privacyUrl: `${origin}${announcementPrivacyPath(delivery.lang)}`,
  });
}

announcementsRoute.post('/request', bodyLimit({ maxSize: 1024, onError: c => c.json({ error: 'body_too_large' }, 413) }), async c => {
  try {
    if (!isLoginPostOrigin(c)) return c.json({ error: 'invalid_origin' }, 403);
  } catch {
    console.warn('[annonce] origine indisponible');
    return unavailableJson(c);
  }
  if (contentType(c) !== 'application/json' || new URL(c.req.url).search) return c.json({ error: 'invalid_body' }, 400);
  let db;
  try {
    db = getDb();
    // Compteurs durables des connexions, sous un nom distinct : une inscription n'use pas le crédit de connexion.
    if (!consumeAuthLimit(db, 'ip', `announcement:${authRequestIp(c)}`)) return tooMany(c, 10);
  } catch (error) {
    reportAuthLimitFailure(error);
    return unavailableJson(c);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch (error) {
    if (error instanceof HTTPException && error.status === 413) return c.json({ error: 'body_too_large' }, 413);
    return c.json({ error: 'invalid_body' }, 400);
  }
  // Case non cochée : refus explicite, rien n'est enregistré ni envoyé.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as Record<string, unknown>).consent !== true) return c.json({ error: 'consent_required' }, 400);
  const parsed = RequestBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
  try {
    // Même compteur pour une adresse inconnue, en attente ou confirmée, avant toute lecture de l'inscription.
    if (!consumeAuthLimit(db, 'email', `announcement:${parsed.data.email}`)) return tooMany(c, 60);
  } catch (error) {
    reportAuthLimitFailure(error);
    return unavailableJson(c);
  }
  let delivery: AnnouncementDelivery | 'capped' | null;
  try {
    delivery = registerAnnouncementRequest(db, parsed.data);
  } catch {
    console.warn('[annonce] demande non enregistrée');
    return unavailableJson(c);
  }
  if (delivery === 'capped') {
    reportCap();
  } else if (delivery) {
    let payload: PreparedEmail;
    try {
      payload = confirmationPayload(delivery);
    } catch {
      console.warn('[annonce] e-mail de confirmation non préparé');
      try { abandonAnnouncementDelivery(db, delivery); } catch { console.warn('[annonce] demande non retirée après un envoi manqué'); }
      return unavailableJson(c);
    }
    scheduleDelivery(delivery, payload);
  }
  // Même réponse dans tous les cas, sans attendre l'envoi.
  return c.json({ ok: true });
});

function singleQueryToken(c: Context): string | null {
  if (c.req.url.length > 2048) return null;
  const params = new URL(c.req.url).searchParams;
  if ([...params.keys()].some(key => key !== 'token')) return null;
  const tokens = params.getAll('token');
  return tokens.length === 1 ? tokens[0] : null;
}

const html = (c: Context, lang: AnnouncementLang, kind: AnnouncementPageKind, status: 200 | 400 | 403 | 410 | 413 | 503 = 200, token?: string) => {
  if (status === 503) c.header('Retry-After', '1');
  return c.html(announcementPage(lang, kind, token), status);
};

/** Formulaire du bouton ou de la messagerie : UTF-8 strict, clés connues, sans valeur répétée ni fichier. */
async function readForm(c: Context, allowed: readonly string[]): Promise<URLSearchParams | null> {
  const type = contentType(c);
  let form: URLSearchParams;
  if (type === 'application/x-www-form-urlencoded') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await c.req.arrayBuffer());
    decodeURIComponent(text.replace(/\+/g, '%20'));
    form = new URLSearchParams(text);
  } else if (type === 'multipart/form-data') {
    const data = await c.req.formData();
    form = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      if (typeof value !== 'string') return null;
      form.append(key, value);
    }
  } else return null;
  const keys = [...form.keys()];
  if (keys.some(key => !allowed.includes(key)) || new Set(keys).size !== keys.length) return null;
  return form;
}

const formError = (error: unknown) => (error instanceof HTTPException && error.status === 413 ? 413 : 400);

announcementsRoute.get('/confirm', c => {
  const lang = announcementRequestLang(c.req.header('accept-language'));
  const token = singleQueryToken(c);
  if (!token || !isValidTokenFormat(token)) return html(c, lang, 'link_invalid', 400);
  try {
    // Lecture seule : les filtres de messagerie ouvrent les liens tout seuls, un GET ne confirme jamais rien.
    const found = inspectAnnouncementConfirmation(getDb(), token);
    if (!found.valid) return html(c, found.lang ?? lang, 'confirm_invalid', 410);
    return html(c, found.lang ?? lang, 'confirm', 200, token);
  } catch {
    console.warn('[annonce] page de confirmation indisponible');
    return html(c, lang, 'unavailable', 503);
  }
});

announcementsRoute.post('/confirm', bodyLimit({ maxSize: 1024, onError: c => html(c, announcementRequestLang(c.req.header('accept-language')), 'link_invalid', 413) }), async c => {
  const lang = announcementRequestLang(c.req.header('accept-language'));
  try {
    if (!isLoginPostOrigin(c)) return html(c, lang, 'link_invalid', 403);
  } catch {
    console.warn('[annonce] origine de confirmation indisponible');
    return html(c, lang, 'unavailable', 503);
  }
  if (new URL(c.req.url).search) return html(c, lang, 'link_invalid', 400);
  let form: URLSearchParams | null;
  try {
    form = contentType(c) === 'application/x-www-form-urlencoded' ? await readForm(c, ['token', 'decision']) : null;
  } catch (error) {
    return html(c, lang, 'link_invalid', formError(error));
  }
  const token = form?.get('token');
  if (!form || !token || form.get('decision') !== 'confirm' || !isValidTokenFormat(token)) return html(c, lang, 'link_invalid', 400);
  try {
    const result = confirmAnnouncement(getDb(), token);
    if (!result.confirmed) return html(c, result.lang ?? lang, 'confirm_invalid', 410);
    return html(c, result.lang, 'confirmed');
  } catch {
    console.warn('[annonce] confirmation non enregistrée');
    return html(c, lang, 'unavailable', 503);
  }
});

announcementsRoute.get('/unsubscribe', c => {
  const lang = announcementRequestLang(c.req.header('accept-language'));
  const token = singleQueryToken(c);
  if (!token) return html(c, lang, 'link_invalid', 400);
  try {
    const reference = openUnsubscribeReference(token);
    if (!reference) return html(c, lang, 'link_invalid', 400);
    const row = inspectAnnouncementSubscription(getDb(), reference);
    if (!row) return html(c, lang, 'unsubscribe_missing');
    return html(c, row.lang, 'unsubscribe', 200, token);
  } catch {
    console.warn('[annonce] page de désinscription indisponible');
    return html(c, lang, 'unavailable', 503);
  }
});

// Sans contrôle d'origine : la désinscription en un clic (RFC 8058) est envoyée par le serveur de messagerie,
// sans en-tête Origin. Le lien scellé fait seul autorité, et il ne peut qu'effacer.
announcementsRoute.post('/unsubscribe', bodyLimit({ maxSize: 1024, onError: c => html(c, announcementRequestLang(c.req.header('accept-language')), 'link_invalid', 413) }), async c => {
  const lang = announcementRequestLang(c.req.header('accept-language'));
  const params = new URL(c.req.url).searchParams;
  if (c.req.url.length > 2048 || [...params.keys()].some(key => key !== 'token')) return html(c, lang, 'link_invalid', 400);
  let form: URLSearchParams | null;
  try {
    form = await readForm(c, ['token', 'decision', 'List-Unsubscribe']);
  } catch (error) {
    return html(c, lang, 'link_invalid', formError(error));
  }
  if (!form) return html(c, lang, 'link_invalid', 400);
  const oneClick = form.get('List-Unsubscribe') === 'One-Click' && !form.has('decision');
  const button = form.get('decision') === 'unsubscribe' && !form.has('List-Unsubscribe');
  const tokens = [...params.getAll('token'), ...form.getAll('token')];
  if ((!oneClick && !button) || tokens.length !== 1) return html(c, lang, 'link_invalid', 400);
  try {
    const reference = openUnsubscribeReference(tokens[0]);
    if (!reference) return html(c, lang, 'link_invalid', 400);
    // Déjà effacée : même réponse, la désinscription est rejouable sans effet.
    const result = eraseAnnouncementSubscription(getDb(), reference);
    return html(c, result.lang ?? lang, 'unsubscribed');
  } catch {
    console.warn('[annonce] désinscription non enregistrée');
    return html(c, lang, 'unavailable', 503);
  }
});
