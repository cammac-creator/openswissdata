import { readFileSync } from "node:fs";
import type { TaresRow } from "./types.js";
import { downloadAllSources } from "./sources.js";
import { buildTaresRows } from "./build-rows.js";

/**
 * Ingest from a local fixture JSON file (used for development + tests).
 */
export function ingestFromFixture(fixturePath: string): TaresRow[] {
  const raw = readFileSync(fixturePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected array in fixture ${fixturePath}, got ${typeof parsed}`);
  }
  return parsed as TaresRow[];
}

/**
 * Ingest from BAZG official XLSX downloads (free data delivery service).
 * Downloads all 7 source files into `cacheDir`, parses them, joins them
 * into the canonical TaresRow[] schema, and validates BAZG compliance.
 */
export async function ingestFromBazg(opts: { cacheDir: string; today?: string }): Promise<{
  rows: TaresRow[];
  stats: ReturnType<typeof buildTaresRows>["stats"];
}> {
  const paths = await downloadAllSources(opts.cacheDir);
  const result = buildTaresRows({
    today: opts.today,
    sources: {
      tariff_8_digit: paths.tariff_8_digit,
      tarifstruktur: paths.tarifstruktur,
      duty_rates_paths: [
        paths.duty_rates_01_30,
        paths.duty_rates_31_63,
        paths.duty_rates_64_83,
        paths.duty_rates_84_97,
      ],
      customs_facilities: paths.customs_facilities,
    },
  });
  return result;
}
