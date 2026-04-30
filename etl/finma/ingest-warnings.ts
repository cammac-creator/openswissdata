import { mkdirSync, existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FinmaWarning } from "./types.js";

/**
 * FINMA Warning List — public list of unauthorised financial-market providers.
 *
 * The warning list is rendered client-side from a JSON endpoint. The page at
 * https://www.finma.ch/en/finma-public/warnungen/warning-list/ posts to the
 * search API with the source GUID identifying the warning-list dataset.
 *
 * Reverse-engineered from the front-end JS (Frontend/Finma/app.min.js) — the
 * `Filter` module sends `data: { ds, Order, ... }` as form-encoded POST.
 */
export const FINMA_WARNINGS_API_URL =
  "https://www.finma.ch/en/api/search/getresult";

/**
 * Sitecore data-source GUID that the warning-list page declares in
 * `data-source` on its `mod-filter` element.
 */
export const FINMA_WARNINGS_SOURCE = "{1C6B8731-638C-4003-A93C-A625BF7A6800}";

/** `Order=4` is "newest first" — what the page itself uses. */
export const FINMA_WARNINGS_ORDER = "4";

/** Public-facing warning-list page URL (used as the canonical source URL). */
export const FINMA_WARNINGS_PAGE_URL =
  "https://www.finma.ch/en/finma-public/warnungen/warning-list/";

interface RawWarningItem {
  Id?: string;
  Title?: string;
  Link?: string;        // relative, e.g. "/en/finma-public/warnungen/warning-list/foo/"
  Date?: string;        // "DD.MM.YYYY"
  DateMobile?: string;
  Timestamp?: number;   // .NET ticks
  FacetColumn?: string; // "Entered in commercial register" | "Not entered..."
  Category?: string | null;
  Type?: string;
}

interface RawApiResponse {
  Items?: RawWarningItem[];
  Count?: number;
  ResultsPerPage?: number;
}

/**
 * Convert FINMA "DD.MM.YYYY" to ISO YYYY-MM-DD. Returns undefined on parse error.
 */
function parseDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = raw.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * "/en/finma-public/warnungen/warning-list/foo-bar/" -> "foo-bar"
 */
function extractSlug(link: string | undefined): string | undefined {
  if (!link) return undefined;
  const m = link.match(/\/warning-list\/([^/?#]+)/i) ||
            link.match(/\/warnliste\/([^/?#]+)/i);
  return m ? m[1] : undefined;
}

/**
 * Map a raw API item to a FinmaWarning. Returns null when the item lacks
 * a usable name (defensive, since an empty Title would mean an unusable row).
 */
export function mapRawWarning(raw: RawWarningItem): FinmaWarning | null {
  const name = (raw.Title ?? "").trim();
  if (!name) return null;
  const link = raw.Link ?? "";
  const sourceUrl = link.startsWith("http") ? link : `https://www.finma.ch${link}`;
  const slug = extractSlug(link);
  const category = raw.FacetColumn?.trim() || undefined;
  // FINMA only ships one bucket here ("warnings about unauthorised
  // providers"), so warning_type is constant. The sub-distinction
  // commercial-register vs not is captured in `category`.
  return {
    name,
    date_added: parseDate(raw.Date),
    category,
    source_url: sourceUrl,
    source_list: "finma-warnings",
    warning_type: "unauthorized_provider",
    additional_info: slug,
  };
}

/**
 * Download the FINMA Warning List JSON, with a 12h on-disk cache to avoid
 * hammering the upstream API during repeated local runs.
 */
export async function downloadWarningsJson(
  cacheDir: string,
  opts: { maxAgeHours?: number } = {},
): Promise<string> {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const path = join(cacheDir, "finma-warnings.json");
  const maxAgeMs = (opts.maxAgeHours ?? 12) * 3600 * 1000;
  if (existsSync(path) && Date.now() - statSync(path).mtimeMs < maxAgeMs) return path;

  console.log(`[finma-warnings] downloading warning list ...`);
  const body = new URLSearchParams({
    ds: FINMA_WARNINGS_SOURCE,
    Order: FINMA_WARNINGS_ORDER,
  });
  const res = await fetch(FINMA_WARNINGS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      // FINMA blocks empty user-agents on some edge nodes.
      "User-Agent": "openswissdata-etl/1.0 (+https://openswissdata.com)",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Failed to download FINMA warning list: HTTP ${res.status}`);
  }
  const text = await res.text();
  writeFileSync(path, text, "utf8");
  return path;
}

/**
 * Parse a cached FINMA warning-list JSON file into FinmaWarning[].
 */
export function parseWarningsJson(path: string): FinmaWarning[] {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as RawApiResponse;
  if (!parsed || !Array.isArray(parsed.Items)) return [];
  const out: FinmaWarning[] = [];
  for (const item of parsed.Items) {
    const mapped = mapRawWarning(item);
    if (mapped) out.push(mapped);
  }
  return out;
}

/**
 * Full ingest path: download (cached) + parse.
 */
export async function ingestFinmaWarnings(opts: { cacheDir: string }): Promise<{
  warnings: FinmaWarning[];
  stats: { total: number; categoryCounts: Record<string, number> };
}> {
  const path = await downloadWarningsJson(opts.cacheDir);
  const warnings = parseWarningsJson(path);
  const categoryCounts: Record<string, number> = {};
  for (const w of warnings) {
    const k = w.category ?? "(unknown)";
    categoryCounts[k] = (categoryCounts[k] ?? 0) + 1;
  }
  return { warnings, stats: { total: warnings.length, categoryCounts } };
}
