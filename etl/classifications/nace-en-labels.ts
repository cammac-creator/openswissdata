/**
 * NACE Rev 2.1 — English official labels (Pro tier add-on, Phase 1).
 *
 * Why: compliance officers and English-speaking analysts in international
 * groups need the OFFICIAL Eurostat English labels for NACE Rev 2.1 codes.
 * The Standard tier already ships these labels embedded in the per-scheme
 * tables (because we keep all 4 languages from the i14y / Eurostat sources),
 * but the Pro tier adds a dedicated `nace_2_1_en_labels.csv` file that:
 *   - is shippable as a stand-alone artefact (no JOIN required),
 *   - groups EN-only rows for fast spreadsheet workflows,
 *   - includes a `level` column for filtering.
 *
 * Source: the EU Vocabularies SKOS/XKOS RDF for NACE Rev 2.1, already
 * downloaded and parsed by `ingest-real.ts` (`ESTAT-NACE2.1.rdf` cached in
 * `data/classifications/classifications-cache/`). We just project the
 * already-parsed `NomenclatureRow` array — no extra network call.
 *
 * Re-use policy: Eurostat publishes NACE under their re-use policy (free
 * for commercial use with attribution). See
 * https://ec.europa.eu/eurostat/web/main/about-us/policies/copyright
 */

import type { NomenclatureRow } from "./types.js";

export interface NaceEnLabelRow {
  code: string;
  level: "section" | "division" | "group" | "class" | "subclass";
  parent: string | null;
  label_en: string;
}

export interface ExtractNaceEnLabelsResult {
  rows: NaceEnLabelRow[];
  stats: {
    total: number;
    with_label: number;
    missing_label: number;
  };
}

/**
 * Project NACE Rev 2.1 NomenclatureRows down to (code, level, parent, label_en).
 *
 * Rows missing an EN label are still emitted (with an empty string) so the
 * row count matches the upstream NACE 2.1 table 1:1. Stats track how many
 * rows had a non-empty label so callers can sanity-check coverage.
 */
export function extractNaceEnLabels(
  allRows: ReadonlyArray<NomenclatureRow>,
): ExtractNaceEnLabelsResult {
  const nace = allRows.filter((r) => r.scheme === "NACE_2.1");
  let withLabel = 0;
  const rows: NaceEnLabelRow[] = nace.map((r) => {
    const label = (r.label_en ?? "").trim();
    if (label.length > 0) withLabel++;
    return {
      code: r.code,
      level: r.level,
      parent: r.parent ?? null,
      label_en: label,
    };
  });
  rows.sort((a, b) => a.code.localeCompare(b.code));
  return {
    rows,
    stats: {
      total: rows.length,
      with_label: withLabel,
      missing_label: rows.length - withLabel,
    },
  };
}

/** CSV row shape used by `bundle.ts` when serialising. */
export function naceEnLabelToCsvRow(r: NaceEnLabelRow): Record<string, string> {
  return {
    code: r.code,
    level: r.level,
    parent: r.parent ?? "",
    label_en: r.label_en,
  };
}
