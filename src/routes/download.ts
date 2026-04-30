import { Hono } from "hono";
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
  // H1: enforce updates_until — expired customers must renew before downloading
  if (ent.updates_until !== null && ent.updates_until < Date.now()) {
    return c.json({ error: "subscription_expired" }, 403);
  }

  const dataset = db.prepare("SELECT current_version FROM datasets WHERE id = ?").get(parsed.dataset_id) as { current_version: string | null } | undefined;
  if (!dataset?.current_version) return c.json({ error: "no_version" }, 404);

  const version = db.prepare("SELECT r2_key FROM versions WHERE dataset_id = ? AND version = ?").get(parsed.dataset_id, dataset.current_version) as { r2_key: string } | undefined;
  if (!version) return c.json({ error: "no_file" }, 404);

  const token = generateToken();
  const now = Date.now();
  const expiresAt = now + DOWNLOAD_TOKEN_TTL_MS;
  db.prepare("INSERT INTO download_tokens (token, customer_id, dataset_id, version, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(token, customerId, parsed.dataset_id, dataset.current_version, expiresAt, now);

  const signedUrl = await signedDownloadUrl(version.r2_key, R2_SIGNED_TTL_S);
  return c.json({
    download_url: signedUrl,
    share_token: token,
    share_url: `${(process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/download/${token}`,
    expires_at: expiresAt,
  });
});

// Public-ish endpoint: redeems a download_token → fresh R2 signed URL redirect.
// Token itself is the auth (48h TTL).
// Single-use: rejects if used_at IS NOT NULL (prevents replay after Slack/screenshot leak).
// Re-checks the entitlement at redeem time (covers the Stripe refund case where
// the order is reversed but a previously-issued token is still in its 48h window).
export const publicDownload = new Hono();
publicDownload.get("/download/:token", async (c) => {
  const token = c.req.param("token");
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
  if (row.used_at !== null) return c.text("token already used", 410);

  // Recheck entitlement at redeem time — covers refund/expiration races.
  const ent = db
    .prepare(
      "SELECT updates_until FROM entitlements WHERE customer_id = ? AND dataset_id = ?",
    )
    .get(row.customer_id, row.dataset_id) as { updates_until: number | null } | undefined;
  if (!ent) return c.text("entitlement revoked", 403);
  if (ent.updates_until !== null && ent.updates_until < Date.now()) {
    return c.text("entitlement expired", 403);
  }

  // Atomic single-use claim: only redeem if still unused.
  const claim = db
    .prepare(
      "UPDATE download_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL",
    )
    .run(Date.now(), token);
  if (claim.changes === 0) return c.text("token already used", 410);

  const versionRow = db
    .prepare("SELECT r2_key FROM versions WHERE dataset_id = ? AND version = ?")
    .get(row.dataset_id, row.version) as { r2_key: string } | undefined;
  if (!versionRow) return c.text("version missing", 500);
  const signedUrl = await signedDownloadUrl(versionRow.r2_key, R2_SIGNED_TTL_S);
  return c.redirect(signedUrl, 302);
});
