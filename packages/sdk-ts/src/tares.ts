import { parseCsv } from "./helpers/csv.js";

export interface TaresRow {
  hs8: string;
  hs6: string;
  chapter: number;
  heading: string;
  designation_fr: string;
  designation_de: string;
  designation_it: string;
  designation_en?: string;
  unit_stat: string;
  duty_mfn_value?: number | null;
  duty_mfn_unit?: string | null;
  duty_mfn_currency?: string | null;
  preferential_regimes: Record<string, number | "free">;
  restrictions_codes: string[];
  customs_relief_codes?: string[];
  valid_from: string;
  source_url: string;
}

export async function loadTares(csvPath: string): Promise<TaresRow[]> {
  const rows = await parseCsv(csvPath);
  return rows.map(r => ({
    hs8: String(r.hs8),
    hs6: String(r.hs6),
    chapter: Number(r.chapter),
    heading: String(r.heading),
    designation_fr: String(r.designation_fr),
    designation_de: String(r.designation_de),
    designation_it: String(r.designation_it),
    designation_en: r.designation_en ? String(r.designation_en) : undefined,
    unit_stat: String(r.unit_stat),
    duty_mfn_value: r.duty_mfn_value !== undefined && r.duty_mfn_value !== "" ? Number(r.duty_mfn_value) : null,
    duty_mfn_unit: r.duty_mfn_unit ? String(r.duty_mfn_unit) : null,
    duty_mfn_currency: r.duty_mfn_currency ? String(r.duty_mfn_currency) : null,
    preferential_regimes: r.preferential_regimes ? JSON.parse(String(r.preferential_regimes)) : {},
    restrictions_codes: r.restrictions_codes ? JSON.parse(String(r.restrictions_codes)) : [],
    customs_relief_codes: r.customs_relief_codes ? JSON.parse(String(r.customs_relief_codes)) : undefined,
    valid_from: String(r.valid_from),
    source_url: String(r.source_url),
  }));
}
