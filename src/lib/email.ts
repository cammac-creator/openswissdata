import type { Tier } from "../mcp/oauth/scopes.js";

export interface EmailSendResult {
  sent: boolean;
  reason?: "no_api_key" | "placeholder_key" | "resend_error";
  details?: string;
}

/** Buyer-facing language for transactional emails. */
export type Locale = "fr" | "de" | "en";

/** Coerce an untrusted value (Stripe metadata, DB column) to a Locale, default fr. */
export function parseLocale(v: unknown): Locale {
  return v === "de" || v === "en" ? v : "fr";
}

/** Footer disclaimer, localized. */
const FOOTER_DISCLAIMER: Record<Locale, string> = {
  fr: "openswissdata.com est un service privé indépendant. Non affilié à opendata.swiss, BAZG, BFS, FINMA.",
  de: "openswissdata.com ist ein unabhängiger privater Dienst. Nicht verbunden mit opendata.swiss, BAZG, BFS, FINMA.",
  en: "openswissdata.com is an independent private service. Not affiliated with opendata.swiss, BAZG, BFS, FINMA.",
};

function resendApiKey(): string | null {
  const key = process.env.RESEND_API_KEY;
  if (!key || key === "re_xxx" || key.trim() === "") return null;
  return key.trim();
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL || "noreply@openswissdata.com";
}

/**
 * Reply-To routes any reply on a transactional email back to a real human
 * inbox. `noreply@` is a one-way sender; clients who hit "Reply" should
 * land in `contact@` (which is the actual Infomaniak mailbox in production).
 */
function replyToAddress(): string {
  return process.env.RESEND_REPLY_TO || "contact@openswissdata.com";
}

/**
 * Send an email through Resend with exponential backoff on transient failures.
 * Retries 3 times (immediate, +1s, +3s) on:
 *  - network errors (fetch threw)
 *  - HTTP 5xx (Resend backend issue)
 *  - HTTP 429 (rate limit)
 * Does NOT retry on 4xx other than 429 (auth, validation, domain not verified)
 * because those won't recover by waiting.
 */
async function resendSend(to: string, subject: string, html: string): Promise<EmailSendResult> {
  const key = resendApiKey();
  if (!key) {
    console.warn(`[email] skipping send to ${to} — RESEND_API_KEY not configured (subject: "${subject}")`);
    return { sent: false, reason: "no_api_key" };
  }

  const MAX_ATTEMPTS = 3;
  const DELAYS_MS = [0, 1000, 3000];
  let lastError: { reason: "resend_error"; details: string } = {
    reason: "resend_error",
    details: "no_attempts",
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (DELAYS_MS[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, DELAYS_MS[attempt]));
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress(),
          to: [to],
          reply_to: replyToAddress(),
          subject,
          html,
        }),
      });
      if (res.ok) return { sent: true };

      const body = await res.text();
      const isRetryable = res.status >= 500 || res.status === 429;
      console.error(
        `[email] attempt ${attempt + 1}/${MAX_ATTEMPTS} — Resend returned ${res.status}: ${body}`,
      );
      lastError = { reason: "resend_error", details: `HTTP ${res.status}` };
      if (!isRetryable) return { sent: false, ...lastError };
    } catch (err) {
      // Network error → always retryable.
      console.error(`[email] attempt ${attempt + 1}/${MAX_ATTEMPTS} — network error:`, err);
      lastError = { reason: "resend_error", details: String(err) };
    }
  }

  console.error(`[email] all ${MAX_ATTEMPTS} attempts failed for ${to}, subject="${subject}"`);
  return { sent: false, ...lastError };
}

// ---------------------------------------------------------------------------
// Email design system (brand-safe HTML)
//
// All visuals are inline-styled, table-based, ≤600px, with web-safe font
// fallbacks (Geist does NOT load in most mail clients). The shared `emailShell`
// gives the three transactional emails a single, coherent frame: cream page,
// white card, header (logo + wordmark + thin red hairline), legal footer.
// ---------------------------------------------------------------------------

