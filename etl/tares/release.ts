import { ingestFromFixture, ingestFromBazg } from "./ingest.js";
import { buildBundle } from "./bundle.js";
import { generateTaresEmbeddings, TARES_EMBEDDING_DIMENSIONS, TARES_EMBEDDING_MODEL } from "./embeddings.js";
import { uploadZip } from "../../src/lib/r2.js";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function todayVersion(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
}

export interface ReleaseResult {
  version: string;
  r2_key: string;
  sha256: string;
  size_bytes: number;
  row_count: number;
  registered: boolean;
}

export async function runRelease(
  opts: { useFixture?: boolean; version?: string; outDir?: string } = {}
): Promise<ReleaseResult> {
  const baseUrl = process.env.BASE_URL;
  const adminSecret = process.env.ADMIN_SECRET;
  if (!baseUrl) throw new Error("BASE_URL env var is required");
  if (!adminSecret) throw new Error("ADMIN_SECRET env var is required");

  const version = opts.version ?? process.env.TARES_VERSION ?? todayVersion();
  const outDir = opts.outDir ?? "./data/tares";
  const useFixture = opts.useFixture ?? process.env.USE_FIXTURE === "1";

  console.log(`[release] TARES version ${version} targeting ${baseUrl}`);

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // 1. Ingest
  let rows;
  if (useFixture) {
    const fixturePath = "./etl/tares/fixtures/sample-5-rows.json";
    rows = ingestFromFixture(fixturePath);
    console.log(`[release] ingested ${rows.length} rows from fixture ${fixturePath}`);
  } else {
    const cacheDir = join(outDir, "bazg-cache");
    console.log(`[release] ingesting from BAZG XLSX (cache=${cacheDir})...`);
    const result = await ingestFromBazg({ cacheDir });
    rows = result.rows;
    console.log(`[release] ingested ${rows.length} rows from BAZG. stats=${JSON.stringify(result.stats)}`);
  }

  // 2. Generate embeddings (Phase 1 / T1) — one vector per HS8, FR description.
  // Skippable via `SKIP_EMBEDDINGS=1` for fast iteration; production releases must
  // ship them so AI agents can do semantic search client-side without recomputing.
  let embeddings: Awaited<ReturnType<typeof generateTaresEmbeddings>> | undefined;
  if (process.env.SKIP_EMBEDDINGS === "1") {
    console.log(`[release] SKIP_EMBEDDINGS=1, skipping embedding generation`);
  } else {
    const cachePath = join(outDir, "embeddings-cache-fr.json");
    console.log(`[release] generating TARES embeddings (model=${TARES_EMBEDDING_MODEL}, ${TARES_EMBEDDING_DIMENSIONS}d, lang=fr, cache=${cachePath})...`);
    const t0 = Date.now();
    embeddings = await generateTaresEmbeddings(rows, { cachePath });
    console.log(
      `[release] generated ${embeddings.length} embeddings in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  }

  // 3. Build bundle
  console.log(`[release] building bundle...`);
  const bundle = await buildBundle(rows, version, outDir, { embeddings });
  console.log(
    `[release] bundle: ${bundle.zipPath} (${(bundle.sizeBytes / 1024).toFixed(1)} KB, sha256 ${bundle.sha256.slice(0, 12)}..., ${bundle.rowCount} rows${embeddings ? `, ${embeddings.length} embeddings` : ""})`
  );

  // 4. Upload to R2
  const r2_key = `tares/${version}/tares.zip`;
  console.log(`[release] uploading to R2 key ${r2_key}...`);
  await uploadZip(bundle.zipPath, r2_key);
  console.log(`[release] uploaded to r2://${process.env.R2_BUCKET ?? "?"}/${r2_key}`);

  // 5. Register via admin endpoint
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/admin/release`;
  console.log(`[release] POST ${endpoint} ...`);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-secret": adminSecret,
    },
    body: JSON.stringify({
      dataset_id: "tares",
      version,
      r2_key,
      sha256: bundle.sha256,
      size_bytes: bundle.sizeBytes,
      changelog: `TARES v${version} — ${bundle.rowCount} rows (fixture)`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`admin release failed: HTTP ${res.status} — ${body}`);
  }
  const payload = await res.json();
  console.log(`[release] registered in DB: ${JSON.stringify(payload)}`);
  console.log(`[release] ✅ TARES ${version} released.`);

  return {
    version,
    r2_key,
    sha256: bundle.sha256,
    size_bytes: bundle.sizeBytes,
    row_count: bundle.rowCount,
    registered: true,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRelease().catch((err) => {
    console.error("[release] ERROR:", err);
    process.exit(1);
  });
}
