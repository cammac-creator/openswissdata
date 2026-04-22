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
  return process.env.RESEND_FROM_EMAIL || "hello@openswissdata.com";
}

async function resendSend(to: string, subject: string, html: string): Promise<EmailSendResult> {
  const key = resendApiKey();
  if (!key) {
    console.warn(`[email] skipping send to ${to} — RESEND_API_KEY not configured (subject: "${subject}")`);
    return { sent: false, reason: "no_api_key" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend returned ${res.status}: ${body}`);
      return { sent: false, reason: "resend_error", details: `HTTP ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error(`[email] network error:`, err);
    return { sent: false, reason: "resend_error", details: String(err) };
  }
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
    <p>Merci d'avoir acheté <strong>${escapeHtml(p.datasetName)}</strong> (version ${escapeHtml(p.version)}).</p>
    <p><a href="${escapeHtmlAttr(p.downloadUrl)}" style="display:inline-block;padding:12px 20px;background:#4f46e5;color:white;text-decoration:none;border-radius:6px">Télécharger le ZIP (lien valide 48h)</a></p>
    <p>Accès permanent via ton espace client : <a href="${escapeHtmlAttr(p.accountUrl)}">${escapeHtml(p.accountUrl)}</a></p>
    <p>— openswissdata.com</p>
  `;
  return resendSend(p.to, `Your ${p.datasetName} download`, html);
}

export interface MagicLinkEmailParams {
  to: string;
  magicUrl: string;
}

export async function sendMagicLinkEmail(p: MagicLinkEmailParams): Promise<EmailSendResult> {
  const html = `
    <p>Bonjour,</p>
    <p>Voici ton lien de connexion à openswissdata.com (valide 15 min) :</p>
    <p><a href="${escapeHtmlAttr(p.magicUrl)}">${escapeHtml(p.magicUrl)}</a></p>
    <p>— openswissdata.com</p>
  `;
  return resendSend(p.to, "Your openswissdata login link", html);
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
