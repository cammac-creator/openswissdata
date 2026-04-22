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
  hs8: string;              // '84821000'
  hs6: string;              // '848200' (international)
  chapter: number;          // 84
  heading: string;          // '8482'
  designation_fr: string;
  designation_de: string;
  designation_it: string;
  designation_en?: string;
  unit_stat: string;        // 'kg'
  duty_mfn_chf_per_100kg?: number;
  preferential_regimes: Record<string, number | "free">;
  restrictions_codes: string[];
  valid_from: string;       // ISO date YYYY-MM-DD
  source_url: string;
}

export interface HierarchyNode {
  code: string;
  parent: string | null;
  children: string[];
}
