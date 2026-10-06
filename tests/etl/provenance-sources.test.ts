import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, verify, createPublicKey } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  canonicalize,
  generateProvenance,
  signProvenance,
  buildSignedProvenance,
  sha256OfFile,
  type ProvenanceSourceRef,
} from "../../etl/shared/provenance.js";
import { verifyProvenanceZip } from "../../etl/shared/verify-provenance.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
// Mêmes options que tests/etl/provenance.test.ts : clé privée PKCS8 DER en base64 et clé publique PEM.
const signing = { privateKeyBase64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
                  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
const base = { dataset: "finma", version: "2026.10.06", sourceUrl: "https://www.finma.ch/", files: [{ name: "a.csv", size: 1, sha256: "00" }],
               permissionReference: "PUBLIC-OFFICIAL-SOURCE-FINMA", permissionAuthority: "FINMA", jurisdiction: "Switzerland" };
const sources: ProvenanceSourceRef[] = [
  { id: "finma.uid_csv", institution: "FINMA", url: "https://www.finma.ch/uid.csv", permission_reference: "PUBLIC-OFFICIAL-SOURCE-FINMA", permission_authority: "FINMA", jurisdiction: "Switzerland" },
  { id: "gleif.lei_api", institution: "GLEIF", url: "https://api.gleif.org/api/v1/lei-records", permission_reference: "PUBLIC-OFFICIAL-SOURCE-GLEIF-CC0", permission_authority: "GLEIF", jurisdiction: "Switzerland" },
];
// Recette publique : signature Ed25519 sur le JSON canonique du manifeste sans signature ni horodatage.
function recettePublique(signed: Record<string, unknown>): boolean {
  const { signature, timestamp_authority, ...payload } = signed as { signature: { signature: string; signed_payload_hash: string } } & Record<string, unknown>;
  void timestamp_authority;
  const canon = canonicalize(payload);
  if (createHash("sha256").update(canon).digest("hex") !== signature.signed_payload_hash) return false;
  return verify(null, Buffer.from(canon), createPublicKey(signing.publicKeyPem), Buffer.from(signature.signature, "base64"));
}

describe("manifeste de provenance à plusieurs sources", () => {
  it("sans sources : un manifeste 1.0 identique à avant (aucun champ sources)", () => {
    const m = generateProvenance(base);
    expect(m.manifest_version).toBe("1.0");
    expect("sources" in m).toBe(false);
  });
  it("avec sources : 1.1, sources triées par id, champs 1.0 conservés", () => {
    const m = generateProvenance({ ...base, sources: [...sources].reverse() });
    expect(m.manifest_version).toBe("1.1");
    expect(m.sources?.map(s => s.id)).toEqual(["finma.uid_csv", "gleif.lei_api"]);
    expect(m.permission_reference).toBe("PUBLIC-OFFICIAL-SOURCE-FINMA");
    expect(m.source_url).toBe("https://www.finma.ch/");
  });
  it("la recette publique vérifie un manifeste 1.1 signé", () => {
    const m = generateProvenance({ ...base, sources });
    const signed = { ...m, signature: signProvenance(m, signing).signature };
    expect(recettePublique(signed)).toBe(true);
  });
  it("modifier une seule source casse la vérification", () => {
    const m = generateProvenance({ ...base, sources });
    const signed = { ...m, signature: signProvenance(m, signing).signature };
    const altere = { ...signed, sources: signed.sources!.map((s, i) => i === 1 ? { ...s, url: "https://exemple.invalid/" } : s) };
    expect(recettePublique(altere)).toBe(false);
  });
  it("sources vide : refusé (une liste vide n'a pas de sens)", () => {
    expect(() => generateProvenance({ ...base, sources: [] })).toThrow(/au moins une source/);
  });
});

describe("archive de bout en bout avec buildSignedProvenance et verifyProvenanceZip", () => {
  // Clé de test écrite dans un dossier temporaire dédié, jamais dans
  // packages/schemas/openswissdata.pubkey.ed25519 ni dans process.env.
  let workDir: string;
  let testPublicKeyPath: string;

  function zipperArchive(manifest: Record<string, unknown>, dataFileContent: string): string {
    const ext = join(workDir, `ext-${Math.random().toString(36).slice(2)}`);
    mkdirSync(ext);
    writeFileSync(join(ext, "provenance.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(join(ext, "a.csv"), dataFileContent, "utf8");
    const zipPath = join(ext, "..", `archive-${Math.random().toString(36).slice(2)}.zip`);
    // Même geste que tests/etl/provenance.test.ts : on zippe un dossier déjà rempli.
    execSync(`cd "${ext}" && zip -r -q "${zipPath}" .`);
    return zipPath;
  }

  it("archive 1.0 sans sources : verifyProvenanceZip accepte", async () => {
    workDir = mkdtempSync(join(tmpdir(), "osd-prov-sources-"));
    testPublicKeyPath = join(workDir, "cle-test.pem");
    writeFileSync(testPublicKeyPath, signing.publicKeyPem);
    try {
      const dataFileContent = "id,valeur\n1,finma\n";
      const tmpDataPath = join(workDir, "a.csv");
      writeFileSync(tmpDataPath, dataFileContent, "utf8");
      const manifest = await buildSignedProvenance({
        ...base,
        files: [{ name: "a.csv", size: statSync(tmpDataPath).size, sha256: sha256OfFile(tmpDataPath) }],
        signing,
        withTimestamp: false,
      });
      const zipPath = zipperArchive(manifest, dataFileContent);
      const verification = await verifyProvenanceZip(zipPath, testPublicKeyPath);
      expect(verification.ok).toBe(true);
      expect(verification.manifest?.manifest_version).toBe("1.0");
      expect("sources" in (verification.manifest ?? {})).toBe(false);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("archive 1.1 avec sources : verifyProvenanceZip accepte", async () => {
    workDir = mkdtempSync(join(tmpdir(), "osd-prov-sources-"));
    testPublicKeyPath = join(workDir, "cle-test.pem");
    writeFileSync(testPublicKeyPath, signing.publicKeyPem);
    try {
      const dataFileContent = "id,valeur\n1,finma\n2,gleif\n";
      const tmpDataPath = join(workDir, "a.csv");
      writeFileSync(tmpDataPath, dataFileContent, "utf8");
      const manifest = await buildSignedProvenance({
        ...base,
        files: [{ name: "a.csv", size: statSync(tmpDataPath).size, sha256: sha256OfFile(tmpDataPath) }],
        sources,
        signing,
        withTimestamp: false,
      });
      const zipPath = zipperArchive(manifest, dataFileContent);
      const verification = await verifyProvenanceZip(zipPath, testPublicKeyPath);
      expect(verification.ok).toBe(true);
      expect(verification.manifest?.manifest_version).toBe("1.1");
      expect(verification.manifest?.sources?.map((s) => s.id)).toEqual([
        "finma.uid_csv",
        "gleif.lei_api",
      ]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
