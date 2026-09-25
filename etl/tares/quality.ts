/** Argent TARES → contrôles, comparaison et rapport qualité de l'or. */
import type { TaresRow } from "./types.js";
import type { BuildResult } from "./build-rows.js";

export function validateTares(result: BuildResult, previous: TaresRow[], previousVersion: string) {
  const { rows, rates, stats } = result;
  if (rows.length < 6_000 || rows.length > 10_000) throw new Error("Volume TARES inhabituel : publication annulée");
  if (!previous.length || Math.abs(rows.length - previous.length) / previous.length > 0.05) {
    throw new Error("Variation du volume TARES supérieure à 5 % : examen nécessaire");
  }
  if (new Set(rows.map(r => r.hs8)).size !== rows.length) throw new Error("Codes TARES en double");
  if (stats.rows_dropped_no_designation || stats.forbidden_field_violations || stats.tn8_currently_valid !== rows.length) {
    throw new Error("Lignes TARES perdues ou interdites");
  }
  for (const row of rows) {
    if (!/^\d{8}$/.test(row.hs8) || row.hs6 !== row.hs8.slice(0, 6) || row.heading !== row.hs8.slice(0, 4) ||
        !row.designation_fr || !row.designation_de || !row.designation_it || !row.designation_en ||
        !row.duty_rates_count || !/^\d{4}-\d{2}-\d{2}$/.test(row.valid_from)) {
      throw new Error(`Ligne TARES incomplète : ${row.hs8}`);
    }
  }
  const codes = new Set(rows.map(r => r.hs8));
  const normals = new Set<string>();
  for (const rate of rates) {
    if (!codes.has(rate.hs8) || !Number.isFinite(rate.value) || rate.value < 0 || !["Fr.", "%"].includes(rate.currency) ||
        !rate.unit_fr || !rate.basisCode || !rate.ldgCode || !rate.zcoCode || !rate.sequence || !rate.validFrom) {
      throw new Error(`Taux TARES incomplet : ${rate.hs8}`);
    }
    if (rate.ansatzart === "NT" && rate.ldgCode === "100000") normals.add(rate.hs8);
  }
  if (normals.size !== rows.length || rates.length < rows.length * 10 ||
      rates.length !== rows.reduce((n, r) => n + (r.duty_rates_count ?? 0), 0)) {
    throw new Error("Détail des taux TARES incomplet");
  }
  const old = new Map(previous.map(r => [r.hs8, r]));
  const added = rows.filter(r => !old.has(r.hs8)).map(r => r.hs8);
  const removed = previous.filter(r => !codes.has(r.hs8)).map(r => r.hs8);
  if ((added.length + removed.length) / previous.length > 0.05) throw new Error("Plus de 5 % des codes TARES remplacés");
  const fields = ["designation_fr", "designation_de", "designation_it", "designation_en", "duty_mfn_value", "duty_mfn_unit", "valid_from"] as const;
  const changes = rows.flatMap(row => {
    const before = old.get(row.hs8);
    if (!before) return [];
    return fields.filter(field => before[field] !== row[field]).map(field => ({ hs8: row.hs8, field, before: before[field] ?? null, after: row[field] ?? null }));
  });
  const changedCodes = new Set(changes.map(c => c.hs8)).size;
  if (changedCodes / previous.length > 0.15) throw new Error("Plus de 15 % des codes TARES modifiés : examen nécessaire");
  return {
    schema_version: 2, checked_at: new Date().toISOString(), rows: rows.length, rates: rates.length,
    previous_version: previousVersion, added, removed, changes,
    missing_mfn_summary: rows.filter(r => r.duty_mfn_value === undefined).length,
    comparison: "Changements observés depuis la version précédente ; seules les colonnes communes sont comparées. Les nouveaux détails de taux ne sont pas un changement douanier en soi.",
    interpretation: "Les taux détaillés conservent les conditions et unités publiées. Les résumés omettent les variantes ambiguës ; aucune absence ne signifie gratuité. Vérifier origine, contingents et conditions dans Tares officiel. unit_stat reste un ancien alias de l'unité du droit, pas une unité statistique indépendante.",
    stats,
  };
}
