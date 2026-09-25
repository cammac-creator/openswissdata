/** Sources et version précédente → bronze vérifié → argent contrôlé → archive or immuable. */
import { ingestRealClassifications } from "./ingest-real.js";
import { buildBundle } from "./bundle.js";
import { validateClassifications } from "./quality.js";
import { uploadZip, getObjectBuffer } from "../../src/lib/r2.js";
import { extractCsvFromZip } from "../../src/mcp/r2-refresh.js";
import { fetchBronze } from "../shared/bronze.js";
import { verifyProvenanceZip } from "../shared/verify-provenance.js";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";


const Version = z.string().regex(/^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/);
const Metadata = z.object({
  dataset: z.object({ current_version: Version }),
  versions: z.array(z.object({ version: Version, r2_key: z.string().regex(/^classifications\/[\d.]+\/classifications\.zip$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), size_bytes: z.number().int().positive().max(100_000_000) })),
});
export interface ReleaseResult {
  version: string; r2_key: string; sha256: string; size_bytes: number;
  entity_count: number; registered: boolean; zip_path: string;
}

export async function runRelease(opts: { useFixture?: boolean; version?: string; outDir?: string; dryRun?: boolean } = {}): Promise<ReleaseResult> {
  const dryRun = opts.dryRun ?? process.env.CLASSIFICATIONS_DRY_RUN === "1";
  const useFixture = opts.useFixture ?? process.env.USE_FIXTURE === "1";
  if (useFixture) throw new Error("Une fixture classifications ne peut jamais être publiée");
  if ((process.env.CLASSIFICATIONS_TIER ?? "standard") !== "standard") throw new Error("Publication Pro suspendue : les compléments exigent un contrôle distinct");
  const today = new Date().toISOString().slice(0, 10);
  const version = Version.parse(opts.version ?? process.env.CLASSIFICATIONS_VERSION ?? today.replaceAll("-", "."));
  if (!useFixture && version.slice(0, 10) !== today.replaceAll("-", ".")) throw new Error("La version CLASSIFICATIONS doit porter la date réelle du contrôle");
  const baseUrl = process.env.BASE_URL;
  const adminSecret = process.env.ADMIN_SECRET;
  if (!useFixture && !baseUrl) throw new Error("BASE_URL absent");
  if (!useFixture && !adminSecret) throw new Error("ADMIN_SECRET absent");
  const outDir = opts.outDir ?? process.env.CLASSIFICATIONS_OUT_DIR ?? "./data/classifications";
  const cacheDir = process.env.CLASSIFICATIONS_CACHE_DIR ?? join(outDir, "sources-cache");
  mkdirSync(outDir, { recursive: true });
  let currentVersion: string | null = null;

  if (!useFixture) {
    const path = await fetchBronze(`${baseUrl!.replace(/\/$/, "")}/api/admin/dataset-versions/classifications`, cacheDir, "versions-production.json", { headers: { "x-admin-secret": adminSecret! } }, 0);
    const metadata = Metadata.parse(JSON.parse(readFileSync(path, "utf8")));
    currentVersion = metadata.dataset.current_version;
    if (metadata.versions.some(v => v.version === version)) throw new Error("Version CLASSIFICATIONS déjà publiée : aucun écrasement autorisé");
    if (version.localeCompare(currentVersion, undefined, { numeric: true }) <= 0) throw new Error("La version CLASSIFICATIONS ne progresse pas");
    const previousVersion = metadata.versions.find(v => v.version === currentVersion);
    if (!previousVersion) throw new Error("Version précédente CLASSIFICATIONS introuvable");
    const dir = join(cacheDir, "bronze", today, "historique"); mkdirSync(dir, { recursive: true });
    const archive = join(dir, `classifications-${currentVersion}-${previousVersion.sha256}.zip`);
    if (!existsSync(archive)) writeFileSync(archive, await getObjectBuffer(previousVersion.r2_key, { maxBytes: 100_000_000 }), { flag: "wx" });
    const bytes = readFileSync(archive);
    if (bytes.length !== previousVersion.size_bytes || createHash("sha256").update(bytes).digest("hex") !== previousVersion.sha256) throw new Error("Archive CLASSIFICATIONS précédente altérée");
    const previous = JSON.parse(await extractCsvFromZip(bytes, "nace_2_0.json"));
    if (!Array.isArray(previous) || !previous.length || previous.some(r => typeof r.code !== "string")) throw new Error("Archive classifications précédente invalide");
  }
  const actual = await ingestRealClassifications({ cacheDir, maxAgeHours: 0 });
  const rows = actual.rows;
  actual.sources = actual.sources.map(source => ({ ...source, version }));
  const quality = { ...validateClassifications(rows, actual.links, actual.sources), previous_version: currentVersion };
  if (actual.sources.some(s => s.fetched_at.slice(0, 10) !== today)) throw new Error("Sources classifications non contrôlées aujourd'hui");
  writeFileSync(join(outDir, `controle-${version}.json`), JSON.stringify(quality, null, 2));
  const bundle = await buildBundle({ rows, crossWalks: actual.crossWalks, links: actual.links, sources: actual.sources, quality }, version, outDir);
  const verified = await verifyProvenanceZip(bundle.zipPath);
  const required = ["noga_2008.json", "noga_2025.json", "nace_2_0.json", "nace_2_1.json", "isic_4.json", "nomenclatures.parquet", "crosswalks.csv", "classification_links.json", "classification_links.csv", "classification_links.parquet", "classification_sources.csv", "quality.json", "sources.json"];
  if (!verified.ok || required.some(name => !verified.fileChecks.some(f => f.name === name && f.ok))) throw new Error("Archive CLASSIFICATIONS : contrôle de signature ou de contenu échoué");
  const r2_key = `classifications/${version}/classifications.zip`;
  const result = { version, r2_key, sha256: bundle.sha256, size_bytes: bundle.sizeBytes, entity_count: rows.length, registered: false, zip_path: bundle.zipPath };
  if (dryRun) { console.log(`[classifications] Simulation vérifiée : ${rows.length} codes, sans publication`); return result; }
  await uploadZip(bundle.zipPath, r2_key, { immutable: true });
  // Relire les octets distants avant de changer la version vendue.
  const uploaded = await getObjectBuffer(r2_key, { maxBytes: 100_000_000 });
  if (uploaded.length !== bundle.sizeBytes || createHash("sha256").update(uploaded).digest("hex") !== bundle.sha256) throw new Error("Archive CLASSIFICATIONS distante non conforme");
  const res = await fetch(`${baseUrl!.replace(/\/$/, "")}/api/admin/release`, {
    method: "POST", signal: AbortSignal.timeout(60_000),
    headers: { "content-type": "application/json", "x-admin-secret": adminSecret! },
    body: JSON.stringify({ dataset_id: "classifications", expected_previous_version: currentVersion, version, r2_key,
      sha256: bundle.sha256, size_bytes: bundle.sizeBytes,
      changelog: `Classifications ${version} — ${rows.length} codes ; ${actual.links.length} relations directes sourcées ; NACE Rev. 2 et parenté ISIC vérifiés ; schéma 2`,
    }),
  });
  if (!res.ok) throw new Error(`Enregistrement CLASSIFICATIONS refusé : HTTP ${res.status}`);
  const registered = await res.json() as { ok?: boolean; version?: string };
  if (registered.ok !== true || registered.version !== version) throw new Error("Réponse d'enregistrement CLASSIFICATIONS incohérente");
  console.log(`[classifications] Archive relue et version enregistrée : ${version}`);
  return { ...result, registered: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRelease().catch(error => { console.error("[classifications]", error instanceof Error ? error.message : "Échec de publication"); process.exitCode = 1; });
}
