/**
 * Provenance manifest for openswissdata ZIP bundles.
 *
 * Each delivered ZIP contains a `provenance.json` proving:
 *   1. Origin — official permission reference (BAZG / public-source notice for FINMA & BFS).
 *   2. Integrity — Ed25519 signature over a canonical JSON payload, plus per-file SHA-256 digests.
 *   3. Non-back-datable timestamp — RFC-3161 token from a public TSA (freetsa.org primary,
 *      DigiCert as fallback).
 *
 * Verification: `verify-provenance.ts` (same folder) extracts a ZIP, recomputes file hashes,
 * canonicalizes the unsigned manifest, then validates the Ed25519 signature with the public
 * key shipped at `packages/schemas/openswissdata.pubkey.ed25519`.
 *
 * The private signing key is stored ONLY in `OSD_SIGNING_KEY_ED25519` (base64 PKCS8 DER).
 * Never commit it.
 */

import { createHash, createPrivateKey, createPublicKey, sign, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProvenanceFile {
  name: string;
  size: number;
  sha256: string;
}

export interface ProvenanceSignature {
  algorithm: "Ed25519";
  public_key_pem: string;
  signed_at: string; // ISO 8601 UTC
  signed_payload_hash: string; // sha256 of canonical JSON without `signature` and `timestamp_authority` fields
  signature: string; // base64
  canonicalization: "rfc8785-like"; // see canonicalize() — sorted-keys JSON without whitespace
}

export interface ProvenanceTimestamp {
  name: "freetsa.org" | "digicert.com" | "none";
  rfc3161_url?: string;
  rfc3161_timestamp?: string; // base64 of DER-encoded TimeStampResp
  requested_at: string;
  status: "ok" | "fallback" | "error";
  error?: string;
}

export interface ProvenanceManifest {
  manifest_version: "1.0";
  issued_at: string;
  issued_by: "openswissdata.com";
  permission_reference: string;
  permission_authority: string;
  permission_date?: string;
  jurisdiction: string;
  dataset: string;
  dataset_version: string;
  source_url: string;
  files: ProvenanceFile[];
}

export interface SignedProvenanceManifest extends ProvenanceManifest {
  signature: ProvenanceSignature;
  timestamp_authority: ProvenanceTimestamp;
}

export interface GenerateProvenanceArgs {
  dataset: string; // e.g. "tares"
  version: string; // semantic / date version (e.g. "2026.04.29")
  sourceUrl: string; // authoritative public URL
  files: ProvenanceFile[]; // computed from the workDir
  permissionReference: string;
  permissionAuthority: string;
  permissionDate?: string;
  jurisdiction?: string;
}

// ---------------------------------------------------------------------------
// Canonicalization (deterministic JSON for signing)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization for signing: sorted object keys (recursively),
 * no whitespace, `undefined` properties dropped (mirroring `JSON.stringify`),
 * arrays preserve order, primitives use `JSON.stringify` formatting.
 *
 * This is RFC-8785-inspired but intentionally minimal: numbers stay as
 * `JSON.stringify` writes them, strings use JS escaping. We do NOT need
 * full RFC-8785 because the manifest only contains strings, integers,
 * arrays, and nested objects — no floats, no special numerics.
 *
 * Document this in the bundle README so any consumer can reproduce.
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) return ""; // never reached at top level — see below
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    // JSON.stringify replaces top-level `undefined` array slots with `null`.
    return "[" + value.map((v) => (v === undefined ? "null" : canonicalize(v))).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  // Drop `undefined`-valued keys to match JSON.stringify behaviour.
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

// ---------------------------------------------------------------------------
// File digest helpers
// ---------------------------------------------------------------------------

