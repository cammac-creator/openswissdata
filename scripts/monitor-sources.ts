/**
 * Source canary — detects upstream schema/format ruptures *before* they hit our
 * pipelines. Computes a stable hash for each authoritative source we depend on
 * (TARES BAZG XLSX, FINMA UID CSV, BFS NOGA via i14y) and compares it to a
 * snapshot stored in `data/source-hashes.json`.
 *
 * If a hash diverges, exit code 2 — the GitHub workflow then opens an issue
 * with the diff. We act on it manually within the SLA we promise customers.
 *
 * Designed to be cheap (HEAD/GET only, no parsing) and never modify data.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface SourceCanary {
  id: string;
  url: string;
  // For HTML/CSV/XLSX sources we hash the raw bytes directly. For JSON we hash
  // a structural shape (top-level keys + array length) so a row-level update
  // doesn't false-positive — only structure changes alert.
  mode: "raw" | "json-shape";
  description: string;
}

const CANARIES: SourceCanary[] = [
  // TARES — 7 official BAZG XLSX downloads
  {
    id: "tares.tariff_8_digit",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/F1BV6N4GlA4l/tariff_8_digit.xlsx",
    mode: "raw",
    description: "BAZG — Liste des numéros tarifaires HS8",
  },
  {
    id: "tares.tarifstruktur",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/x0cFz-OgqaF2/Tarifstruktur.xlsx",
    mode: "raw",
    description: "BAZG — Structure tarifaire hiérarchique multilingue",
  },
  {
    id: "tares.duty_rates_01_30",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/suXEbuatJI1d/duty%20rates%20chapter%2001%20to%2030.xlsx",
    mode: "raw",
    description: "BAZG — Droits MFN chapitres 01-30",
  },
  {
    id: "tares.duty_rates_31_63",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/8HOWtwQe30-s/duty_rates_chapter_31_to_63.xlsx",
    mode: "raw",
    description: "BAZG — Droits MFN chapitres 31-63",
  },
  {
    id: "tares.duty_rates_64_83",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/dxAKUBpiFgx2/duty_rates_chapter_64_to_83.xlsx",
    mode: "raw",
    description: "BAZG — Droits MFN chapitres 64-83",
  },
  {
    id: "tares.duty_rates_84_97",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/vCLXp0mDCgBz/duty_rates_chapter_84_to_97.xlsx",
    mode: "raw",
    description: "BAZG — Droits MFN chapitres 84-97",
  },
  {
    id: "tares.customs_facilities",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/CAEsoXoBTdJY/customs_facilities.xlsx",
    mode: "raw",
    description: "BAZG — Codes ZCO d'allègement douanier",
  },
  // FINMA — single consolidated CSV
  {
    id: "finma.uid_csv",
    url: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/csv/uid.csv",
    mode: "raw",
    description: "FINMA — CSV consolidé des institutions autorisées (UID)",
  },
  // BFS — NOGA via i14y JSON API
  {
    id: "bfs.noga_2025",
    url: "https://api.i14y.admin.ch/api/public/v1/concepts/001bfaa8-fa57-4d66-acfd-c795d67fcf80?includeCodeListEntries=true",
    mode: "json-shape",
    description: "BFS — NOGA 2025 (concept i14y)",
  },
  {
    id: "bfs.noga_2008",
    url: "https://api.i14y.admin.ch/api/public/v1/concepts/08dc481b-2add-1232-b5fe-b1fae7a1ac02?includeCodeListEntries=true",
    mode: "json-shape",
    description: "BFS — NOGA 2008 (concept i14y)",
  },
];

// Baseline lives in `etl/` because `data/` is gitignored — this is config, not data.
const HASH_FILE = "etl/canary-baseline.json";
const REPORT_FILE = "etl/canary-report.json";
const USER_AGENT = "openswissdata-canary/0.1 (+contact:contact@openswissdata.com)";

interface HashSnapshot {
  [id: string]: { hash: string; checked_at: string; size?: number };
}

interface CanaryResult {
  id: string;
  status: "match" | "drift" | "missing" | "error";
  current_hash?: string;
  previous_hash?: string;
  size?: number;
  error?: string;
  description: string;
}

/**
 * Build a structural hash of a JSON document. Sorted top-level keys + array
 * lengths at depth 1 — enough to detect "they renamed `entries` to `items`"
 * without flapping every time a row changes.
 */
