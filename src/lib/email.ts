export interface EmailSendResult {
  sent: boolean;
  reason?: "no_api_key" | "placeholder_key" | "resend_error";
  details?: string;
}

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

export interface DownloadEmailParams {
  to: string;
  datasetName: string;
  downloadUrl: string;
  accountUrl: string;
  version: string;
}

export async function sendDownloadEmail(p: DownloadEmailParams): Promise<EmailSendResult> {
  const html = `
    <p>Bonjour,</p>
    <p>Merci pour votre achat de <strong>${escapeHtml(p.datasetName)}</strong> (version ${escapeHtml(p.version)}).</p>
    <p><a href="${escapeHtmlAttr(p.downloadUrl)}" style="display:inline-block;padding:12px 20px;background:#4f46e5;color:white;text-decoration:none;border-radius:6px">Télécharger le ZIP (lien valide 48 h)</a></p>
    <p>Accès permanent via votre espace client : <a href="${escapeHtmlAttr(p.accountUrl)}">${escapeHtml(p.accountUrl)}</a></p>
    <p>— openswissdata.com</p>
  `;
  return resendSend(p.to, `Votre dataset ${p.datasetName} est prêt — openswissdata`, html);
}

export interface MagicLinkEmailParams {
  to: string;
  magicUrl: string;
}

export async function sendMagicLinkEmail(p: MagicLinkEmailParams): Promise<EmailSendResult> {
  const html = `
    <p>Bonjour,</p>
    <p>Voici votre lien de connexion à openswissdata.com (valide 15 minutes) :</p>
    <p><a href="${escapeHtmlAttr(p.magicUrl)}" style="display:inline-block;padding:12px 20px;background:#4f46e5;color:white;text-decoration:none;border-radius:6px">Se connecter à openswissdata</a></p>
    <p style="font-size:13px;color:#666;">Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message.</p>
    <p>— openswissdata.com</p>
  `;
  return resendSend(p.to, "Votre lien de connexion openswissdata", html);
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
