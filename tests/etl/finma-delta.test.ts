import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { computeDelta, loadSnapshot, saveSnapshot } from "../../etl/finma/delta.js";
import type { FinmaEntity } from "../../etl/finma/types.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function bank(name: string, uid: string | undefined, overrides: Partial<FinmaEntity> = {}): FinmaEntity {
  return {
    entity_type: "bank",
    name, uid,
    source_list: "finma-banks",
    source_url: "https://www.finma.ch/",
    ...overrides,
  };
}

describe("computeDelta", () => {
  it("detects added entities", () => {
    const prev = [bank("A AG", "CHE-111.111.111")];
    const curr = [bank("A AG", "CHE-111.111.111"), bank("B AG", "CHE-222.222.222")];
    const { changes } = computeDelta(prev, curr);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("added");
    expect(changes[0].name).toBe("B AG");
  });

  it("detects removed entities", () => {
    const prev = [bank("A AG", "CHE-111.111.111"), bank("B AG", "CHE-222.222.222")];
    const curr = [bank("A AG", "CHE-111.111.111")];
    const { changes } = computeDelta(prev, curr);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("removed");
    expect(changes[0].name).toBe("B AG");
  });

  it("detects status changes", () => {
    const prev = [bank("A AG", "CHE-111.111.111", { status: "active" })];
    const curr = [bank("A AG", "CHE-111.111.111", { status: "withdrawn" })];
    const { changes } = computeDelta(prev, curr);
    const statusChange = changes.find(c => c.kind === "status_changed");
    expect(statusChange).toBeDefined();
    expect(statusChange?.after?.status).toBe("withdrawn");
    expect(statusChange?.before?.status).toBe("active");
  });

  it("detects address changes", () => {
    const prev = [bank("A AG", "CHE-111.111.111", { address: "Rue A" })];
    const curr = [bank("A AG", "CHE-111.111.111", { address: "Rue B" })];
    const { changes } = computeDelta(prev, curr);
    const ac = changes.find(c => c.kind === "address_changed");
    expect(ac?.after?.address).toBe("Rue B");
  });

  it("uses UID as primary match key", () => {
    const prev = [bank("Old Name AG", "CHE-111.111.111")];
    const curr = [bank("New Name AG", "CHE-111.111.111")]; // same UID, renamed
    const { changes } = computeDelta(prev, curr);
    // No add/remove because UID matches; no tracked field changed either
    expect(changes.filter(c => c.kind === "added" || c.kind === "removed")).toHaveLength(0);
  });

  it("returns counts", () => {
    const prev = [bank("A", "CHE-111.111.111"), bank("B", "CHE-222.222.222")];
    const curr = [bank("A", "CHE-111.111.111"), bank("C", "CHE-333.333.333")];
    const result = computeDelta(prev, curr);
    expect(result.previous_count).toBe(2);
    expect(result.current_count).toBe(2);
  });
});

describe("snapshot load/save", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "osd-snap-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("returns empty array if file doesn't exist", () => {
    expect(loadSnapshot(join(tmp, "nope.json"))).toEqual([]);
  });

  it("roundtrips entities through save/load", () => {
    const entities = [bank("X", "CHE-999.999.999", { address: "Bern" })];
    const path = join(tmp, "snap.json");
    saveSnapshot(entities, path);
    expect(existsSync(path)).toBe(true);
    const loaded = loadSnapshot(path);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("X");
    expect(loaded[0].address).toBe("Bern");
  });
});
