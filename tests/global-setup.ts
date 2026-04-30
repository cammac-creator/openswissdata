/**
 * Vitest globalSetup — runs ONCE before any test worker starts.
 *
 * Generates a single Ed25519 test key pair and:
 *   - Backs up the production public key from `packages/schemas/openswissdata.pubkey.ed25519`.
 *   - Writes the test public key over it for the duration of the suite.
 *   - Exports the matching private key + a `OSD_SKIP_RFC3161=1` flag through
 *     env vars so every worker process uses them.
 *
 * Tear-down restores the production public key. As an extra safety net,
 * `process.on('exit')` also restores in case Vitest crashes before teardown.
 */

import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PUBKEY_PATH = resolve(process.cwd(), "packages/schemas/openswissdata.pubkey.ed25519");

let originalPubkey: string | null = null;
let restored = false;

function restorePubkey(): void {
  if (restored) return;
  if (originalPubkey !== null) {
    writeFileSync(PUBKEY_PATH, originalPubkey, "utf8");
    restored = true;
  }
}

export async function setup(): Promise<void> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const testPubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const testPrivBase64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");

  if (existsSync(PUBKEY_PATH)) {
    originalPubkey = readFileSync(PUBKEY_PATH, "utf8");
  }
  writeFileSync(PUBKEY_PATH, testPubPem, "utf8");

  process.env.OSD_SIGNING_KEY_ED25519 = testPrivBase64;
  process.env.OSD_SKIP_RFC3161 = "1";

  // Last-ditch restore on abrupt exit (Ctrl-C, vitest crash, etc.)
  process.on("exit", restorePubkey);
  process.on("SIGINT", () => {
    restorePubkey();
    process.exit(130);
  });
}

export async function teardown(): Promise<void> {
  restorePubkey();
}
