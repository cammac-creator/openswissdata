/**
 * MCP data freshness — refresh the in-memory FINMA slices from the current R2
 * ZIP, WITHOUT redeploy and WITHOUT breaking the synchronous tool API.
 *
 * Why this exists
 * ---------------
 * The MCP tools read bundled CSV slices (`src/mcp/data/*.csv`) via the SYNC
 * getters in `data-loader.ts`. Those CSVs are committed and frozen — they only
 * change on redeploy. Meanwhile the daily FINMA ETL (GitHub Actions) publishes
 * a fresh ZIP to R2 and points `datasets.current_version` at it. So the paid
 * MCP served stale (April) FINMA data while R2/DB were current.
 *
 * This engine closes that gap: at boot, after each `/api/admin/release`, and on
 * a 12 h safety timer, it pulls the current FINMA ZIP from R2, extracts the
 * registry + warnings slices, validates them, and hot-swaps the in-memory maps.
 * The getters stay synchronous → the 7 sync tools are untouched.
 *
 * Design invariants (the dangerous part is serving WRONG data, not crashing):
 *   - VERSION-GATED: skip entirely unless `datasets.current_version` moved since
 *     the loaded version. The timer is then just a cheap DB read; TARES (cron
 *     disabled) never re-downloads.
 *   - ALL-OR-NOTHING per dataset: registry + warnings are fetched, parsed AND
 *     validated before EITHER is swapped. A partial failure keeps the last-good
 *     (or the April seed) — never a half-fresh, inconsistent registry/warnings.
 *   - FIRE-AND-FORGET SAFE: never throws to the caller, never blocks the request
 *     path, never fails a release. All R2 work happens off the hot path.
 *   - OBSERVABLE: `getMcpFreshness()` exposes loaded vs current version so stale
 *     state is visible in /admin instead of served silently (the C1→C2 honesty
 *     thread — honest freshness, data-side this time).
 *
 * Scope: FINMA only — it is the only dataset whose cron runs daily. TARES (cron
 * disabled) and classifications (annual) would refresh by the same mechanism if
 * their `current_version` ever advanced, but are intentionally not configured
 * here. Embeddings (frozen by design) and STATENT (deprecated) are out of scope.
 */
import { createHash } from "node:crypto";
import yauzl from "yauzl";
import { parse } from "csv-parse/sync";
import { getDb } from "../lib/db.js";
import { getObjectBuffer } from "../lib/r2.js";
import {
  setFinmaRegistry,
  setFinmaWarnings,
  type FinmaRegistryRow,
  type FinmaWarningRow,
} from "./data-loader.js";
import { snapshotFromRows } from "./snapshots.js";

export interface FreshnessState {
  /** Dataset version currently held in the in-memory maps (null = seed only). */
  loadedVersion: string | null;
  /** Epoch ms of the last *successful* swap. */
  lastRefreshAt: number | null;
  /** Epoch ms of the last attempt (success, skip or failure). */
  lastAttemptAt: number | null;
  /** Last error message, or null if the last attempt succeeded/skipped. */
  lastError: string | null;
}

const freshness: Record<"finma", FreshnessState> = {
  finma: { loadedVersion: null, lastRefreshAt: null, lastAttemptAt: null, lastError: null },
};

/**
 * Snapshot of freshness for /admin: per dataset, the loaded version vs the
 * current DB version and a `stale` flag (loaded ≠ current). Read-only; never
 * throws.
 */
export function getMcpFreshness(): Record<string, FreshnessState & { currentVersion: string | null; stale: boolean; onSeed: boolean }> {
  const out: Record<string, FreshnessState & { currentVersion: string | null; stale: boolean; onSeed: boolean }> = {};
  let db: ReturnType<typeof getDb> | null = null;
  try {
    db = getDb();
  } catch {
    db = null;
  }
  for (const id of Object.keys(freshness) as (keyof typeof freshness)[]) {
    let currentVersion: string | null = null;
    if (db) {
      try {
        const row = db.prepare("SELECT current_version FROM datasets WHERE id=?").get(id) as
          | { current_version: string | null }
          | undefined;
        currentVersion = row?.current_version ?? null;
      } catch {
        currentVersion = null;
      }
    }
    const s = freshness[id];
    out[id] = {
      ...s,
      currentVersion,
      // `onSeed`: we are still serving the committed April CSV, never swapped.
      onSeed: s.loadedVersion === null,
      // `stale` must NOT lie when we're stuck on the seed after a *failed*
      // attempt (the C1 sin, data-side): loadedVersion stays null forever if R2
      // is down / creds rotated, yet the DB has a fresh version. So stale is
      // true whenever the loaded version differs from current AND we have
      // actually attempted at least once. Before the first attempt (true boot
      // grace, lastAttemptAt === null) it stays false.
      stale: currentVersion != null && s.loadedVersion !== currentVersion && s.lastAttemptAt !== null,
    };
  }
  return out;
}

