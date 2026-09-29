// Présentation Atlas de /api/delivery/:token (29.09.2026). Ce module ne fait que du HTML :
// la route garde ses contrôles, ses codes, ses en-têtes et sa redirection signée.
// La CSP de la route (default-src 'none', style-src 'unsafe-inline') interdit toute ressource :
// styles en ligne, icônes SVG dans le document, polices système proches de Geist.
// Aucun jeton ailleurs que dans la cible du formulaire de confirmation.

export type DeliveryLocale = "fr" | "de" | "en";
export type DeliveryState =
  | "invalid" | "unknown" | "expired" | "used" | "unavailable"
  | "revoked" | "outside" | "missing" | "error";

/** Durées affichées ; un test les compare aux constantes de la route et du worker. */
export const DELIVERY_LINK_HOURS = 48;
export const DELIVERY_DOUBLE_CLICK_SECONDS = 90;

/**
 * Réponses texte historiques de redeemDownload (statut + corps exact) → état présenté.
 * Tout couple absent de cette table est présenté comme une erreur générique, jamais en brut.
 */
const STATE_BY_RESPONSE: Readonly<Record<string, DeliveryState>> = {
  "400 invalid token": "invalid",
  "404 token not found": "unknown",
  "410 token expired": "expired",
  "410 token already used": "used",
  "410 token expired or already used": "unavailable",
  "403 entitlement revoked": "revoked",
  "403 version outside entitlement": "outside",
  "404 version missing": "missing",
  "500 version missing": "missing",
};
export const DELIVERY_RESPONSE_TEXTS: readonly string[] = Object.keys(STATE_BY_RESPONSE);

export function deliveryStateFor(status: number, text: string): DeliveryState {
  return STATE_BY_RESPONSE[`${status} ${text}`] ?? "error";
}

/** Langue de la page GET : paramètre du lien du mail, français par défaut (comme avant). */
export function deliveryLocaleFromQuery(value: string | undefined): DeliveryLocale {
  return value === "de" ? "de" : value === "en" ? "en" : "fr";
}

/**
 * Langue d'une réponse au POST : le formulaire ne transmet rien (cible et champs inchangés),
 * seule la langue du navigateur est disponible. Français par défaut.
 */
export function deliveryLocaleFromHeader(header: string | undefined): DeliveryLocale {
  const ranked = (header ?? "").split(",").map((part, index) => {
    const [tag = "", ...params] = part.trim().toLowerCase().split(";");
    const weight = params.map(p => p.trim()).find(p => p.startsWith("q="));
    const q = weight === undefined ? 1 : Number(weight.slice(2));
    return { lang: tag.split("-")[0], q: Number.isFinite(q) ? q : 0, index };
  }).filter(entry => entry.q > 0 && (entry.lang === "fr" || entry.lang === "de" || entry.lang === "en"))
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return (ranked[0]?.lang as DeliveryLocale | undefined) ?? "fr";
}

const prefix = (locale: DeliveryLocale) => (locale === "fr" ? "" : `/${locale}`);
const homePath = (locale: DeliveryLocale) => (locale === "fr" ? "/" : `/${locale}/`);
export const deliveryAccountPath = (locale: DeliveryLocale) => `${prefix(locale)}/account`;
const supportPath = (locale: DeliveryLocale, anchor?: string) => `${prefix(locale)}/support${anchor ? `#${anchor}` : ""}`;

type Action = "account" | "support" | "retry";
type Tone = "info" | "warn" | "stop";
type Icon = "link" | "clock" | "check" | "lock" | "alert";
interface Notice { tag: string; title: string; body: string[]; note: string }
interface NoticeShape { tone: Tone; icon: Icon; primary: Action; secondary: Action; anchor?: string }

