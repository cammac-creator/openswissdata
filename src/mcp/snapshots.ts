/**
 * Dataset snapshots — write side (powers the MCP history tools
 * `tariff_changelog` and `entity_history`).
 *
 * Each dated release we publish to R2 is a durable point-in-time record. By
 * snapshotting per-entity, per-field values at every version we build a
 * timeline that the official sources do NOT expose (xtares.admin.ch and
 * finma.ch only serve the CURRENT state) — an irreplicable moat.
 *
 * Storage model: FULL snapshot per version (one row per entity × tracked
 * field × version). Chosen over delta because:
 *   - the read tools diff consecutive versions and expect every tracked field
 *     present in every version (a missing field would read as a spurious
 *     change to null);
 *   - each version's rows are SELF-CONTAINED → writes are idempotent AND
 *     order-independent (backfill and the live hook can run in any order,
 *     `INSERT OR IGNORE` on the UNIQUE key dedupes).
 * Volume is bounded and small at our horizon; retention/pruning is a deferred
 * follow-up if the dataset ever grows hot.
 *
 * This lives in `src/` (not `etl/`, which is not compiled into the deploy
 * artifact) so the live refresh hook and the admin backfill endpoint can use
 * it on Railway. The legacy CLI `etl/shared/snapshot.ts` predates this and is
 * dev-only (it shells out to `unzip`, absent from the prod container).
 *
 * IMPORTANT: the field lists below MUST stay in sync with the `TRACKED_FIELDS`
 * in `tools/tariff-changelog.ts` and `tools/entity-history.ts` (the read side).
 */
import type Database from "better-sqlite3";

export type SnapshotDataset = "tares" | "finma";

/** Fields tracked for TARES — mirrors tariff-changelog.ts TRACKED_FIELDS. */
export const TARES_SNAPSHOT_FIELDS = [
  "duty_mfn_value",
  "duty_mfn_unit",
  "duty_mfn_currency",
  "designation_fr",
  "valid_from",
] as const;

/** Fields tracked for FINMA — mirrors entity-history.ts TRACKED_FIELDS. */
export const FINMA_SNAPSHOT_FIELDS = [
  "name",
  "licence_type",
  "status",
  "canton",
  "city",
  "is_warning_listed",
] as const;

export interface SnapshotRow {
  dataset_id: string;
  version: string;
  entity_key: string;
  field: string;
  value: string | null;
  recorded_at: number;
}

/**
 * Deterministic entity key per dataset. TARES → HS8 code; FINMA → Swiss UID,
 * with a name-based synthetic fallback for the rare rows without a UID (kept
 * identical to the read tools' expectation: they key FINMA by `uid`).
 */
function entityKey(dataset: SnapshotDataset, row: Record<string, string>): string | null {
  if (dataset === "tares") {
    return row.hs8 || null;
  }
  const uid = row.uid || row.UID || "";
  const name = row.name || "";
  if (!uid && !name) return null;
  return uid || `name:${name}`;
}

function fieldsFor(dataset: SnapshotDataset): readonly string[] {
  return dataset === "tares" ? TARES_SNAPSHOT_FIELDS : FINMA_SNAPSHOT_FIELDS;
}

/** Columns a slice MUST contain to be snapshotted (entity key + tracked fields). */
const REQUIRED_COLUMNS: Record<SnapshotDataset, readonly string[]> = {
  tares: ["hs8", ...TARES_SNAPSHOT_FIELDS],
  finma: ["uid", ...FINMA_SNAPSHOT_FIELDS],
};

/**
 * Guard against schema drift across historical slices. csv-parse with
 * `columns:true` returns `undefined` for a column ABSENT from the header — which
 * `buildSnapshotRows` would otherwise store as `null`, fabricating a spurious
 * "field changed to ∅" for every entity at that version boundary (the read
 * tools diff consecutive versions). Real case: `tares-2026.04.23.zip` carries
 * `duty_mfn_chf_per_100kg` instead of `duty_mfn_value/_unit/_currency`. So we
 * refuse to snapshot any version whose slice is missing a tracked column.
 */
export function checkColumns(
  dataset: SnapshotDataset,
  rows: Array<Record<string, string>>,
): { ok: boolean; missing: string[] } {
  if (rows.length === 0) return { ok: true, missing: [] };
  const keys = new Set(Object.keys(rows[0]));
  const missing = REQUIRED_COLUMNS[dataset].filter((c) => !keys.has(c));
  return { ok: missing.length === 0, missing };
}

/** Build the full set of snapshot rows for one dataset version from parsed CSV rows. */
export function buildSnapshotRows(
  dataset: SnapshotDataset,
  version: string,
  recordedAt: number,
  rows: Array<Record<string, string>>,
): SnapshotRow[] {
  const fields = fieldsFor(dataset);
  const out: SnapshotRow[] = [];
  for (const row of rows) {
    const key = entityKey(dataset, row);
    if (!key) continue;
    for (const field of fields) {
      const raw = row[field];
      out.push({
        dataset_id: dataset,
        version,
        entity_key: key,
        field,
        value: raw === undefined || raw === "" ? null : raw,
        recorded_at: recordedAt,
      });
    }
  }
  return out;
}

/** Chunked, idempotent insert (INSERT OR IGNORE on the UNIQUE key). */
export function insertSnapshots(
  db: Database.Database,
  rows: SnapshotRow[],
): { inserted: number; skipped: number } {
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
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    txn(rows.slice(i, i + CHUNK));
  }
  return { inserted, skipped: rows.length - inserted };
}

/** released_at for a version (from the `versions` table), or `now` if absent. */
export function getReleasedAt(db: Database.Database, dataset: SnapshotDataset, version: string): number {
  const row = db
    .prepare("SELECT released_at FROM versions WHERE dataset_id = ? AND version = ?")
    .get(dataset, version) as { released_at: number } | undefined;
  return row?.released_at ?? Date.now();
}

/**
 * Snapshot one dataset version from already-parsed rows. Used by the live
 * refresh hook (reusing rows already downloaded by C2) and by the backfill.
 */
export function snapshotFromRows(
  db: Database.Database,
  dataset: SnapshotDataset,
  version: string,
  recordedAt: number,
  rows: Array<Record<string, string>>,
): { inserted: number; skipped: number; entities: number } {
  const cols = checkColumns(dataset, rows);
  if (!cols.ok) {
    throw new Error(
      `${dataset} ${version}: schema drift — slice missing tracked column(s) [${cols.missing.join(", ")}]; refusing to snapshot (would fabricate false changes)`,
    );
  }
  const snapshotRows = buildSnapshotRows(dataset, version, recordedAt, rows);
  const { inserted, skipped } = insertSnapshots(db, snapshotRows);
  const entities = new Set(snapshotRows.map((r) => r.entity_key)).size;
  return { inserted, skipped, entities };
}
