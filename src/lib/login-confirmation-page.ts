import {createHash} from 'node:crypto';

export type LoginLocale = 'fr' | 'de' | 'en';
type Notice = 'invalid' | 'changed' | 'unavailable';
const COPY = {
  fr: {
    title: 'Confirmer votre connexion', eyebrow: 'VOTRE ESPACE PRIVÉ',
    intro: 'Vous êtes sur le point d’ouvrir le compte associé à cette adresse.',
    account: 'Compte à ouvrir', current: 'Compte actuellement ouvert',
    button: 'Confirmer ma connexion', cancel: 'Annuler',
    advice: 'Confirmez uniquement si vous avez demandé ce lien et reconnaissez cette adresse.',
    expiry: 'Cette confirmation est valable cinq minutes au maximum, sans prolonger la validité du lien reçu.',
    switch: 'Cette connexion remplacera le compte actuellement ouvert sur cet appareil.',
    checkbox: 'Je souhaite changer de compte sur cet appareil.',
    footer: 'OpenSwissData · Connexion à votre compte', back: 'Revenir à mon espace',
    invalid: ['Confirmation indisponible', 'Si vous venez de confirmer, ouvrez d’abord votre espace avec le bouton ci-dessous. Sinon, rouvrez le lien reçu par email dans ce navigateur. S’il a expiré ou a déjà été utilisé, demandez un nouveau lien depuis votre espace.'],
    changed: ['Votre connexion a changé', 'Un compte a été ouvert ou fermé depuis l’affichage de cette page. Rouvrez le lien reçu pour vérifier le compte avant de confirmer.'],
    unavailable: ['La connexion peut attendre', 'Le service est momentanément indisponible. Aucune connexion n’a été confirmée. Rouvrez le lien reçu dans quelques instants ; il reste soumis à sa durée de validité.'],
  },
  de: {
    title: 'Anmeldung bestätigen', eyebrow: 'IHR PRIVATER BEREICH',
    intro: 'Sie sind dabei, das Konto zu dieser Adresse zu öffnen.',
    account: 'Zu öffnendes Konto', current: 'Derzeit geöffnetes Konto',
    button: 'Meine Anmeldung bestätigen', cancel: 'Abbrechen',
    advice: 'Bestätigen Sie nur, wenn Sie diesen Link angefordert haben und diese Adresse erkennen.',
    expiry: 'Diese Bestätigung ist höchstens fünf Minuten gültig. Die Gültigkeit des erhaltenen Links wird nicht verlängert.',
    switch: 'Diese Anmeldung ersetzt das derzeit auf diesem Gerät geöffnete Konto.',
    checkbox: 'Ich möchte das Konto auf diesem Gerät wechseln.',
    footer: 'OpenSwissData · Anmeldung bei Ihrem Konto', back: 'Zurück zu meinem Bereich',
    invalid: ['Bestätigung nicht verfügbar', 'Falls Sie gerade bestätigt haben, öffnen Sie zuerst Ihren Bereich über die Schaltfläche unten. Andernfalls öffnen Sie den Link aus Ihrer E-Mail erneut in diesem Browser. Ist er abgelaufen oder bereits verwendet, fordern Sie in Ihrem Bereich einen neuen Link an.'],
    changed: ['Ihre Anmeldung hat sich geändert', 'Seit dem Öffnen dieser Seite wurde ein Konto an- oder abgemeldet. Öffnen Sie den erhaltenen Link erneut und prüfen Sie das Konto vor der Bestätigung.'],
    unavailable: ['Bitte versuchen Sie es später erneut', 'Der Dienst ist vorübergehend nicht verfügbar. Es wurde keine Anmeldung bestätigt. Öffnen Sie den erhaltenen Link in Kürze erneut; seine Gültigkeitsdauer bleibt unverändert.'],
  },
  en: {
    title: 'Confirm your sign-in', eyebrow: 'YOUR PRIVATE SPACE',
    intro: 'You are about to open the account associated with this address.',
    account: 'Account to open', current: 'Currently signed-in account',
    button: 'Confirm my sign-in', cancel: 'Cancel',
    advice: 'Only confirm if you requested this link and recognise this address.',
    expiry: 'This confirmation is valid for up to five minutes. It does not extend the validity of the email link.',
    switch: 'This sign-in will replace the account currently open on this device.',
    checkbox: 'I want to switch accounts on this device.',
    footer: 'OpenSwissData · Account sign-in', back: 'Back to my account',
    invalid: ['Confirmation unavailable', 'If you have just confirmed, open your account using the button below first. Otherwise, reopen the link from your email in this browser. If it has expired or has already been used, request a new link from your account page.'],
    changed: ['Your sign-in has changed', 'An account has been signed in or out since this page was opened. Reopen the email link and check the account before confirming.'],
    unavailable: ['Please try again shortly', 'The service is temporarily unavailable. No sign-in has been confirmed. Reopen the email link shortly; its original validity period still applies.'],
  },
} as const;