const SHAPES: Record<DeliveryState, NoticeShape> = {
  invalid: { tone: "info", icon: "link", primary: "account", secondary: "support", anchor: "lien-expire" },
  unknown: { tone: "info", icon: "link", primary: "account", secondary: "support", anchor: "lien-expire" },
  expired: { tone: "info", icon: "clock", primary: "account", secondary: "support", anchor: "lien-expire" },
  used: { tone: "info", icon: "check", primary: "account", secondary: "support", anchor: "lien-expire" },
  unavailable: { tone: "info", icon: "clock", primary: "account", secondary: "support", anchor: "lien-expire" },
  revoked: { tone: "stop", icon: "lock", primary: "support", secondary: "account" },
  outside: { tone: "stop", icon: "lock", primary: "account", secondary: "support" },
  missing: { tone: "warn", icon: "alert", primary: "support", secondary: "account" },
  error: { tone: "warn", icon: "alert", primary: "retry", secondary: "support" },
};

const H = DELIVERY_LINK_HOURS;
const S = DELIVERY_DOUBLE_CLICK_SECONDS;

const COPY = {
  fr: {
    eyebrow: "Livraison de votre achat", where: "Téléchargement",
    title: "Confirmer le téléchargement",
    intro: "Touchez le bouton pour recevoir l’archive ZIP de votre achat. Cette confirmation évite qu’un aperçu automatique de votre messagerie n’utilise le lien à votre place.",
    rulesLabel: "Règles de ce lien",
    rules: [[`${H} h`, "Durée de validité du lien reçu."], ["1 fois", "Le premier clic utilise le lien : il ne sert qu’une fois."], [`${S} s`, `Touché deux fois par erreur ? Le second clic reste accepté pendant ${S} secondes, sans prolonger le lien.`]],
    button: "Télécharger mon fichier",
    after: "Le fichier arrive dans les téléchargements de votre navigateur ; cette page reste affichée.",
    personal: "Ce lien est personnel : ne le transmettez pas.",
    helpTitle: "Si le lien ne fonctionne plus",
    helpAccount: "L’expiration d’un lien ne supprime pas vos droits : votre espace prépare un nouvel accès aux versions comprises dans votre achat.",
    helpSupport: "Lien expiré, fichier illisible, reçu : les réponses et le contact.",
    actions: { account: "Ouvrir mon espace client", support: "Aide et support", retry: "Revenir à la confirmation" },
    footer: "OpenSwissData · Téléchargement de votre achat",
    notices: {
      invalid: { tag: "Lien incomplet", title: "Ce lien est incomplet", body: ["L’adresse ouverte ne correspond pas à un lien de téléchargement complet. Il arrive qu’une messagerie coupe un long lien en deux."], note: "Rouvrez le lien en le touchant directement dans le mail, sans le copier. Vos fichiers restent aussi disponibles dans votre espace client." },
      unknown: { tag: "Lien introuvable", title: "Ce lien n’est plus reconnu", body: [`Le plus souvent, il a expiré : un lien de téléchargement reste valable ${H} heures, puis il est effacé. Il peut aussi avoir été copié en partie.`], note: "L’expiration d’un lien ne supprime pas vos droits. Votre espace client prépare un nouvel accès aux versions comprises dans votre achat." },
      expired: { tag: "Lien expiré", title: "Ce lien a expiré", body: [`Un lien de téléchargement reste valable ${H} heures. Ce délai est dépassé : le lien ne peut plus servir.`], note: "L’expiration d’un lien ne supprime pas vos droits. Votre espace client prépare un nouvel accès aux versions comprises dans votre achat." },
      used: { tag: "Lien déjà utilisé", title: "Ce lien a déjà servi", body: [`Un lien de téléchargement ne s’utilise qu’une fois. Il a été utilisé il y a plus de ${S} secondes, depuis cet appareil ou un autre.`, "Si le téléchargement a abouti, l’archive ZIP se trouve dans le dossier Téléchargements de votre appareil."], note: "Sinon, votre espace client prépare un nouvel accès aux versions comprises dans votre achat." },
      unavailable: { tag: "Lien épuisé", title: "Ce lien vient de s’épuiser", body: ["Au moment de votre clic, le lien a expiré ou a été utilisé ailleurs, par exemple depuis un autre onglet. Ce clic n’a déclenché aucun téléchargement."], note: "Votre espace client prépare un nouvel accès aux versions comprises dans votre achat." },
      revoked: { tag: "Accès inactif", title: "L’accès à cet achat n’est pas actif", body: ["Les droits liés à cet achat ne sont pas actifs actuellement, par exemple après un remboursement complet ou pendant l’examen d’une contestation de paiement."], note: "Aucun fichier n’a été transmis et le lien n’a pas été utilisé. Si cette situation vous surprend, écrivez-nous depuis la page d’aide avec l’adresse email de l’achat." },
      outside: { tag: "Version non comprise", title: "Cette version n’est pas comprise dans l’achat", body: ["Le lien vise une version publiée après la fin de la période de mises à jour de votre achat."], note: "Le lien n’a pas été utilisé. Votre espace client donne accès aux versions comprises dans votre achat." },
      missing: { tag: "Fichier indisponible", title: "Ce fichier est momentanément indisponible", body: ["La version visée par ce lien n’est pas disponible au téléchargement pour le moment."], note: "Le lien n’a pas été utilisé. Réessayez plus tard, ou écrivez-nous depuis la page d’aide." },
      error: { tag: "Service indisponible", title: "Le téléchargement n’a pas pu démarrer", body: ["Le service de fichiers n’a pas répondu. Aucun fichier n’a été transmis."], note: "Revenez à la confirmation et réessayez dans quelques minutes : le bouton reste utilisable tant que le lien est valable. En cas de nouvel échec, votre espace client ou la page d’aide prennent le relais." },
    },
  },
  de: {
    eyebrow: "Lieferung Ihres Kaufs", where: "Download",
    title: "Download bestätigen",
    intro: "Tippen Sie auf die Schaltfläche, um das ZIP-Archiv Ihres Kaufs zu erhalten. Diese Bestätigung verhindert, dass eine automatische Vorschau Ihres E-Mail-Programms den Link an Ihrer Stelle verbraucht.",
    rulesLabel: "Regeln dieses Links",
    rules: [[`${H} Std.`, "Gültigkeit des erhaltenen Links."], ["1 Mal", "Der erste Klick verbraucht den Link: Er ist nur einmal nutzbar."], [`${S} s`, `Versehentlich zweimal getippt? Der zweite Klick wird ${S} Sekunden lang akzeptiert, ohne den Link zu verlängern.`]],
    button: "Datei herunterladen",
    after: "Die Datei landet in den Downloads Ihres Browsers; diese Seite bleibt geöffnet.",
    personal: "Dieser Link ist persönlich: Bitte geben Sie ihn nicht weiter.",
    helpTitle: "Wenn der Link nicht mehr funktioniert",
    helpAccount: "Der Ablauf eines Links löscht Ihre Rechte nicht: Im Kundenkonto erhalten Sie einen neuen Zugang zu den Versionen Ihres Kaufs.",
    helpSupport: "Abgelaufener Link, unlesbare Datei, Beleg: Antworten und Kontakt.",
    actions: { account: "Kundenkonto öffnen", support: "Hilfe und Support", retry: "Zurück zur Bestätigung" },
    footer: "OpenSwissData · Download Ihres Kaufs",
    notices: {
      invalid: { tag: "Link unvollständig", title: "Dieser Link ist unvollständig", body: ["Die geöffnete Adresse entspricht keinem vollständigen Download-Link. Manche E-Mail-Programme trennen lange Links in zwei Teile."], note: "Öffnen Sie den Link direkt aus der E-Mail, ohne ihn zu kopieren. Ihre Dateien finden Sie auch im Kundenkonto." },
      unknown: { tag: "Link unbekannt", title: "Dieser Link ist nicht mehr bekannt", body: [`Meist ist er abgelaufen: Ein Download-Link bleibt ${H} Stunden gültig und wird danach gelöscht. Er kann auch unvollständig kopiert worden sein.`], note: "Der Ablauf eines Links löscht Ihre Rechte nicht. Im Kundenkonto erhalten Sie einen neuen Zugang zu den Versionen Ihres Kaufs." },
      expired: { tag: "Link abgelaufen", title: "Dieser Link ist abgelaufen", body: [`Ein Download-Link bleibt ${H} Stunden gültig. Diese Frist ist verstrichen: Der Link kann nicht mehr verwendet werden.`], note: "Der Ablauf eines Links löscht Ihre Rechte nicht. Im Kundenkonto erhalten Sie einen neuen Zugang zu den Versionen Ihres Kaufs." },
      used: { tag: "Link bereits verwendet", title: "Dieser Link wurde bereits verwendet", body: [`Ein Download-Link ist nur einmal nutzbar. Er wurde vor mehr als ${S} Sekunden verwendet, auf diesem oder einem anderen Gerät.`, "War der Download erfolgreich, liegt das ZIP-Archiv im Download-Ordner Ihres Geräts."], note: "Andernfalls erhalten Sie im Kundenkonto einen neuen Zugang zu den Versionen Ihres Kaufs." },
      unavailable: { tag: "Link verbraucht", title: "Dieser Link ist nicht mehr nutzbar", body: ["Im Moment Ihres Klicks ist der Link abgelaufen oder wurde anderswo verwendet, zum Beispiel in einem anderen Tab. Dieser Klick hat keinen Download ausgelöst."], note: "Im Kundenkonto erhalten Sie einen neuen Zugang zu den Versionen Ihres Kaufs." },
      revoked: { tag: "Zugang inaktiv", title: "Der Zugang zu diesem Kauf ist nicht aktiv", body: ["Die Rechte aus diesem Kauf sind derzeit nicht aktiv, zum Beispiel nach einer vollständigen Erstattung oder während der Prüfung einer Zahlungsanfechtung."], note: "Es wurde keine Datei übertragen und der Link wurde nicht verbraucht. Falls Sie das überrascht, schreiben Sie uns über die Hilfeseite mit der E-Mail-Adresse des Kaufs." },
      outside: { tag: "Version nicht enthalten", title: "Diese Version ist im Kauf nicht enthalten", body: ["Der Link verweist auf eine Version, die nach dem Ende des Aktualisierungszeitraums Ihres Kaufs veröffentlicht wurde."], note: "Der Link wurde nicht verbraucht. Im Kundenkonto finden Sie die Versionen, die Ihr Kauf umfasst." },
      missing: { tag: "Datei nicht verfügbar", title: "Diese Datei ist vorübergehend nicht verfügbar", body: ["Die Version, auf die dieser Link verweist, steht derzeit nicht zum Download bereit."], note: "Der Link wurde nicht verbraucht. Versuchen Sie es später erneut oder schreiben Sie uns über die Hilfeseite." },
      error: { tag: "Dienst nicht verfügbar", title: "Der Download konnte nicht starten", body: ["Der Dateidienst hat nicht geantwortet. Es wurde keine Datei übertragen."], note: "Kehren Sie zur Bestätigung zurück und versuchen Sie es in einigen Minuten erneut: Die Schaltfläche bleibt nutzbar, solange der Link gültig ist. Scheitert es erneut, helfen Ihnen das Kundenkonto oder die Hilfeseite weiter." },
    },
  },
  en: {
    eyebrow: "Your purchase delivery", where: "Download",
    title: "Confirm your download",
    intro: "Tap the button to receive the ZIP archive of your purchase. This confirmation stops an automatic preview in your mail app from using the link on your behalf.",
    rulesLabel: "Rules for this link",
    rules: [[`${H} h`, "How long the link you received stays valid."], ["Once", "The first click uses the link: it works only once."], [`${S} s`, `Tapped twice by mistake? The second click is still accepted for ${S} seconds, without extending the link.`]],
    button: "Download my file",
    after: "The file goes to your browser’s downloads; this page stays open.",
    personal: "This link is personal: please do not forward it.",
    helpTitle: "If the link no longer works",
    helpAccount: "An expired link does not remove your rights: your account prepares new access to the versions covered by your purchase.",
    helpSupport: "Expired link, unreadable file, receipt: answers and contact.",
    actions: { account: "Open my account", support: "Help and support", retry: "Back to the confirmation" },
    footer: "OpenSwissData · Your purchase download",
    notices: {
      invalid: { tag: "Incomplete link", title: "This link is incomplete", body: ["The address you opened is not a complete download link. Some mail apps split long links in two."], note: "Open the link by tapping it directly in the email, without copying it. Your files are also available in your account." },
      unknown: { tag: "Link not found", title: "This link is no longer recognised", body: [`Most often it has expired: a download link stays valid for ${H} hours and is then deleted. It may also have been copied only in part.`], note: "An expired link does not remove your rights. Your account prepares new access to the versions covered by your purchase." },
      expired: { tag: "Link expired", title: "This link has expired", body: [`A download link stays valid for ${H} hours. That time has passed, so the link can no longer be used.`], note: "An expired link does not remove your rights. Your account prepares new access to the versions covered by your purchase." },
      used: { tag: "Link already used", title: "This link has already been used", body: [`A download link works only once. It was used more than ${S} seconds ago, on this device or another one.`, "If the download finished, the ZIP archive is in your device’s Downloads folder."], note: "Otherwise, your account prepares new access to the versions covered by your purchase." },
      unavailable: { tag: "Link used up", title: "This link has just run out", body: ["At the moment you clicked, the link expired or was used elsewhere, for example in another tab. This click did not start a download."], note: "Your account prepares new access to the versions covered by your purchase." },
      revoked: { tag: "Access inactive", title: "Access to this purchase is not active", body: ["The rights attached to this purchase are not active at the moment, for example after a full refund or while a payment dispute is being reviewed."], note: "No file was sent and the link was not used. If this surprises you, write to us from the help page with the email address used for the purchase." },
      outside: { tag: "Version not included", title: "This version is not included in the purchase", body: ["The link points to a version released after the update period of your purchase ended."], note: "The link was not used. Your account gives access to the versions covered by your purchase." },
      missing: { tag: "File unavailable", title: "This file is temporarily unavailable", body: ["The version this link points to is not available for download at the moment."], note: "The link was not used. Try again later, or write to us from the help page." },
      error: { tag: "Service unavailable", title: "The download could not start", body: ["The file service did not respond. No file was sent."], note: "Go back to the confirmation and try again in a few minutes: the button keeps working while the link is valid. If it fails again, your account or the help page will take over." },
    },
  },
} as const satisfies Record<DeliveryLocale, {
  eyebrow: string; where: string; title: string; intro: string; rulesLabel: string;
  rules: readonly (readonly [string, string])[]; button: string; after: string; personal: string;
  helpTitle: string; helpAccount: string; helpSupport: string;
  actions: Record<Action, string>; footer: string; notices: Record<DeliveryState, Notice>;
}>;

