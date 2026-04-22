import { ingestOneSource } from "./ingest.js";
import { FINMA_SOURCES } from "./sources.js";
import { buildBundle } from "./bundle.js";
import { uploadZip } from "../../src/lib/r2.js";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { FinmaEntity } from "./types.js";

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

  if (!useFixture) {
    throw new Error("Real ingestion from FINMA URLs not yet implemented. Use USE_FIXTURE=1.");
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const entities: FinmaEntity[] = [];
  for (const f of FIXTURE_MAP) {
    const source = FINMA_SOURCES.find((s) => s.entity_type === f.entity_type);
    if (!source) throw new Error(`No FINMA source config for entity_type=${f.entity_type}`);
    const rows = ingestOneSource(f.path, source);
    entities.push(...rows);
    console.log(`[release-finma] ${f.entity_type}: ${rows.length} rows`);
  }
  console.log(`[release-finma] total ${entities.length} entities`);

  const bundle = await buildBundle({ entities }, version, outDir);
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
      changelog: `FINMA v${version} — ${entities.length} entities (fixtures)`,
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
