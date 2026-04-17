import { readFileSync } from "node:fs";
import type { TaresRow } from "./types.js";

/**
 * Ingest from a local fixture JSON file (used for development + tests).
 * Real scraping will be added in Task 2.4.
 */
export function ingestFromFixture(fixturePath: string): TaresRow[] {
  const raw = readFileSync(fixturePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected array in fixture ${fixturePath}, got ${typeof parsed}`);
  }
  return parsed as TaresRow[];
}
