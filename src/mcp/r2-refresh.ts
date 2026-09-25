/**
 * Archives or FINMA et TARES dans R2 → lecture bornée et vérifiée → cartes MCP en mémoire.
 * Reprise au démarrage, après publication et toutes les douze heures. Chaque jeu
 * garde sa dernière version complète en cas d'échec ; état consultable dans le CRM.
 * Les trois jeux restent indépendants. Les embeddings ne sont pas actualisés ici.
 */
import { createHash } from "node:crypto";
import yauzl from "yauzl";
import { parse } from "csv-parse/sync";
import { getDb } from "../lib/db.js";
import { readTaresArchive, readDatasetArchive } from "../lib/tares-archive.js";
import { getObjectBuffer } from "../lib/r2.js";
import {
  setFinmaRegistry,
  setFinmaWarnings,
  setTares,
  setClassificationLinks,
  type TaresRow,
  type FinmaRegistryRow,
  type FinmaWarningRow,
} from "./data-loader.js";
import { CLASSIFICATION_SCHEMES, isDocumentedOfsIdentity, type ClassificationLink, type ClassificationSource } from "../lib/classification-links.js";
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

const freshness: Record<"finma" | "tares" | "classifications", FreshnessState> = {
  finma: { loadedVersion: null, lastRefreshAt: null, lastAttemptAt: null, lastError: null },
  tares: { loadedVersion: null, lastRefreshAt: null, lastAttemptAt: null, lastError: null },
  classifications: { loadedVersion: null, lastRefreshAt: null, lastAttemptAt: null, lastError: null },
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
export function extractCsvFromZip(zipBuf: Buffer, basename: string, maxBytes = 30_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("zip open failed"));
      let resolved = false;
      zip.on("entry", (entry) => {
        if (entry.fileName.split("/").pop() === basename) {
          if (entry.uncompressedSize > maxBytes) { zip.close(); return reject(new Error(`Fichier ZIP trop volumineux : ${basename}`)); }
          zip.openReadStream(entry, (e, rs) => {
            if (e || !rs) return reject(e ?? new Error("zip read stream failed"));
            const parts: Buffer[] = [];
            let size = 0;
            rs.on("data", (d: Buffer) => {
              size += d.length;
              if (size > maxBytes) { rs.destroy(); zip.close(); reject(new Error(`Fichier ZIP trop volumineux : ${basename}`)); return; }
              parts.push(d);
            });
            rs.on("end", () => {
              resolved = true;
              zip.close();
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
let taresFlight: Promise<void> | null = null;
let taresAgain = false;

/** TARES suit aussi la version vendue ; aucun remplacement partiel en cas d'échec. */
export function refreshTaresFromR2(): Promise<void> {
  if (taresFlight) { taresAgain = true; return taresFlight; }
  taresFlight = (async () => {
    do {
      taresAgain = false;
      const state = freshness.tares;
      state.lastAttemptAt = Date.now();
      try {
        if (!process.env.R2_ACCOUNT_ID || !process.env.R2_BUCKET) throw new Error("Accès R2 non configuré");
        const db = getDb();
        const current = () => (db.prepare("SELECT current_version FROM datasets WHERE id='tares'").get() as { current_version?: string } | undefined)?.current_version;
        const version = current();
        if (!version) throw new Error("Version TARES absente");
        if (version === state.loadedVersion) { state.lastError = null; continue; }
        const info = db.prepare("SELECT r2_key,sha256,size_bytes,released_at FROM versions WHERE dataset_id='tares' AND version=?").get(version) as
          { r2_key: string; sha256: string; size_bytes: number; released_at: number } | undefined;
        if (!info || !/^[a-f0-9]{64}$/.test(info.sha256) || info.size_bytes <= 0 || info.size_bytes > 100_000_000) throw new Error("Métadonnées TARES invalides");
        const bytes = await withTimeout(readTaresArchive(info), R2_FETCH_TIMEOUT_MS, "Lecture TARES");
        if (bytes.length !== info.size_bytes || createHash("sha256").update(bytes).digest("hex") !== info.sha256) throw new Error("Empreinte TARES invalide");
        const rows = parseCsv<TaresRow>(await extractCsvFromZip(bytes, "tares.csv"));
        validateRows(rows, 6_000, ["hs8", "designation_fr", "duty_mfn_value", "duty_rates_count"], "TARES");
        if (rows.length > 10_000 || new Set(rows.map(r => r.hs8)).size !== rows.length || rows.some(r => !/^\d{8}$/.test(r.hs8) || !r.designation_fr || !Number.isInteger(Number(r.duty_rates_count)) || Number(r.duty_rates_count) <= 0)) throw new Error("Lignes TARES invalides");
        if (current() !== version) { taresAgain = true; continue; }
        setTares(rows, version); state.loadedVersion = version; state.lastRefreshAt = Date.now(); state.lastError = null;
        console.log(`[mcp-refresh] TARES ${version} : ${rows.length} codes`);
        try { snapshotFromRows(db, "tares", version, info.released_at, rows as unknown as Record<string, string>[]); }
        catch { console.error("[mcp-snapshot] Instantané TARES non enregistré ; données courantes chargées"); }
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : "Échec TARES";
        console.error(`[mcp-refresh] TARES conservé : ${state.lastError}`);
      }
    } while (taresAgain);
  })().finally(() => { taresFlight = null; });
  return taresFlight;
}

let classificationsFlight: Promise<void> | null = null;
let classificationsAgain = false;

/** Les relations et leurs sources suivent la version vendue, sans chaînage implicite. */
export function refreshClassificationsFromR2(): Promise<void> {
  if (classificationsFlight) { classificationsAgain = true; return classificationsFlight; }
  classificationsFlight = (async () => {
    do {
      classificationsAgain = false;
      const state = freshness.classifications; state.lastAttemptAt = Date.now();
      try {
        if (!process.env.R2_ACCOUNT_ID || !process.env.R2_BUCKET) throw new Error("Accès R2 non configuré");
        const db = getDb();
        const current = () => (db.prepare("SELECT current_version FROM datasets WHERE id='classifications'").get() as {current_version?:string}|undefined)?.current_version;
        const version = current();
        if (!version) throw new Error("Version classifications absente");
        if (version === state.loadedVersion) { state.lastError = null; continue; }
        const info = db.prepare("SELECT r2_key,sha256,size_bytes FROM versions WHERE dataset_id='classifications' AND version=?").get(version) as {r2_key:string;sha256:string;size_bytes:number}|undefined;
        if (!info) throw new Error("Métadonnées classifications absentes");
        const bytes = await withTimeout(readDatasetArchive("classifications", info), R2_FETCH_TIMEOUT_MS, "Lecture classifications");
        const quality = JSON.parse(await extractCsvFromZip(bytes, "quality.json"));
        const links = JSON.parse(await extractCsvFromZip(bytes, "classification_links.json")) as ClassificationLink[];
        const sources = JSON.parse(await extractCsvFromZip(bytes, "sources.json")) as ClassificationSource[];
        if (quality.schema_version !== 2 || quality.orphan_parents !== 0 || !Array.isArray(links) || links.length < 6000 || links.length > 10000 || quality.links !== links.length || !Array.isArray(sources) || sources.length < 9 || sources.length > 32) throw new Error("Référentiel classifications incomplet");
        const sourceIds = new Set(sources.map(s => s.source_id));
        if (sourceIds.size !== sources.length || sources.some(s => s.version !== version || !/^[a-f0-9]{64}$/.test(s.sha256) || !s.url?.startsWith("https://"))) throw new Error("Provenance classifications invalide");
        const keys = new Set<string>();
        for (const l of links) {
          const key = [l.source_scheme,l.source_code,l.target_scheme,l.target_code].join(":");
          if (keys.has(key) || !CLASSIFICATION_SCHEMES.includes(l.source_scheme) || !CLASSIFICATION_SCHEMES.includes(l.target_scheme) || l.source_scheme === l.target_scheme || !/^([A-Z]|\d{2,6})$/.test(l.source_code) || !/^([A-Z]|\d{2,6})$/.test(l.target_code) || !sourceIds.has(l.source_id) || !["exactMatch","closeMatch","broadMatch","narrowMatch","relatedMatch"].includes(l.relation)) throw new Error("Lien classifications invalide");
          if (l.relation === "exactMatch" && !isDocumentedOfsIdentity(l)) throw new Error("Équivalence classifications non contrôlée");
          keys.add(key);
        }
        if (current() !== version) { classificationsAgain = true; continue; }
        setClassificationLinks(links, sources); state.loadedVersion = version; state.lastRefreshAt = Date.now(); state.lastError = null;
        console.log(`[mcp-refresh] Classifications ${version} : ${links.length} liens`);
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : "Échec classifications";
        console.error(`[mcp-refresh] Classifications conservées : ${state.lastError}`);
      }
    } while (classificationsAgain);
  })().finally(() => { classificationsFlight = null; });
  return classificationsFlight;
}

let _timer: ReturnType<typeof setInterval> | null = null;

/**
 * Kick the boot refresh (fire-and-forget) and arm the 12 h safety timer.
 * Idempotent. Called only from the server entrypoint (not in tests).
 */
export function startMcpDataRefresh(): void {
  void refreshFinmaFromR2();
  void refreshTaresFromR2();
  void refreshClassificationsFromR2();
  if (!_timer) {
    _timer = setInterval(() => { void refreshFinmaFromR2(); void refreshTaresFromR2(); void refreshClassificationsFromR2(); }, REFRESH_INTERVAL_MS);
    // Don't keep the event loop alive just for the timer.
    _timer.unref?.();
  }
}

/** Test helper: reset freshness + in-flight state between cases. */
export function _resetFreshnessForTest(): void {
  freshness.finma = { loadedVersion: null, lastRefreshAt: null, lastAttemptAt: null, lastError: null };
  freshness.tares = { loadedVersion: null, lastRefreshAt: null, lastAttemptAt: null, lastError: null };
  taresFlight = null; taresAgain = false;
  freshness.classifications = { loadedVersion: null, lastRefreshAt: null, lastAttemptAt: null, lastError: null };
  classificationsFlight = null; classificationsAgain = false;
  _inFlight = null;
  _rerun = false;
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
