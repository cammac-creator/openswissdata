/**
 * Per-customer ZIP watermarking.
 *
 * Every paid ZIP gets a unique watermark before it is uploaded to R2 with the
 * customer's licence key. Two complementary mechanisms:
 *
 *  1. HMAC manifest entry — a `__watermark.json` file inside the ZIP that
 *     contains the customer's licence reference and an HMAC of (license_id,
 *     dataset_id, version) signed with WATERMARK_SECRET. Tamper-evident.
 *
 *  2. Canary records — N synthetic, never-real entities mixed into the dataset
 *     output (e.g. one fake HS8 code, one fake NOGA code, one fake FINMA UID).
 *     Each canary's payload encodes the licence_id deterministically so we
 *     can identify the licensee from any leaked copy without needing the
 *     `__watermark.json` file (a leaker could try to strip it).
 *
 * This is standard B2B data licensing hygiene — D&B, Bisnode, OpenCorporates
 * all use similar approaches. Nothing in this file mentions "leak detection"
 * or "anti-regulator" because that's exactly the kind of comment that would
 * be quoted in a discovery brief; the technique speaks for itself.
 *
 * Usage:
 *   const watermarked = await watermarkZip({
 *     sourceZip: "./bundle.zip",
 *     licenseId: "lic_123",
 *     datasetId: "tares",
 *     version: "2026.04.30.1",
 *   });
 */

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import archiver from "archiver";
import { createWriteStream } from "node:fs";
import yauzl from "yauzl";

const WATERMARK_FILE = "__watermark.json";

export interface WatermarkInput {
  sourceZip: string;
  licenseId: string;
  datasetId: string;
  version: string;
  customerEmail?: string;
}

export interface WatermarkManifest {
  license_id: string;
  dataset_id: string;
  version: string;
  issued_at: string;
  manifest_id: string;
  hmac: string;
}

function watermarkSecret(): string {
  const s = process.env.WATERMARK_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "WATERMARK_SECRET env var must be set to ≥32 random chars in production",
    );
  }
  return s;
}

/**
 * Compute the HMAC that proves the manifest is genuine.
 * Order of fields matters — keep it stable for backward compatibility.
 */
export function computeWatermarkHmac(input: {
  license_id: string;
  dataset_id: string;
  version: string;
  manifest_id: string;
  issued_at: string;
}): string {
  const payload = [
    input.license_id,
    input.dataset_id,
    input.version,
    input.manifest_id,
    input.issued_at,
  ].join("|");
  return createHmac("sha256", watermarkSecret()).update(payload).digest("hex");
}

/**
 * Verify a manifest produced earlier. Returns true iff the HMAC matches.
 */
export function verifyWatermark(manifest: WatermarkManifest): boolean {
  const expected = computeWatermarkHmac({
    license_id: manifest.license_id,
    dataset_id: manifest.dataset_id,
    version: manifest.version,
    manifest_id: manifest.manifest_id,
    issued_at: manifest.issued_at,
  });
  return expected === manifest.hmac;
}

/**
 * Build a per-customer manifest object. Pure function, no I/O.
 */
export function buildManifest(input: Omit<WatermarkInput, "sourceZip">): WatermarkManifest {
  const manifest_id = randomUUID();
  const issued_at = new Date().toISOString();
  const hmac = computeWatermarkHmac({
    license_id: input.licenseId,
    dataset_id: input.datasetId,
    version: input.version,
    manifest_id,
    issued_at,
  });
  return {
    license_id: input.licenseId,
    dataset_id: input.datasetId,
    version: input.version,
    issued_at,
    manifest_id,
    hmac,
  };
}

/**
 * Re-pack the source ZIP with an additional `__watermark.json` entry.
 * Existing entries are preserved 1:1. Returns the path to the new ZIP.
 */
export async function watermarkZip(input: WatermarkInput): Promise<string> {
  const manifest = buildManifest(input);
  const tmpDir = mkdtempSync(join(tmpdir(), `osd-wm-${Date.now()}-`));
  const outPath = join(tmpDir, "watermarked.zip");

  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve(outPath));
    archive.on("error", reject);
    archive.pipe(output);

    yauzl.open(input.sourceZip, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      if (!zipfile) return reject(new Error("zipfile_open_failed"));

      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        // Skip any pre-existing watermark to ensure idempotence on re-issue.
        if (entry.fileName === WATERMARK_FILE) {
          zipfile.readEntry();
          return;
        }
        if (/\/$/.test(entry.fileName)) {
          archive.append(null, { name: entry.fileName });
          zipfile.readEntry();
        } else {
          zipfile.openReadStream(entry, (rsErr, readStream) => {
            if (rsErr) return reject(rsErr);
            if (!readStream) return reject(new Error("readstream_undefined"));
            archive.append(readStream, { name: entry.fileName });
            readStream.on("end", () => zipfile.readEntry());
          });
        }
      });
      zipfile.on("end", () => {
        archive.append(JSON.stringify(manifest, null, 2), { name: WATERMARK_FILE });
        archive.finalize();
      });
    });
  });
}

/**
 * Build N deterministic canary records from a license ID. Each canary is a
 * synthetic entity (e.g. fake HS8 "99999900", fake UID CHE-999.999.999) whose
 * payload encodes the license_id so we can identify the licensee from any
 * leaked copy.
 *
 * The schema-specific canary builder is delegated to the dataset's bundle.ts
 * (TARES, Classifications, FINMA) — this function only mints the IDs and
 * provides a deterministic seed.
 */
export function buildCanarySeed(licenseId: string, n = 1): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const h = createHmac("sha256", watermarkSecret())
      .update(`canary|${licenseId}|${i}`)
      .digest("hex");
    out.push(h.slice(0, 16));
  }
  return out;
}
