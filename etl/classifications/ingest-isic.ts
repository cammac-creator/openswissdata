import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import type { NomenclatureRow, NomenclatureLevel } from "./types.js";

function levelFromCode(code: string): NomenclatureLevel {
  const clean = code.replace(/\./g, "");
  if (/^[A-Z]$/.test(clean)) return "section";
  switch (clean.length) {
    case 2: return "division";
    case 3: return "group";
    case 4: return "class";
    default: return "subclass";
  }
}

function parentFromCode(code: string): string | null {
  const clean = code.replace(/\./g, "");
  if (clean.length <= 1) return null;
  return clean.slice(0, -1);
}

interface IsicCsvRow {
  Code?: string;
  Description?: string;
  Parent?: string;
  [key: string]: string | undefined;
}

export function parseIsicCsv(path: string): NomenclatureRow[] {
  const raw = readFileSync(path, "utf8");
  const records: IsicCsvRow[] = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  const out: NomenclatureRow[] = [];
  for (const r of records) {
    const code = (r.Code ?? "").toString().trim();
    if (!code) continue;
    const clean = code.replace(/\./g, "");
    const label = (r.Description ?? "").toString().trim();
    const parentRaw = (r.Parent ?? "").toString().trim();
    const parent = parentRaw ? parentRaw.replace(/\./g, "") : parentFromCode(code);
    out.push({
      scheme: "ISIC_4",
      code: clean,
      level: levelFromCode(code),
      parent,
      label_en: label || undefined,
    });
  }
  return out;
}
