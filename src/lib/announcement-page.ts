// Pages des liens « être prévenu » (confirmation, désinscription) : FR/DE/EN, autonomes, sans script ni ressource
// tierce, style par empreinte (CSP posée dans src/index.ts après secureHeaders), noindex. Aucune adresse affichée :
// la page ne montre que l'état de la demande. Un GET n'écrit jamais rien ; seul le bouton (POST) agit.
import { createHash } from 'node:crypto';
import type { AnnouncementLang } from './announcements.js';

export type AnnouncementPageKind =
  | 'confirm' | 'confirmed' | 'confirm_invalid'
  | 'unsubscribe' | 'unsubscribed' | 'unsubscribe_missing'
  | 'link_invalid' | 'unavailable';

type Copy = {
  eyebrow: string; footer: string; back: string; privacy: string;
  confirm: [string, string]; confirmButton: string; confirmFine: string;
  confirmed: [string, string];
  confirm_invalid: [string, string];
  unsubscribe: [string, string]; unsubscribeButton: string;
  unsubscribed: [string, string];
  unsubscribe_missing: [string, string];
  link_invalid: [string, string];
  unavailable: [string, string];
};

const COPY: Record<AnnouncementLang, Copy> = {
  fr: {
    eyebrow: 'HISTORIQUE DÉTAILLÉ FINMA', footer: 'OpenSwissData · Inscription par e-mail', back: 'Revenir aux mouvements FINMA', privacy: 'Politique de confidentialité',
    confirm: ['Confirmer votre inscription', 'Vous avez demandé à être prévenu(e) par e-mail quand l’historique détaillé des mouvements FINMA sera disponible. Confirmez cette demande avec le bouton ci-dessous.'],
    confirmButton: 'Confirmer mon inscription',
    confirmFine: 'Sans confirmation, votre adresse est effacée 7 jours après la demande. Chaque message permet de vous désinscrire en un clic.',
    confirmed: ['Inscription confirmée', 'Merci. Vous serez prévenu(e) par e-mail quand l’historique détaillé sera disponible. Chaque message contient un lien pour vous désinscrire en un clic.'],
    confirm_invalid: ['Lien expiré ou déjà utilisé', 'Ce lien de confirmation n’est plus valable : il a expiré (48 heures), a déjà servi, ou un e-mail plus récent l’a remplacé. Vous pouvez refaire la demande depuis la page des mouvements FINMA.'],
    unsubscribe: ['Vous désinscrire', 'Votre adresse sera effacée immédiatement. Vous ne recevrez plus de message à ce sujet.'],
    unsubscribeButton: 'Me désinscrire',
    unsubscribed: ['Adresse effacée', 'Votre inscription est effacée. Vous ne recevrez plus de message à ce sujet.'],
    unsubscribe_missing: ['Aucune inscription liée à ce lien', 'Aucune adresse n’est enregistrée pour ce lien : elle a déjà été effacée.'],
    link_invalid: ['Lien invalide', 'Ce lien est incomplet ou a été modifié. Ouvrez le lien tel qu’il figure dans l’e-mail reçu.'],
    unavailable: ['Service momentanément indisponible', 'Rien n’a été modifié. Réessayez dans quelques instants avec le même lien.'],
  },
  de: {
    eyebrow: 'DETAILLIERTER FINMA-VERLAUF', footer: 'OpenSwissData · Anmeldung per E-Mail', back: 'Zurück zu den FINMA-Bewegungen', privacy: 'Datenschutzerklärung',
    confirm: ['Anmeldung bestätigen', 'Sie möchten per E-Mail benachrichtigt werden, wenn der detaillierte Verlauf der FINMA-Bewegungen verfügbar ist. Bestätigen Sie diese Anfrage mit der Schaltfläche unten.'],
    confirmButton: 'Anmeldung bestätigen',
    confirmFine: 'Ohne Bestätigung wird Ihre Adresse 7 Tage nach der Anfrage gelöscht. Jede Nachricht enthält einen Link zur Abmeldung mit einem Klick.',
    confirmed: ['Anmeldung bestätigt', 'Danke. Sie werden per E-Mail benachrichtigt, wenn der detaillierte Verlauf verfügbar ist. Jede Nachricht enthält einen Link zur Abmeldung mit einem Klick.'],
    confirm_invalid: ['Link abgelaufen oder bereits verwendet', 'Dieser Bestätigungslink ist nicht mehr gültig: Er ist abgelaufen (48 Stunden), wurde bereits verwendet oder durch eine neuere E-Mail ersetzt. Sie können die Anfrage auf der Seite der FINMA-Bewegungen erneut stellen.'],
    unsubscribe: ['Abmelden', 'Ihre Adresse wird sofort gelöscht. Sie erhalten dazu keine Nachricht mehr.'],
    unsubscribeButton: 'Abmelden',
    unsubscribed: ['Adresse gelöscht', 'Ihre Anmeldung ist gelöscht. Sie erhalten dazu keine Nachricht mehr.'],
    unsubscribe_missing: ['Keine Anmeldung zu diesem Link', 'Zu diesem Link ist keine Adresse gespeichert: Sie wurde bereits gelöscht.'],
    link_invalid: ['Ungültiger Link', 'Dieser Link ist unvollständig oder wurde verändert. Öffnen Sie den Link so, wie er in der erhaltenen E-Mail steht.'],
    unavailable: ['Dienst vorübergehend nicht verfügbar', 'Es wurde nichts geändert. Versuchen Sie es in Kürze mit demselben Link erneut.'],
  },
  en: {
    eyebrow: 'DETAILED FINMA HISTORY', footer: 'OpenSwissData · E-mail sign-up', back: 'Back to FINMA movements', privacy: 'Privacy policy',
    confirm: ['Confirm your sign-up', 'You asked to be notified by e-mail when the detailed history of FINMA movements is available. Confirm this request with the button below.'],
    confirmButton: 'Confirm my sign-up',
    confirmFine: 'Without confirmation, your address is erased 7 days after the request. Every message lets you unsubscribe in one click.',
    confirmed: ['Sign-up confirmed', 'Thank you. You will be notified by e-mail when the detailed history is available. Every message contains a one-click unsubscribe link.'],
    confirm_invalid: ['Link expired or already used', 'This confirmation link is no longer valid: it has expired (48 hours), has already been used, or a more recent e-mail replaced it. You can make the request again on the FINMA movements page.'],
    unsubscribe: ['Unsubscribe', 'Your address will be erased immediately. You will receive no further message about this.'],
    unsubscribeButton: 'Unsubscribe',
    unsubscribed: ['Address erased', 'Your sign-up has been erased. You will receive no further message about this.'],
    unsubscribe_missing: ['No sign-up for this link', 'No address is stored for this link: it has already been erased.'],
    link_invalid: ['Invalid link', 'This link is incomplete or has been altered. Open the link exactly as it appears in the e-mail you received.'],
    unavailable: ['Service temporarily unavailable', 'Nothing has been changed. Try again shortly with the same link.'],
  },
};