const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
const ICONS: Record<Icon | "download" | "arrow" | "info", string> = {
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19.5h14"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16 9.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  alert: '<path d="M12 4 3 20h18L12 4z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
};
const icon = (name: keyof typeof ICONS) => `<svg ${SVG_ATTRS}>${ICONS[name]}</svg>`;

// Palette Atlas (papier ivoire, vert profond, filet rouge) ; pile système proche de Geist.
const CSS = `:root{color-scheme:light;--paper:#f4f3ed;--ink:#16382f;--muted:#53675e;--line:#d7ded5;--red:#b83a2c;--card:#fbfbf5;--soft:#eef1e9;--sans:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-family:var(--sans);color:var(--ink);background:var(--paper);-webkit-text-size-adjust:100%;text-size-adjust:100%}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100svh;display:flex;flex-direction:column;align-items:center;padding:18px 16px 26px;background:var(--paper);font-size:16px;line-height:1.6}
header,main,footer{width:100%;max-width:560px}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:2px 0 12px;border-bottom:1px solid #16382f17}
.brand{display:inline-flex;align-items:center;gap:9px;min-height:44px;font-size:21px;font-weight:660;letter-spacing:-1px;color:var(--ink);text-decoration:none;white-space:nowrap}
.brand .light{font-weight:400}.brand .point{color:var(--red)}
.mark{display:grid;place-items:center;width:26px;height:26px;background:var(--red);border-radius:6px;color:#fff;font-size:24px;font-weight:600;line-height:1;letter-spacing:0}
.where{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
main{margin-block:auto;padding:30px 0 6px}
article{position:relative;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:34px 32px 28px;box-shadow:12px 12px 0 #dde5d7,12px 12px 0 1px #cbd6c7,0 30px 60px #16382f14}
article::before{content:"";position:absolute;top:-1px;left:32px;width:56px;height:3px;background:var(--red)}
.eyebrow{display:flex;align-items:center;gap:10px;margin:0 0 18px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.eyebrow::before{content:"";width:7px;height:7px;flex:none;background:var(--red);border-radius:1px}
h1{margin:0 0 16px;font-size:clamp(30px,7.2vw,40px);line-height:1.08;letter-spacing:-.045em;font-weight:560;color:var(--ink);overflow-wrap:break-word;text-wrap:balance}
p{margin:0 0 14px;font-size:15.5px;line-height:1.7;color:var(--muted)}
.lede{color:#2f4a41}
dl{display:grid;grid-template-columns:auto 1fr;column-gap:18px;margin:24px 0 26px;border-top:1px solid var(--line)}
dt,dd{margin:0;padding:13px 0;border-bottom:1px solid var(--line)}
dt{font-family:var(--mono);font-size:18px;font-weight:600;letter-spacing:-.02em;line-height:1.35;color:var(--ink);white-space:nowrap}
dd{font-size:14px;line-height:1.55;color:var(--muted);align-self:center}
form{margin:0}
button,.action{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;min-height:56px;padding:15px 20px;border:1px solid var(--ink);border-radius:6px;background:var(--ink);color:#fff;font:inherit;font-size:16px;font-weight:600;line-height:1.35;text-align:left;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
button:hover,.action:hover{background:#245143}
button svg,.action svg{flex:none;width:22px;height:22px}
.after{display:flex;gap:10px;align-items:flex-start;margin:14px 0 0;font-size:13.5px;line-height:1.6}
.after svg{flex:none;width:17px;height:17px;margin-top:2px;color:var(--ink)}
.fine{margin:22px 0 0;padding-top:15px;border-top:1px solid var(--line);font-size:12.5px;line-height:1.6}
.state{display:inline-flex;align-items:center;gap:8px;margin:0 0 16px;padding:6px 13px 6px 9px;border-radius:99px;font-size:13px;font-weight:600;line-height:1.3;background:#e4ebe1;color:var(--ink)}
.state svg{flex:none;width:18px;height:18px}
.state.warn{background:#f5ecd9;color:#664610}
.state.stop{background:#f8e8e3;color:#7d2419}
.note{margin:20px 0 24px;padding:15px 18px;background:var(--soft);border:1px solid var(--line);border-left:3px solid var(--ink);border-radius:0 8px 8px 0;color:#2f4a41;font-size:14.5px;line-height:1.65}
.note.warn{border-left-color:#c9953f;background:#f8f3e8}
.note.stop{border-left-color:var(--red);background:#fbf1ee}
.secondary{display:block;margin-top:6px;padding:14px 4px 4px;text-align:center;color:var(--ink);font-size:14.5px;font-weight:550;text-underline-offset:4px}
.help{margin:40px 0 0}
.help h2{display:flex;align-items:center;gap:10px;margin:0 0 8px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.help h2::before{content:"";width:7px;height:7px;flex:none;background:var(--red);border-radius:1px}
.help ul{margin:0;padding:0;list-style:none;border-top:1px solid #c9d2c6}
.help a{display:grid;grid-template-columns:1fr auto;column-gap:16px;row-gap:3px;align-items:center;padding:16px 2px;border-bottom:1px solid #c9d2c6;color:var(--ink);text-decoration:none}
.help strong{font-size:15.5px;font-weight:600}
.help em{grid-column:1;font-style:normal;font-size:13.5px;line-height:1.55;color:var(--muted)}
.help svg{grid-column:2;grid-row:1 / span 2;width:20px;height:20px;color:var(--red)}
.help a:hover strong{text-decoration:underline;text-underline-offset:4px}
a:focus-visible,button:focus-visible{outline:3px solid var(--red);outline-offset:4px}
footer{padding:28px 0 0;text-align:center;font-size:12px;line-height:1.6;color:var(--muted)}
@media (max-width:440px){body{padding:12px 16px 22px}main{padding-top:24px}article{padding:28px 20px 22px;box-shadow:7px 7px 0 #dde5d7,7px 7px 0 1px #cbd6c7,0 20px 40px #16382f12}article::before{left:20px}dl{column-gap:14px}dt{font-size:16.5px}.where{display:none}}
@media (prefers-reduced-motion:no-preference){button,.action{transition:background-color .2s}}`;