// Présentation Atlas (papier ivoire, vert profond, filet rouge) ; polices système, rien de chargé : la CSP n’autorise que ce style, par empreinte.
const CSS = `:root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#16382f;background:#f4f3ed}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:28px 20px;display:flex;flex-direction:column;align-items:center;background:#f4f3ed}header,main,footer{width:100%;max-width:520px}.brand{display:inline-flex;align-items:center;gap:10px;font-size:21px;font-weight:660;letter-spacing:-1px;color:#16382f;text-decoration:none;padding:8px 0}.mark{display:inline-grid;place-items:center;width:26px;height:26px;background:#b83a2c;border-radius:6px;color:#fff;font-size:24px;font-weight:600;line-height:1;letter-spacing:0}.mark::before{content:"+"}main{margin:auto 0;padding:40px 0}article{position:relative;background:#fbfbf5;border:1px solid #d7ded5;border-radius:12px;padding:36px 34px 30px;box-shadow:12px 12px 0 #dde5d7,12px 12px 0 1px #cbd6c7,0 30px 60px #16382f14}article::before{content:"";position:absolute;top:-1px;left:34px;width:56px;height:3px;background:#b83a2c}.eyebrow{display:flex;align-items:center;gap:10px;color:#53675e;letter-spacing:.09em;font-size:11px;font-weight:600;margin:0 0 18px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.eyebrow::before{content:"";width:7px;height:7px;flex:none;background:#b83a2c;border-radius:1px}h1{font-size:clamp(28px,6vw,38px);line-height:1.1;letter-spacing:-.045em;font-weight:560;margin:0 0 18px;color:#16382f;overflow-wrap:break-word}p{font-size:15px;line-height:1.7;margin:0 0 18px;color:#53675e}.account{padding:18px 20px;background:#eef1e9;border:1px solid #d7ded5;border-left:3px solid #16382f;border-radius:0 8px 8px 0;margin:22px 0}.account span{display:block;color:#53675e;font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.account bdi{font-size:17px;font-weight:650;color:#16382f;overflow-wrap:anywhere}.current{margin:12px 0 0;font-size:13px}.current bdi{font-size:13px;font-weight:600}.warning{padding:16px 18px;border-radius:0 8px 8px 0;background:#f6efe1;border-left:3px solid #c9953f;color:#5d4214;margin:18px 0}.warning p{color:inherit;font-size:14px;margin:0 0 14px}label{display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.5;cursor:pointer;color:#16382f}input[type=checkbox]{accent-color:#16382f;width:18px;height:18px;flex:0 0 18px;margin:2px 0}button,.back{display:flex;align-items:center;justify-content:center;width:100%;min-height:54px;padding:15px 18px;border:1px solid #16382f;border-radius:6px;background:#16382f;color:#fff;font:inherit;font-size:15px;font-weight:600;text-align:center;text-decoration:none;cursor:pointer;line-height:1.4}button:hover,.back:hover{background:#245143}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #b83a2c;outline-offset:4px}.cancel{display:block;text-align:center;color:#16382f;padding:15px 8px;font-size:14px;text-underline-offset:4px}.fine{font-size:12px;line-height:1.6;margin:18px 0 0;padding-top:16px;border-top:1px solid #d7ded5;color:#53675e}footer{text-align:center;padding:12px 0 0;color:#53675e;font-size:12px}@media(max-width:400px){body{padding:20px 16px}main{padding:28px 0}article{padding:28px 22px 24px;box-shadow:8px 8px 0 #dde5d7,8px 8px 0 1px #cbd6c7,0 20px 40px #16382f12}article::before{left:22px}}`;
export const LOGIN_CONFIRMATION_CSP = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(CSS).digest('base64')}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export const loginAccountPath = (locale: LoginLocale) => (locale === 'fr' ? '' : '/' + locale) + '/account';

function displayLoginEmail(email: string): string {
  return email.slice(0, 320).replace(/[\p{Cc}\p{Cf}]/gu, '');
}
function shell(locale: LoginLocale, title: string, content: string, confirmation = false): string {
  const c = COPY[locale];
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="${confirmation ? 'strict-origin' : 'no-referrer'}"><title>${escape(title)} · OpenSwissData</title><style>${CSS}</style></head><body><header><a class="brand" href="${loginAccountPath(locale)}"><span class="mark" aria-hidden="true"></span>openswissdata</a></header><main><article><p class="eyebrow">${c.eyebrow}</p><h1>${escape(title)}</h1>${content}</article></main><footer>${c.footer}</footer></body></html>`;
}

export function loginConfirmationPage(view: {locale: LoginLocale; email: string; currentEmail?: string; switchAccount: boolean; confirmation: string}): string {
  const c = COPY[view.locale];
  const current = view.currentEmail ? `<p class="current">${c.current} : <bdi>${escape(displayLoginEmail(view.currentEmail))}</bdi></p>` : '';
  const warning = view.switchAccount ? `<div class="warning"><p>${c.switch}</p><label><input id="switch-account" name="switch_account" type="checkbox" value="yes" required><span>${c.checkbox}</span></label></div>` : '';
  return shell(view.locale, c.title, `<p>${c.intro}</p><div class="account"><span>${c.account}</span><bdi id="target-account">${escape(displayLoginEmail(view.email))}</bdi>${current}</div><p>${c.advice}</p><form id="login-confirmation" method="post" action="/api/auth/confirm" autocomplete="off"><input type="hidden" name="confirmation" value="${escape(view.confirmation)}">${warning}<button id="confirm-login" type="submit" name="decision" value="connect">${c.button}</button><a class="cancel" href="${loginAccountPath(view.locale)}">${c.cancel}</a></form><p class="fine">${c.expiry}</p>`, true);
}

export function loginNoticePage(locale: LoginLocale, kind: Notice): string {
  const c = COPY[locale], notice = c[kind];
  return shell(locale, notice[0], `<p id="login-error" role="alert">${notice[1]}</p><a class="back" href="${loginAccountPath(locale)}">${c.back}</a>`);
}
