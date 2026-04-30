import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  generateProvenance,
  signProvenance,
  canonicalize,
  PERMISSION_PROFILES,
} from "../../etl/shared/provenance.js";
import { verifyProvenanceZip } from "../../etl/shared/verify-provenance.js";
import { ingestFromFixture } from "../../etl/tares/ingest.js";
import { buildBundle } from "../../etl/tares/bundle.js";

/**
 * Global Vitest setup (`tests/setup.ts`) provisions:
 *   - a temporary Ed25519 key pair (env `OSD_SIGNING_KEY_ED25519` + the public key
 *     written over `packages/schemas/openswissdata.pubkey.ed25519` for the suite)
 *   - `OSD_SKIP_RFC3161=1` so the bundle pipeline does not call freetsa.org
 *
 * These tests therefore exercise the real signing path against a test pubkey.
 */

const PUBKEY_PATH = resolve(process.cwd(), "packages/schemas/openswissdata.pubkey.ed25519");

describe("canonicalize()", () => {
  it("sorts object keys recursively and emits no whitespace", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ b: { y: 1, x: 2 }, a: [3, 1, 2] })).toBe(
      '{"a":[3,1,2],"b":{"x":2,"y":1}}'
    );
  });

  it("is stable across reorderings", () => {
    const a = { dataset: "tares", files: [{ name: "x", size: 1, sha256: "ff" }], version: "v1" };
    const b = { version: "v1", files: [{ size: 1, sha256: "ff", name: "x" }], dataset: "tares" };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("handles null and primitives correctly", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize("hello")).toBe('"hello"');
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize(true)).toBe("true");
  });

  it("drops undefined-valued keys (matching JSON.stringify)", () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalize({ a: 1, b: undefined, c: 2 })).toBe('{"a":1,"c":2}');
    // Round-trip property: parse(stringify(canonicalize(x))) === parse(canonicalize(x))
    const x = { permission_date: undefined, jurisdiction: "Switzerland", version: "v1" };
    const c = canonicalize(x);
    expect(JSON.parse(c)).toEqual({ jurisdiction: "Switzerland", version: "v1" });
  });

  it("preserves array order and replaces undefined slots with null", () => {
    expect(canonicalize([1, undefined, 3])).toBe("[1,null,3]");
    expect(canonicalize([{ b: 1, a: 2 }, "x"])).toBe('[{"a":2,"b":1},"x"]');
  });
});