/** Extract a single file (by basename) from an in-memory ZIP buffer. */
export function extractCsvFromZip(zipBuf: Buffer, basename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("zip open failed"));
      let resolved = false;
      zip.on("entry", (entry) => {
        if (entry.fileName.split("/").pop() === basename) {
          zip.openReadStream(entry, (e, rs) => {
            if (e || !rs) return reject(e ?? new Error("zip read stream failed"));
            const parts: Buffer[] = [];
            rs.on("data", (d: Buffer) => parts.push(d));
            rs.on("end", () => {
              resolved = true;
              resolve(Buffer.concat(parts).toString("utf8"));
            });
            rs.on("error", reject);
          });
        } else {
          zip.readEntry();
        }
      });
      zip.on("error", reject);
      zip.on("end", () => {
        if (!resolved) reject(new Error(`${basename} not found in ZIP`));
      });
      zip.readEntry();
    });
  });
}

function parseCsv<T>(text: string): T[] {
  return parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true }) as T[];
}

// Validation thresholds — guard against truncated/empty/garbage downloads. The
// April seed has ~2912 registry / ~2182 warnings rows; a legitimate update is
// ±tens. A floor well under the seed catches truncation without false alarms.
const FINMA_REGISTRY_MIN_ROWS = 2000;
const FINMA_WARNINGS_MIN_ROWS = 1500;
const REGISTRY_REQUIRED_COLS = ["name", "uid", "licence_type", "status", "is_warning_listed"];
const WARNINGS_REQUIRED_COLS = ["name", "category", "source_list", "warning_type"];

function validateRows<T extends object>(
  rows: T[],
  minRows: number,
  requiredCols: string[],
  label: string,
): void {
  if (!Array.isArray(rows) || rows.length < minRows) {
    throw new Error(`${label}: ${rows?.length ?? 0} rows (< ${minRows}) — refusing swap`);
  }
  const cols = Object.keys(rows[0] ?? {});
  for (const col of requiredCols) {
    if (!cols.includes(col)) throw new Error(`${label}: missing required column '${col}'`);
  }
}

// Wall-clock ceiling for the whole R2 fetch. Belt-and-suspenders on top of the
// AbortController inside getObjectBuffer: guarantees the refresh promise ALWAYS
// settles, so the in-flight latch below can never wedge permanently.
const R2_FETCH_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// Coalesce concurrent calls (boot + release + timer can race). `_inFlight`
// holds the running promise; `_rerun` is the trailing-edge flag: a call that
// arrives DURING a run requests one more pass once it finishes, so a release
// that lands mid-download is never swallowed (it re-reads current_version and
// catches the newer version). Awaiting the returned promise awaits all passes.
let _inFlight: Promise<void> | null = null;
let _rerun = false;

/**
 * Refresh the FINMA in-memory slices from the current R2 ZIP. Safe to call
 * unconditionally and concurrently: version-gated, all-or-nothing, never throws.
 */
export function refreshFinmaFromR2(): Promise<void> {
  if (_inFlight) {
    _rerun = true;
    return _inFlight;
  }
  _inFlight = (async () => {
    do {
      _rerun = false;
      await doRefreshFinma();
    } while (_rerun);
  })().finally(() => {
    _inFlight = null;
  });
  return _inFlight;
}

