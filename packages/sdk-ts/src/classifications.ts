import { parseCsv } from "./helpers/csv.js";
import { join } from "node:path";

export interface NomenclatureRow {
  scheme: "NOGA_2008" | "NOGA_2025" | "NACE_2.0" | "NACE_2.1" | "ISIC_4";
  code: string;
  level: "section" | "division" | "group" | "class" | "subclass";
  parent: string | null;
  label_fr?: string;
  label_de?: string;
  label_it?: string;
  label_en?: string;
}

export interface CrossWalkRow {
  noga_2008: string | null;
  noga_2025: string | null;
  nace_2_0: string | null;
  nace_2_1: string | null;
  isic_4: string | null;
  mapping_type: "exact" | "partial" | "aggregated" | "derived";
  notes?: string;
}

async function loadScheme(baseDir: string, filename: string, scheme: NomenclatureRow["scheme"]): Promise<NomenclatureRow[]> {
  const rows = await parseCsv(join(baseDir, filename));
  return rows.map(r => ({
    scheme,
    code: String(r.code),
    level: r.level as NomenclatureRow["level"],
    parent: r.parent ? String(r.parent) : null,
    label_fr: r.label_fr ? String(r.label_fr) : undefined,
    label_de: r.label_de ? String(r.label_de) : undefined,
    label_it: r.label_it ? String(r.label_it) : undefined,
    label_en: r.label_en ? String(r.label_en) : undefined,
  }));
}

/**
 * Load all 5 nomenclatures from a Classifications bundle directory.
 * Expects the directory to contain noga_2008.csv, noga_2025.csv, nace_2_0.csv, nace_2_1.csv, isic_4.csv.
 */
export async function loadClassifications(baseDir: string): Promise<NomenclatureRow[]> {
  const results = await Promise.all([
    loadScheme(baseDir, "noga_2008.csv", "NOGA_2008"),
    loadScheme(baseDir, "noga_2025.csv", "NOGA_2025"),
    loadScheme(baseDir, "nace_2_0.csv", "NACE_2.0"),
    loadScheme(baseDir, "nace_2_1.csv", "NACE_2.1"),
    loadScheme(baseDir, "isic_4.csv", "ISIC_4"),
  ]);
  return results.flat();
}

export async function loadCrossWalks(csvPath: string): Promise<CrossWalkRow[]> {
  const rows = await parseCsv(csvPath);
  return rows.map(r => ({
    noga_2008: r.noga_2008 ? String(r.noga_2008) : null,
    noga_2025: r.noga_2025 ? String(r.noga_2025) : null,
    nace_2_0: r.nace_2_0 ? String(r.nace_2_0) : null,
    nace_2_1: r.nace_2_1 ? String(r.nace_2_1) : null,
    isic_4: r.isic_4 ? String(r.isic_4) : null,
    mapping_type: r.mapping_type as CrossWalkRow["mapping_type"],
    notes: r.notes ? String(r.notes) : undefined,
  }));
}
