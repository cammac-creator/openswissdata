import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import type { NomenclatureRow, NomenclatureScheme, NomenclatureLevel } from "./types.js";

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

interface NaceCsvRow {
  Code?: string;
  code?: string;
  Description?: string;
  description?: string;
  Parent?: string;
  parent?: string;
  [key: string]: string | undefined;
}

/**
 * Parse a Eurostat Ramon-style NACE CSV. Tolerates different header casings.
 * Labels are English only (Ramon publishes EN as primary).
 */
export function parseNaceCsv(path: string, scheme: "NACE_2.0" | "NACE_2.1"): NomenclatureRow[] {
  const raw = readFileSync(path, "utf8");
  const records: NaceCsvRow[] = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  const out: NomenclatureRow[] = [];
  for (const r of records) {
    const code = (r.Code ?? r.code ?? "").toString().trim();
    if (!code) continue;
    const clean = code.replace(/\./g, "");
    const label = (r.Description ?? r.description ?? "").toString().trim();
    out.push({
      scheme,
      code: clean,
      level: levelFromCode(code),
      parent: parentFromCode(code),
      label_en: label || undefined,
    });
  }
  return out;
}