export function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256OfBuffer(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// Manifest construction
// ---------------------------------------------------------------------------

export function generateProvenance(args: GenerateProvenanceArgs): ProvenanceManifest {
  const issued_at = new Date().toISOString();
  return {
    manifest_version: "1.0",
    issued_at,
    issued_by: "openswissdata.com",
    permission_reference: args.permissionReference,
    permission_authority: args.permissionAuthority,
    permission_date: args.permissionDate,
    jurisdiction: args.jurisdiction ?? "Switzerland",
    dataset: args.dataset,
    dataset_version: args.version,
    source_url: args.sourceUrl,
    files: [...args.files].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ---------------------------------------------------------------------------
// Public key loading (for embedding into the signature block)
// ---------------------------------------------------------------------------

const DEFAULT_PUBKEY_PATH = resolve(__dirname, "../../packages/schemas/openswissdata.pubkey.ed25519");

export function loadPublicKeyPem(path: string = DEFAULT_PUBKEY_PATH): string {
  if (!existsSync(path)) {
    throw new Error(`[provenance] public key not found at ${path}`);
  }
  return readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

export interface SignProvenanceOptions {
  privateKeyBase64?: string; // PKCS8 DER, base64 — defaults to env OSD_SIGNING_KEY_ED25519
  publicKeyPem?: string; // defaults to file
}

export function signProvenance(
  manifest: ProvenanceManifest,
  opts: SignProvenanceOptions = {}
): { signature: ProvenanceSignature } {
  const privB64 = opts.privateKeyBase64 ?? process.env.OSD_SIGNING_KEY_ED25519;
  if (!privB64) {
    throw new Error(
      "[provenance] OSD_SIGNING_KEY_ED25519 env var is required to sign manifests. " +
        "See scripts/generate-signing-key.mjs to provision a key pair."
    );
  }
  const privateKey = createPrivateKey({
    key: Buffer.from(privB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const publicKeyPem = opts.publicKeyPem ?? loadPublicKeyPem();
  // Sanity check: the env private key must match the committed public key.
  // Otherwise we'd ship a manifest signed with a key buyers cannot verify.
  const derivedPub = createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" })
    .toString();
  if (derivedPub.replace(/\s+/g, "") !== publicKeyPem.replace(/\s+/g, "")) {
    throw new Error(
      "[provenance] private key in env does NOT match committed public key. " +
        "Refusing to sign — fix OSD_SIGNING_KEY_ED25519 or rotate the public key file."
    );
  }

  const canonical = canonicalize(manifest);
  const payloadHash = sha256OfBuffer(canonical);
  // Ed25519 with node:crypto: pass `null` as the digest (pure Ed25519 signs raw message).
  const signatureBuf = sign(null, Buffer.from(canonical, "utf8"), privateKey);
  const signed_at = new Date().toISOString();

  return {
    signature: {
      algorithm: "Ed25519",
      public_key_pem: publicKeyPem,
      signed_at,
      signed_payload_hash: payloadHash,
      signature: signatureBuf.toString("base64"),
      canonicalization: "rfc8785-like",
    },
  };
}

// ---------------------------------------------------------------------------
// RFC-3161 timestamp request
// ---------------------------------------------------------------------------

const SHA256_OID_BYTES = Buffer.from([
  0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
]);

function derLen(n: number): Buffer {
  if (n < 128) return Buffer.from([n]);
  const out: number[] = [];
  while (n > 0) {
    out.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | out.length, ...out]);
}
function derSeq(content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x30]), derLen(content.length), content]);
}
function derInt1(): Buffer {
  return Buffer.from([0x02, 0x01, 0x01]);
}
function derOctetString(buf: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x04]), derLen(buf.length), buf]);
}
function derBoolTrue(): Buffer {
  return Buffer.from([0x01, 0x01, 0xff]);
}
function derNonceFromRandom(): Buffer {
  const nb = randomBytes(8);
  nb[0] &= 0x7f; // strip sign bit so encoded INTEGER is positive without padding
  const start = nb[0] === 0 ? 1 : 0;
  const body = nb.subarray(start);
  return Buffer.concat([Buffer.from([0x02, body.length]), body]);
}

/**
 * Build a minimal RFC-3161 TimeStampReq (DER) for a SHA-256 hash of `payload`.
 *
 *   TimeStampReq ::= SEQUENCE {
 *     version           INTEGER  { v1(1) },
 *     messageImprint    MessageImprint,
 *     nonce             INTEGER OPTIONAL,
 *     certReq           BOOLEAN DEFAULT FALSE
 *   }
 *   MessageImprint ::= SEQUENCE {
 *     hashAlgorithm     AlgorithmIdentifier,
 *     hashedMessage     OCTET STRING
 *   }
 */
function buildTsRequest(hash: Buffer): Buffer {
  const algId = derSeq(Buffer.concat([SHA256_OID_BYTES, Buffer.from([0x05, 0x00])]));
  const messageImprint = derSeq(Buffer.concat([algId, derOctetString(hash)]));
  const version = derInt1();
  const nonce = derNonceFromRandom();
  const certReq = derBoolTrue();
  return derSeq(Buffer.concat([version, messageImprint, nonce, certReq]));
}

export interface RequestRfc3161Options {
  primaryUrl?: string;
  fallbackUrl?: string;
  timeoutMs?: number;
  /**
   * If `true` (default), throw when both TSA endpoints fail.
   * Set to `false` only for tests that run offline.
   */
  required?: boolean;
}

const DEFAULT_PRIMARY = "https://freetsa.org/tsr";
const DEFAULT_FALLBACK = "http://timestamp.digicert.com";
const DEFAULT_TIMEOUT_MS = 30_000;

