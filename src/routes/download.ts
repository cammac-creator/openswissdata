import { Hono, type Context } from "hono";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireAuth } from "../lib/auth-middleware.js";
import { generateToken, isValidTokenFormat } from "../lib/tokens.js";
import { signedDownloadUrl } from "../lib/r2.js";

export const downloadRoute = new Hono<{ Variables: { customer_id: number } }>();

const DOWNLOAD_TOKEN_TTL_MS = 48 * 3600 * 1000;
const R2_SIGNED_TTL_S = 300;

const RequestSchema = z.object({
  dataset_id: z.enum(["tares", "classifications", "finma"]),
});

// Authenticated endpoint: returns a short signed URL OR issues a download token
// that can be shared (valid 48h) — we use signed URL for immediate UX.
downloadRoute.post("/account/download-request", requireAuth, async (c) => {
  let parsed;
  try {
    parsed = RequestSchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const customerId = c.get("customer_id") as number;
  const db = getDb();

  const ent = db.prepare("SELECT updates_until FROM entitlements WHERE customer_id = ? AND dataset_id = ?")
    .get(customerId, parsed.dataset_id) as { updates_until: number | null } | undefined;
  if (!ent) return c.json({ error: "no_entitlement" }, 403);
  // Les 360 jours limitent les nouvelles versions, jamais l’accès aux fichiers acquis.
  const dataset = db.prepare("SELECT current_version FROM datasets WHERE id=?").get(parsed.dataset_id) as {current_version: string | null} | undefined;
  const version = ent.updates_until !== null && ent.updates_until < Date.now()
    ? db.prepare("SELECT version,r2_key FROM versions WHERE dataset_id=? AND released_at<=? ORDER BY released_at DESC,id DESC LIMIT 1").get(parsed.dataset_id,ent.updates_until) as {version:string;r2_key:string} | undefined
    : db.prepare("SELECT version,r2_key FROM versions WHERE dataset_id=? AND version=?").get(parsed.dataset_id,dataset?.current_version ?? "") as {version:string;r2_key:string} | undefined;
  if (!version) return c.json({ error: "no_eligible_version" }, 404);

  const token = generateToken();
  const now = Date.now();
  const expiresAt = now + DOWNLOAD_TOKEN_TTL_MS;
  const signedUrl = await signedDownloadUrl(version.r2_key, R2_SIGNED_TTL_S);
  const currentEnt = db.prepare("SELECT updates_until FROM entitlements WHERE customer_id=? AND dataset_id=?")
    .get(customerId, parsed.dataset_id) as {updates_until: number | null} | undefined;
  const release = db.prepare("SELECT released_at FROM versions WHERE dataset_id=? AND version=?")
    .get(parsed.dataset_id, version.version) as {released_at:number};
  if (!currentEnt || (currentEnt.updates_until !== null && release.released_at > currentEnt.updates_until)) {
    return c.json({error:"no_entitlement"},403);
  }
  db.prepare("INSERT INTO download_tokens (token, customer_id, dataset_id, version, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(token, customerId, parsed.dataset_id, version.version, expiresAt, now);
  return c.json({
    download_url: signedUrl,
    share_token: token,
    share_url: `${(process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/delivery/${token}`,
    expires_at: now + R2_SIGNED_TTL_S * 1000,
    share_expires_at: expiresAt,
  });
});

// Public-ish endpoint: redeems a download_token → fresh R2 signed URL redirect.
// Token itself is the auth (48h TTL).
// Les liens historiques restent à usage unique. Le formulaire tolère un double clic
// pendant 90 s, sans prolonger la première utilisation. Les droits sont revérifiés.
export const publicDownload = new Hono();
async function redeemDownload(c: Context) {
  c.header("Referrer-Policy","no-referrer");
  const token = c.req.param("token") ?? "";
  if (!isValidTokenFormat(token)) return c.text("invalid token", 400);
  const db = getDb();
  const row = db
    .prepare(
      "SELECT customer_id, dataset_id, version, expires_at, used_at FROM download_tokens WHERE token = ?",
    )
    .get(token) as
    | { customer_id: number; dataset_id: string; version: string; expires_at: number; used_at: number | null }
    | undefined;
  if (!row) return c.text("token not found", 404);
  if (row.expires_at < Date.now()) return c.text("token expired", 410);
  const graceMs = c.req.method === "POST" ? 90_000 : 0;
  if (row.used_at !== null && (graceMs === 0 || row.used_at < Date.now() - graceMs)) return c.text("token already used", 410);

  // Recheck entitlement at redeem time — covers refund/expiration races.
  const ent = db
    .prepare(
      "SELECT updates_until FROM entitlements WHERE customer_id = ? AND dataset_id = ?",
    )
    .get(row.customer_id, row.dataset_id) as { updates_until: number | null } | undefined;
  if (!ent) return c.text("entitlement revoked", 403);
  const entitledVersion = db.prepare("SELECT released_at FROM versions WHERE dataset_id=? AND version=?").get(row.dataset_id,row.version) as {released_at:number} | undefined;
  if (!entitledVersion) return c.text("version missing", 404);
  if (ent.updates_until !== null && entitledVersion.released_at > ent.updates_until) return c.text("version outside entitlement",403);

  const versionRow = db
    .prepare("SELECT r2_key FROM versions WHERE dataset_id = ? AND version = ?")
    .get(row.dataset_id, row.version) as { r2_key: string } | undefined;
  if (!versionRow) return c.text("version missing", 500);
  const signedUrl = await signedDownloadUrl(versionRow.r2_key, R2_SIGNED_TTL_S);
  // Ne consommer le lien qu'après la signature réussie, en revérifiant les droits.
  const currentEnt = db.prepare("SELECT updates_until FROM entitlements WHERE customer_id=? AND dataset_id=?")
    .get(row.customer_id,row.dataset_id) as {updates_until:number|null} | undefined;
  if (!currentEnt || (currentEnt.updates_until !== null && entitledVersion.released_at > currentEnt.updates_until)) {
    return c.text("entitlement revoked",403);
  }
  const claim = db.prepare(`UPDATE download_tokens SET used_at=COALESCE(used_at,?) WHERE token=?
    AND (used_at IS NULL OR (? > 0 AND used_at>=?)) AND expires_at>=?`)
    .run(Date.now(),token,graceMs,Date.now()-graceMs,Date.now());
  if (!claim.changes) return c.text("token expired or already used",410);
  return c.redirect(signedUrl, 302);
}
publicDownload.get("/download/:token", redeemDownload);
publicDownload.post("/delivery/:token", redeemDownload);

// Une prévisualisation automatique de mail ne doit jamais consommer le téléchargement.
publicDownload.get("/delivery/:token", c => {
  const token = c.req.param("token");
  if (!isValidTokenFormat(token)) return c.text("invalid token",400);
  const lang = c.req.query("lang") === "de" ? "de" : c.req.query("lang") === "en" ? "en" : "fr";
  const copy = {
    fr: {title:"Votre fichier est prêt",intro:"Confirmez le téléchargement pour ouvrir votre archive. Ce lien est personnel et utilisable une fois pendant 48 heures.",button:"Télécharger mon fichier",account:"Retrouver mes fichiers dans mon compte"},
    de: {title:"Ihre Datei ist bereit",intro:"Bestätigen Sie den Download, um Ihr Archiv zu öffnen. Dieser persönliche Link ist 48 Stunden lang einmalig nutzbar.",button:"Datei herunterladen",account:"Meine Dateien im Kundenkonto finden"},
    en: {title:"Your file is ready",intro:"Confirm the download to open your archive. This personal link can be used once within 48 hours.",button:"Download my file",account:"Find my files in my account"},
  }[lang];
  c.header("Cache-Control","private, no-store");
  c.header("Referrer-Policy","no-referrer");
  c.header("X-Robots-Tag","noindex, nofollow");
  c.header("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; base-uri 'none'");
  return c.html(`<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${copy.title} · OpenSwissData</title>
    <style>body{margin:0;padding:24px;background:#f5f3eb;color:#18342d;font:17px/1.65 system-ui,sans-serif}main{max-width:540px;margin:10vh auto;padding:32px;background:#fff;border:1px solid #ddd9cd;border-radius:20px}h1{font-size:clamp(28px,6vw,40px);line-height:1.2}button{font:inherit;font-weight:650;background:#183f33;color:white;border:0;border-radius:10px;padding:15px 22px;cursor:pointer;width:100%}a{color:#214f3e}p:last-child{font-size:14px;margin-top:24px}button:focus-visible,a:focus-visible{outline:3px solid #c27531;outline-offset:4px}</style>
    <main><small>OPENSWISSDATA</small><h1>${copy.title}</h1><p>${copy.intro}</p><form method="post" action="/api/delivery/${token}"><button type="submit">${copy.button}</button></form><p><a href="${lang === "fr" ? "" : `/${lang}`}/account">${copy.account}</a></p></main></html>`);
});
