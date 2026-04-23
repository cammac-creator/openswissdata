/**
 * TARES row — compliant with BAZG commercial redistribution conditions
 * (approved 2026-04-21, see docs/legal-correspondence.md).
 *
 * FORBIDDEN fields (MUST NEVER be added to this interface):
 * - Erläuterungen (explanatory notes)
 * - Entscheide (classification decisions / rulings)
 *
 * Any scraper populating TaresRow MUST call assertNoForbiddenFields()
 * from normalize.ts before emitting rows.
 */
export interface TaresRow {
  hs8: string;              // '84821000' (canonical, no dot separator)
  hs6: string;              // '848200' (international)
  chapter: number;          // 84
  heading: string;          // '8482'
  designation_fr: string;
  designation_de: string;
  designation_it: string;
  designation_en?: string;
  unit_stat: string;        // 'kg' / 'piece' / etc.

  // MFN duty as published by BAZG. Switzerland expresses duties in mixed units
  // (per 100 kg brut, per 1 pièce, per hl, per kg net…) so we keep the raw
  // value + unit instead of forcing a per-100kg conversion (which would lose
  // data for animals, watches, alcohol, etc.).
  duty_mfn_value?: number;       // e.g. 120
  duty_mfn_unit?: string;        // e.g. "par 100 kg brut" / "par 1 pièce(s)"
  duty_mfn_currency?: string;    // always "CHF" but kept explicit for downstream consumers

  preferential_regimes: Record<string, number | "free">;
  restrictions_codes: string[];           // extra-customs restrictions (REACH, CITES, dual-use…) — empty in v1
  customs_relief_codes?: string[];        // BAZG ZCO customs facility codes (Zollerleichterungen)
  valid_from: string;       // ISO date YYYY-MM-DD
  source_url: string;
}

export interface HierarchyNode {
  code: string;
  parent: string | null;
  children: string[];
}