async function postTsr(url: string, body: Buffer, timeoutMs: number): Promise<Buffer> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/timestamp-query",
        accept: "application/timestamp-reply",
      },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("timestamp-reply")) {
      throw new Error(`unexpected content-type: ${ct}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

/**
 * Request an RFC-3161 timestamp for the SHA-256 hash of `payload`.
 *
 * Returns the base64-encoded TimeStampResp (DER) plus metadata. Tries the
 * primary TSA first; on failure or timeout, retries against the fallback.
 *
 * If both endpoints fail and `required` is true (the default), this throws —
 * we do NOT silently ship a manifest without a non-back-datable timestamp.
 */
export async function requestRfc3161Timestamp(
  payload: Buffer | string,
  opts: RequestRfc3161Options = {}
): Promise<ProvenanceTimestamp> {
  const primary = opts.primaryUrl ?? DEFAULT_PRIMARY;
  const fallback = opts.fallbackUrl ?? DEFAULT_FALLBACK;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const required = opts.required ?? true;

  const buf = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const hash = createHash("sha256").update(buf).digest();
  const tsReq = buildTsRequest(hash);

  // Primary
  try {
    const tsResp = await postTsr(primary, tsReq, timeout);
    return {
      name: primary.includes("freetsa") ? "freetsa.org" : "digicert.com",
      rfc3161_url: primary,
      rfc3161_timestamp: tsResp.toString("base64"),
      requested_at: new Date().toISOString(),
      status: "ok",
    };
  } catch (errPrimary) {
    const msgPrimary = errPrimary instanceof Error ? errPrimary.message : String(errPrimary);
    // Fallback
    try {
      const tsResp = await postTsr(fallback, tsReq, timeout);
      return {
        name: fallback.includes("freetsa") ? "freetsa.org" : "digicert.com",
        rfc3161_url: fallback,
        rfc3161_timestamp: tsResp.toString("base64"),
        requested_at: new Date().toISOString(),
        status: "fallback",
        error: `primary failed: ${msgPrimary}`,
      };
    } catch (errFallback) {
      const msgFallback = errFallback instanceof Error ? errFallback.message : String(errFallback);
      const combined = `primary(${primary}): ${msgPrimary} | fallback(${fallback}): ${msgFallback}`;
      if (required) {
        throw new Error(`[provenance] RFC-3161 timestamp failed on both TSAs — ${combined}`);
      }
      return {
        name: "none",
        requested_at: new Date().toISOString(),
        status: "error",
        error: combined,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Per-dataset permission profiles
// ---------------------------------------------------------------------------

export const PERMISSION_PROFILES = {
  tares: {
    permissionReference: "BAZG-PERMISSION-2026-04-21-MICHAEL-BEER",
    permissionAuthority: "BAZG (Bundesamt für Zoll und Grenzsicherheit)",
    permissionDate: "2026-04-21",
    jurisdiction: "Bern, Switzerland",
    sourceUrl: "https://xtares.admin.ch/",
  },
  classifications: {
    permissionReference: "PUBLIC-OFFICIAL-SOURCE-BFS-EUROSTAT-UNSD",
    permissionAuthority: "BFS (Federal Statistical Office), Eurostat (Ramon), UN Statistics Division",
    jurisdiction: "Switzerland (re-publication of public official sources)",
    sourceUrl:
      "https://www.bfs.admin.ch/bfs/en/home/statistics/industry-services/nomenclatures/noga.html",
  },
  finma: {
    permissionReference: "PUBLIC-OFFICIAL-SOURCE-FINMA",
    permissionAuthority: "FINMA (Swiss Financial Market Supervisory Authority)",
    jurisdiction: "Switzerland (re-publication of FINMA public registry)",
    sourceUrl: "https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/",
  },
} as const satisfies Record<
  string,
  {
    permissionReference: string;
    permissionAuthority: string;
    permissionDate?: string;
    jurisdiction: string;
    sourceUrl: string;
  }
>;

// ---------------------------------------------------------------------------
// Convenience: end-to-end builder used by ETL pipelines
// ---------------------------------------------------------------------------

export interface BuildSignedProvenanceArgs extends GenerateProvenanceArgs {
  /** If false, do not contact a TSA (used in offline tests). */
  withTimestamp?: boolean;
  /** Override TSA URLs — primarily for tests. */
  rfc3161?: RequestRfc3161Options;
}

export async function buildSignedProvenance(
  args: BuildSignedProvenanceArgs
): Promise<SignedProvenanceManifest> {
  const manifest = generateProvenance(args);
  const { signature } = signProvenance(manifest);

  // `withTimestamp: false` (explicit), or env `OSD_SKIP_RFC3161=1` (test/CI),
  // both bypass the network call.
  const skipTs = args.withTimestamp === false || process.env.OSD_SKIP_RFC3161 === "1";

  let timestamp_authority: ProvenanceTimestamp;
  if (skipTs) {
    timestamp_authority = {
      name: "none",
      requested_at: new Date().toISOString(),
      status: "error",
      error: "timestamp skipped (test mode)",
    };
  } else {
    timestamp_authority = await requestRfc3161Timestamp(signature.signature, args.rfc3161);
  }

  return { ...manifest, signature, timestamp_authority };
}
