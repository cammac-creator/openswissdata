import type { Context } from 'hono';
import { html } from 'hono/html';

type Locale = 'fr' | 'de' | 'en';
export const CHECKOUT_NOTICE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const notices = new WeakSet<Context>();
export const isCheckoutNotice = (c: Context): boolean => notices.has(c);
const copy = {
  fr: { titles: { 400: 'Vérifiez votre demande', 413: 'Cette demande est trop volumineuse', 429: 'Patientez quelques secondes', 503: 'Paiement momentanément indisponible' },
    wait: 'Une demande vient déjà d’être traitée. Attendez quelques secondes avant de réessayer.',
    unavailable: 'Cette demande n’a pas pu ouvrir une nouvelle page de paiement. Réessayez un peu plus tard.',
    invalid: 'Revenez à la fiche du produit pour recommencer votre demande.',
    existing: 'Si une page de paiement est déjà ouverte, poursuivez depuis celle-ci.', back: 'Revenir aux offres', support: 'Contacter le support', label: 'Votre achat' },
  de: { titles: { 400: 'Bitte prüfen Sie Ihre Anfrage', 413: 'Diese Anfrage ist zu groß', 429: 'Bitte warten Sie einige Sekunden', 503: 'Zahlung vorübergehend nicht verfügbar' },
    wait: 'Eine Anfrage wurde gerade bearbeitet. Bitte warten Sie einige Sekunden, bevor Sie es erneut versuchen.',
    unavailable: 'Für diese Anfrage konnte keine neue Zahlungsseite geöffnet werden. Bitte versuchen Sie es später erneut.',
    invalid: 'Kehren Sie zur Produktseite zurück, um Ihre Anfrage erneut zu starten.',
    existing: 'Wenn bereits eine Zahlungsseite geöffnet ist, setzen Sie den Vorgang dort fort.', back: 'Zurück zu den Angeboten', support: 'Support kontaktieren', label: 'Ihr Kauf' },
  en: { titles: { 400: 'Please check your request', 413: 'This request is too large', 429: 'Please wait a few seconds', 503: 'Payment temporarily unavailable' },
    wait: 'A request was just processed. Please wait a few seconds before trying again.',
    unavailable: 'This request could not open a new payment page. Please try again later.',
    invalid: 'Return to the product page to start your request again.',
    existing: 'If a payment page is already open, continue from that page.', back: 'Back to the offers', support: 'Contact support', label: 'Your purchase' },
} as const;

/** La page d’origine locale prime ; aucune URL fournie n’est réinjectée dans la réponse. */
function locale(c: Context): Locale {
  try {
    const source = new URL(c.req.header('referer') ?? ''), base = new URL(process.env.BASE_URL ?? 'http://localhost:3000');
    if (source.origin === base.origin) return source.pathname.match(/^\/(de|en)(?:\/|$)/)?.[1] as Locale ?? 'fr';
  } catch { /* Sans origine exploitable, consulter les langues déclarées du navigateur. */ }
  const languages = (c.req.header('accept-language') ?? '').slice(0, 512).split(',').map((part, index) => {
    const [tag, weight] = part.trim().toLowerCase().split(';');
    return { tag: tag.split('-')[0], q: weight === undefined ? 1 : Number(weight.trim().replace(/^q=/, '')), index };
  }).filter(x => ['fr', 'de', 'en'].includes(x.tag) && x.q > 0 && x.q <= 1).sort((a, b) => b.q - a.q || a.index - b.index);
  return languages[0]?.tag as Locale ?? 'fr';
}

/** Statut conservé ; avis sans script ni répétition automatique pour un formulaire affiché au navigateur. */
export function checkoutRefusal(c: Context, error: string, status: 400 | 413 | 429 | 503) {
  if (!c.req.path.endsWith('/start') || !c.req.header('accept')?.includes('text/html')) return c.json({ error }, status);
  const lang = locale(c), text = copy[lang], title = text.titles[status], message = status === 429 ? text.wait : status === 503 ? text.unavailable : text.invalid;
  notices.add(c);
  c.header('Content-Security-Policy', CHECKOUT_NOTICE_CSP);
  c.header('X-Robots-Tag', 'noindex, nofollow');
  return c.html(html`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · OpenSwissData</title>
<style>body{margin:0;background:#f4f6f8;color:#172229;font:17px/1.6 system-ui,sans-serif}main{box-sizing:border-box;max-width:620px;margin:8vh auto;padding:32px}article{padding:28px;background:#fff;border:1px solid #dce2e8;border-radius:20px}h1{font-size:clamp(1.6rem,5vw,2.3rem);line-height:1.2;margin:12px 0 24px;overflow-wrap:anywhere}p{margin:0 0 20px}.brand{font-weight:800;margin-bottom:32px}.label{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:#53616d}a{color:#164a6b;display:inline-flex;align-items:center;min-height:44px;line-height:1.3}a:focus-visible{outline:3px solid #155c8c;outline-offset:4px}.back{display:flex;justify-content:center;text-align:center;padding:12px 16px;background:#172229;color:#fff;border-radius:10px;text-decoration:none;margin:24px 0 8px}small{font-size:.9rem;color:#53616d}@media(max-width:380px){main{padding:16px}article{padding:22px}}</style></head><body><main><div class="brand">openswissdata</div><article><p class="label">${text.label}</p><h1>${title}</h1><p>${message}</p><p><small>${text.existing}</small></p><a class="back" href="${lang === 'fr' ? '' : '/' + lang}/bundle">${text.back}</a><a href="mailto:contact@openswissdata.com">${text.support}</a></article></main></body></html>`, status);
}
