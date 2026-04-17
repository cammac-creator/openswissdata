import XLSX from "xlsx";
import type { NomenclatureRow, NomenclatureScheme, NomenclatureLevel } from "./types.js";

const { readFile, utils } = XLSX;

function levelFromCode(code: string): NomenclatureLevel {
  const clean = code.replace(/\./g, "");
  switch (clean.length) {
    case 1: return "section";
    case 2: return "division";
    case 3: return "group";
    case 4: return "class";
    default: return "subclass";
  }
}

function parentFromCode(code: string): string | null {
  const clean = code.replace(/\./g, "");
  return clean.length > 1 ? clean.slice(0, -1) : null;
}

function findColumnIndex(header: unknown[], needles: string[]): number {
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] ?? "").toLowerCase();
    if (needles.some(n => h.includes(n.toLowerCase()))) return i;
  }
  return -1;
}

/**
 * Parse a BFS-style NOGA XLSX file.
 * Expects column headers that contain:
 *   - "code" (German/French/English variants)
 *   - FR label column (titre/français)
 *   - DE label column (titel/deutsch)
 *   - IT label column (italiano)
 *
 * The parser tolerates different header spellings across BFS file versions.
 */
export function parseNogaXlsx(path: string, scheme: NomenclatureScheme): NomenclatureRow[] {
  const wb = readFile(path);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error(`No sheet in ${path}`);

  const rows: unknown[][] = utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (rows.length < 2) return [];

  const header = rows[0];
  const codeCol = findColumnIndex(header, ["code"]);
  const frCol = findColumnIndex(header, ["titre français", "français", "francais", "titre fr"]);
  const deCol = findColumnIndex(header, ["titel deutsch", "deutsch", "bezeichnung"]);
  const itCol = findColumnIndex(header, ["italiano", "titolo italiano"]);

  if (codeCol < 0) throw new Error(`No code column found in ${path}`);

  const out: NomenclatureRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rawCode = r[codeCol];
    if (rawCode === null || rawCode === undefined || String(rawCode).trim() === "") continue;
    const code = String(rawCode).replace(/\./g, "").trim();
    if (!/^[0-9]+$/.test(code) && !/^[A-Z]$/.test(code)) continue; // skip non-code rows (headings etc.)
    out.push({
      scheme,
      code,
      level: levelFromCode(code),
      parent: parentFromCode(code),
      label_fr: frCol >= 0 && r[frCol] != null ? String(r[frCol]).trim() : undefined,
      label_de: deCol >= 0 && r[deCol] != null ? String(r[deCol]).trim() : undefined,
      label_it: itCol >= 0 && r[itCol] != null ? String(r[itCol]).trim() : undefined,
    });
  }
  return out;
}
