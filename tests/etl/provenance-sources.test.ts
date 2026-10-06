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
  it("source modifiée + empreinte recalculée : encore refusé, par Ed25519 cette fois", () => {
    // Le cas précédent échoue dès le contrôle d'empreinte (`signed_payload_hash`),
    // qui n'est pas signé et se recalcule par quiconque : il n'atteint jamais la
    // vérification Ed25519. Ici on recalcule l'empreinte sur le contenu altéré
    // (comme le ferait un faussaire qui sait reproduire ce calcul public) pour
    // prouver que c'est bien la signature, et non l'empreinte, qui arrête l'altération.
    const m = generateProvenance({ ...base, sources });
    const signed = { ...m, signature: signProvenance(m, signing).signature };
    const alteredSources = signed.sources!.map((s, i) => i === 1 ? { ...s, url: "https://exemple.invalid/" } : s);
    const { signature: ancienneSignature, ...sansSignature } = { ...signed, sources: alteredSources } as typeof signed;
    const canon = canonicalize(sansSignature);
    const empreinteRecalculee = createHash("sha256").update(canon).digest("hex");
    const altere = { ...sansSignature, signature: { ...ancienneSignature, signed_payload_hash: empreinteRecalculee } };
    // Rejoue exactement le premier contrôle de `recettePublique` : il passerait
    // désormais, puisque l'empreinte a été recalculée sur le contenu altéré.
    const { signature: sigVerif, ...payloadVerif } = altere;
    expect(createHash("sha256").update(canonicalize(payloadVerif)).digest("hex")).toBe(sigVerif.signed_payload_hash);
    // Seule la signature Ed25519, calculée sur l'ancien contenu, détecte encore l'altération.
    expect(recettePublique(altere)).toBe(false);
  });
  it("sources vide : refusé (une liste vide n'a pas de sens)", () => {
    expect(() => generateProvenance({ ...base, sources: [] })).toThrow(/au moins une source/);
  });
  it("tri binaire de sources (ordre par code de caractère, pas localeCompare)", () => {
    // `[...].sort()` JS par défaut est binaire : ici il diverge de `localeCompare`,
    // qui classerait eurostat.nace2_isic4_sparql et eurostat.nace2_sparql avant
    // eurostat.nace21_rdf.
    const ref = (id: string): ProvenanceSourceRef => ({
      id, institution: "Eurostat", url: "https://example.invalid/",
      permission_reference: "PUBLIC-OFFICIAL-SOURCE-BFS-EUROSTAT-UNSD", permission_authority: "Eurostat", jurisdiction: "Switzerland",
    });
    const unsorted = [
      ref("eurostat.nace2_sparql"),
      ref("eurostat.nace21_rdf"),
      ref("eurostat.nace2_isic4_sparql"),
    ];
    const m = generateProvenance({ ...base, sources: unsorted });
    expect(m.sources?.map(s => s.id)).toEqual([
      "eurostat.nace21_rdf",
      "eurostat.nace2_isic4_sparql",
      "eurostat.nace2_sparql",
    ]);
    // Preuve que c'est bien l'ordre binaire par défaut, et qu'il diverge de localeCompare.
    expect(m.sources?.map(s => s.id)).toEqual([...unsorted.map(s => s.id)].sort());
    expect(m.sources?.map(s => s.id)).not.toEqual([...unsorted.map(s => s.id)].sort((a, b) => a.localeCompare(b)));
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

  it("archive 1.1 altérée + empreinte recalculée : verifyProvenanceZip refuse, par Ed25519", async () => {
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
      // Falsification : une source changée, puis l'empreinte `signed_payload_hash`
      // recalculée sur le contenu altéré (ce que peut faire quiconque, la formule
      // est publique) — pour prouver que c'est la signature Ed25519, et non ce
      // premier contrôle d'empreinte, qui arrête l'archive altérée.
      const alteredSources = manifest.sources!.map((s, i) => (i === 1 ? { ...s, url: "https://exemple.invalid/" } : s));
      const { signature: ancienneSignature, timestamp_authority, ...sansSignature } = { ...manifest, sources: alteredSources };
      const empreinteRecalculee = createHash("sha256").update(canonicalize(sansSignature)).digest("hex");
      const manifestAltere = {
        ...sansSignature,
        timestamp_authority,
        signature: { ...ancienneSignature, signed_payload_hash: empreinteRecalculee },
      };
      const zipPath = zipperArchive(manifestAltere, dataFileContent);
      const verification = await verifyProvenanceZip(zipPath, testPublicKeyPath);
      expect(verification.signatureValid).toBe(false);
      expect(verification.ok).toBe(false);
      expect(verification.errors.some((e) => /Ed25519 signature INVALID/.test(e))).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
