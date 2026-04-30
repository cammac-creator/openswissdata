import { parseNogaXlsx } from "./ingest-noga.js";
import { parseNaceCsv } from "./ingest-nace.js";
import { parseIsicCsv } from "./ingest-isic.js";
import { buildCrossWalks } from "./crosswalks.js";
import { ingestRealClassifications } from "./ingest-real.js";
import { buildBundle } from "./bundle.js";
import {
  generateNogaEmbeddings,
  NOGA_EMBEDDING_DIMENSIONS,
  NOGA_EMBEDDING_MODEL,
  type NogaEmbedding,
} from "./embeddings.js";
import { generateMultilingualNogaEmbeddings } from "./embeddings-multilingual.js";
import { ingestNaicsCrosswalk, type IngestNaicsResult } from "./naics-crosswalk.js";
import { extractNaceEnLabels, type NaceEnLabelRow } from "./nace-en-labels.js";
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

  // STATENT removed from Pro tier 2026-04-30 — license `terms_by_ask` was not
  // obtained from BFS (commercial redistribution would require a written waiver).
  // The historical ingest-statent.ts + bundle.ts STATENT branch are kept for
  // bit-identical reproduction of legacy ZIPs but are no longer wired in here.

  // Pro tier add-on #1: pre-computed NOGA 2025 multilingual embeddings.
  // FR is reused from the existing cache (no recompute). DE/IT/EN are generated
  // into per-language caches. Powers the `classifyText` free-text → top-K NOGA
  // codes feature on the buyer side for compliance officers in DE/IT/EN UIs.
  // Skippable via `SKIP_EMBEDDINGS=1` for fast iteration; production releases ship them.
  let embeddings: NogaEmbedding[] | undefined;
  if (tier === "pro" && process.env.SKIP_EMBEDDINGS !== "1") {
    const cachePathFr = join(outDir, "embeddings-cache-fr.json");
    console.log(
      `[release-classifications] tier=pro — generating multilingual NOGA embeddings (model=${NOGA_EMBEDDING_MODEL}, ${NOGA_EMBEDDING_DIMENSIONS}d, langs=fr+de+it+en, caches=${outDir}/embeddings-cache-{lang}.json)...`,
    );
    const t0 = Date.now();
    // FR — reuse the existing cache (already shipped in v1).
    const fr = await generateNogaEmbeddings(rows, { cachePath: cachePathFr });
    // DE / IT / EN — generated under their own per-language caches.
    const multi = await generateMultilingualNogaEmbeddings(rows, {
      cacheDir: outDir,
      langs: ["de", "it", "en"],
    });
    embeddings = [...fr, ...multi.byLang.de, ...multi.byLang.it, ...multi.byLang.en];
    console.log(
      `[release-classifications] generated ${embeddings.length} embeddings (fr=${fr.length}, de=${multi.byLang.de.length}, it=${multi.byLang.it.length}, en=${multi.byLang.en.length}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  } else if (tier === "pro") {
    console.log("[release-classifications] SKIP_EMBEDDINGS=1 — skipping NOGA embeddings generation");
  }

  // Pro tier add-on #2: NAICS 2022 ↔ ISIC ↔ NACE/NOGA cross-walk (US Census Bureau, Public Domain).
  let naics: IngestNaicsResult | undefined;
  if (tier === "pro" && !useFixture) {
    const cacheDir = join(outDir, "naics-cache");
    console.log("[release-classifications] tier=pro — ingesting NAICS 2022 ↔ ISIC concordance (US Census)...");
    naics = await ingestNaicsCrosswalk({ rows, cacheDir });
    console.log(
      `[release-classifications] NAICS ingested: ${naics.stats.emitted_rows} rows (exact=${naics.stats.exact}, partial=${naics.stats.partial}), ${naics.stats.naics_unique} unique NAICS, fetch=${naics.stats.fetch_seconds.toFixed(1)}s`,
    );
  }

  // Pro tier add-on #3: NACE Rev 2.1 official EN labels (Eurostat re-use policy).
  let naceEnLabels: NaceEnLabelRow[] | undefined;
  if (tier === "pro") {
    const result = extractNaceEnLabels(rows);
    naceEnLabels = result.rows;
    console.log(
      `[release-classifications] NACE 2.1 EN labels extracted: ${result.stats.total} rows (${result.stats.with_label} with label, ${result.stats.missing_label} empty)`,
    );
  }

  const bundle = await buildBundle(
    { rows, crossWalks, embeddings, naics, naceEnLabels },
    version,
    outDir,
  );
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
      changelog:
        tier === "pro"
          ? `Classifications v${version} (Pro) — ${rows.length} rows, ${crossWalks.length} cross-walks, embeddings=${embeddings?.length ?? 0} (4 langs), NAICS-NACE cross-walk=${naics?.rows.length ?? 0}, NACE EN labels=${naceEnLabels?.length ?? 0}`
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
