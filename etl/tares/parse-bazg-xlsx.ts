import xlsx from "../shared/xlsx.js";

/**
 * Parsers for the BAZG XLSX files referenced in sources.ts.
 *
 * BAZG stores tariff numbers as "0101.2110" (4 + dot + 4). We strip the dot
 * everywhere so all keys are canonical 8-digit strings ("01012110") matching
 * TaresRow.hs8.
 */

function stripDot(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const c = code.replace(/\./g, "").trim();
  return /^\d{8}$/.test(c) ? c : null;
}

function excelSerialToIso(serial: number | string | undefined): string | null {
  if (serial === undefined || serial === null || serial === "") return null;
  const n = typeof serial === "number" ? serial : Number(serial);
  if (!Number.isFinite(n)) throw new Error("Date BAZG invalide");
  // Excel epoch: 1899-12-30 (accounts for the 1900 leap-year bug).
  const ms = (n - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) throw new Error("Date BAZG invalide");
  return d.toISOString().slice(0, 10);
}

function readSheet(path: string, sheetIndex = 0): { headers: string[]; rows: Record<string, unknown>[] } {
  const wb = xlsx.readFile(path);
  const ws = wb.Sheets[wb.SheetNames[sheetIndex]];
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  if (aoa.length === 0) return { headers: [], rows: [] };
  // Heuristic: most BAZG sheets have a 1-row title before the headers.
  // Detect: if row 0 has only a single non-null cell and row 1 has many → headers are at row 1.
  let headerRowIdx = 0;
  const r0 = aoa[0] ?? [];
  const r1 = aoa[1] ?? [];
  const r0Filled = r0.filter((v) => v !== null && v !== "").length;
  const r1Filled = r1.filter((v) => v !== null && v !== "").length;
  if (r0Filled <= 1 && r1Filled > 3) headerRowIdx = 1;
  const headers = (aoa[headerRowIdx] as unknown[]).map((h) => (h == null ? "" : String(h).trim()));
  const rows = aoa.slice(headerRowIdx + 1).map((r) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = r[i] ?? null;
    return obj;
  });
  return { headers, rows };
}

function requireHeaders(headers: string[], expected: string[]): void {
  const missing = expected.filter(h => !headers.includes(h));
  if (missing.length) throw new Error(`Structure BAZG modifiée : colonnes absentes ${missing.join(", ")}`);
}

// ---------- tariff_8_digit ----------

export interface Tn8ValidityRow {
  hs8: string;
  validFrom: string | null;  // ISO date
  validTo: string | null;    // ISO date
}

export function parseTariff8Digit(path: string): Tn8ValidityRow[] {
  const { headers, rows } = readSheet(path);
  requireHeaders(headers, ["TN8 Nr", "TN8 Vdat", "TN8 Bdat"]);
  const out: Tn8ValidityRow[] = [];
  for (const r of rows) {
    const hs8 = stripDot(r["TN8 Nr"]);
    if (!hs8) continue;
    out.push({
      hs8,
      validFrom: excelSerialToIso(r["TN8 Vdat"] as number),
      validTo: excelSerialToIso(r["TN8 Bdat"] as number),
    });
  }
  return out;
}

// ---------- tarifstruktur ----------

export interface StructureNode {
  type: string;          // TAB, TN2, TN4, TN6, TN8
  code: string;          // canonical (no dot)
  rawCode: string;       // as published
  text_de: string;
  text_fr: string;
  text_it: string;
  text_en: string;
}

export function parseTarifstruktur(path: string): StructureNode[] {
  const { headers, rows } = readSheet(path);
  requireHeaders(headers, ["Typ", "Numm", "Text D", "Text F", "Text I", "Text E"]);
  const out: StructureNode[] = [];
  for (const r of rows) {
    const type = String(r["Typ"] ?? "").trim();
    const raw = String(r["Numm"] ?? "").trim();
    if (!type || !raw) continue;
    const code = raw.replace(/\./g, "");
    out.push({
      type,
      code,
      rawCode: raw,
      text_de: String(r["Text D"] ?? "").trim(),
      text_fr: String(r["Text F"] ?? "").trim(),
      text_it: String(r["Text I"] ?? "").trim(),
      text_en: String(r["Text E"] ?? "").trim(),
    });
  }
  return out;
}

// ---------- duty_rates_chapter_* ----------

