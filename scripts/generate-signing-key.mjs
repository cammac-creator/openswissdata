#!/usr/bin/env node
/**
 * Generate the openswissdata Ed25519 signing key pair.
 *
 *   - Public key  → packages/schemas/openswissdata.pubkey.ed25519 (PEM SPKI, commitable)
 *   - Private key → printed to stdout (base64-encoded PKCS8). Caller stores it
 *                   in `.env` (`OSD_SIGNING_KEY_ED25519=…`) and Railway env.
 *
 * The private key MUST NEVER be committed.
 *
 * Usage: node scripts/generate-signing-key.mjs
 *
 * Idempotent: refuses to overwrite an existing public key file.
 */

import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const repoRoot = resolve(__dirname, "..");
const pubkeyPath = resolve(repoRoot, "packages/schemas/openswissdata.pubkey.ed25519");

if (existsSync(pubkeyPath)) {
  console.error(
    `[generate-signing-key] ABORT — public key already exists at ${pubkeyPath}.\n` +
      `Re-generating would invalidate every signature ever issued. Delete the file manually if you really mean to rotate.`
  );
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const pubkeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privkeyDer = privateKey.export({ type: "pkcs8", format: "der" });
const privkeyB64 = privkeyDer.toString("base64");

mkdirSync(dirname(pubkeyPath), { recursive: true });
writeFileSync(pubkeyPath, pubkeyPem, "utf8");

const pubkeyB64 = Buffer.from(pubkeyPem).toString("base64").slice(0, 16);

console.log(`✅ Public key written to: ${pubkeyPath}`);
console.log(`   First 16 chars (base64 of PEM): ${pubkeyB64}`);
console.log("");
console.log("=== PRIVATE KEY (base64-encoded PKCS8 DER) — STORE NOW, NEVER COMMIT ===");
console.log(privkeyB64);
console.log("=== END PRIVATE KEY ===");
console.log("");
console.log("Next steps:");
console.log("  1. Add to local .env:    OSD_SIGNING_KEY_ED25519=<the base64 above>");
console.log("  2. Add to Railway:       railway variables --set OSD_SIGNING_KEY_ED25519=<the base64 above>");
console.log("  3. Commit ONLY the public key (PEM file).");