const BRAND = {
  cream: "#FBFBF8",
  creamAlt: "#F4F4F0",
  card: "#FFFFFF",
  ink: "#0A0A0C",
  inkSoft: "#4A4D55",
  inkMute: "#6B6E76",
  line: "rgba(10,10,12,.08)",
  lineStrong: "rgba(10,10,12,.14)",
  accent: "#DC1F2D",
} as const;

// Font family names use SINGLE quotes so the whole stack stays valid inside a
// double-quoted inline `style="..."` attribute (double quotes here would close
// the attribute early and silently drop every declaration after the stack).
const FONT_SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const FONT_MONO = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const LOGO_URL = "https://www.openswissdata.com/logo.png";

/** Resolve the canonical site origin (no trailing slash). */
function siteOrigin(): string {
  return (process.env.BASE_URL || "https://www.openswissdata.com").replace(/\/$/, "");
}

/** Hidden preheader text (preview line shown in the inbox before opening). */
function preheaderHtml(text: string): string {
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;` +
    `font-size:1px;line-height:1px;color:${BRAND.cream};opacity:0;">` +
    `${escapeHtml(text)}` +
    // Spacer entities prevent client from pulling body copy into the preview.
    `&#847;&zwnj;&nbsp;&#8199;&#65279;`.repeat(20) +
    `</div>`
  );
}

/**
 * Bulletproof button (table/td technique). `kind` = "primary" → ink fill,
 * cream label; "secondary" → hairline border, ink label on white.
 */
function emailButton(opts: { href: string; label: string; kind?: "primary" | "secondary" }): string {
  const primary = (opts.kind ?? "primary") === "primary";
  const bg = primary ? BRAND.ink : BRAND.card;
  const color = primary ? BRAND.cream : BRAND.ink;
  const border = primary ? BRAND.ink : BRAND.lineStrong;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">` +
    `<tr><td align="center" bgcolor="${bg}" style="border-radius:10px;background:${bg};border:1px solid ${border};">` +
    `<a href="${escapeHtmlAttr(opts.href)}" target="_blank" ` +
    `style="display:inline-block;padding:14px 28px;font-family:${FONT_SANS};font-size:15px;` +
    `font-weight:600;line-height:1;color:${color};text-decoration:none;border-radius:10px;">` +
    `${escapeHtml(opts.label)}</a>` +
    `</td></tr></table>`
  );
}

/** Mono eyebrow label: uppercase, tracked, muted. */
function eyebrow(text: string): string {
  return (
    `<div style="font-family:${FONT_MONO};font-size:11px;letter-spacing:.12em;` +
    `text-transform:uppercase;color:${BRAND.inkMute};margin:0 0 14px 0;">` +
    `${escapeHtml(text)}</div>`
  );
}

/**
 * Shared frame for every transactional email. `bodyHtml` is injected verbatim
 * into the white card (callers build it with the helpers above + escaped data).
 */