describe("signProvenance()", () => {
  it("produces a valid Ed25519 signature on a canonical payload", () => {
    const manifest = generateProvenance({
      dataset: "tares",
      version: "v1.test",
      sourceUrl: "https://xtares.admin.ch/",
      files: [{ name: "tares.csv", size: 100, sha256: "abc123" }],
      permissionReference: PERMISSION_PROFILES.tares.permissionReference,
      permissionAuthority: PERMISSION_PROFILES.tares.permissionAuthority,
      permissionDate: PERMISSION_PROFILES.tares.permissionDate,
      jurisdiction: PERMISSION_PROFILES.tares.jurisdiction,
    });
    const { signature } = signProvenance(manifest);
    expect(signature.algorithm).toBe("Ed25519");
    expect(signature.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(signature.signed_payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(signature.public_key_pem).toContain("BEGIN PUBLIC KEY");
  });

  it("refuses to sign if env private key does not match committed public key", () => {
    const otherPair = generateKeyPairSync("ed25519");
    const otherPriv = otherPair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    const manifest = generateProvenance({
      dataset: "tares",
      version: "v1",
      sourceUrl: "https://xtares.admin.ch/",
      files: [],
      permissionReference: "X",
      permissionAuthority: "Y",
    });
    expect(() => signProvenance(manifest, { privateKeyBase64: otherPriv })).toThrow(
      /private key in env does NOT match committed public key/
    );
  });
});

describe("buildBundle() — TARES with provenance", () => {
  let workDir: string;
  const fixturePath = join(process.cwd(), "etl/tares/fixtures/sample-5-rows.json");

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "osd-prov-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("ZIP contains provenance.json with expected structure", async () => {
    const rows = ingestFromFixture(fixturePath);
    const result = await buildBundle(rows, "2026.04.29", workDir, { withTimestamp: false });

    const ext = join(workDir, "ext");
    execSync(`unzip -o -q "${result.zipPath}" -d "${ext}"`);
    expect(existsSync(join(ext, "provenance.json"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(ext, "provenance.json"), "utf8"));
    expect(manifest.dataset).toBe("tares");
    expect(manifest.dataset_version).toBe("2026.04.29");
    expect(manifest.permission_reference).toBe(
      PERMISSION_PROFILES.tares.permissionReference
    );
    expect(manifest.permission_authority).toContain("BAZG");
    expect(manifest.jurisdiction).toContain("Bern");
    expect(manifest.signature.algorithm).toBe("Ed25519");
    expect(manifest.signature.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(manifest.files.length).toBeGreaterThan(0);
    // Files should be sorted alphabetically (locale-aware, matching generateProvenance)
    const names = manifest.files.map((f: { name: string }) => f.name);
    expect([...names].sort((a: string, b: string) => a.localeCompare(b))).toEqual(names);
  });

  it("verifyProvenanceZip() returns ok=true on a freshly built bundle", async () => {
    const rows = ingestFromFixture(fixturePath);
    const result = await buildBundle(rows, "2026.04.29", workDir, { withTimestamp: false });

    const verification = await verifyProvenanceZip(result.zipPath, PUBKEY_PATH);
    expect(verification.errors).toEqual([]);
    expect(verification.ok).toBe(true);
    expect(verification.signatureValid).toBe(true);
    expect(verification.fileChecks.every((c) => c.ok)).toBe(true);
    // Without timestamp, we expect a warning — not an error
    expect(verification.warnings.some((w) => /no RFC-3161 timestamp/.test(w))).toBe(true);
  });

  it("verifyProvenanceZip() detects tampering of a payload file", async () => {
    const rows = ingestFromFixture(fixturePath);
    const result = await buildBundle(rows, "2026.04.29", workDir, { withTimestamp: false });

    // Tamper: extract, modify tares.csv, re-zip
    const ext = join(workDir, "ext");
    execSync(`unzip -o -q "${result.zipPath}" -d "${ext}"`);
    writeFileSync(join(ext, "tares.csv"), "TAMPERED\n", "utf8");
    const tamperedZip = join(workDir, "tampered.zip");
    execSync(`cd "${ext}" && zip -r -q "${tamperedZip}" .`);

    const verification = await verifyProvenanceZip(tamperedZip, PUBKEY_PATH);
    expect(verification.ok).toBe(false);
    expect(verification.errors.some((e) => /file integrity mismatch/.test(e))).toBe(true);
  });

  it("verifyProvenanceZip() detects tampering of the manifest itself", async () => {
    const rows = ingestFromFixture(fixturePath);
    const result = await buildBundle(rows, "2026.04.29", workDir, { withTimestamp: false });

    const ext = join(workDir, "ext");
    execSync(`unzip -o -q "${result.zipPath}" -d "${ext}"`);
    const manifest = JSON.parse(readFileSync(join(ext, "provenance.json"), "utf8"));
    // Change the dataset version after signing — should invalidate the signature.
    manifest.dataset_version = "v999.evil";
    writeFileSync(join(ext, "provenance.json"), JSON.stringify(manifest, null, 2));
    const tamperedZip = join(workDir, "tampered2.zip");
    execSync(`cd "${ext}" && zip -r -q "${tamperedZip}" .`);

    const verification = await verifyProvenanceZip(tamperedZip, PUBKEY_PATH);
    expect(verification.ok).toBe(false);
    expect(verification.signatureValid).toBe(false);
  });
});