export interface DutyRateRow {
  hs8: string;
  ansatzart: string;        // NT (normal/MFN), PR (préférentiel), Z (zoll quota), ...
  ldgCode: string;          // LDG Nr — 100000 = MFN, 100002 = AELE, etc.
  ldgText_de: string;
  ldgText_fr: string;
  ldgText_it: string;
  ldgText_en: string;
  value: number;            // ANS berechnet
  currency: string;         // Unité publiée ANS Einheit : « Fr. » ou « % », conservée sans conversion.
  unit_de: string;          // BGL Txt D Faktor — e.g. "je 100 kg brutto"
  unit_fr: string;
  unit_it: string;
  unit_en: string;
  validFrom: string | null;
  validTo: string | null;
  zcoCode: string;
  sequence: string;
  conditions_fr: string;
  basisCode: string;
  source_file: string;
  source_record: Record<string, unknown>;
}

export function parseDutyRates(paths: string[]): DutyRateRow[] {
  const out: DutyRateRow[] = [];
  for (const path of paths) {
    const { headers, rows } = readSheet(path);
    requireHeaders(headers, ["TN8 Nr", "ZCO Code", "ANS Laufnr", "ANS Ansatzart", "LDG Nr", "ANS berechnet", "ANS Einheit", "ANS Vdat berechnet", "ANS Bdat berechnet", "BGL Code", "BGL Txt F Faktor", "ANS Txt F"]);
    const allowed = ["TN8 Nr", "ZCO Code", "ZEL Tariflinie", "ANS Generaleinfuhrbewilligungscode", "ANS Laufnr", "ANS Txt D", "ANS Txt F", "ANS Txt I", "ANS Txt E", "ANS Ansatzart", "LDG Nr", "LDG Ltxt D", "LDG Ltxt F", "LDG Ltxt I", "LDG Ltxt E", "ANS berechnet", "ANS Einheit", "ANS Vdat berechnet", "ANS Bdat berechnet", "BGL Code", "BGL Txt D Faktor", "BGL Txt F Faktor", "BGL Txt I Faktor", "BGL Txt E Faktor", "ANS Direktbeförderung", "ANP Zusammengefasst", "PAN Vdat", "PAN Bdat"];
    if (headers.some(h => !allowed.includes(h))) throw new Error("Nouvelles colonnes BAZG à examiner avant redistribution");
    for (const r of rows) {
      const hs8 = stripDot(r["TN8 Nr"]);
      if (!hs8) {
        if (r["TN8 Nr"] != null && r["TN8 Nr"] !== "") throw new Error("Code tarifaire BAZG invalide");
        continue;
      }
      const value = r["ANS berechnet"];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`Taux BAZG absent ou invalide pour ${hs8}`);
      }
      out.push({
        hs8,
        ansatzart: String(r["ANS Ansatzart"] ?? "").trim(),
        ldgCode: String(r["LDG Nr"] ?? "").trim(),
        ldgText_de: String(r["LDG Ltxt D"] ?? "").trim(),
        ldgText_fr: String(r["LDG Ltxt F"] ?? "").trim(),
        ldgText_it: String(r["LDG Ltxt I"] ?? "").trim(),
        ldgText_en: String(r["LDG Ltxt E"] ?? "").trim(),
        value,
        currency: String(r["ANS Einheit"] ?? "").trim(),
        unit_de: String(r["BGL Txt D Faktor"] ?? "").trim(),
        unit_fr: String(r["BGL Txt F Faktor"] ?? "").trim(),
        unit_it: String(r["BGL Txt I Faktor"] ?? "").trim(),
        unit_en: String(r["BGL Txt E Faktor"] ?? "").trim(),
        validFrom: excelSerialToIso(r["ANS Vdat berechnet"] as number),
        validTo: excelSerialToIso(r["ANS Bdat berechnet"] as number),
        zcoCode: String(r["ZCO Code"] ?? "").trim(),
        sequence: String(r["ANS Laufnr"] ?? "").trim(),
        conditions_fr: String(r["ANS Txt F"] ?? "").trim(),
        basisCode: String(r["BGL Code"] ?? "").trim(),
        source_file: path.split(/[\\/]/).at(-1)!,
        source_record: r,
      });
    }
  }
  return out;
}

// ---------- customs_facilities ----------

export interface ReliefRow {
  hs8: string;
  zcoCode: string;          // Customs relief code (ZCO Code)
  validFrom: string | null;
  validTo: string | null;
}

export function parseCustomsFacilities(path: string): ReliefRow[] {
  const { headers, rows } = readSheet(path);
  requireHeaders(headers, ["TN8 Nr", "ZCO Code", "ZEL Vdat", "ZEL Bdat"]);
  const out: ReliefRow[] = [];
  for (const r of rows) {
    const hs8 = stripDot(r["TN8 Nr"]);
    if (!hs8) continue;
    out.push({
      hs8,
      zcoCode: String(r["ZCO Code"] ?? "").trim(),
      validFrom: excelSerialToIso(r["ZEL Vdat"] as number),
      validTo: excelSerialToIso(r["ZEL Bdat"] as number),
    });
  }
  return out;
}
