import { ingestOneSource, ingestFromFinmaCsv } from "./ingest.js";
import { FINMA_SOURCES } from "./sources.js";
import { buildBundle } from "./bundle.js";
import { ingestFinmaWarnings } from "./ingest-warnings.js";
import { ingestGleif } from "./ingest-gleif.js";
import { readPublishedSnapshots, buildHistory, versionDate, type PublishedVersion } from "./history.js";
import { fetchBronze } from "../shared/bronze.js";
import { fetchZefixForUids, type ZefixData } from "./ingest-zefix.js";
import { uploadZip } from "../../src/lib/r2.js";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FinmaEntity, FinmaWarning } from "./types.js";

function todayVersion(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
}

export interface ReleaseResult {
  version: string;
  r2_key: string;
  sha256: string;
  size_bytes: number;
  entity_count: number;
  registered: boolean;
}

const FIXTURE_MAP: Array<{ entity_type: string; path: string }> = [
  { entity_type: "bank", path: "./etl/finma/fixtures/finma-banks-sample.xlsx" },
  { entity_type: "payment_institution", path: "./etl/finma/fixtures/finma-psp-sample.xlsx" },
  { entity_type: "insurance", path: "./etl/finma/fixtures/finma-insurance-sample.xlsx" },
  { entity_type: "asset_manager_individual", path: "./etl/finma/fixtures/finma-asset-manager-individual-sample.xlsx" },
];

