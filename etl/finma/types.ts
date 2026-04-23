export type FinmaEntityType =
  | "bank"
  | "insurance"
  | "asset_manager_collective"
  | "asset_manager_individual"
  | "securities_firm"
  | "fund_representative"
  | "payment_institution"
  | "sro_member"
  | "supervisory_org"
  | "insurance_intermediary"
  | "fintech"
  | "infrastructure"
  | "other";

export interface FinmaEntity {
  entity_type: FinmaEntityType;
  name: string;
  uid?: string;             // Swiss UID (CHE-xxx.xxx.xxx)
  lei?: string;             // Legal Entity Identifier (GLEIF) — optional, not in uid.csv
  licence_type?: string;    // raw AuthorisationType label (EN preferred)
  licence_type_de?: string; // German label
  licence_type_fr?: string; // French label
  licence_type_it?: string; // Italian label
  licence_date?: string;    // ISO date — not in uid.csv (only in per-category XLSX)
  status?: string;          // "active" | "withdrawn" | "suspended" | ...
  canton?: string;          // 2-letter CH code
  city?: string;            // raw city (uid.csv has City column)
  address?: string;
  source_list: string;      // e.g. "finma-uid-csv"
  source_url: string;
}

export interface FinmaSource {
  entity_type: FinmaEntityType;
  source_list: string;      // "finma-banks", "finma-psp", ...
  source_url: string;
  /**
   * Map from upstream XLSX column name (as it appears in the header row) to
   * FinmaEntity field name. Columns not in the map are ignored.
   */
  headers_map: Partial<Record<string, keyof FinmaEntity>>;
}
