import { generateKeyPairSync } from "node:crypto";
import type { SignProvenanceOptions } from "../../etl/shared/provenance.js";

// Clés éphémères en mémoire, propres à ce processus de test. Aucun fichier du dépôt n’est écrit.
const pair = generateKeyPairSync("ed25519");
export const testSigning = {
  privateKeyBase64: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
};

export function withTestSignature<Input, Options extends {
  withTimestamp?: boolean; signing?: SignProvenanceOptions;
}, Result>(build: (input: Input, version: string, outDir: string, opts?: Options) => Promise<Result>) {
  return (input: Input, version: string, outDir: string, opts?: Options): Promise<Result> =>
    build(input, version, outDir, { ...opts, withTimestamp: false, signing: testSigning } as Options);
}