// Présentation Atlas (papier ivoire, vert profond, filet rouge), polices système : rien n'est chargé.
const CSS = `:root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#16382f;background:#f4f3ed}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:28px 20px;display:flex;flex-direction:column;align-items:center;background:#f4f3ed}header,main,footer{width:100%;max-width:520px}.brand{display:inline-flex;align-items:center;gap:10px;font-size:21px;font-weight:660;letter-spacing:-1px;color:#16382f;text-decoration:none;padding:8px 0}.mark{display:inline-grid;place-items:center;width:26px;height:26px;background:#b83a2c;border-radius:6px;color:#fff;font-size:24px;font-weight:600;line-height:1}.mark::before{content:"+"}main{margin:auto 0;padding:40px 0}article{position:relative;background:#fbfbf5;border:1px solid #d7ded5;border-radius:12px;padding:36px 34px 30px;box-shadow:12px 12px 0 #dde5d7,12px 12px 0 1px #cbd6c7,0 30px 60px #16382f14}article::before{content:"";position:absolute;top:-1px;left:34px;width:56px;height:3px;background:#b83a2c}.eyebrow{display:flex;align-items:center;gap:10px;color:#53675e;letter-spacing:.09em;font-size:11px;font-weight:600;margin:0 0 18px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.eyebrow::before{content:"";width:7px;height:7px;flex:none;background:#b83a2c;border-radius:1px}h1{font-size:clamp(28px,6vw,38px);line-height:1.1;letter-spacing:-.045em;font-weight:560;margin:0 0 18px;color:#16382f;overflow-wrap:break-word}p{font-size:15px;line-height:1.7;margin:0 0 18px;color:#53675e}button,.back{display:flex;align-items:center;justify-content:center;width:100%;min-height:54px;padding:15px 18px;border:1px solid #16382f;border-radius:6px;background:#16382f;color:#fff;font:inherit;font-size:15px;font-weight:600;text-align:center;text-decoration:none;cursor:pointer;line-height:1.4}button:hover,.back:hover{background:#245143}button:focus-visible,a:focus-visible{outline:3px solid #b83a2c;outline-offset:4px}.fine{font-size:12px;line-height:1.6;margin:18px 0 0;padding-top:16px;border-top:1px solid #d7ded5;color:#53675e}.fine a{color:#16382f;text-underline-offset:3px}footer{text-align:center;padding:12px 0 0;color:#53675e;font-size:12px}@media(max-width:400px){body{padding:20px 16px}main{padding:28px 0}article{padding:28px 22px 24px;box-shadow:8px 8px 0 #dde5d7,8px 8px 0 1px #cbd6c7,0 20px 40px #16382f12}article::before{left:22px}}`;
export const ANNOUNCEMENT_PAGE_CSP = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(CSS).digest('base64')}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const prefix = (lang: AnnouncementLang) => (lang === 'fr' ? '' : '/' + lang);
export const announcementVitrinePath = (lang: AnnouncementLang) => `${prefix(lang)}/finma-movements/`;
/** Section « Finalités et fondements » de la notice : ses identifiants sont les mêmes en FR, DE et EN. */
export const announcementPrivacyPath = (lang: AnnouncementLang) => `${prefix(lang)}/legal/privacy#finalites`;
export const announcementRequestLang = (header: string | undefined): AnnouncementLang =>
  (/^(de|en)(?:-|,|;|$)/i.exec(header ?? '')?.[1]?.toLowerCase() as 'de' | 'en' | undefined) ?? 'fr';

