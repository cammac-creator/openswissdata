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
  duty_mfn_chf_per_100kg?: number | null;
  preferential_regimes: Record<string, number | "free">;
  restrictions_codes: string[];
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
    duty_mfn_chf_per_100kg: r.duty_mfn_chf_per_100kg ? Number(r.duty_mfn_chf_per_100kg) : null,
    preferential_regimes: r.preferential_regimes ? JSON.parse(String(r.preferential_regimes)) : {},
    restrictions_codes: r.restrictions_codes ? JSON.parse(String(r.restrictions_codes)) : [],
    valid_from: String(r.valid_from),
    source_url: String(r.source_url),
  }));
}
