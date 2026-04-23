import { mkdirSync, existsSync, statSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Official BAZG XLSX downloads — Free Data Delivery service
 * https://www.bazg.admin.ch/de/tares-kostenlose-datenlieferungen-aufgrund-von-kundenwuenschen
 *
 * These files are published by BAZG as the canonical machine-readable export
 * of TARES (no scraping required, no API key needed).
 */
export interface BazgSource {
  key: string;          // logical name used by parsers
  url: string;          // direct XLSX download
  description: string;
}

export const BAZG_SOURCES: Record<string, BazgSource> = {
  tariff_8_digit: {
    key: "tariff_8_digit",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/F1BV6N4GlA4l/tariff_8_digit.xlsx",
    description: "List of all HS8 tariff numbers with valid_from/valid_to dates",
  },
  tarifstruktur: {
    key: "tarifstruktur",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/x0cFz-OgqaF2/Tarifstruktur.xlsx",
    description: "Hierarchical tariff structure with multilingual designations (DE/FR/IT/EN)",
  },
  duty_rates_01_30: {
    key: "duty_rates_01_30",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/suXEbuatJI1d/duty%20rates%20chapter%2001%20to%2030.xlsx",
    description: "MFN + preferential duty rates for chapters 01-30",
  },
  duty_rates_31_63: {
    key: "duty_rates_31_63",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/8HOWtwQe30-s/duty_rates_chapter_31_to_63.xlsx",
    description: "MFN + preferential duty rates for chapters 31-63",
  },
  duty_rates_64_83: {
    key: "duty_rates_64_83",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/dxAKUBpiFgx2/duty_rates_chapter_64_to_83.xlsx",
    description: "MFN + preferential duty rates for chapters 64-83",
  },
  duty_rates_84_97: {
    key: "duty_rates_84_97",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/vCLXp0mDCgBz/duty_rates_chapter_84_to_97.xlsx",
    description: "MFN + preferential duty rates for chapters 84-97",
  },
  customs_facilities: {
    key: "customs_facilities",
    url: "https://www.bazg.admin.ch/dam/de/sd-web/CAEsoXoBTdJY/customs_facilities.xlsx",
    description: "BAZG customs facility codes (ZCO) by tariff number",
  },
};

/**
 * Download all BAZG sources to a local cache directory. Skips files that are
 * already present and younger than `maxAgeHours` (default 12h) — avoids
 * hammering BAZG when iterating locally.
 */
export async function downloadAllSources(
  cacheDir: string,
  opts: { maxAgeHours?: number } = {},
): Promise<Record<string, string>> {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const maxAgeMs = (opts.maxAgeHours ?? 12) * 3600 * 1000;
  const out: Record<string, string> = {};
  for (const src of Object.values(BAZG_SOURCES)) {
    const path = join(cacheDir, `${src.key}.xlsx`);
    if (existsSync(path) && Date.now() - statSync(path).mtimeMs < maxAgeMs) {
      out[src.key] = path;
      continue;
    }
    console.log(`[bazg] downloading ${src.key} ...`);
    const res = await fetch(src.url);
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download ${src.key} from ${src.url}: HTTP ${res.status}`);
    }
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(path));
    out[src.key] = path;
  }
  return out;
}
