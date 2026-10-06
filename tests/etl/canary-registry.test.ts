import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CANARIES } from "../../scripts/monitor-sources.js";
import { SOURCES } from "../../etl/shared/sources/registry.js";

const FIGEE = JSON.parse(readFileSync(new URL("../fixtures/canaries-2026-10-06.json", import.meta.url), "utf8"));

describe("le canari lit le registre", () => {
  it("la liste du canari est identique à celle du 06.10 (ids, adresses, modes, descriptions, ordre)", () => {
    expect(CANARIES).toEqual(FIGEE);
  });
  it("une source sans mode de canari n'entre pas dans le canari", () => {
    const sansCanari = SOURCES.filter(s => !s.canary).map(s => s.id);
    expect(sansCanari.length).toBeGreaterThan(0);
    for (const id of sansCanari) expect(CANARIES.some(c => c.id === id), id).toBe(false);
  });
  it("le canari est exactement l'ensemble des sources qui ont un mode", () => {
    expect(CANARIES.map(c => c.id)).toEqual(SOURCES.filter(s => s.canary).map(s => s.id));
  });
});