/**
 * `token` : jeton de confirmation ou lien de désinscription scellé, recopié dans le formulaire (corps du POST,
 * jamais l'adresse de la requête). Il figure déjà dans l'adresse de la page ouverte depuis l'e-mail.
 */
export function announcementPage(lang: AnnouncementLang, kind: AnnouncementPageKind, token?: string): string {
  const c = COPY[lang];
  const [title, text] = c[kind];
  const privacy = `<p class="fine"><a href="${announcementPrivacyPath(lang)}">${c.privacy}</a></p>`;
  let content: string;
  if (kind === 'confirm' && token) {
    content = `<p>${text}</p><form method="post" action="/api/announcements/confirm" autocomplete="off"><input type="hidden" name="token" value="${escape(token)}"><button type="submit" name="decision" value="confirm">${c.confirmButton}</button></form><p class="fine">${c.confirmFine} <a href="${announcementPrivacyPath(lang)}">${c.privacy}</a></p>`;
  } else if (kind === 'unsubscribe' && token) {
    content = `<p>${text}</p><form method="post" action="/api/announcements/unsubscribe" autocomplete="off"><input type="hidden" name="token" value="${escape(token)}"><button type="submit" name="decision" value="unsubscribe">${c.unsubscribeButton}</button></form>${privacy}`;
  } else {
    const role = ['confirm_invalid', 'link_invalid', 'unavailable'].includes(kind) ? ' role="alert"' : ' role="status"';
    content = `<p${role}>${text}</p><a class="back" href="${announcementVitrinePath(lang)}">${c.back}</a>${privacy}`;
  }
  // strict-origin : la page ouverte depuis l'e-mail garde une origine vérifiable pour son formulaire, sans chemin ni jeton.
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="strict-origin"><title>${escape(title)} · OpenSwissData</title><style>${CSS}</style></head><body><header><a class="brand" href="${announcementVitrinePath(lang)}"><span class="mark" aria-hidden="true"></span>openswissdata</a></header><main><article><p class="eyebrow">${c.eyebrow}</p><h1>${escape(title)}</h1>${content}</article></main><footer>${c.footer}</footer></body></html>`;
}
