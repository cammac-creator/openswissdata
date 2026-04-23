import xlsx from "xlsx";

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
  if (!Number.isFinite(n)) return null;
  // Excel epoch: 1899-12-30 (accounts for the 1900 leap-year bug).
  const ms = (n - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
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

// ---------- tariff_8_digit ----------

export interface Tn8ValidityRow {
  hs8: string;
  validFrom: string | null;  // ISO date
  validTo: string | null;    // ISO date
}

export function parseTariff8Digit(path: string): Tn8ValidityRow[] {
  const { rows } = readSheet(path);
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
  const { rows } = readSheet(path);
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
  currency: string;         // ANS Einheit (always "Fr." in practice)
  unit_de: string;          // BGL Txt D Faktor — e.g. "je 100 kg brutto"
  unit_fr: string;
  unit_it: string;
  unit_en: string;
  validFrom: string | null;
  validTo: string | null;
}

export function parseDutyRates(paths: string[]): DutyRateRow[] {
  const out: DutyRateRow[] = [];
  for (const path of paths) {
    const { rows } = readSheet(path);
    for (const r of rows) {
      const hs8 = stripDot(r["TN8 Nr"]);
      if (!hs8) continue;
      const value = r["ANS berechnet"];
      out.push({
        hs8,
        ansatzart: String(r["ANS Ansatzart"] ?? "").trim(),
        ldgCode: String(r["LDG Nr"] ?? "").trim(),
        ldgText_de: String(r["LDG Ltxt D"] ?? "").trim(),
        ldgText_fr: String(r["LDG Ltxt F"] ?? "").trim(),
        ldgText_it: String(r["LDG Ltxt I"] ?? "").trim(),
        ldgText_en: String(r["LDG Ltxt E"] ?? "").trim(),
        value: typeof value === "number" ? value : Number(value ?? 0),
        currency: String(r["ANS Einheit"] ?? "Fr.").trim(),
        unit_de: String(r["BGL Txt D Faktor"] ?? "").trim(),
        unit_fr: String(r["BGL Txt F Faktor"] ?? "").trim(),
        unit_it: String(r["BGL Txt I Faktor"] ?? "").trim(),
        unit_en: String(r["BGL Txt E Faktor"] ?? "").trim(),
        validFrom: excelSerialToIso(r["ANS Vdat berechnet"] as number),
        validTo: excelSerialToIso(r["ANS Bdat berechnet"] as number),
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
  const { rows } = readSheet(path);
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
