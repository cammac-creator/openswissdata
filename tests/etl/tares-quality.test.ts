import { describe, it, expect } from "vitest";
import { validateTares } from "../../etl/tares/quality.js";
import type { BuildResult } from "../../etl/tares/build-rows.js";
function sample(): BuildResult {
  const rows = Array.from({ length: 6_000 }, (_, i) => ({ hs8: String(1000000 + i).padStart(8, "0"), hs6: String(1000000 + i).padStart(8, "0").slice(0, 6), heading: "0100", chapter: 1, designation_fr: "Exemple", designation_de: "Beispiel", designation_it: "Esempio", designation_en: "Example", unit_stat: "", preferential_regimes: {}, restrictions_codes: [], valid_from: "2026-01-01", source_url: "https://example.test", duty_rates_count: 10 }));
  const rates = rows.flatMap(row => Array.from({ length: 10 }, (_, i) => ({ hs8: row.hs8, ansatzart: i ? "PR" : "NT", ldgCode: i ? String(i) : "100000", ldgText_de: "", ldgText_fr: "", ldgText_it: "", ldgText_en: "", value: 0, currency: "Fr.", unit_de: "", unit_fr: "par pièce", unit_it: "", unit_en: "", validFrom: "2026-01-01", validTo: null, zcoCode: "00", sequence: "1", conditions_fr: "", basisCode: "201", source_file: "fictif.xlsx", source_record: {} })));
  return { rows, rates, stats: { tn8_total: 6_000, tn8_currently_valid: 6_000, duty_rate_rows_loaded: 60_000, duty_rate_rows_kept: 60_000, customs_relief_rows_loaded: 0, rows_dropped_no_designation: 0, forbidden_field_violations: 0 } };
}
describe("Qualité TARES avant publication", () => {
  it("compare les codes et accepte les résumés absents si le détail existe", () => { const data = sample(); const report = validateTares(data, data.rows, "2026.01.01"); expect(report.rows).toBe(6_000); expect(report.rates).toBe(60_000); expect(report.changes).toEqual([]); expect(report.missing_mfn_summary).toBe(6_000); });
  it("bloque une source vide", () => { const data = sample(); expect(() => validateTares({ ...data, rows: [] }, data.rows, "ancien")).toThrow("Volume"); });
  it("bloque une chute de volume", () => { const data = sample(); expect(() => validateTares(data, [...data.rows, ...data.rows], "ancien")).toThrow("Variation"); });
  it("bloque les doublons", () => { const data = sample(); data.rows[1] = data.rows[0]; expect(() => validateTares(data, data.rows, "ancien")).toThrow("double"); });
  it("bloque une langue manquante", () => { const data = sample(); data.rows[0].designation_it = ""; expect(() => validateTares(data, data.rows, "ancien")).toThrow("incomplète"); });
  it.each([NaN, -1, Infinity])("bloque un taux invalide %s", value => { const data = sample(); data.rates[0].value = value; expect(() => validateTares(data, data.rows, "ancien")).toThrow("incomplet"); });
  it("bloque un changement d'unité monétaire", () => { const data = sample(); data.rates[0].currency = "EUR"; expect(() => validateTares(data, data.rows, "ancien")).toThrow("incomplet"); });
  it("bloque une perte du détail", () => { const data = sample(); data.rates.pop(); expect(() => validateTares(data, data.rows, "ancien")).toThrow("Détail"); });
  it("bloque une variation massive des champs", () => { const data = sample(); const before = data.rows.map(r => ({ ...r, designation_fr: "Ancien" })); expect(() => validateTares(data, before, "ancien")).toThrow("15 %"); });
});