export async function runRelease(
  opts: { useFixture?: boolean; version?: string; outDir?: string; dryRun?: boolean } = {}
): Promise<ReleaseResult> {
  const baseUrl = process.env.BASE_URL;
  const adminSecret = process.env.ADMIN_SECRET;
  if (!baseUrl) throw new Error("BASE_URL env var is required");
  if (!adminSecret) throw new Error("ADMIN_SECRET env var is required");

  const version = opts.version ?? process.env.FINMA_VERSION ?? todayVersion();
  const outDir = opts.outDir ?? process.env.FINMA_OUT_DIR ?? "./data/finma";
  const dryRun = opts.dryRun ?? process.env.FINMA_DRY_RUN === "1";
  const useFixture = opts.useFixture ?? process.env.USE_FIXTURE === "1";

  console.log(`[release-finma] version ${version} targeting ${baseUrl}`);

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const cacheDir = process.env.FINMA_CACHE_DIR ?? join(outDir, "finma-cache");
  let published: PublishedVersion[] = [];
  let currentVersion: string | null = null;
  if (!useFixture) {
    const metadataPath = process.env.FINMA_PREVIOUS_VERSIONS_FILE ?? await fetchBronze(
      `${baseUrl.replace(/\/$/, "")}/api/admin/dataset-versions/finma`, cacheDir,
      "versions-production.json", { headers: { "x-admin-secret": adminSecret } }, 0,
    );
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as { dataset: { current_version: string }; versions: PublishedVersion[] };
    currentVersion = metadata.dataset.current_version;
    if (!dryRun && metadata.versions.some(v => v.version === version)) throw new Error("Version déjà publiée : choisir une nouvelle version, sans écraser l'archive");
    const cutoff = Date.parse(versionDate(version)) - 90 * 86_400_000;
    const sorted = metadata.versions.filter(v => v.released_at <= Date.now()).sort((a, b) => a.released_at - b.released_at);
    const first = sorted.findIndex(v => Date.parse(versionDate(v.version)) >= cutoff);
    published = first < 0 ? sorted.slice(-1) : sorted.slice(Math.max(0, first - 1));
  }

  let entities: FinmaEntity[] = [];
  let warnings: FinmaWarning[] = [];
  if (useFixture) {
    for (const f of FIXTURE_MAP) {
      const source = FINMA_SOURCES.find((s) => s.entity_type === f.entity_type);
      if (!source) throw new Error(`No FINMA source config for entity_type=${f.entity_type}`);
      const rows = ingestOneSource(f.path, source);
      entities.push(...rows);
      console.log(`[release-finma] ${f.entity_type}: ${rows.length} rows`);
    }
  } else {
    console.log(`[release-finma] ingesting from FINMA uid.csv (cache=${cacheDir})...`);
    const result = await ingestFromFinmaCsv({ cacheDir });
    entities = result.entities;
    console.log(`[release-finma] ingested ${entities.length} entities. unmapped types: ${JSON.stringify(result.stats.unmappedTypes)}`);

    console.log(`[release-finma] ingesting FINMA warning list ...`);
    const warn = await ingestFinmaWarnings({ cacheDir });
    warnings = warn.warnings;
    console.log(`[release-finma] ingested ${warnings.length} warnings. categories: ${JSON.stringify(warn.stats.categoryCounts)}`);

    if (entities.length < 2_000 || warnings.length < 1_000) throw new Error("Sources FINMA incomplètes : publication annulée");
    for (const entity of entities) entity.is_warning_listed = null;
    const gleif = await ingestGleif(entities, cacheDir);
    console.log(`[release-finma] GLEIF : ${gleif.matched} lignes enrichies, ${gleif.ambiguous_uids} UID ambigus non attribués`);
  }
  console.log(`[release-finma] total ${entities.length} entities, ${warnings.length} warnings`);

  // ---------------------------------------------------------------------
  // Tier "FINMA + Zefix Sync" — bulk LINDAS SPARQL enrichment.
  // Activated via FINMA_TIER=zefix. Default tier remains 'standard'.
  // ---------------------------------------------------------------------
  const tier = (process.env.FINMA_TIER ?? "standard").toLowerCase();
  let zefixByUid: Map<string, ZefixData> | undefined;
  if (tier === "zefix") {
    const uniqUids = [...new Set(entities.map((e) => e.uid).filter((u): u is string => !!u))];
    console.log(`[release-finma] tier=zefix — fetching Zefix data for ${uniqUids.length} unique UIDs from LINDAS …`);
    const cachePath = join(outDir, "finma-cache", `zefix-bulk.json`);
    const t0 = Date.now();
    const r = await fetchZefixForUids(uniqUids, {
      cachePath,
      batchSize: 500,
      onProgress: (done, total, dt) => {
        console.log(`[release-finma]   LINDAS batch progress: ${done}/${total} (${dt} ms)`);
      },
    });
    const dt = Date.now() - t0;
    console.log(
      `[release-finma] Zefix enrichment: ${r.data.size}/${uniqUids.length} matched in ${r.batches} batch(es), ${dt} ms total. ` +
        `invalid_uids=${r.invalidUids.length}, missing=${r.missingUids.length}`,
    );
    if (r.data.size === 0) {
      // Hard fail: the user explicitly asked for zefix tier, getting 0 means
      // the endpoint or query is broken — better to fail loudly than ship an
      // empty enrichment file pretending to be useful.
      throw new Error("[release-finma] FINMA_TIER=zefix but 0 entities enriched — LINDAS endpoint or query is broken");
    }
    zefixByUid = r.data;
  }

  const snapshots = useFixture ? [] : await readPublishedSnapshots(published, cacheDir);
  const previous = snapshots.at(-1);
  if (previous && Math.abs(entities.length - previous.entities.length) / previous.entities.length > 0.1) throw new Error("Variation FINMA supérieure à 10 % : contrôle humain nécessaire");
  const history = buildHistory(snapshots, { version, entities });
  writeFileSync(join(outDir, `controle-${version}.json`), JSON.stringify({ version, registry_rows: entities.length, warnings: warnings.length, lei_rows: entities.filter(e => e.lei).length, history: history.coverage, changes: history.changes.length }, null, 2));
  const bundle = await buildBundle({ entities, warnings, zefixByUid, recentChanges: history.changes, historyCoverage: history.coverage }, version, outDir);
  console.log(
    `[release-finma] bundle sha256 ${bundle.sha256.slice(0, 12)}..., ${(bundle.sizeBytes / 1024).toFixed(1)} KB`
  );

  const r2_key = `finma/${version}/finma.zip`;
  if (dryRun) {
    console.log(`[release-finma] Préparation vérifiée, sans publication : ${bundle.zipPath}`);
    return { version, r2_key, sha256: bundle.sha256, size_bytes: bundle.sizeBytes, entity_count: entities.length, registered: false };
  }
  await uploadZip(bundle.zipPath, r2_key, { immutable: true });
  console.log(`[release-finma] uploaded to r2://${process.env.R2_BUCKET ?? "?"}/${r2_key}`);

  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/admin/release`;
  console.log(`[release-finma] POST ${endpoint} ...`);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-secret": adminSecret,
    },
    body: JSON.stringify({
      dataset_id: "finma",
      expected_previous_version: currentVersion,
      version,
      r2_key,
      sha256: bundle.sha256,
      size_bytes: bundle.sizeBytes,
      changelog: `FINMA v${version} — ${entities.length} entities + ${warnings.length} warnings`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`admin release failed: HTTP ${res.status} — ${body}`);
  }
  const payload = await res.json();
  console.log(`[release-finma] registered in DB: ${JSON.stringify(payload)}`);
  console.log(`[release-finma] ✅ registered ${version}`);

  return {
    version,
    r2_key,
    sha256: bundle.sha256,
    size_bytes: bundle.sizeBytes,
    entity_count: entities.length,
    registered: true,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRelease().catch((err) => {
    console.error("[release-finma] ERROR:", err);
    process.exit(1);
  });
}