function shell(locale: DeliveryLocale, title: string, content: string, after = ""): string {
  const c = COPY[locale];
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light"><title>${title} · OpenSwissData</title><style>${CSS}</style></head><body>`
    + `<header><a class="brand" href="${homePath(locale)}" aria-label="OpenSwissData"><span class="mark" aria-hidden="true">+</span><span aria-hidden="true">open<span class="light">swiss</span>data<span class="point">.</span></span></a><span class="where">${c.where}</span></header>`
    + `<main><article>${content}</article>${after}</main><footer>${c.footer}</footer></body></html>`;
}

/**
 * Page GET de confirmation. Le formulaire reste exactement celui d'avant :
 * méthode post, cible /api/delivery/<jeton>, aucun champ (bouton sans nom).
 * Le jeton, déjà contrôlé par isValidTokenFormat, n'apparaît nulle part ailleurs.
 */
export function deliveryConfirmationPage(locale: DeliveryLocale, token: string): string {
  const c = COPY[locale];
  const rules = c.rules.map(([value, text]) => `<dt>${value}</dt><dd>${text}</dd>`).join("");
  const help = `<section class="help" aria-labelledby="aide"><h2 id="aide">${c.helpTitle}</h2><ul>`
    + `<li><a href="${deliveryAccountPath(locale)}"><strong>${c.actions.account}</strong><em>${c.helpAccount}</em>${icon("arrow")}</a></li>`
    + `<li><a href="${supportPath(locale, "lien-expire")}"><strong>${c.actions.support}</strong><em>${c.helpSupport}</em>${icon("arrow")}</a></li></ul></section>`;
  return shell(locale, c.title,
    `<p class="eyebrow">${c.eyebrow}</p><h1>${c.title}</h1><p class="lede">${c.intro}</p>`
    + `<dl aria-label="${c.rulesLabel}">${rules}</dl>`
    + `<form method="post" action="/api/delivery/${token}"><button type="submit">${c.button}${icon("download")}</button></form>`
    + `<p class="after">${icon("info")}<span>${c.after}</span></p>`
    + `<p class="fine">${c.personal}</p>`,
    help);
}

/** Page d'un état refusé ou en panne. Aucun jeton, aucun formulaire. */
export function deliveryNoticePage(locale: DeliveryLocale, state: DeliveryState): string {
  const c = COPY[locale];
  const notice: Notice = c.notices[state];
  const shape = SHAPES[state];
  const href = (action: Action) => action === "account" ? deliveryAccountPath(locale)
    : action === "support" ? supportPath(locale, shape.anchor)
    // Adresse relative : revient à la page GET de ce même lien, sans écrire le jeton.
    : `?lang=${locale}`;
  const body = notice.body.map(text => `<p class="lede">${text}</p>`).join("");
  return shell(locale, notice.tag,
    `<p class="eyebrow">${c.eyebrow}</p><p class="state ${shape.tone}">${icon(shape.icon)}<span>${notice.tag}</span></p>`
    + `<h1>${notice.title}</h1>${body}<p class="note ${shape.tone}">${notice.note}</p>`
    + `<a class="action" href="${href(shape.primary)}">${c.actions[shape.primary]}${icon("arrow")}</a>`
    + `<a class="secondary" href="${href(shape.secondary)}">${c.actions[shape.secondary]}</a>`);
}
