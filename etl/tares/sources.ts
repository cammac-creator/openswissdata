/** Sources BAZG → bronze brut daté immuable ; index de cache argent reconstruisible. */
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

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
    const indexPath = join(cacheDir, `${src.key}.cache.json`);
    if (existsSync(indexPath) && maxAgeMs > 0) {
      const index = JSON.parse(readFileSync(indexPath, "utf8"));
      if (/^\d{4}-\d{2}-\d{2}$/.test(index.day) && /^[a-f0-9]{64}$/.test(index.sha256) &&
          index.url === src.url && Date.now() - Date.parse(index.fetched_at) >= 0 && Date.now() - Date.parse(index.fetched_at) < maxAgeMs) {
        const path = join(cacheDir, "bronze", index.day, `${src.key}-${index.sha256}.xlsx`);
        if (existsSync(path) && createHash("sha256").update(readFileSync(path)).digest("hex") === index.sha256) {
          out[src.key] = path;
          continue;
        }
      }
    }
    console.log(`[bazg] lecture de ${src.key} ...`);
    const res = await fetch(src.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok || !res.body) {
      throw new Error(`Source BAZG indisponible ${src.key} : HTTP ${res.status}`);
    }
    const parts: Uint8Array[] = []; let size = 0;
    for await (const part of res.body) {
      size += part.length;
      if (size > 50_000_000) throw new Error(`Source BAZG trop volumineuse : ${src.key}`);
      parts.push(part);
    }
    const bytes = Buffer.concat(parts);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fetched_at = new Date().toISOString(), day = fetched_at.slice(0, 10);
    const dir = join(cacheDir, "bronze", day); mkdirSync(dir, { recursive: true });
    const path = join(dir, `${src.key}-${sha256}.xlsx`);
    try { writeFileSync(path, bytes, { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if (bytes.subarray(0, 4).toString("hex") !== "504b0304") throw new Error(`Source BAZG non XLSX : ${src.key}`);
    const meta = { url: src.url, fetched_at, day, sha256, bytes: size, last_modified: res.headers.get("last-modified") };
    if (!existsSync(`${path}.meta.json`)) writeFileSync(`${path}.meta.json`, JSON.stringify(meta, null, 2), { flag: "wx" });
    writeFileSync(`${indexPath}.tmp`, JSON.stringify(meta)); renameSync(`${indexPath}.tmp`, indexPath);
    out[src.key] = path;
  }
  return out;
}
