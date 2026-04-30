/**
 * Snapshot ingestion script — Phase 2 V2 / B.3
 *
 * Extracts per-entity, per-field snapshots from a dataset release ZIP and
 * stores them in `dataset_snapshots` to power the MCP "history" tools
 * (`tariff_changelog`, `entity_history`).
 *
 * Why this exists:
 *   - Official sources (xtares.admin.ch, finma.ch/uid.csv) only serve the
 *     CURRENT version. A scraper or competitor cannot reconstruct the
 *     historical timeline. We can — every dated release ZIP we publish to
 *     R2 is the durable source of truth.
 *   - Backfilling once and snapshotting at each future release builds an
 *     irreplicable moat (12-24 months rolling window).
 *
 * Usage (CLI):
 *   tsx etl/shared/snapshot.ts --dataset tares --version 2026.04.30
 *   tsx etl/shared/snapshot.ts --dataset finma --version 2026.04.30.1
 *
 * Source order for the ZIP:
 *   1. Local file `data/<dataset>/<dataset>-<version>.zip` (fast path)
 *   2. R2 key `<dataset>/<version>/<dataset>.zip` (download to /tmp)
 *
 * Idempotent: re-running with the same dataset+version is a no-op
 * (UNIQUE(dataset_id, version, entity_key, field) + INSERT OR IGNORE).
 *
 * NOTE: Classifications snapshots are intentionally skipped (NOGA codes
 * change rarely → low value-add for changelog history).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import { parse } from "csv-parse/sync";
import type Database from "better-sqlite3";
import { getDb } from "../../src/lib/db.js";
import { signedDownloadUrl } from "../../src/lib/r2.js";

// ---------------------------------------------------------------------
// Field selection per dataset
// ---------------------------------------------------------------------
//
// We only snapshot fields that:
//   1. Change over time (stable join keys excluded)
//   2. Carry meaningful diff value for an end-user / agent
//
// Exhaustive snapshots would 10x the row count for marginal value.

const TARES_FIELDS = [
  "duty_mfn_value",
  "duty_mfn_unit",
  "duty_mfn_currency",
  "designation_fr",
  "valid_from",
] as const;

const FINMA_FIELDS = [
  "name",
  "licence_type",
  "status",
  "canton",
  "city",
  "is_warning_listed",
] as const;

// ---------------------------------------------------------------------
// ZIP extraction (relies on the system `unzip` binary — Node has no
// stdlib reader; adding `adm-zip` as a runtime dep is overkill for a
// CLI we run a handful of times per month).
// ---------------------------------------------------------------------

function extractCsvFromZip(zipPath: string, csvName: string): string {
  if (!existsSync(zipPath)) throw new Error(`ZIP not found: ${zipPath}`);
  const out = execSync(`unzip -p "${zipPath}" "${csvName}"`);
  if (out.length === 0) throw new Error(`Empty extract for ${csvName} in ${zipPath}`);
  return out.toString("utf8");
}

// ---------------------------------------------------------------------
// ZIP discovery — local first, R2 fallback
// ---------------------------------------------------------------------

async function locateZip(dataset: string, version: string): Promise<string> {
  const localPath = `./data/${dataset}/${dataset}-${version}.zip`;
  if (existsSync(localPath)) {
    console.log(`[snapshot] using local ZIP: ${localPath}`);
    return localPath;
  }

  const r2Key = `${dataset}/${version}/${dataset}.zip`;
  console.log(`[snapshot] local ZIP missing, fetching from R2: ${r2Key}`);
  const url = await signedDownloadUrl(r2Key, 300);
  const tmpPath = join(tmpdir(), `${dataset}-${version}-${Date.now()}.zip`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`R2 fetch failed: HTTP ${res.status} for ${r2Key}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(tmpPath, buf);
  console.log(`[snapshot] downloaded ${(buf.length / 1024).toFixed(1)} KB → ${tmpPath}`);
  return tmpPath;
}

// ---------------------------------------------------------------------
// Released-at lookup — uses the `versions` table (registered by
// /api/admin/release). Falls back to "now" if the row is missing
// (fresh DB / first run before any release was registered).
// ---------------------------------------------------------------------

function getReleasedAt(db: Database.Database, datasetId: string, version: string): number {
  const row = db
    .prepare("SELECT released_at FROM versions WHERE dataset_id = ? AND version = ?")
    .get(datasetId, version) as { released_at: number } | undefined;
  if (row) return row.released_at;
  console.warn(
    `[snapshot] WARNING: no row in versions table for ${datasetId}@${version}, using current time as recorded_at`,
  );
  return Date.now();
}

// ---------------------------------------------------------------------
// Insert helper — chunked transactions, idempotent.
// ---------------------------------------------------------------------

interface SnapshotRow {
  dataset_id: string;
  version: string;
  entity_key: string;
  field: string;
  value: string | null;
  recorded_at: number;
}

function insertSnapshots(db: Database.Database, rows: SnapshotRow[]): { inserted: number; skipped: number } {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO dataset_snapshots
       (dataset_id, version, entity_key, field, value, recorded_at)
     VALUES (@dataset_id, @version, @entity_key, @field, @value, @recorded_at)`,
  );
  let inserted = 0;
  const txn = db.transaction((batch: SnapshotRow[]) => {
    for (const r of batch) {
      const info = stmt.run(r);
      if (info.changes > 0) inserted++;
    }
  });
  // Chunk to keep the transaction memory bounded
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    txn(rows.slice(i, i + CHUNK));
  }
  return { inserted, skipped: rows.length - inserted };
}

// ---------------------------------------------------------------------
// TARES snapshot
// ---------------------------------------------------------------------

export async function snapshotTares(
  version: string,
  opts: { db?: Database.Database; localCsv?: string } = {},
): Promise<{ inserted: number; skipped: number; rowCount: number }> {
  const db = opts.db ?? getDb();
  let csv: string;
  if (opts.localCsv) {
    csv = readFileSync(opts.localCsv, "utf8");
    console.log(`[snapshot:tares] reading local CSV: ${opts.localCsv}`);
  } else {
    const zipPath = await locateZip("tares", version);
    csv = extractCsvFromZip(zipPath, "tares.csv");
  }

  const rows = parse(csv, { columns: true, skip_empty_lines: true, relax_quotes: true }) as Record<
    string,
    string
  >[];
  console.log(`[snapshot:tares] parsed ${rows.length} TARES rows`);

  const recordedAt = getReleasedAt(db, "tares", version);
  const snapshots: SnapshotRow[] = [];
  for (const row of rows) {
    const hs8 = row.hs8;
    if (!hs8) continue;
    for (const field of TARES_FIELDS) {
      const raw = row[field];
      const value = raw === undefined || raw === "" ? null : raw;
      snapshots.push({
        dataset_id: "tares",
        version,
        entity_key: hs8,
        field,
        value,
        recorded_at: recordedAt,
      });
    }
  }
  console.log(`[snapshot:tares] preparing ${snapshots.length} snapshot rows...`);
  const result = insertSnapshots(db, snapshots);
  console.log(
    `[snapshot:tares] done: inserted=${result.inserted}, skipped=${result.skipped} (already present)`,
  );
  return { ...result, rowCount: rows.length };
}

// ---------------------------------------------------------------------
// FINMA snapshot
// ---------------------------------------------------------------------

export async function snapshotFinma(
  version: string,
  opts: { db?: Database.Database; localCsv?: string } = {},
): Promise<{ inserted: number; skipped: number; rowCount: number }> {
  const db = opts.db ?? getDb();
  let csv: string;
  if (opts.localCsv) {
    csv = readFileSync(opts.localCsv, "utf8");
    console.log(`[snapshot:finma] reading local CSV: ${opts.localCsv}`);
  } else {
    const zipPath = await locateZip("finma", version);
    csv = extractCsvFromZip(zipPath, "finma_registry.csv");
  }

  const rows = parse(csv, { columns: true, skip_empty_lines: true, relax_quotes: true }) as Record<
    string,
    string
  >[];
  console.log(`[snapshot:finma] parsed ${rows.length} FINMA registry rows`);

  const recordedAt = getReleasedAt(db, "finma", version);
  const snapshots: SnapshotRow[] = [];
  let withUid = 0;
  for (const row of rows) {
    // Entity key must be deterministic. Prefer UID; fall back to a name-based
    // synthetic key for entities without a UID (rare but present in raw data).
    const uid = row.uid || row.UID || "";
    const name = row.name || "";
    if (!uid && !name) continue;
    const key = uid || `name:${name}`;
    if (uid) withUid++;
    for (const field of FINMA_FIELDS) {
      const raw = row[field];
      const value = raw === undefined || raw === "" ? null : raw;
      snapshots.push({
        dataset_id: "finma",
        version,
        entity_key: key,
        field,
        value,
        recorded_at: recordedAt,
      });
    }
  }
  console.log(
    `[snapshot:finma] preparing ${snapshots.length} snapshot rows (${withUid} entities with UID)...`,
  );
  const result = insertSnapshots(db, snapshots);
  console.log(
    `[snapshot:finma] done: inserted=${result.inserted}, skipped=${result.skipped} (already present)`,
  );
  return { ...result, rowCount: rows.length };
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

function parseArgs(argv: string[]): { dataset: string; version: string; localCsv?: string } {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (!val || val.startsWith("--")) throw new Error(`--${key} requires a value`);
      out[key] = val;
      i++;
    }
  }
  if (!out.dataset) throw new Error("--dataset is required (tares | finma)");
  if (!out.version) throw new Error("--version is required (e.g. 2026.04.30)");
  return out as { dataset: string; version: string; localCsv?: string };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[snapshot] dataset=${args.dataset} version=${args.version}`);

  if (args.dataset === "tares") {
    await snapshotTares(args.version, { localCsv: args.localCsv });
  } else if (args.dataset === "finma") {
    await snapshotFinma(args.version, { localCsv: args.localCsv });
  } else if (args.dataset === "classifications") {
    console.log(
      "[snapshot] classifications: skipped intentionally (NOGA codes change rarely, low value for changelog).",
    );
    return;
  } else {
    throw new Error(`Unknown dataset: ${args.dataset}`);
  }

  console.log(`[snapshot] OK`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[snapshot] ERROR:", err);
    process.exit(1);
  });
}
