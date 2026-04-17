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
  | "insurance_intermediary";

export interface FinmaEntity {
  entity_type: FinmaEntityType;
  name: string;
  uid?: string;             // Swiss UID (CHE-xxx.xxx.xxx)
  lei?: string;             // Legal Entity Identifier (GLEIF)
  licence_type?: string;
  licence_date?: string;    // ISO date
  status?: string;          // "active" | "withdrawn" | "suspended" | ...
  canton?: string;          // 2-letter CH code
  address?: string;
  source_list: string;      // e.g. "finma-banks" — which upstream list this came from
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
