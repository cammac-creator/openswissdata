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
  /**
   * True if a fuzzy-name match (score >= 0.8) was found against the FINMA
   * Warning List. Computed during cross-reference, not from upstream.
   */
  is_warning_listed?: boolean;
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

/**
 * One entry in the FINMA Warning List — a public list of companies and
 * individuals carrying out financial activities without FINMA authorisation.
 *
 * Source: https://www.finma.ch/en/finma-public/warnungen/warning-list/
 */
export interface FinmaWarning {
  /** Entity name as published by FINMA. */
  name: string;
  /** ISO 2-letter country code, when available. Always undefined in v1
   *  (would require fetching one detail page per entity). */
  country?: string;
  /** ISO date (YYYY-MM-DD) when the entity was added to the warning list. */
  date_added?: string;
  /** Free-text label from FINMA, e.g. "Entered in commercial register" or
   *  "Not entered in commercial register". */
  category?: string;
  /** Absolute URL of the entity's FINMA detail page. */
  source_url: string;
  /** Always "finma-warnings". */
  source_list: "finma-warnings";
  /** Bucket label, e.g. "unauthorized_provider". */
  warning_type: string;
  /** Free text holding upstream sub-fields not yet promoted to first-class
   *  columns (currently the slug derived from the URL). */
  additional_info?: string;
}