async function doRefreshFinma(): Promise<void> {
  const state = freshness.finma;
  state.lastAttemptAt = Date.now();
  try {
    // No R2 creds (tests / local without env) → nothing to do, stay on seed.
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_BUCKET) {
      state.lastError = "r2 credentials not configured";
      return;
    }

    const db = getDb();
    const ds = db.prepare("SELECT current_version FROM datasets WHERE id='finma'").get() as
      | { current_version: string | null }
      | undefined;
    const version = ds?.current_version ?? null;
    if (!version) {
      state.lastError = "no finma current_version in DB";
      return;
    }
    // VERSION-GATE: nothing new to load.
    if (version === state.loadedVersion) {
      state.lastError = null;
      return;
    }
    const ver = db
      .prepare("SELECT r2_key, sha256, size_bytes, released_at FROM versions WHERE dataset_id='finma' AND version=?")
      .get(version) as { r2_key: string; sha256: string; size_bytes: number; released_at: number } | undefined;
    if (!ver?.r2_key) {
      state.lastError = `no r2_key for finma ${version}`;
      return;
    }

    // Download (bounded by the known size + margin → OOM guard, timed out so it
    // always settles). Then verify the ZIP bytes against the sha256 recorded at
    // release time BEFORE unzipping — a tampered/corrupted object at the same
    // key (or a wrong key) is rejected instead of served as authentic FINMA
    // data. THEN extract + parse + validate BOTH slices before swapping EITHER.
    const maxBytes = Number.isFinite(ver.size_bytes) && ver.size_bytes > 0
      ? ver.size_bytes + 1_000_000
      : undefined;
    const zipBuf = await withTimeout(
      getObjectBuffer(ver.r2_key, { maxBytes }),
      R2_FETCH_TIMEOUT_MS,
      "r2 getObjectBuffer",
    );

    if (ver.sha256) {
      const actual = createHash("sha256").update(zipBuf).digest("hex");
      if (actual !== ver.sha256.toLowerCase()) {
        throw new Error(
          `finma ${version}: sha256 mismatch (got ${actual.slice(0, 12)}…, expected ${ver.sha256.slice(0, 12)}…) — refusing swap`,
        );
      }
    }

    const [registryText, warningsText] = await Promise.all([
      extractCsvFromZip(zipBuf, "finma_registry.csv"),
      extractCsvFromZip(zipBuf, "finma_warnings.csv"),
    ]);
    const registry = parseCsv<FinmaRegistryRow>(registryText);
    const warnings = parseCsv<FinmaWarningRow>(warningsText);
    validateRows(registry, FINMA_REGISTRY_MIN_ROWS, REGISTRY_REQUIRED_COLS, "finma_registry");
    validateRows(warnings, FINMA_WARNINGS_MIN_ROWS, WARNINGS_REQUIRED_COLS, "finma_warnings");

    // Atomic swap (two reference reassignments, no await between them).
    setFinmaRegistry(registry);
    setFinmaWarnings(warnings);
    state.loadedVersion = version;
    state.lastRefreshAt = Date.now();
    state.lastError = null;
    console.log(
      `[mcp-refresh] finma → ${version} (registry ${registry.length} rows, warnings ${warnings.length} rows)`,
    );

    // Best-effort history snapshot for tariff_changelog / entity_history. Reuses
    // the registry rows we just parsed (no second download). ISOLATED in its own
    // try/catch: a snapshot failure must NEVER mark the refresh as failed (the
    // swap already succeeded above). Idempotent (INSERT OR IGNORE per version).
    try {
      const recordedAt = ver.released_at || Date.now();
      const snap = snapshotFromRows(
        db,
        "finma",
        version,
        recordedAt,
        registry as unknown as Array<Record<string, string>>,
      );
      if (snap.inserted > 0) {
        console.log(`[mcp-snapshot] finma ${version}: +${snap.inserted} rows (${snap.entities} entities)`);
      }
    } catch (e) {
      console.error(
        `[mcp-snapshot] finma ${version} snapshot failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } catch (e) {
    // Keep last-good (or seed). Never propagate — this runs off the hot path.
    state.lastError = e instanceof Error ? e.message : String(e);
    console.error(`[mcp-refresh] finma refresh failed, keeping last-good: ${state.lastError}`);
  }
}

const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 h safety net
let _timer: ReturnType<typeof setInterval> | null = null;

/**
 * Kick the boot refresh (fire-and-forget) and arm the 12 h safety timer.
 * Idempotent. Called only from the server entrypoint (not in tests).
 */
export function startMcpDataRefresh(): void {
  void refreshFinmaFromR2();
  if (!_timer) {
    _timer = setInterval(() => void refreshFinmaFromR2(), REFRESH_INTERVAL_MS);
    // Don't keep the event loop alive just for the timer.
    _timer.unref?.();
  }
}

/** Test helper: reset freshness + in-flight state between cases. */
export function _resetFreshnessForTest(): void {
  freshness.finma = { loadedVersion: null, lastRefreshAt: null, lastAttemptAt: null, lastError: null };
  _inFlight = null;
  _rerun = false;
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
