import { Hono, type Context } from "hono";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireAuth } from "../lib/auth-middleware.js";
import { generateToken, isValidTokenFormat } from "../lib/tokens.js";
import { signedDownloadUrl } from "../lib/r2.js";
import { deliveryConfirmationPage, deliveryLocaleFromHeader, deliveryLocaleFromQuery, deliveryNoticePage, deliveryStateFor } from "../lib/delivery-page.js";

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
  const issued = db.transaction(() => {
    const currentEnt = db.prepare("SELECT updates_until FROM entitlements WHERE customer_id=? AND dataset_id=?")
      .get(customerId, parsed.dataset_id) as {updates_until: number | null} | undefined;
    const release = db.prepare("SELECT released_at FROM versions WHERE dataset_id=? AND version=?")
      .get(parsed.dataset_id, version.version) as {released_at:number} | undefined;
    if (!release || !currentEnt || (currentEnt.updates_until !== null && release.released_at > currentEnt.updates_until)) return false;
    const activity = db.prepare("INSERT INTO download_activity(customer_id,dataset_id,version,source,created_at) VALUES(?,?,?,'account',?)")
      .run(customerId, parsed.dataset_id, version.version, now);
    db.prepare("INSERT INTO download_tokens (token, customer_id, dataset_id, version, expires_at, created_at, activity_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(token, customerId, parsed.dataset_id, version.version, expiresAt, now, Number(activity.lastInsertRowid));
    return true;
  }).immediate();
  if (!issued) return c.json({error:"no_entitlement"},403);
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
      "SELECT customer_id, dataset_id, version, expires_at, used_at, activity_id FROM download_tokens WHERE token = ?",
    )
    .get(token) as
    | { customer_id: number; dataset_id: string; version: string; expires_at: number; used_at: number | null; activity_id: number | null }
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
  const claimed = db.transaction(() => {
    const currentEnt = db.prepare("SELECT updates_until FROM entitlements WHERE customer_id=? AND dataset_id=?")
      .get(row.customer_id,row.dataset_id) as {updates_until:number|null} | undefined;
    if (!currentEnt || (currentEnt.updates_until !== null && entitledVersion.released_at > currentEnt.updates_until)) return "revoked";
    const now = Date.now();
    const claim = db.prepare(`UPDATE download_tokens SET used_at=COALESCE(used_at,?) WHERE token=?
      AND (used_at IS NULL OR (? > 0 AND used_at>=?)) AND expires_at>=?`)
      .run(now,token,graceMs,now-graceMs,now);
    if (claim.changes && row.activity_id !== null) {
      db.prepare("UPDATE download_activity SET authorized_at=COALESCE(authorized_at,?) WHERE id=? AND customer_id=? AND dataset_id=? AND version=?")
        .run(now,row.activity_id,row.customer_id,row.dataset_id,row.version);
    }
    return claim.changes > 0 ? "authorized" : "unavailable";
  }).immediate();
  if (claimed === "revoked") return c.text("entitlement revoked",403);
  if (claimed !== "authorized") return c.text("token expired or already used",410);
  return c.redirect(signedUrl, 302);
}
publicDownload.get("/download/:token", redeemDownload);

// Le POST du formulaire garde redeemDownload tel quel : mêmes contrôles, codes, en-têtes et
// redirection signée. Seul le corps d'un refus devient une page lisible (présentation Atlas) ;
// statut et en-têtes sont recopiés, content-type excepté. Le lien historique /download reste en texte.
publicDownload.post("/delivery/:token", async c => {
  const res = await redeemDownload(c);
  if (res.status === 302) return res;
  const state = deliveryStateFor(res.status, await res.text());
  const headers = new Headers(res.headers);
  headers.set("Content-Type", "text/html; charset=UTF-8");
  headers.delete("Content-Length");
  return new Response(deliveryNoticePage(deliveryLocaleFromHeader(c.req.header("accept-language")), state), { status: res.status, headers });
});

// Une prévisualisation automatique de mail ne doit jamais consommer le téléchargement.
publicDownload.get("/delivery/:token", c => {
  const token = c.req.param("token");
  if (!isValidTokenFormat(token)) {
    const lang = c.req.query("lang") === undefined ? deliveryLocaleFromHeader(c.req.header("accept-language")) : deliveryLocaleFromQuery(c.req.query("lang"));
    return c.html(deliveryNoticePage(lang, "invalid"), 400);
  }
  const lang = deliveryLocaleFromQuery(c.req.query("lang"));
  c.header("Cache-Control","private, no-store");
  c.header("Referrer-Policy","no-referrer");
  c.header("X-Robots-Tag","noindex, nofollow");
  c.header("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; base-uri 'none'");
  return c.html(deliveryConfirmationPage(lang, token));
});
