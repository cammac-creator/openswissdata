import { parseNogaXlsx } from "./ingest-noga.js";
import { parseNaceCsv } from "./ingest-nace.js";
import { parseIsicCsv } from "./ingest-isic.js";
import { buildCrossWalks } from "./crosswalks.js";
import { buildBundle } from "./bundle.js";
import { uploadZip } from "../../src/lib/r2.js";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { NomenclatureRow } from "./types.js";

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

export async function runRelease(
  opts: { useFixture?: boolean; version?: string; outDir?: string } = {}
): Promise<ReleaseResult> {
  const baseUrl = process.env.BASE_URL;
  const adminSecret = process.env.ADMIN_SECRET;
  if (!baseUrl) throw new Error("BASE_URL env var is required");
  if (!adminSecret) throw new Error("ADMIN_SECRET env var is required");

  const version = opts.version ?? process.env.CLASSIFICATIONS_VERSION ?? todayVersion();
  const outDir = opts.outDir ?? "./data/classifications";
  const useFixture = opts.useFixture ?? process.env.USE_FIXTURE === "1";

  console.log(`[release-classifications] version ${version} targeting ${baseUrl}`);

  if (!useFixture) {
    throw new Error("Real ingestion from upstream sources not yet implemented. Use USE_FIXTURE=1.");
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const fixDir = "./etl/classifications/fixtures";

  const noga2025 = parseNogaXlsx(join(fixDir, "noga-2025-sample.xlsx"), "NOGA_2025");
  const noga2008 = parseNogaXlsx(join(fixDir, "noga-2008-sample.xlsx"), "NOGA_2008");
  const nace20 = parseNaceCsv(join(fixDir, "nace-2.0-sample.csv"), "NACE_2.0");
  const nace21 = parseNaceCsv(join(fixDir, "nace-2.1-sample.csv"), "NACE_2.1");
  const isic4 = parseIsicCsv(join(fixDir, "isic-4-sample.csv"));

  const rows: NomenclatureRow[] = [...noga2008, ...noga2025, ...nace20, ...nace21, ...isic4];
  console.log(`[release-classifications] ingested ${rows.length} rows across 5 schemes`);

  const crossWalks = buildCrossWalks(rows, {
    nace20to21Path: join(fixDir, "bridge-nace-2.0-to-2.1.csv"),
    nace21toIsic4Path: join(fixDir, "bridge-nace-2.1-to-isic-4.csv"),
  });
  console.log(`[release-classifications] built ${crossWalks.length} cross-walks`);

  const bundle = await buildBundle({ rows, crossWalks }, version, outDir);
  console.log(
    `[release-classifications] bundle sha256 ${bundle.sha256.slice(0, 12)}..., ${(bundle.sizeBytes / 1024).toFixed(1)} KB`
  );

  const r2_key = `classifications/${version}/classifications.zip`;
  await uploadZip(bundle.zipPath, r2_key);
  console.log(`[release-classifications] uploaded to r2://${process.env.R2_BUCKET ?? "?"}/${r2_key}`);

  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/admin/release`;
  console.log(`[release-classifications] POST ${endpoint} ...`);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-secret": adminSecret,
    },
    body: JSON.stringify({
      dataset_id: "classifications",
      version,
      r2_key,
      sha256: bundle.sha256,
      size_bytes: bundle.sizeBytes,
      changelog: `Classifications v${version} — ${rows.length} rows, ${crossWalks.length} cross-walks (fixtures)`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`admin release failed: HTTP ${res.status} — ${body}`);
  }
  const payload = await res.json();
  console.log(`[release-classifications] registered in DB: ${JSON.stringify(payload)}`);
  console.log(`[release-classifications] ✅ registered ${version}`);

  return {
    version,
    r2_key,
    sha256: bundle.sha256,
    size_bytes: bundle.sizeBytes,
    entity_count: rows.length,
    registered: true,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRelease().catch((err) => {
    console.error("[release-classifications] ERROR:", err);
    process.exit(1);
  });
}