function hashJsonShape(json: unknown): string {
  const shape = describeShape(json, 0);
  return createHash("sha256").update(shape).digest("hex");
}

function describeShape(node: unknown, depth: number): string {
  if (node === null) return "null";
  if (Array.isArray(node)) {
    if (depth > 1 || node.length === 0) return `array[${node.length}]`;
    // Sample shape from first element only — assume homogeneous arrays
    return `array[${node.length}]<${describeShape(node[0], depth + 1)}>`;
  }
  if (typeof node === "object") {
    const keys = Object.keys(node as object).sort();
    if (depth > 2) return `object{${keys.length}}`;
    const entries = keys
      .map((k) => `${k}:${describeShape((node as Record<string, unknown>)[k], depth + 1)}`)
      .join(",");
    return `object{${entries}}`;
  }
  return typeof node;
}

async function fetchAndHash(canary: SourceCanary): Promise<{ hash: string; size: number }> {
  const res = await fetch(canary.url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  if (canary.mode === "raw") {
    const buf = Buffer.from(await res.arrayBuffer());
    return { hash: createHash("sha256").update(buf).digest("hex"), size: buf.length };
  }
  const json = await res.json();
  const text = JSON.stringify(json);
  return { hash: hashJsonShape(json), size: text.length };
}

function loadSnapshot(): HashSnapshot {
  if (!existsSync(HASH_FILE)) return {};
  try {
    return JSON.parse(readFileSync(HASH_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveSnapshot(snap: HashSnapshot) {
  mkdirSync(dirname(HASH_FILE), { recursive: true });
  writeFileSync(HASH_FILE, JSON.stringify(snap, null, 2) + "\n");
}

async function main() {
  const updateMode = process.argv.includes("--update");
  const previous = loadSnapshot();
  const next: HashSnapshot = {};
  const results: CanaryResult[] = [];

  for (const canary of CANARIES) {
    process.stdout.write(`[canary] ${canary.id} ... `);
    try {
      const { hash, size } = await fetchAndHash(canary);
      const prev = previous[canary.id];
      next[canary.id] = { hash, checked_at: new Date().toISOString(), size };
      if (!prev) {
        console.log(`new (${hash.slice(0, 12)}, ${size}b)`);
        results.push({ id: canary.id, status: "missing", current_hash: hash, size, description: canary.description });
      } else if (prev.hash !== hash) {
        console.log(`DRIFT prev=${prev.hash.slice(0, 12)} now=${hash.slice(0, 12)}`);
        results.push({
          id: canary.id,
          status: "drift",
          current_hash: hash,
          previous_hash: prev.hash,
          size,
          description: canary.description,
        });
      } else {
        console.log(`match (${hash.slice(0, 12)})`);
        results.push({ id: canary.id, status: "match", current_hash: hash, size, description: canary.description });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR ${msg}`);
      // Preserve previous hash on error so a transient network blip doesn't
      // wipe the baseline.
      if (previous[canary.id]) next[canary.id] = previous[canary.id];
      results.push({ id: canary.id, status: "error", error: msg, description: canary.description });
    }
  }

  // Summary
  const drifts = results.filter((r) => r.status === "drift");
  const errors = results.filter((r) => r.status === "error");
  const newOnes = results.filter((r) => r.status === "missing");

  console.log("");
  console.log(
    `[canary] ${results.length} sources · ${drifts.length} drift · ${errors.length} error · ${newOnes.length} new`,
  );

  // Write snapshot only if --update or first-run baseline
  if (updateMode || Object.keys(previous).length === 0) {
    saveSnapshot(next);
    console.log(`[canary] snapshot written to ${HASH_FILE}`);
  }

  // Emit machine-readable report for the workflow to consume
  const report = {
    checked_at: new Date().toISOString(),
    total: results.length,
    drift: drifts.length,
    error: errors.length,
    new: newOnes.length,
    drifts,
    errors,
    new_sources: newOnes,
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");

  // Exit 2 on drift so the workflow can branch on it
  if (drifts.length > 0) process.exit(2);
  if (errors.length > 0) process.exit(3);
  process.exit(0);
}

main().catch((err) => {
  console.error("[canary] fatal:", err);
  process.exit(1);
});
