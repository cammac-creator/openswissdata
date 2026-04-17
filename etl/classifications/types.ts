export type NomenclatureScheme = "NOGA_2008" | "NOGA_2025" | "NACE_2.0" | "NACE_2.1" | "ISIC_4";

export type NomenclatureLevel = "section" | "division" | "group" | "class" | "subclass";

export interface NomenclatureRow {
  scheme: NomenclatureScheme;
  code: string;
  level: NomenclatureLevel;
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
