/** Sources et version précédente → bronze vérifié → argent contrôlé → archive or immuable. */
import { ingestFromFixture, ingestFromBazg } from "./ingest.js";
import { buildBundle } from "./bundle.js";
import { validateTares } from "./quality.js";
import { generateTaresEmbeddings } from "./embeddings.js";
import { uploadZip, getObjectBuffer } from "../../src/lib/r2.js";
import { extractCsvFromZip } from "../../src/mcp/r2-refresh.js";
import { fetchBronze } from "../shared/bronze.js";
import { verifyProvenanceZip } from "../shared/verify-provenance.js";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { TaresRow } from "./types.js";

const Version = z.string().regex(/^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/);
const Metadata = z.object({
  dataset: z.object({ current_version: Version }),
  versions: z.array(z.object({ version: Version, r2_key: z.string().regex(/^tares\/[\d.]+\/tares\.zip$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), size_bytes: z.number().int().positive().max(100_000_000) })),
});
export interface ReleaseResult {
  version: string; r2_key: string; sha256: string; size_bytes: number;
  row_count: number; registered: boolean; zip_path: string;
}

export async function runRelease(opts: { useFixture?: boolean; version?: string; outDir?: string; dryRun?: boolean } = {}): Promise<ReleaseResult> {
  const dryRun = opts.dryRun ?? process.env.TARES_DRY_RUN === "1";
  const useFixture = opts.useFixture ?? process.env.USE_FIXTURE === "1";
  if (useFixture && !dryRun) throw new Error("Une fixture TARES ne peut jamais être publiée");
  const today = new Date().toISOString().slice(0, 10);
  const version = Version.parse(opts.version ?? process.env.TARES_VERSION ?? today.replaceAll("-", "."));
  if (!useFixture && version.slice(0, 10) !== today.replaceAll("-", ".")) throw new Error("La version TARES doit porter la date réelle du contrôle");
  const baseUrl = process.env.BASE_URL;
  const adminSecret = process.env.ADMIN_SECRET;
  if (!useFixture && !baseUrl) throw new Error("BASE_URL absent");
  if (!useFixture && !adminSecret) throw new Error("ADMIN_SECRET absent");
  const outDir = opts.outDir ?? process.env.TARES_OUT_DIR ?? "./data/tares";
  const cacheDir = process.env.TARES_CACHE_DIR ?? join(outDir, "bazg-cache");
  mkdirSync(outDir, { recursive: true });
  let currentVersion: string | null = null;
  let previous: TaresRow[] = [];
  if (!useFixture) {
    const path = await fetchBronze(`${baseUrl!.replace(/\/$/, "")}/api/admin/dataset-versions/tares`, cacheDir, "versions-production.json", { headers: { "x-admin-secret": adminSecret! } }, 0);
    const metadata = Metadata.parse(JSON.parse(readFileSync(path, "utf8")));
    currentVersion = metadata.dataset.current_version;
    if (metadata.versions.some(v => v.version === version)) throw new Error("Version TARES déjà publiée : aucun écrasement autorisé");
    if (version.localeCompare(currentVersion, undefined, { numeric: true }) <= 0) throw new Error("La version TARES ne progresse pas");
    const previousVersion = metadata.versions.find(v => v.version === currentVersion);
    if (!previousVersion) throw new Error("Version précédente TARES introuvable");
    const dir = join(cacheDir, "bronze", today, "historique"); mkdirSync(dir, { recursive: true });
    const archive = join(dir, `tares-${currentVersion}-${previousVersion.sha256}.zip`);
    if (!existsSync(archive)) writeFileSync(archive, await getObjectBuffer(previousVersion.r2_key, { maxBytes: 100_000_000 }), { flag: "wx" });
    const bytes = readFileSync(archive);
    if (bytes.length !== previousVersion.size_bytes || createHash("sha256").update(bytes).digest("hex") !== previousVersion.sha256) throw new Error("Archive TARES précédente altérée");
    previous = JSON.parse(await extractCsvFromZip(bytes, "tares.json"));
    if (!Array.isArray(previous) || previous.some(r => typeof r.hs8 !== "string")) throw new Error("Archive TARES précédente invalide");
  }
  const actual = useFixture ? undefined : await ingestFromBazg({ cacheDir, today, maxAgeHours: 0 });
  const rows = actual?.rows ?? ingestFromFixture("./etl/tares/fixtures/sample-5-rows.json");
  const quality = actual ? validateTares(actual, previous, currentVersion!) : undefined;
  if (actual?.sources.some(s => s.fetched_at.slice(0, 10) !== today)) throw new Error("Sources TARES non contrôlées aujourd'hui");
  if (quality) writeFileSync(join(outDir, `controle-${version}.json`), JSON.stringify(quality, null, 2));
  const embeddings = process.env.SKIP_EMBEDDINGS === "1" ? undefined : await generateTaresEmbeddings(rows, { cachePath: join(outDir, "embeddings-cache-fr.json") });
  const bundle = await buildBundle(rows, version, outDir, { embeddings, rates: actual?.rates, quality, sources: actual?.sources });
  const verified = await verifyProvenanceZip(bundle.zipPath);
  const required = ["tares.csv", "tares.json", "tares.parquet", "tares.sql", ...(actual ? ["tares_rates.json", "tares_rates.csv", "quality.json", "sources.json"] : []), ...(embeddings ? ["tares_embeddings.parquet"] : [])];
  if (!verified.ok || required.some(name => !verified.fileChecks.some(f => f.name === name && f.ok))) throw new Error("Archive TARES : contrôle de signature ou de contenu échoué");
  const r2_key = `tares/${version}/tares.zip`;
  const result = { version, r2_key, sha256: bundle.sha256, size_bytes: bundle.sizeBytes, row_count: rows.length, registered: false, zip_path: bundle.zipPath };
  if (dryRun) { console.log(`[tares] Simulation vérifiée : ${rows.length} codes, sans publication`); return result; }
  await uploadZip(bundle.zipPath, r2_key, { immutable: true });
  // Relire les octets distants avant de changer la version vendue.
  const uploaded = await getObjectBuffer(r2_key, { maxBytes: 100_000_000 });
  if (uploaded.length !== bundle.sizeBytes || createHash("sha256").update(uploaded).digest("hex") !== bundle.sha256) throw new Error("Archive TARES distante non conforme");
  const res = await fetch(`${baseUrl!.replace(/\/$/, "")}/api/admin/release`, {
    method: "POST", signal: AbortSignal.timeout(60_000),
    headers: { "content-type": "application/json", "x-admin-secret": adminSecret! },
    body: JSON.stringify({ dataset_id: "tares", expected_previous_version: currentVersion, version, r2_key,
      sha256: bundle.sha256, size_bytes: bundle.sizeBytes,
      changelog: `TARES ${version} — ${rows.length} codes, ${actual!.rates.length} lignes de taux et conditions ; schéma 2, contrôles et comparaison inclus`,
    }),
  });
  if (!res.ok) throw new Error(`Enregistrement TARES refusé : HTTP ${res.status}`);
  const registered = await res.json() as { ok?: boolean; version?: string };
  if (registered.ok !== true || registered.version !== version) throw new Error("Réponse d'enregistrement TARES incohérente");
  console.log(`[tares] Archive relue et version enregistrée : ${version}`);
  return { ...result, registered: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRelease().catch(error => { console.error("[tares]", error instanceof Error ? error.message : "Échec de publication"); process.exitCode = 1; });
}
