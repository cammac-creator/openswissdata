/**
 * Verify a `provenance.json` extracted from an openswissdata ZIP bundle.
 *
 * Usage (CLI):
 *   tsx etl/shared/verify-provenance.ts <path-to-zip> [path-to-pubkey.pem]
 *
 * Usage (programmatic):
 *   import { verifyProvenanceZip } from "./verify-provenance.js";
 *   const result = await verifyProvenanceZip("./tares-2026.04.29.zip");
 *
 * Verification steps:
 *   1. Extract `provenance.json` from the ZIP.
 *   2. Recompute SHA-256 of every file listed in `manifest.files` and compare.
 *   3. Strip `signature` + `timestamp_authority` from the manifest, canonicalize
 *      with the same algorithm used at signing, then check the Ed25519
 *      signature against the public key.
 *   4. Report whether an RFC-3161 timestamp token is present (we don't validate
 *      the TSA chain — that is the buyer's responsibility if they want full
 *      trust beyond "the token exists and is parseable as ASN.1").
 */

import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createPublicKey, verify, createHash } from "node:crypto";
import { canonicalize, type SignedProvenanceManifest } from "./provenance.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_PUBKEY_PATH = resolve(__dirname, "../../packages/schemas/openswissdata.pubkey.ed25519");

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: SignedProvenanceManifest;
  fileChecks: { name: string; ok: boolean; expected: string; actual?: string }[];
  signatureValid: boolean;
  timestampPresent: boolean;
}

function unzipTo(zipPath: string, dest: string): void {
  execSync(`unzip -o -q "${zipPath}" -d "${dest}"`, { stdio: "ignore" });
}

export async function verifyProvenanceZip(
  zipPath: string,
  publicKeyPath: string = DEFAULT_PUBKEY_PATH
): Promise<VerifyResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fileChecks: VerifyResult["fileChecks"] = [];
  let signatureValid = false;
  let timestampPresent = false;
  let manifest: SignedProvenanceManifest | undefined;

  if (!existsSync(zipPath)) {
    return {
      ok: false,
      errors: [`ZIP not found: ${zipPath}`],
      warnings,
      fileChecks,
      signatureValid,
      timestampPresent,
    };
  }
  if (!existsSync(publicKeyPath)) {
    return {
      ok: false,
      errors: [`Public key not found: ${publicKeyPath}`],
      warnings,
      fileChecks,
      signatureValid,
      timestampPresent,
    };
  }

  const tmp = mkdtempSync(join(tmpdir(), "osd-verify-"));
  try {
    unzipTo(zipPath, tmp);

    const provPath = join(tmp, "provenance.json");
    if (!existsSync(provPath)) {
      errors.push("provenance.json missing from ZIP");
      return { ok: false, errors, warnings, fileChecks, signatureValid, timestampPresent };
    }
    manifest = JSON.parse(readFileSync(provPath, "utf8")) as SignedProvenanceManifest;

    // 1. Per-file integrity
    for (const f of manifest.files) {
      const p = join(tmp, f.name);
      if (!existsSync(p)) {
        fileChecks.push({ name: f.name, ok: false, expected: f.sha256 });
        errors.push(`file missing: ${f.name}`);
        continue;
      }
      const actual = createHash("sha256").update(readFileSync(p)).digest("hex");
      const sizeOk = statSync(p).size === f.size;
      const ok = actual === f.sha256 && sizeOk;
      fileChecks.push({ name: f.name, ok, expected: f.sha256, actual });
      if (!ok) {
        errors.push(
          `file integrity mismatch: ${f.name} expected ${f.sha256.slice(0, 16)}… got ${actual.slice(0, 16)}…`
        );
      }
    }

    // 2. Signature
    if (!manifest.signature) {
      errors.push("manifest has no signature block");
    } else {
      // Strip signature + timestamp_authority before canonicalising — they were
      // not part of the signed payload.
      const { signature, timestamp_authority, ...unsigned } = manifest;
      const canonical = canonicalize(unsigned);
      const recomputedHash = createHash("sha256").update(canonical).digest("hex");
      if (recomputedHash !== signature.signed_payload_hash) {
        errors.push(
          `payload hash mismatch — manifest declares ${signature.signed_payload_hash.slice(0, 16)}… but canonical re-hash is ${recomputedHash.slice(0, 16)}… (manifest tampered or canonicalisation drift)`
        );
      }

      // Public key consistency: refuse to validate against a foreign key.
      const committedPubPem = readFileSync(publicKeyPath, "utf8");
      if (signature.public_key_pem.replace(/\s+/g, "") !== committedPubPem.replace(/\s+/g, "")) {
        warnings.push(
          "manifest public_key_pem does not match the public key file passed to verify (a key rotation may have happened)"
        );
      }

      const pubKey = createPublicKey({ key: committedPubPem, format: "pem" });
      const sigBuf = Buffer.from(signature.signature, "base64");
      signatureValid = verify(null, Buffer.from(canonical, "utf8"), pubKey, sigBuf);
      if (!signatureValid) {
        errors.push("Ed25519 signature INVALID against committed public key");
      }
      timestamp_authority; // referenced for the destructure
    }

    // 3. Timestamp presence (we do not validate the TSA chain here)
    if (manifest.timestamp_authority?.rfc3161_timestamp) {
      timestampPresent = true;
      const tokBuf = Buffer.from(manifest.timestamp_authority.rfc3161_timestamp, "base64");
      // Cheap sanity check: must look like DER SEQUENCE (0x30) and be > 100 bytes.
      if (tokBuf.length < 100 || tokBuf[0] !== 0x30) {
        warnings.push("rfc3161 token does not look like a valid DER SEQUENCE");
      }
    } else {
      warnings.push(
        `no RFC-3161 timestamp present (status=${manifest.timestamp_authority?.status ?? "unknown"})`
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    manifest,
    fileChecks,
    signatureValid,
    timestampPresent,
  };
}

// CLI entrypoint -------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const zipArg = process.argv[2];
  const pubkeyArg = process.argv[3] ?? DEFAULT_PUBKEY_PATH;
  if (!zipArg) {
    console.error("usage: tsx etl/shared/verify-provenance.ts <zip> [pubkey.pem]");
    process.exit(2);
  }
  verifyProvenanceZip(zipArg, pubkeyArg)
    .then((r) => {
      console.log(JSON.stringify(
        {
          ok: r.ok,
          signatureValid: r.signatureValid,
          timestampPresent: r.timestampPresent,
          fileChecks: r.fileChecks.map((f) => ({ name: f.name, ok: f.ok })),
          dataset: r.manifest?.dataset,
          dataset_version: r.manifest?.dataset_version,
          permission_reference: r.manifest?.permission_reference,
          errors: r.errors,
          warnings: r.warnings,
        },
        null,
        2
      ));
      process.exit(r.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error("verify-provenance crashed:", err);
      process.exit(3);
    });
  // Hint for unused listing helper imports (keeps tree-shake friendly)
  void readdirSync;
}