function emailShell(opts: { heading: string; bodyHtml: string; preheader?: string; locale?: Locale }): string {
  const locale = opts.locale ?? "fr";
  const preheader = opts.preheader ? preheaderHtml(opts.preheader) : "";
  return (
    `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">` +
    `<html lang="${locale}" xmlns="http://www.w3.org/1999/xhtml"><head>` +
    `<meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<meta name="x-apple-disable-message-reformatting"/>` +
    `<title>${escapeHtml(opts.heading)}</title>` +
    `</head>` +
    `<body style="margin:0;padding:0;background:${BRAND.cream};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">` +
    preheader +
    // Outer cream canvas.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:${BRAND.cream};margin:0;padding:0;">` +
    `<tr><td align="center" style="padding:32px 16px;">` +
    // Centered column: fluid up to 600px so it shrinks on narrow phones.
    // Outlook desktop ignores max-width, so an MSO-only ghost table pins 600px
    // there without forcing full-bleed on mobile clients.
    `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:100%;max-width:600px;margin:0 auto;">` +
    // Header: logo + wordmark.
    `<tr><td style="padding:4px 0 18px 0;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="vertical-align:middle;padding:0 10px 0 0;">` +
    `<img src="${LOGO_URL}" width="28" height="28" alt="openswissdata" ` +
    `style="display:block;width:28px;height:28px;border:0;outline:none;"/></td>` +
    `<td style="vertical-align:middle;font-family:${FONT_MONO};font-size:15px;` +
    `letter-spacing:.02em;color:${BRAND.ink};font-weight:600;">openswissdata</td>` +
    `</tr></table></td></tr>` +
    // White card.
    `<tr><td style="background:${BRAND.card};border:1px solid ${BRAND.line};border-radius:12px;overflow:hidden;">` +
    // Thin red hairline at the very top of the card.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="height:3px;line-height:3px;font-size:3px;background:${BRAND.accent};">&nbsp;</td>` +
    `</tr></table>` +
    // Card content.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="padding:34px 32px 36px 32px;">` +
    `<h1 style="margin:0 0 22px 0;font-family:${FONT_SANS};font-size:22px;line-height:1.3;` +
    `font-weight:700;color:${BRAND.ink};">${escapeHtml(opts.heading)}</h1>` +
    opts.bodyHtml +
    `</td></tr></table>` +
    `</td></tr>` +
    // Footer.
    `<tr><td style="padding:24px 8px 8px 8px;">` +
    `<p style="margin:0 0 8px 0;font-family:${FONT_SANS};font-size:12px;line-height:1.6;color:${BRAND.inkMute};">` +
    `${escapeHtml(FOOTER_DISCLAIMER[locale])}</p>` +
    `<p style="margin:0;font-family:${FONT_SANS};font-size:12px;line-height:1.6;color:${BRAND.inkMute};">` +
    `<a href="${siteOrigin()}" target="_blank" style="color:${BRAND.inkSoft};text-decoration:underline;">openswissdata.com</a></p>` +
    `</td></tr>` +
    `</table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/** Standard body paragraph. */
function para(html: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${FONT_SANS};font-size:15px;line-height:1.65;color:${BRAND.inkSoft};">${html}</p>`;
}

/** Inline mono code chip (for short values inside running text). */
function codeChip(value: string): string {
  return (
    `<span style="font-family:${FONT_MONO};font-size:13px;background:${BRAND.creamAlt};` +
    `color:${BRAND.ink};padding:2px 6px;border-radius:4px;word-break:break-all;">${escapeHtml(value)}</span>`
  );
}

export interface DownloadEmailParams {
  to: string;
  datasetName: string;
  downloadUrl: string;
  accountUrl: string;
  version: string;
  locale?: Locale;
}

export async function sendDownloadEmail(p: DownloadEmailParams): Promise<EmailSendResult> {
  const locale = p.locale ?? "fr";
  const name = escapeHtml(p.datasetName);
  const strong = (s: string) => `<strong style="color:${BRAND.ink};">${s}</strong>`;
  const accountLink = (label: string) =>
    `<a href="${escapeHtmlAttr(p.accountUrl)}" target="_blank" style="color:${BRAND.ink};text-decoration:underline;">${label}</a>`;
  const copy = {
    fr: {
      eyebrow: "Téléchargement prêt",
      heading: `Votre dataset ${p.datasetName} est prêt`,
      subject: `Votre dataset ${p.datasetName} est prêt — openswissdata`,
      preheader: `Téléchargez ${p.datasetName} (lien valide 48 h) — openswissdata`,
      intro: `Merci pour votre achat de ${strong(name)} (version ${escapeHtml(p.version)}). Votre archive est prête.`,
      button: "Télécharger le ZIP",
      validity: "Ce lien de téléchargement est valide 48&nbsp;heures.",
      access: `Accès permanent depuis votre ${accountLink("espace client")}.`,
    },
    de: {
      eyebrow: "Download bereit",
      heading: `Ihr Dataset ${p.datasetName} ist bereit`,
      subject: `Ihr Dataset ${p.datasetName} ist bereit — openswissdata`,
      preheader: `${p.datasetName} herunterladen (Link 48 h gültig) — openswissdata`,
      intro: `Vielen Dank für Ihren Kauf von ${strong(name)} (Version ${escapeHtml(p.version)}). Ihr Archiv ist bereit.`,
      button: "ZIP herunterladen",
      validity: "Dieser Download-Link ist 48&nbsp;Stunden gültig.",
      access: `Dauerhafter Zugriff über Ihren ${accountLink("Kundenbereich")}.`,
    },
    en: {
      eyebrow: "Download ready",
      heading: `Your ${p.datasetName} dataset is ready`,
      subject: `Your ${p.datasetName} dataset is ready — openswissdata`,
      preheader: `Download ${p.datasetName} (link valid 48 h) — openswissdata`,
      intro: `Thank you for purchasing ${strong(name)} (version ${escapeHtml(p.version)}). Your archive is ready.`,
      button: "Download the ZIP",
      validity: "This download link is valid for 48&nbsp;hours.",
      access: `Permanent access from your ${accountLink("account")}.`,
    },
  }[locale];

  const body =
    eyebrow(copy.eyebrow) +
    para(copy.intro) +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px 0;"><tr><td>` +
    emailButton({ href: p.downloadUrl, label: copy.button }) +
    `</td></tr></table>` +
    para(`<span style="color:${BRAND.inkMute};font-size:13px;">${copy.validity}</span>`) +
    // Hairline separator before the secondary access note.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr>` +
    `<td style="height:1px;line-height:1px;font-size:1px;background:${BRAND.line};">&nbsp;</td></tr></table>` +
    para(copy.access);

  const html = emailShell({ heading: copy.heading, bodyHtml: body, preheader: copy.preheader, locale });
  return resendSend(p.to, copy.subject, html);
}

export interface MagicLinkEmailParams {
  to: string;
  magicUrl: string;
  locale?: Locale;
}

export async function sendMagicLinkEmail(p: MagicLinkEmailParams): Promise<EmailSendResult> {
  const locale = p.locale ?? "fr";
  const copy = {
    fr: {
      eyebrow: "Connexion",
      heading: "Votre lien de connexion",
      subject: "Votre lien de connexion openswissdata",
      preheader: "Lien de connexion openswissdata (valide 15 minutes)",
      intro: "Voici votre lien de connexion à votre espace client openswissdata.",
      button: "Se connecter",
      expiry: "Ce lien expire dans 15&nbsp;minutes et ne peut être utilisé qu'une seule fois.",
      security: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message — aucune action ne sera effectuée.",
    },
    de: {
      eyebrow: "Anmeldung",
      heading: "Ihr Anmeldelink",
      subject: "Ihr openswissdata-Anmeldelink",
      preheader: "openswissdata-Anmeldelink (15 Minuten gültig)",
      intro: "Hier ist Ihr Link zur Anmeldung in Ihrem openswissdata-Kundenbereich.",
      button: "Anmelden",
      expiry: "Dieser Link läuft in 15&nbsp;Minuten ab und kann nur einmal verwendet werden.",
      security: "Falls Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese Nachricht — es wird keine Aktion ausgeführt.",
    },
    en: {
      eyebrow: "Sign in",
      heading: "Your sign-in link",
      subject: "Your openswissdata sign-in link",
      preheader: "openswissdata sign-in link (valid 15 minutes)",
      intro: "Here is your link to sign in to your openswissdata account.",
      button: "Sign in",
      expiry: "This link expires in 15&nbsp;minutes and can only be used once.",
      security: "If you didn't request this, ignore this message — no action will be taken.",
    },
  }[locale];

  const body =
    eyebrow(copy.eyebrow) +
    para(copy.intro) +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px 0;"><tr><td>` +
    emailButton({ href: p.magicUrl, label: copy.button }) +
    `</td></tr></table>` +
    para(`<span style="color:${BRAND.inkMute};font-size:13px;">${copy.expiry}</span>`) +
    // Hairline separator before the security note.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr>` +
    `<td style="height:1px;line-height:1px;font-size:1px;background:${BRAND.line};">&nbsp;</td></tr></table>` +
    para(`<span style="color:${BRAND.inkMute};font-size:13px;">${copy.security}</span>`);

  const html = emailShell({ heading: copy.heading, bodyHtml: body, preheader: copy.preheader, locale });
  return resendSend(p.to, copy.subject, html);
}

export interface McpCredentialsEmailParams {
  to: string;
  clientId: string;
  /**
   * Plaintext client secret, generated on the fly. Shown ONLY in this email
   * (never stored in plaintext). Omit when upgrading an existing client — the
   * client keeps its original secret and we just confirm activation.
   */
  clientSecret?: string;
  tier: Tier;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  locale?: Locale;
}

/** Localized site path to the customer account page. */
export function accountUrl(locale: Locale): string {
  return siteOrigin() + (locale === "fr" ? "/account" : `/${locale}/account`);
}

/**
 * Sent when a paid MCP subscription is activated (Stripe webhook). On a NEW
 * client it delivers the credentials (the secret is shown once here); on an
 * upgrade of an existing client it just confirms activation without a secret.
 */
export async function sendMcpCredentialsEmail(p: McpCredentialsEmailParams): Promise<EmailSendResult> {
  const locale = p.locale ?? "fr";
  const hasSecret = typeof p.clientSecret === "string" && p.clientSecret.length > 0;
  const acctUrl = accountUrl(locale);
  const tierChip = codeChip(p.tier);
  const accountLink = (label: string) =>
    `<a href="${escapeHtmlAttr(acctUrl)}" target="_blank" style="color:${BRAND.ink};text-decoration:underline;">${label}</a>`;
  const copy = {
    fr: {
      heading: "Votre abonnement MCP est actif",
      subject: `Votre abonnement MCP openswissdata est actif — ${p.tier}`,
      preheader: `openswissdata MCP — ${p.tier} : identifiants et points de terminaison OAuth`,
      intro: `Votre abonnement <strong style="color:${BRAND.ink};">openswissdata MCP — ${escapeHtml(p.tier)}</strong> est actif. Merci de votre confiance.`,
      eyebrowCreds: "Identifiants OAuth",
      callout: `<strong>À conserver une seule fois.</strong> Le <span style="font-family:${FONT_MONO};">client_secret</span> ci-dessous n'est affiché que dans cet e-mail. Enregistrez-le dans un gestionnaire de secrets : il ne pourra pas être récupéré ensuite.`,
      eyebrowUpgrade: "Mise à niveau",
      upgrade: `Votre clé MCP existante a été mise à niveau vers ${tierChip}. Aucun nouvel identifiant n'est nécessaire&nbsp;: continuez d'utiliser votre <span style="font-family:${FONT_MONO};">client_secret</span> habituel.`,
      eyebrowEndpoints: "Points de terminaison OAuth 2.1",
      connect: `Pour connecter Claude Desktop, Cursor ou Cline, ajoutez le serveur MCP ${codeChip("https://mcp.openswissdata.com")} — le client vous guidera dans le flux d'autorisation OAuth avec les identifiants ci-dessus.`,
      manage: `Gérez ou résiliez votre abonnement à tout moment depuis votre ${accountLink("espace client")}.`,
    },
    de: {
      heading: "Ihr MCP-Abonnement ist aktiv",
      subject: `Ihr openswissdata-MCP-Abonnement ist aktiv — ${p.tier}`,
      preheader: `openswissdata MCP — ${p.tier}: Zugangsdaten und OAuth-Endpunkte`,
      intro: `Ihr Abonnement <strong style="color:${BRAND.ink};">openswissdata MCP — ${escapeHtml(p.tier)}</strong> ist aktiv. Vielen Dank für Ihr Vertrauen.`,
      eyebrowCreds: "OAuth-Zugangsdaten",
      callout: `<strong>Nur einmalig sichtbar.</strong> Das untenstehende <span style="font-family:${FONT_MONO};">client_secret</span> wird nur in dieser E-Mail angezeigt. Speichern Sie es in einem Secret-Manager: es kann später nicht erneut abgerufen werden.`,
      eyebrowUpgrade: "Upgrade",
      upgrade: `Ihr bestehender MCP-Schlüssel wurde auf ${tierChip} hochgestuft. Es sind keine neuen Zugangsdaten erforderlich&nbsp;: verwenden Sie weiterhin Ihr gewohntes <span style="font-family:${FONT_MONO};">client_secret</span>.`,
      eyebrowEndpoints: "OAuth-2.1-Endpunkte",
      connect: `Um Claude Desktop, Cursor oder Cline zu verbinden, fügen Sie den MCP-Server ${codeChip("https://mcp.openswissdata.com")} hinzu — der Client führt Sie mit den obigen Zugangsdaten durch den OAuth-Autorisierungsfluss.`,
      manage: `Verwalten oder kündigen Sie Ihr Abonnement jederzeit über Ihren ${accountLink("Kundenbereich")}.`,
    },
    en: {
      heading: "Your MCP subscription is active",
      subject: `Your openswissdata MCP subscription is active — ${p.tier}`,
      preheader: `openswissdata MCP — ${p.tier}: credentials and OAuth endpoints`,
      intro: `Your <strong style="color:${BRAND.ink};">openswissdata MCP — ${escapeHtml(p.tier)}</strong> subscription is active. Thank you for your trust.`,
      eyebrowCreds: "OAuth credentials",
      callout: `<strong>Shown only once.</strong> The <span style="font-family:${FONT_MONO};">client_secret</span> below appears only in this email. Save it in a secrets manager: it cannot be retrieved later.`,
      eyebrowUpgrade: "Upgrade",
      upgrade: `Your existing MCP key has been upgraded to ${tierChip}. No new credentials are needed&nbsp;: keep using your usual <span style="font-family:${FONT_MONO};">client_secret</span>.`,
      eyebrowEndpoints: "OAuth 2.1 endpoints",
      connect: `To connect Claude Desktop, Cursor or Cline, add the MCP server ${codeChip("https://mcp.openswissdata.com")} — the client will guide you through the OAuth authorization flow with the credentials above.`,
      manage: `Manage or cancel your subscription anytime from your ${accountLink("account")}.`,
    },
  }[locale];

  // One labelled mono row inside a credentials panel.
  const credRow = (label: string, value: string, last = false): string =>
    `<tr><td style="padding:0 0 ${last ? "0" : "14px"} 0;">` +
    `<div style="font-family:${FONT_MONO};font-size:11px;letter-spacing:.06em;text-transform:uppercase;` +
    `color:${BRAND.inkMute};margin:0 0 4px 0;">${escapeHtml(label)}</div>` +
    `<div style="font-family:${FONT_MONO};font-size:14px;line-height:1.5;color:${BRAND.ink};` +
    `word-break:break-all;">${escapeHtml(value)}</div>` +
    `</td></tr>`;

  // Panel wrapper on the alt-cream background, with hairline border.
  const panel = (innerHtml: string): string =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:${BRAND.creamAlt};border:1px solid ${BRAND.line};border-radius:10px;margin:0 0 16px 0;">` +
    `<tr><td style="padding:20px 22px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${innerHtml}</table>` +
    `</td></tr></table>`;

  let credentialsBlock: string;
  if (hasSecret) {
    // "Save it once" callout: red hairline left border on white.
    const callout =
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
      `style="background:${BRAND.card};border:1px solid ${BRAND.lineStrong};border-left:3px solid ${BRAND.accent};` +
      `border-radius:8px;margin:0 0 16px 0;">` +
      `<tr><td style="padding:14px 18px;font-family:${FONT_SANS};font-size:13px;line-height:1.6;color:${BRAND.ink};">` +
      copy.callout +
      `</td></tr></table>`;
    credentialsBlock =
      eyebrow(copy.eyebrowCreds) +
      callout +
      panel(credRow("client_id", p.clientId) + credRow("client_secret", p.clientSecret as string, true));
  } else {
    credentialsBlock =
      eyebrow(copy.eyebrowUpgrade) +
      para(copy.upgrade) +
      panel(credRow("client_id", p.clientId, true));
  }

  const body =
    para(copy.intro) +
    credentialsBlock +
    eyebrow(copy.eyebrowEndpoints) +
    panel(
      credRow("Authorization endpoint", p.authorizationEndpoint) +
      credRow("Token endpoint", p.tokenEndpoint, true),
    ) +
    para(copy.connect) +
    // Hairline separator before the account link.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr>` +
    `<td style="height:1px;line-height:1px;font-size:1px;background:${BRAND.line};">&nbsp;</td></tr></table>` +
    para(copy.manage);

  const html = emailShell({ heading: copy.heading, bodyHtml: body, preheader: copy.preheader, locale });
  return resendSend(p.to, copy.subject, html);
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, ch =>
    ch === "&" ? "&amp;" :
    ch === "<" ? "&lt;" :
    ch === ">" ? "&gt;" :
    ch === '"' ? "&quot;" : "&#39;"
  );
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s);
}
