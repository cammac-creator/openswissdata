/**
 * Tool: tariff_changelog
 *
 * Returns the historical changelog of MFN duty rates (and adjacent fields)
 * for a Swiss customs tariff (HS8) code. Window is the rolling 12-24 months
 * captured in `dataset_snapshots` (one row per dataset × version × entity ×
 * field — populated by `etl/shared/snapshot.ts`).
 *
 * Why this is irreplicable:
 *   - The official source (xtares.admin.ch) only serves the CURRENT version.
 *   - A scraper cannot reconstruct the timeline without years of polling.
 *   - We have it because every release ZIP we publish to R2 is dated and
 *     archived — backfilling once and snapshotting on each release builds
 *     a moat the competition can't catch up to without going back in time.
 */

import { z } from "zod";
import { getDb } from "../../lib/db.js";
import { getTares } from "../data-loader.js";

export const tariffChangelogSchema = {
  type: "object",
  properties: {
    hs8: { type: "string", pattern: "^\\d{8}$", description: "8-digit Swiss tariff number" },
    since: {
      type: "string",
      format: "date",
      description: "ISO date (YYYY-MM-DD); only changes recorded on/after are returned",
    },
  },
  required: ["hs8"],
} as const;

const InputZ = z.object({
  hs8: z.string().regex(/^\d{8}$/),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export interface TariffChangelogChange {
  from_version: string;
  to_version: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  recorded_at: number;
}

export interface TariffChangelogResult {
  hs_code: string;
  current: {
    duty_mfn_value: number | null;
    duty_mfn_unit: string | null;
    duty_mfn_currency: string | null;
    designation_fr: string | null;
    valid_from: string | null;
  };
  changes: TariffChangelogChange[];
  versions_observed: string[];
  source_note: string;
}

interface SnapshotRow {
  version: string;
  field: string;
  value: string | null;
  recorded_at: number;
}

const TRACKED_FIELDS = [
  "duty_mfn_value",
  "duty_mfn_unit",
  "duty_mfn_currency",
  "designation_fr",
  "valid_from",
] as const;

/**
 * Compute pairwise diffs across consecutive versions for a given HS code.
 * `rows` is expected to be sorted by recorded_at ASC.
 */
function computeChanges(rows: SnapshotRow[]): TariffChangelogChange[] {
  // Group by version, preserving order of first appearance
  const byVersion: { version: string; recorded_at: number; values: Map<string, string | null> }[] = [];
  const versionIdx = new Map<string, number>();
  for (const r of rows) {
    let idx = versionIdx.get(r.version);
    if (idx === undefined) {
      idx = byVersion.length;
      versionIdx.set(r.version, idx);
      byVersion.push({ version: r.version, recorded_at: r.recorded_at, values: new Map() });
    }
    byVersion[idx].values.set(r.field, r.value);
  }

  byVersion.sort((a, b) => a.recorded_at - b.recorded_at);

  const changes: TariffChangelogChange[] = [];
  for (let i = 1; i < byVersion.length; i++) {
    const prev = byVersion[i - 1];
    const curr = byVersion[i];
    for (const field of TRACKED_FIELDS) {
      const oldV = prev.values.get(field) ?? null;
      const newV = curr.values.get(field) ?? null;
      if (oldV !== newV) {
        changes.push({
          from_version: prev.version,
          to_version: curr.version,
          field,
          old_value: oldV,
          new_value: newV,
          recorded_at: curr.recorded_at,
        });
      }
    }
  }
  return changes;
}

export function tariffChangelogHandler(args: unknown): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: TariffChangelogResult;
} {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const { hs8, since } = parsed.data;
  const sinceMs = since ? Date.parse(`${since}T00:00:00Z`) : 0;

  // Current state — fall back to the bundled CSV (data-loader) so the
  // response is meaningful even on a fresh DB with no snapshots yet.
  const { byHs8 } = getTares();
  const row = byHs8.get(hs8);
  const current: TariffChangelogResult["current"] = {
    duty_mfn_value:
      row && row.duty_mfn_value && row.duty_mfn_value !== ""
        ? Number(row.duty_mfn_value)
        : null,
    duty_mfn_unit: row?.duty_mfn_unit || null,
    duty_mfn_currency: row?.duty_mfn_currency || null,
    designation_fr: row?.designation_fr || null,
    valid_from: row?.valid_from || null,
  };

  if (!row) {
    return {
      content: [{ type: "text", text: `No TARES entry for HS8 "${hs8}" — cannot compute changelog.` }],
      isError: true,
    };
  }

  // Pull all snapshots for this entity, oldest first
  const db = getDb();
  const snapshotRows = db
    .prepare(
      `SELECT version, field, value, recorded_at
       FROM dataset_snapshots
       WHERE dataset_id = 'tares'
         AND entity_key = ?
         AND field IN ('duty_mfn_value', 'duty_mfn_unit', 'duty_mfn_currency', 'designation_fr', 'valid_from')
         AND recorded_at >= ?
       ORDER BY recorded_at ASC`,
    )
    .all(hs8, sinceMs) as SnapshotRow[];

  const versionsObserved = [...new Set(snapshotRows.map((r) => r.version))];
  const changes = computeChanges(snapshotRows);

  const result: TariffChangelogResult = {
    hs_code: hs8,
    current,
    changes,
    versions_observed: versionsObserved,
    source_note:
      "OpenSwissData historical snapshots — derived from dated TARES releases (xtares.admin.ch only serves the current version).",
  };

  // Text payload: short human-readable summary
  const lines: string[] = [];
  lines.push(`HS8 ${hs8} — TARES changelog`);
  lines.push(
    `Current: MFN ${current.duty_mfn_value ?? "n/a"} ${current.duty_mfn_unit ?? ""} ${current.duty_mfn_currency ?? ""}`.trim(),
  );
  lines.push(`Versions observed: ${versionsObserved.length === 0 ? "(none)" : versionsObserved.join(", ")}`);
  if (changes.length === 0) {
    lines.push("No changes recorded in the requested window.");
  } else {
    lines.push(`${changes.length} change${changes.length > 1 ? "s" : ""}:`);
    for (const c of changes.slice(0, 20)) {
      const ts = new Date(c.recorded_at).toISOString().slice(0, 10);
      lines.push(
        `  - ${ts} ${c.from_version} → ${c.to_version}: ${c.field} "${c.old_value ?? "∅"}" → "${c.new_value ?? "∅"}"`,
      );
    }
    if (changes.length > 20) lines.push(`  ... ${changes.length - 20} more`);
  }
  lines.push("");
  lines.push(result.source_note);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structured: result,
  };
}

export const tariffChangelogTool = {
  name: "tariff_changelog",
  description:
    "Returns the historical changelog of MFN duty rates (and adjacent fields) for a Swiss customs tariff (HS8) code. Window: rolling 12-24 months. Irreplicable by scraping — xtares.admin.ch only serves the current version. Requires `hs8`; optional `since` (ISO date) to bound the window.",
  inputSchema: tariffChangelogSchema,
  handler: tariffChangelogHandler,
} as const;
