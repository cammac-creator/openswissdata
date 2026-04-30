/**
 * Public types shared across the SDK.
 *
 * Mirrors the shapes returned by the live MCP tools at
 * https://mcp.openswissdata.com/jsonrpc — kept in sync with
 * `src/mcp/tools/*.ts` in the upstream repo.
 */

// -- Common -----------------------------------------------------------------

export type Lang = "fr" | "de" | "it" | "en";

export type ClassificationScheme =
  | "NOGA_2008"
  | "NOGA_2025"
  | "NACE_2.0"
  | "NACE_2.1"
  | "ISIC_4";

// -- TARES ------------------------------------------------------------------

export interface TariffLookupInput {
  hs8: string;
  lang?: Lang;
}

export interface TariffLookupResult {
  hs8: string;
  hs6: string;
  chapter: string;
  heading: string;
  designation: string;
  designations_all: { fr: string; de: string; it: string; en: string };
  unit_stat: string;
  duty_mfn: { value: number | null; unit: string | null; currency: string | null };
  preferential_regimes: Record<string, number | "free">;
  restrictions_codes: string[];
  customs_relief_codes: string[];
  valid_from: string;
  source_url: string;
  /** Mandatory non-official disclaimer — must be surfaced to the end user. */
  disclaimer: string;
}

export interface TariffSemanticSearchInput {
  query: string;
  top_k?: number;
  lang?: "fr";
}

export interface TariffSemanticHit {
  hs_code: string;
  description: string;
  score: number;
}

export interface TariffSemanticSearchResult {
  query: string;
  hits: TariffSemanticHit[];
  count: number;
  model: string;
  /** Mandatory non-official disclaimer. */
  disclaimer: string;
}

export interface TariffChangelogInput {
  hs8: string;
  /** ISO date YYYY-MM-DD; only changes recorded on/after are returned. */
  since?: string;
}

export interface TariffChangelogChange {
  from_version: string;
  to_version: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  recorded_at: number;
}

export interface TariffChangelogResult {
  hs_code: string;
  current: {
    duty_mfn_value: number | null;
    duty_mfn_unit: string | null;
    duty_mfn_currency: string | null;
    designation_fr: string | null;
    valid_from: string | null;
  };
  changes: TariffChangelogChange[];
  versions_observed: string[];
  source_note: string;
}

// -- Classifications --------------------------------------------------------

export interface CrossWalkInput {
  code: string;
  source: ClassificationScheme;
  target: ClassificationScheme;
}

export interface CrossWalkMapping {
  source_code: string;
  target_code: string;
  mapping_type: string;
  notes: string;
}

export interface CrossWalkResult {
  source_scheme: ClassificationScheme;
  target_scheme: ClassificationScheme;
  source_code: string;
  mappings: CrossWalkMapping[];
  count: number;
}

export interface ClassifyTextInput {
  text: string;
  top_k?: number;
  lang?: "fr";
  scheme?: "NOGA_2025" | "NACE_2.1";
}

export interface ClassifyTextHit {
  code: string;
  label_fr: string;
  score: number;
}

export interface ClassifyTextResult {
  query: string;
  scheme_requested: "NOGA_2025" | "NACE_2.1";
  scheme_returned: "NOGA_2025";
  hits: ClassifyTextHit[];
  count: number;
  model: string;
  /** True when scheme_requested ≠ scheme_returned (NACE fallback). */
  degraded?: boolean;
}

// -- FINMA ------------------------------------------------------------------

export interface KycCheckInput {
  name: string;
  top_k?: number;
}

export interface KycMatch {
  entity_type: string;
  name: string;
  uid: string | null;
  lei: string | null;
  licence_type: string;
  status: string;
  canton: string | null;
  city: string;
  is_warning_listed: boolean;
  source_url: string;
}

export interface KycWarning {
  name: string;
  warning_type: string;
  category: string;
  date_added: string;
  source_url: string;
}

export interface KycCheckResult {
  query: string;
  registry_matches: KycMatch[];
  warning_matches: KycWarning[];
  match_count: number;
  warning_count: number;
}

export interface FinmaSearchInput {
  name: string;
  top_k?: number;
  include_warnings?: boolean;
}

export interface FinmaSearchMatch {
  name: string;
  uid: string | null;
  lei: string | null;
  entity_type: string;
  licence_type: string;
  status: string;
  city: string;
  canton: string | null;
  is_warning_listed: boolean;
  source_url: string;
  score: number;
}

export interface FinmaSearchWarning {
  name: string;
  warning_type: string;
  category: string;
  date_added: string;
  source_url: string;
  score: number;
}

export interface FinmaSearchResult {
  query: string;
  matches: FinmaSearchMatch[];
  warnings?: FinmaSearchWarning[];
  match_count: number;
}

export interface EntityHistoryInput {
  uid: string;
}

export interface EntityHistoryEvent {
  /** "added" | "field_changed" */
  event: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  recorded_at: number;
  version: string;
}

export interface EntityHistoryResult {
  uid: string;
  current: {
    name: string | null;
    licence_type: string | null;
    status: string | null;
    canton: string | null;
    city: string | null;
    is_warning_listed: boolean | null;
  };
  timeline: EntityHistoryEvent[];
  versions_observed: string[];
  source_note: string;
}

// -- MCP wire types ---------------------------------------------------------

/** JSON-RPC 2.0 request. */
export interface JsonRpcRequest<P = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: P;
}

/** JSON-RPC 2.0 response. */
export interface JsonRpcResponse<R = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: R;
  error?: { code: number; message: string; data?: unknown };
}

/** Shape of `result` for `tools/call`. */
export interface ToolCallResult<S = unknown> {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: S;
}

/** Discovery payload (`GET /discovery`). */
export interface ServerInfo {
  protocol_version: string;
  server_info: { name: string; version: string };
  capabilities: { tools: { list_changed: boolean } };
  tools: string[];
}
