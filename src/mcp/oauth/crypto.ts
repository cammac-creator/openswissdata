/**
 * OAuth 2.1 cryptographic helpers — backed by `node:crypto`.
 *
 * All tokens (access, refresh, authorization code, client_secret) are returned
 * to the caller in **plaintext base64url** form, but stored only as
 * **HMAC-SHA256 hashes** keyed by `OAUTH_SIGNING_SECRET`. A leak of the
 * `mcp_tokens` / `mcp_clients` / `mcp_oauth_codes` tables therefore does not
 * compromise active tokens — the attacker still needs the signing secret to
 * reproduce a hash.
 *
 * PKCE S256: the verifier must be 43–128 chars in `[A-Za-z0-9_-]`, the
 * challenge is `BASE64URL(SHA-256(verifier))`. Spec: RFC 7636 §4.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** A 32-byte random token, base64url-encoded (43 chars). */
export function generateRandomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A 16-byte random client_id, prefixed for human readability. */
export function generateClientId(): string {
  return "osd_" + randomBytes(16).toString("base64url");
}

/** A 32-byte random client_secret. */
export function generateClientSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** A 24-byte authorization code (also base64url). */
export function generateAuthCode(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * HMAC-SHA256 hash of a token, using `OAUTH_SIGNING_SECRET` as the key.
 * The same input always produces the same output — so we can hash an incoming
 * token and look it up in the DB by exact match, without ever storing the
 * plaintext.
 */
export function hashToken(token: string): string {
  const secret = process.env.OAUTH_SIGNING_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "OAUTH_SIGNING_SECRET is missing or too short (min 16 chars). " +
        "Set it in .env / Railway variables.",
    );
  }
  return createHmac("sha256", secret).update(token).digest("base64url");
}

/**
 * PKCE S256: BASE64URL(SHA-256(verifier)). Spec: RFC 7636 §4.2.
 */
export function pkceChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Constant-time comparison of two challenges (prevents timing attacks during
 * PKCE verification).
 */
export function pkceVerify(
  verifier: string,
  challenge: string,
  method: "S256" | "plain",
): boolean {
  const expected = method === "S256" ? pkceChallengeS256(verifier) : verifier;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(challenge, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Validate a PKCE code_verifier shape per RFC 7636 §4.1: 43–128 chars in
 * `[A-Za-z0-9-._~]`. We accept the slightly broader base64url alphabet
 * `[A-Za-z0-9_-]` since most clients (incl. our own helper) emit base64url.
 */
export function isValidVerifier(v: string): boolean {
  return typeof v === "string" && /^[A-Za-z0-9_~.-]{43,128}$/.test(v);
}
