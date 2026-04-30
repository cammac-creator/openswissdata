import { parseNogaXlsx } from "./ingest-noga.js";
import { parseNaceCsv } from "./ingest-nace.js";
import { parseIsicCsv } from "./ingest-isic.js";
import { buildCrossWalks } from "./crosswalks.js";
import { ingestRealClassifications } from "./ingest-real.js";
import { ingestStatent, type IngestStatentResult } from "./ingest-statent.js";
import { buildBundle } from "./bundle.js";
import {
  generateNogaEmbeddings,
  NOGA_EMBEDDING_DIMENSIONS,
  NOGA_EMBEDDING_MODEL,
  type NogaEmbedding,
} from "./embeddings.js";
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
  const tier = (process.env.CLASSIFICATIONS_TIER ?? "standard").toLowerCase();
  if (tier !== "standard" && tier !== "pro") {
    throw new Error(`CLASSIFICATIONS_TIER must be "standard" or "pro", got "${tier}"`);
  }

  console.log(
    `[release-classifications] version ${version} tier=${tier} targeting ${baseUrl}`,
  );

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  let rows: NomenclatureRow[];
  let crossWalks;

  if (useFixture) {
    const fixDir = "./etl/classifications/fixtures";
    const noga2025 = parseNogaXlsx(join(fixDir, "noga-2025-sample.xlsx"), "NOGA_2025");
    const noga2008 = parseNogaXlsx(join(fixDir, "noga-2008-sample.xlsx"), "NOGA_2008");
    const nace20 = parseNaceCsv(join(fixDir, "nace-2.0-sample.csv"), "NACE_2.0");
    const nace21 = parseNaceCsv(join(fixDir, "nace-2.1-sample.csv"), "NACE_2.1");
    const isic4 = parseIsicCsv(join(fixDir, "isic-4-sample.csv"));
    rows = [...noga2008, ...noga2025, ...nace20, ...nace21, ...isic4];
    console.log(`[release-classifications] ingested ${rows.length} rows from fixtures (5 schemes)`);
    crossWalks = buildCrossWalks(rows, {
      nace20to21Path: join(fixDir, "bridge-nace-2.0-to-2.1.csv"),
      nace21toIsic4Path: join(fixDir, "bridge-nace-2.1-to-isic-4.csv"),
    });
    console.log(`[release-classifications] built ${crossWalks.length} cross-walks (fixtures)`);
  } else {
    const cacheDir = join(outDir, "classifications-cache");
    console.log(`[release-classifications] ingesting from real sources (cache=${cacheDir})...`);
    const result = await ingestRealClassifications({ cacheDir });
    rows = result.rows;
    crossWalks = result.crossWalks;
    console.log(`[release-classifications] ingested ${rows.length} rows. stats=${JSON.stringify(result.stats)}`);
  }

  // Optional Pro tier add-on: STATENT (BFS structural establishments + FTE).
  let statent: IngestStatentResult | undefined;
  if (tier === "pro" && !useFixture) {
    const cacheDir = join(outDir, "classifications-cache");
    console.log("[release-classifications] tier=pro — ingesting STATENT (BFS PX-Web)...");
    statent = await ingestStatent({ cacheDir });
    console.log(
      `[release-classifications] STATENT ingested: canton×division=${statent.stats.canton_division_rows}, commune×sector=${statent.stats.commune_sector_rows}, suppressed=${statent.stats.suppressed_cells}, fetch=${statent.stats.fetch_seconds.toFixed(1)}s`,
    );
  }

  // Optional Pro tier add-on: pre-computed NOGA 2025 embeddings (Phase 1 / C3).
  // Powers the `classifyText` free-text → top-3 NOGA codes feature on the buyer side.
  // Skippable via `SKIP_EMBEDDINGS=1` for fast iteration; production releases ship them.
  let embeddings: NogaEmbedding[] | undefined;
  if (tier === "pro" && process.env.SKIP_EMBEDDINGS !== "1") {
    const cachePath = join(outDir, "embeddings-cache-fr.json");
    console.log(
      `[release-classifications] tier=pro — generating NOGA embeddings (model=${NOGA_EMBEDDING_MODEL}, ${NOGA_EMBEDDING_DIMENSIONS}d, lang=fr, cache=${cachePath})...`,
    );
    const t0 = Date.now();
    embeddings = await generateNogaEmbeddings(rows, { cachePath });
    console.log(
      `[release-classifications] generated ${embeddings.length} embeddings in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  } else if (tier === "pro") {
    console.log("[release-classifications] SKIP_EMBEDDINGS=1 — skipping NOGA embeddings generation");
  }

  const bundle = await buildBundle({ rows, crossWalks, statent, embeddings }, version, outDir);
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
      changelog: statent
        ? `Classifications v${version} (Pro) — ${rows.length} rows, ${crossWalks.length} cross-walks, STATENT canton×division=${statent.stats.canton_division_rows} + commune×sector=${statent.stats.commune_sector_rows}`
        : `Classifications v${version} — ${rows.length} rows, ${crossWalks.length} cross-walks`,
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
