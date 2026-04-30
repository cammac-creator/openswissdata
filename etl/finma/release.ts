import { ingestOneSource, ingestFromFinmaCsv } from "./ingest.js";
import { FINMA_SOURCES } from "./sources.js";
import { buildBundle } from "./bundle.js";
import { ingestFinmaWarnings } from "./ingest-warnings.js";
import { flagWarningsOnRegistry } from "./unify-schema.js";
import { fetchZefixForUids, type ZefixData } from "./ingest-zefix.js";
import { uploadZip } from "../../src/lib/r2.js";
import { mkdirSync, existsSync } from "node:fs";
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
  opts: { useFixture?: boolean; version?: string; outDir?: string } = {}
): Promise<ReleaseResult> {
  const baseUrl = process.env.BASE_URL;
  const adminSecret = process.env.ADMIN_SECRET;
  if (!baseUrl) throw new Error("BASE_URL env var is required");
  if (!adminSecret) throw new Error("ADMIN_SECRET env var is required");

  const version = opts.version ?? process.env.FINMA_VERSION ?? todayVersion();
  const outDir = opts.outDir ?? "./data/finma";
  const useFixture = opts.useFixture ?? process.env.USE_FIXTURE === "1";

  console.log(`[release-finma] version ${version} targeting ${baseUrl}`);

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

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
    const cacheDir = join(outDir, "finma-cache");
    console.log(`[release-finma] ingesting from FINMA uid.csv (cache=${cacheDir})...`);
    const result = await ingestFromFinmaCsv({ cacheDir });
    entities = result.entities;
    console.log(`[release-finma] ingested ${entities.length} entities. unmapped types: ${JSON.stringify(result.stats.unmappedTypes)}`);

    console.log(`[release-finma] ingesting FINMA warning list ...`);
    const warn = await ingestFinmaWarnings({ cacheDir });
    warnings = warn.warnings;
    console.log(`[release-finma] ingested ${warnings.length} warnings. categories: ${JSON.stringify(warn.stats.categoryCounts)}`);

    const flagged = flagWarningsOnRegistry(entities, warnings, 0.8);
    console.log(`[release-finma] cross-ref: ${flagged} authorised entities flagged is_warning_listed=true`);
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

  const bundle = await buildBundle({ entities, warnings, zefixByUid }, version, outDir);
  console.log(
    `[release-finma] bundle sha256 ${bundle.sha256.slice(0, 12)}..., ${(bundle.sizeBytes / 1024).toFixed(1)} KB`
  );

  const r2_key = `finma/${version}/finma.zip`;
  await uploadZip(bundle.zipPath, r2_key);
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
