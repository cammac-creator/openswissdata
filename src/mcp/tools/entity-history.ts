/**
 * Tool: entity_history
 *
 * Returns the timeline of changes for a FINMA-supervised entity, keyed by
 * Swiss UID (CHE-xxx.xxx.xxx). Captures registration, authorisation type
 * changes, status mutations, address moves and warning-list cross-flag
 * transitions over the rolling history window.
 *
 * Why this is irreplicable:
 *   - finma.ch publishes the *current* state of each registry per category
 *     (banks, insurance, asset managers, …). There is no public time-series.
 *   - Reconstructing it would require months of weekly polling + diffing
 *     uid.csv — what we already do, dated and archived.
 */

import { z } from "zod";
import { getDb } from "../../lib/db.js";
import { getFinmaRegistry } from "../data-loader.js";

export const entityHistorySchema = {
  type: "object",
  properties: {
    uid: {
      type: "string",
      pattern: "^CHE-",
      description: "Swiss UID (e.g. CHE-103.137.179)",
    },
  },
  required: ["uid"],
} as const;

const InputZ = z.object({
  uid: z.string().regex(/^CHE-/, "uid must start with 'CHE-'"),
});

export interface EntityHistoryEvent {
  event: string; // "added" | "field_changed"
  field: string;
  old_value: string | null;
  new_value: string | null;
  recorded_at: number;
  version: string;
}

export interface EntityHistoryResult {
  uid: string;
  current: {
    name: string | null;
    licence_type: string | null;
    status: string | null;
    canton: string | null;
    city: string | null;
    is_warning_listed: boolean | null;
  };
  timeline: EntityHistoryEvent[];
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
  "name",
  "licence_type",
  "status",
  "canton",
  "city",
  "is_warning_listed",
] as const;

/**
 * Build the timeline from raw snapshot rows. Rows are grouped by version
 * (sorted by recorded_at), then we walk versions in order and emit:
 *   - one "added" event for the first version a field appears in
 *   - one "field_changed" event whenever the value differs from the
 *     previous version's value
 */
function buildTimeline(rows: SnapshotRow[]): EntityHistoryEvent[] {
  // Group by version
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

  const events: EntityHistoryEvent[] = [];
  const seenFields = new Set<string>();
  const lastValues = new Map<string, string | null>();

  for (let i = 0; i < byVersion.length; i++) {
    const v = byVersion[i];
    for (const field of TRACKED_FIELDS) {
      if (!v.values.has(field)) continue;
      const newV = v.values.get(field) ?? null;
      if (!seenFields.has(field)) {
        seenFields.add(field);
        events.push({
          event: "added",
          field,
          old_value: null,
          new_value: newV,
          recorded_at: v.recorded_at,
          version: v.version,
        });
      } else {
        const oldV = lastValues.get(field) ?? null;
        if (oldV !== newV) {
          events.push({
            event: "field_changed",
            field,
            old_value: oldV,
            new_value: newV,
            recorded_at: v.recorded_at,
            version: v.version,
          });
        }
      }
      lastValues.set(field, newV);
    }
  }
  return events;
}

export function entityHistoryHandler(args: unknown): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: EntityHistoryResult;
} {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const { uid } = parsed.data;

  // Current state — bundled FINMA registry (data-loader) is the live snapshot.
  const registry = getFinmaRegistry();
  const row = registry.find((e) => e.uid === uid);

  const current: EntityHistoryResult["current"] = {
    name: row?.name ?? null,
    licence_type: row?.licence_type ?? null,
    status: row?.status ?? null,
    canton: row?.canton ?? null,
    city: row?.city ?? null,
    is_warning_listed: row ? row.is_warning_listed === "true" : null,
  };

  // Pull snapshots
  const db = getDb();
  const snapshotRows = db
    .prepare(
      `SELECT version, field, value, recorded_at
       FROM dataset_snapshots
       WHERE dataset_id = 'finma'
         AND entity_key = ?
         AND field IN ('name', 'licence_type', 'status', 'canton', 'city', 'is_warning_listed')
       ORDER BY recorded_at ASC`,
    )
    .all(uid) as SnapshotRow[];

  const versionsObserved = [...new Set(snapshotRows.map((r) => r.version))];
  const timeline = buildTimeline(snapshotRows);

  const result: EntityHistoryResult = {
    uid,
    current,
    timeline,
    versions_observed: versionsObserved,
    source_note:
      "OpenSwissData historical snapshots — derived from dated FINMA uid.csv releases (finma.ch only publishes the current state).",
  };

  const lines: string[] = [];
  lines.push(`UID ${uid} — FINMA entity history`);
  if (current.name) {
    lines.push(`Current: ${current.name} (${current.licence_type ?? "?"}, status=${current.status ?? "?"}, ${current.city ?? "?"})`);
  } else {
    lines.push("Current: (UID not present in current FINMA registry)");
  }
  lines.push(`Versions observed: ${versionsObserved.length === 0 ? "(none)" : versionsObserved.join(", ")}`);
  if (timeline.length === 0) {
    lines.push("No timeline events recorded.");
  } else {
    lines.push(`${timeline.length} event${timeline.length > 1 ? "s" : ""}:`);
    for (const e of timeline.slice(0, 20)) {
      const ts = new Date(e.recorded_at).toISOString().slice(0, 10);
      if (e.event === "added") {
        lines.push(`  - ${ts} [${e.version}] added ${e.field}="${e.new_value ?? "∅"}"`);
      } else {
        lines.push(
          `  - ${ts} [${e.version}] ${e.field}: "${e.old_value ?? "∅"}" → "${e.new_value ?? "∅"}"`,
        );
      }
    }
    if (timeline.length > 20) lines.push(`  ... ${timeline.length - 20} more`);
  }
  lines.push("");
  lines.push(result.source_note);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structured: result,
  };
}

export const entityHistoryTool = {
  name: "entity_history",
  description:
    "Returns the timeline of changes for a FINMA-supervised entity (registration, authorisation type changes, status mutations, address moves, warning-list flag transitions). Keyed by Swiss UID (CHE-xxx.xxx.xxx). Irreplicable by scraping — finma.ch only publishes the current state.",
  inputSchema: entityHistorySchema,
  handler: entityHistoryHandler,
} as const;
