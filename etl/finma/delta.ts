import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { FinmaEntity } from "./types.js";

export type DeltaChangeKind = "added" | "removed" | "status_changed" | "address_changed" | "licence_changed";

export interface DeltaChange {
  kind: DeltaChangeKind;
  entity_type: FinmaEntity["entity_type"];
  name: string;
  uid?: string;
  source_list: string;
  before?: Partial<FinmaEntity>;
  after?: Partial<FinmaEntity>;
}

export interface DeltaResult {
  changes: DeltaChange[];
  current_count: number;
  previous_count: number;
}

/**
 * Create a stable composite key for entity matching. Prefer UID, fallback to name+entity_type.
 */
function entityKey(e: FinmaEntity): string {
  return e.uid ?? `${e.entity_type}::${e.name}`;
}

export function computeDelta(previous: FinmaEntity[], current: FinmaEntity[]): DeltaResult {
  const prevMap = new Map(previous.map(e => [entityKey(e), e]));
  const currMap = new Map(current.map(e => [entityKey(e), e]));
  const changes: DeltaChange[] = [];

  // Additions
  for (const [key, curr] of currMap) {
    if (!prevMap.has(key)) {
      changes.push({
        kind: "added",
        entity_type: curr.entity_type,
        name: curr.name,
        uid: curr.uid,
        source_list: curr.source_list,
        after: { ...curr },
      });
    }
  }

  // Removals
  for (const [key, prev] of prevMap) {
    if (!currMap.has(key)) {
      changes.push({
        kind: "removed",
        entity_type: prev.entity_type,
        name: prev.name,
        uid: prev.uid,
        source_list: prev.source_list,
        before: { ...prev },
      });
    }
  }

  // Modifications (for matched keys, check 3 fields: status, address, licence_type)
  for (const [key, curr] of currMap) {
    const prev = prevMap.get(key);
    if (!prev) continue;
    if ((prev.status ?? null) !== (curr.status ?? null)) {
      changes.push({ kind: "status_changed", entity_type: curr.entity_type, name: curr.name, uid: curr.uid, source_list: curr.source_list, before: { status: prev.status }, after: { status: curr.status } });
    }
    if ((prev.address ?? null) !== (curr.address ?? null)) {
      changes.push({ kind: "address_changed", entity_type: curr.entity_type, name: curr.name, uid: curr.uid, source_list: curr.source_list, before: { address: prev.address }, after: { address: curr.address } });
    }
    if ((prev.licence_type ?? null) !== (curr.licence_type ?? null)) {
      changes.push({ kind: "licence_changed", entity_type: curr.entity_type, name: curr.name, uid: curr.uid, source_list: curr.source_list, before: { licence_type: prev.licence_type }, after: { licence_type: curr.licence_type } });
    }
  }

  return { changes, current_count: current.length, previous_count: previous.length };
}

/**
 * Load a previous snapshot from JSON, or return [] if the file doesn't exist.
 */
export function loadSnapshot(path: string): FinmaEntity[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`Expected array in snapshot ${path}`);
  return parsed as FinmaEntity[];
}

/**
 * Save the current ingest to a JSON snapshot for future delta comparisons.
 */
export function saveSnapshot(entities: FinmaEntity[], path: string): void {
  writeFileSync(path, JSON.stringify(entities, null, 2), "utf8");
}
