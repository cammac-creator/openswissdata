import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import xlsx from "xlsx";
import { downloadAllSources } from "../../etl/tares/sources.js";
import { parseDutyRates } from "../../etl/tares/parse-bazg-xlsx.js";
let temp: string;
beforeEach(() => { temp = mkdtempSync(join(tmpdir(), "osd-tares-sources-")); });
afterEach(() => { rmSync(temp, { recursive: true, force: true }); vi.unstubAllGlobals(); });
describe("Transport BAZG", () => {
  it("archive les octets avant lecture et réutilise un cache vérifié", async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]); const http = vi.fn(async () => new Response(bytes)); vi.stubGlobal("fetch", http);
    const paths = await downloadAllSources(temp); expect(Object.keys(paths)).toHaveLength(7); expect(readFileSync(paths.tariff_8_digit)).toEqual(bytes);
    expect(paths.tariff_8_digit).toContain("/bronze/"); expect(await downloadAllSources(temp)).toEqual(paths); expect(http).toHaveBeenCalledTimes(7);
    await downloadAllSources(temp, { maxAgeHours: 0 }); expect(http).toHaveBeenCalledTimes(14); expect(readFileSync(paths.tariff_8_digit)).toEqual(bytes);
  });
  it("conserve une erreur HTML dans le bronze sans la valider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Erreur</html>")));
    await expect(downloadAllSources(temp)).rejects.toThrow("non XLSX");
    const folder = join(temp, "bronze", new Date().toISOString().slice(0, 10)); expect(readdirSync(folder)).toHaveLength(1); expect(readdirSync(temp)).not.toContain("tariff_8_digit.cache.json");
  });
  it("ne remplace pas le bronze lors d’une coupure du téléchargement", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0x50, 0x4b])); controller.error(Error("coupure")); } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream))); await expect(downloadAllSources(temp)).rejects.toThrow("coupure"); expect(readdirSync(temp)).toHaveLength(0);
  });
});
const source = { "TN8 Nr": "0406.9051", "ZCO Code": "00", "ANS Laufnr": "2", "ANS Ansatzart": "NT", "LDG Nr": "100000", "ANS berechnet": 50, "ANS Einheit": "Fr.", "ANS Vdat berechnet": 41640, "ANS Bdat berechnet": 401768, "BGL Code": "206", "BGL Txt F Faktor": "par 100 kg brut", "ANS Txt F": "dans les limites du contingent" };
function sheet(row: Record<string, unknown>) { const path = join(temp, "source.xlsx"), wb = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([row]), "Taux"); xlsx.writeFile(wb, path); return path; }
describe("Lecture sans perte des taux", () => {
  it("conserve les conditions et cellules originales", () => { const [row] = parseDutyRates([sheet(source)]); expect(row.conditions_fr).toBe(source["ANS Txt F"]); expect(row.sequence).toBe("2"); expect(row.source_record).toEqual(source); });
  it("refuse une colonne de taux renommée", () => { const row: Record<string, unknown> = { ...source }; delete row["ANS berechnet"]; row["Nouveau taux"] = 50; expect(() => parseDutyRates([sheet(row)])).toThrow("colonnes absentes"); });
  it("refuse des nouveaux champs non examinés", () => { expect(() => parseDutyRates([sheet({ ...source, Erläuterungen: "texte hors périmètre" })])).toThrow("redistribution"); });
  it("ne transforme jamais une valeur vide en gratuité", () => { expect(() => parseDutyRates([sheet({ ...source, "ANS berechnet": null })])).toThrow("absent ou invalide"); });
  it("refuse une date illisible", () => { expect(() => parseDutyRates([sheet({ ...source, "ANS Vdat berechnet": "inconnue" })])).toThrow("Date BAZG"); });
});
