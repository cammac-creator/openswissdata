import { describe, it, expect } from "vitest";
import { selectEntriesForRun, weeklyRotationOffset } from "../../scripts/sync-datasets.js";

// Lot G4 (23.10.2026) : 56 jeux approuvés pour un plafond de 50 par passage. Sans départ tournant,
// les 6 derniers n'étaient jamais rafraîchis ; avec lui, aucun jeu n'est sauté deux semaines de suite.
const WEEK_MS = 7 * 86_400_000;
const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `jeu-${i}` })) as never[];
const ids = (list: { id: string }[]) => list.map(e => e.id);

describe("départ tournant du collecteur des jeux ouverts", () => {
  it("garde les premiers de la liste quand le départ vaut 0", () => {
    const { toProcess, skipped } = selectEntriesForRun(entries(56), 50, 0);
    expect(ids(toProcess)).toEqual(ids(entries(50)));
    expect(ids(skipped)).toEqual(["jeu-50", "jeu-51", "jeu-52", "jeu-53", "jeu-54", "jeu-55"]);
  });

  it("boucle sur la liste à partir du départ", () => {
    const { toProcess, skipped } = selectEntriesForRun(entries(56), 50, 50);
    expect(toProcess).toHaveLength(50);
    expect(ids(toProcess).slice(0, 7)).toEqual(["jeu-50", "jeu-51", "jeu-52", "jeu-53", "jeu-54", "jeu-55", "jeu-0"]);
    expect(ids(skipped)).toEqual(["jeu-44", "jeu-45", "jeu-46", "jeu-47", "jeu-48", "jeu-49"]);
  });

  it("traite tout, sans rotation, sous le plafond", () => {
    expect(weeklyRotationOffset(123 * WEEK_MS, 50, 36)).toBe(0);
    const { toProcess, skipped } = selectEntriesForRun(entries(36), 50, 17);
    expect(ids(toProcess)).toEqual(ids(entries(36)));
    expect(skipped).toEqual([]);
  });

  it("ne saute jamais un jeu deux semaines de suite (56 jeux, plafond 50)", () => {
    for (let week = 0; week < 60; week++) {
      const a = selectEntriesForRun(entries(56), 50, weeklyRotationOffset(week * WEEK_MS, 50, 56)).skipped;
      const b = selectEntriesForRun(entries(56), 50, weeklyRotationOffset((week + 1) * WEEK_MS, 50, 56)).skipped;
      expect(ids(a).filter(id => ids(b).includes(id))).toEqual([]);
    }
  });

  it("rafraîchit chaque jeu au moins une semaine sur deux", () => {
    const seen = new Set<string>();
    for (const week of [2900, 2901]) {
      for (const e of selectEntriesForRun(entries(56), 50, weeklyRotationOffset(week * WEEK_MS, 50, 56)).toProcess) seen.add(e.id);
    }
    expect(seen.size).toBe(56);
  });
});
