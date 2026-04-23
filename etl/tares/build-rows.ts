import type { TaresRow } from "./types.js";
import { assertNoForbiddenFields } from "./normalize.js";
import {
  parseTariff8Digit,
  parseTarifstruktur,
  parseDutyRates,
  parseCustomsFacilities,
  type DutyRateRow,
  type StructureNode,
  type Tn8ValidityRow,
} from "./parse-bazg-xlsx.js";

const TARES_BASE_URL = "https://xtares.admin.ch/tares/";

/**
 * Map of LDG Nr (BAZG country/regime code) → short slug used in
 * preferential_regimes. Extend as needed when new agreements ship.
 */
const LDG_TO_SLUG: Record<string, string> = {
  "100000": "mfn",   // Normal-Ansatz / MFN
  "100002": "efta",  // Europäische Freihandelsassoziation
  "100020": "eu",    // Union européenne (EU)
  "100021": "uk",    // United Kingdom
  "100022": "cn",    // China
  "100023": "jp",    // Japan
  "100024": "tr",    // Turquie
};

function slugFromLdg(row: DutyRateRow): string {
  if (LDG_TO_SLUG[row.ldgCode]) return LDG_TO_SLUG[row.ldgCode];
  // Fallback: derive a slug from the FR text (lowercase, alphanum only).
  const slug = row.ldgText_fr
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return slug || `ldg_${row.ldgCode}`;
}

function isCurrent(validFrom: string | null, validTo: string | null, today: string): boolean {
  if (validFrom && validFrom > today) return false;
  if (validTo && validTo < today) return false;
  return true;
}

export interface BuildOptions {
  today?: string;       // ISO date used to filter valid rows (default: now)
  sources: {
    tariff_8_digit: string;
    tarifstruktur: string;
    duty_rates_paths: string[];
    customs_facilities?: string;
  };
}

export interface BuildResult {
  rows: TaresRow[];
  stats: {
    tn8_total: number;
    tn8_currently_valid: number;
    duty_rate_rows_loaded: number;
    duty_rate_rows_kept: number;
    customs_relief_rows_loaded: number;
    rows_dropped_no_designation: number;
    forbidden_field_violations: number;
  };
}

/**
 * Builds the canonical TaresRow[] from BAZG XLSX sources.
 */
export function buildTaresRows(opts: BuildOptions): BuildResult {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  const tn8List = parseTariff8Digit(opts.sources.tariff_8_digit);
  const struct = parseTarifstruktur(opts.sources.tarifstruktur);
  const duties = parseDutyRates(opts.sources.duty_rates_paths);
  const reliefs = opts.sources.customs_facilities
    ? parseCustomsFacilities(opts.sources.customs_facilities)
    : [];

  // Index structure rows by hs8 (we only care about TN8 entries for designations,
  // but TN6/TN4/TN2 are useful as fallback when TN8 row is missing — rare).
  const structByCode = new Map<string, StructureNode>();
  for (const s of struct) {
    if (!structByCode.has(s.code)) structByCode.set(s.code, s);
  }

  // Index reliefs by hs8 → list of unique ZCO codes.
  const reliefByHs8 = new Map<string, Set<string>>();
  for (const r of reliefs) {
    if (!isCurrent(r.validFrom, r.validTo, today)) continue;
    if (!r.zcoCode) continue;
    let set = reliefByHs8.get(r.hs8);
    if (!set) {
      set = new Set();
      reliefByHs8.set(r.hs8, set);
    }
    set.add(r.zcoCode);
  }

  // Index duties by hs8.
  const dutiesByHs8 = new Map<string, DutyRateRow[]>();
  let duty_rate_rows_loaded = duties.length;
  let duty_rate_rows_kept = 0;
  for (const d of duties) {
    if (!isCurrent(d.validFrom, d.validTo, today)) continue;
    duty_rate_rows_kept++;
    let arr = dutiesByHs8.get(d.hs8);
    if (!arr) {
      arr = [];
      dutiesByHs8.set(d.hs8, arr);
    }
    arr.push(d);
  }

  let tn8_currently_valid = 0;
  let rows_dropped_no_designation = 0;
  let forbidden_field_violations = 0;
  const rows: TaresRow[] = [];

  for (const v of tn8List) {
    if (!isCurrent(v.validFrom, v.validTo, today)) continue;
    tn8_currently_valid++;

    const desc = structByCode.get(v.hs8);
    if (!desc || (!desc.text_fr && !desc.text_de && !desc.text_en)) {
      rows_dropped_no_designation++;
      continue;
    }

    const codeDuties = dutiesByHs8.get(v.hs8) ?? [];

    // MFN duty (Ansatzart === "NT" with LDG Nr = "100000")
    const mfn = codeDuties.find((d) => d.ldgCode === "100000") ?? codeDuties.find((d) => d.ansatzart === "NT");

    // Preferential regimes: pick all rows with Ansatzart === "PR" (preferential).
    const prefs: Record<string, number | "free"> = {};
    for (const d of codeDuties) {
      if (d.ansatzart !== "PR") continue;
      const slug = slugFromLdg(d);
      const v: number | "free" = d.value === 0 ? "free" : d.value;
      // Keep the lowest rate per regime (most favourable).
      const cur = prefs[slug];
      if (cur === undefined) {
        prefs[slug] = v;
      } else if (cur === "free") {
        // already best
      } else if (v === "free") {
        prefs[slug] = "free";
      } else if (typeof cur === "number" && typeof v === "number" && v < cur) {
        prefs[slug] = v;
      }
    }

    const reliefCodes = reliefByHs8.get(v.hs8);

    const row: TaresRow = {
      hs8: v.hs8,
      hs6: v.hs8.slice(0, 6),
      chapter: Number(v.hs8.slice(0, 2)),
      heading: v.hs8.slice(0, 4),
      designation_fr: desc.text_fr,
      designation_de: desc.text_de,
      designation_it: desc.text_it,
      designation_en: desc.text_en || undefined,
      unit_stat: mfn?.unit_en || mfn?.unit_fr || mfn?.unit_de || "",
      duty_mfn_value: mfn ? mfn.value : undefined,
      duty_mfn_unit: mfn ? (mfn.unit_fr || mfn.unit_de || mfn.unit_en) : undefined,
      duty_mfn_currency: mfn ? "CHF" : undefined,
      preferential_regimes: prefs,
      restrictions_codes: [],
      customs_relief_codes: reliefCodes && reliefCodes.size > 0 ? Array.from(reliefCodes).sort() : undefined,
      valid_from: v.validFrom ?? "1970-01-01",
      source_url: `${TARES_BASE_URL}control/searchSimpleTarifNumber?number=${v.hs8}`,
    };

    const violations = assertNoForbiddenFields(row as unknown as Record<string, unknown>);
    if (violations.length > 0) {
      forbidden_field_violations++;
      throw new Error(
        `BAZG compliance violation: row ${v.hs8} contains forbidden field(s) ${violations.join(",")}`,
      );
    }
    rows.push(row);
  }

  // Stable sort by hs8 — deterministic ZIP for diff/cache.
  rows.sort((a, b) => a.hs8.localeCompare(b.hs8));

  return {
    rows,
    stats: {
      tn8_total: tn8List.length,
      tn8_currently_valid,
      duty_rate_rows_loaded,
      duty_rate_rows_kept,
      customs_relief_rows_loaded: reliefs.length,
      rows_dropped_no_designation,
      forbidden_field_violations,
    },
  };
}
