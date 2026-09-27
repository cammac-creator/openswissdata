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

const CSS = `:root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18333a;background:#f3f6f4}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:32px 20px;display:flex;flex-direction:column;align-items:center}header,main,footer{width:100%;max-width:510px}.brand{font-size:20px;font-weight:750;letter-spacing:-.7px;color:#18333a;text-decoration:none;display:inline-block;padding:8px 0}.mark{display:inline-block;width:14px;height:14px;background:#b66a40;margin-right:10px;border-radius:3px;vertical-align:0}main{margin:auto 0;padding:44px 0}article{background:#fff;border:1px solid #dce5e0;border-radius:22px;padding:34px;box-shadow:0 12px 48px #18333a08}.eyebrow{color:#337566;letter-spacing:2px;font-size:11px;font-weight:700;margin:0 0 16px}h1{font-size:clamp(26px,5vw,34px);line-height:1.15;letter-spacing:-1px;margin:0 0 20px}p{font-size:15px;line-height:1.65;margin:0 0 20px;color:#4e6267}.account{padding:18px;background:#f3f7f5;border:1px solid #dce7e1;border-radius:12px;margin:24px 0}.account span{display:block;color:#536b64;font-size:12px;margin-bottom:6px}.account bdi{font-weight:650;overflow-wrap:anywhere}.current{margin:12px 0 0;font-size:13px}.current bdi{font-weight:600}.warning{padding:16px;border-radius:12px;background:#fff7e9;border:1px solid #ebd5aa;color:#684b18;margin:18px 0}.warning p{color:inherit;font-size:14px;margin:0 0 14px}label{display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.5;cursor:pointer}input[type=checkbox]{accent-color:#176756;width:18px;height:18px;flex:0 0 18px;margin:2px 0}button,.back{display:block;width:100%;padding:16px 18px;border:0;border-radius:10px;background:#176756;color:white;font:inherit;font-size:15px;font-weight:650;text-align:center;text-decoration:none;cursor:pointer;line-height:1.4}button:hover,.back:hover{background:#104f43}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #b87736;outline-offset:4px}.cancel{display:block;text-align:center;color:#455e58;padding:15px 8px;font-size:14px;text-underline-offset:4px}.fine{font-size:12px;line-height:1.6;margin:20px 0 0;color:#657773}footer{text-align:center;padding:12px 0 0;color:#657773;font-size:12px}@media(max-width:400px){body{padding:20px 16px}main{padding:28px 0}article{padding:25px 22px}}`;
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
