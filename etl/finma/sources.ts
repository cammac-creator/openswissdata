import { mkdirSync, existsSync, statSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FinmaSource } from "./types.js";

/**
 * FINMA publishes a single consolidated CSV with ALL authorised institutions
 * (UID, name, city, AuthorisationType in DE/FR/IT/EN). Updated daily.
 *
 * https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/
 */
export const FINMA_UID_CSV_URL =
  "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/csv/uid.csv";

export const FINMA_UID_CSV_SOURCE: FinmaSource = {
  entity_type: "bank", // placeholder — actual entity_type is derived per row
  source_list: "finma-uid-csv",
  source_url:
    "https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/",
  headers_map: {
    Name: "name",
    UID: "uid",
    City: "city",
    AuthorisationTypeEN: "licence_type",
    AuthorisationTypeDE: "licence_type_de",
    AuthorisationTypeFR: "licence_type_fr",
    AuthorisationTypeIT: "licence_type_it",
  },
};

/**
 * Legacy per-category source configs — kept for fixture-based tests and
 * future enrichment paths. Production ingest now uses FINMA_UID_CSV_SOURCE.
 */
export const FINMA_SOURCES: FinmaSource[] = [
  {
    entity_type: "bank",
    source_list: "finma-banks",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/banks/",
    headers_map: { Name: "name", Firma: "name", "UID-Number": "uid", UID: "uid", Canton: "canton", Kanton: "canton", Address: "address", Adresse: "address", "Licence date": "licence_date", "Datum der Bewilligung": "licence_date", Status: "status", "Licence type": "licence_type" },
  },
  {
    entity_type: "insurance",
    source_list: "finma-insurance",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/insurance/",
    headers_map: { Name: "name", Firma: "name", UID: "uid", Canton: "canton", Kanton: "canton", Address: "address", Adresse: "address", "Licence date": "licence_date", Status: "status" },
  },
  {
    entity_type: "payment_institution",
    source_list: "finma-psp",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/fintechs/",
    headers_map: { Name: "name", UID: "uid", Canton: "canton", Address: "address", "Licence date": "licence_date", "Licence type": "licence_type" },
  },
  {
    entity_type: "asset_manager_collective",
    source_list: "finma-asset-manager-collective",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/asset-managers-collective/",
    headers_map: { Name: "name", Firma: "name", UID: "uid", Canton: "canton", Kanton: "canton", Address: "address", "Licence date": "licence_date" },
  },
  {
    entity_type: "asset_manager_individual",
    source_list: "finma-asset-manager-individual",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/asset-managers/",
    headers_map: { Name: "name", UID: "uid", Canton: "canton", Address: "address", "Licence date": "licence_date" },
  },
  {
    entity_type: "securities_firm",
    source_list: "finma-securities-firms",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/securities-firms/",
    headers_map: { Name: "name", UID: "uid", Canton: "canton", Address: "address", "Licence date": "licence_date" },
  },
  {
    entity_type: "fund_representative",
    source_list: "finma-fund-representatives",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/representatives/",
    headers_map: { Name: "name", UID: "uid", Canton: "canton", Address: "address", "Licence date": "licence_date" },
  },
  {
    entity_type: "sro_member",
    source_list: "finma-sro-members",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/sro-members/",
    headers_map: { Name: "name", UID: "uid", Canton: "canton", SRO: "licence_type" },
  },
  {
    entity_type: "supervisory_org",
    source_list: "finma-supervisory-orgs",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/supervisory-organisations/",
    headers_map: { Name: "name", UID: "uid", Address: "address" },
  },
  {
    entity_type: "insurance_intermediary",
    source_list: "finma-insurance-intermediaries",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/insurance-intermediaries/",
    headers_map: { Name: "name", UID: "uid", Canton: "canton", Address: "address", "Licence date": "licence_date" },
  },
];

/**
 * Per-category XLSX URLs kept for future enrichment (e.g. licence date, status,
 * branch addresses). Not used by ingest v1 but referenced in README documentation.
 */
export const FINMA_PER_CATEGORY_XLSX: Record<string, string> = {
  banks: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/beh.xlsx",
  raiffeisen: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/raiff.xlsx",
  bank_repoffices: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/repbeh.xlsx",
  bank_status2: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/beh_status2.xlsx",
  fintech: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/fintech.xlsx",
  fintech_repoffices: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/fintechvtr.xlsx",
  insurance_companies: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/vu.xlsx",
  insurance_groups: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/vk.xlsx",
  insurance_uk_bfsa: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/bfsa.xlsx",
  insurance_intermediaries: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/uvvreg.xlsx",
  swiss_collective_invest_schemes: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/afch.xlsx",
  foreign_collective_invest_schemes: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/afetr.xlsx",
  fund_management_and_managers: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/flvervt.xlsx",
  manager_repoffices: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/repvkv.xlsx",
  portfolio_managers_sro: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/vvtr.xlsx",
  portfolio_managers_finig: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/grfinig.xlsx",
  portfolio_managers_repoffices: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/repvvtr.xlsx",
  trading_venues: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/bourses.xlsx",
  sros: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/sro.xlsx",
  supervisory_orgs: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/ao.xlsx",
  prospectus_reviewers: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/prprosp.xlsx",
  registration_bodies: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/regst.xlsx",
};

/**
 * Map FINMA AuthorisationTypeEN labels (37 distinct values in 2026-04 snapshot)
 * to our internal entity_type taxonomy. Anything unmapped falls back to "other".
 */
export const AUTH_TYPE_TO_ENTITY_TYPE: Record<string, import("./types.js").FinmaEntityType> = {
  // Banks & deposit-taking
  "Bank": "bank",
  "Custodian bank": "bank",
  "Foreign bank branch office": "bank",
  "Foreign bank representative office": "bank",
  "Raiffeisen bank": "bank",
  "Mortgage bond institution": "bank",

  // Securities firms
  "Securities firm": "securities_firm",
  "Foreign securities firm branch office": "securities_firm",
  "Foreign securities firm representative office": "securities_firm",

  // Insurance
  "Non-life insurer": "insurance",
  "Life insurance company": "insurance",
  "Health insurance company under ICA": "insurance",
  "General health insurance company": "insurance",
  "Professional reinsurer": "insurance",
  "reinsurance captive": "insurance",
  "Insurance activities through a local branch in Switzerland": "insurance",
  "Insurance activities through the free provision of services in Switzerland": "insurance",
  "Insurance activities through the free provision of services in Liechtenstein": "insurance",
  "Insurance group": "insurance",

  // Asset management — collective
  "Manager of collective assets": "asset_manager_collective",
  "Fund management company": "asset_manager_collective",
  "Investment company with variable capital (SICAV)": "asset_manager_collective",
  "Limited partnership for collective investment schemes": "asset_manager_collective",

  // Asset management — individual
  "Portfolio manager": "asset_manager_individual",
  "Trustee": "asset_manager_individual",

  // Foreign-fund representatives
  "Representatives of foreign collective investment schemes (CISA)": "fund_representative",

  // FinTech
  "persons under Article 1b of the Banking Act": "fintech",
  "Vertretungen ausländischer Personen nach Art. 1b Bankengesetz": "fintech",

  // Supervisory & SRO
  "Supervisory organisation": "supervisory_org",

  // Market infrastructure
  "Central counterparty": "infrastructure",
  "Central custodian": "infrastructure",
  "Multilateral trading system": "infrastructure",
  "Swiss trading venue": "infrastructure",
  "Transaction register": "infrastructure",
  "Financial group": "infrastructure",
  "registration body": "infrastructure",
  "reviewing body for prospectuses": "infrastructure",
};

/**
 * Download the FINMA uid.csv to a local cache. Skips if cached file is
 * younger than `maxAgeHours` (default 12h).
 */
export async function downloadUidCsv(
  cacheDir: string,
  opts: { maxAgeHours?: number } = {},
): Promise<string> {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const path = join(cacheDir, "uid.csv");
  const maxAgeMs = (opts.maxAgeHours ?? 12) * 3600 * 1000;
  if (existsSync(path) && Date.now() - statSync(path).mtimeMs < maxAgeMs) return path;
  console.log(`[finma] downloading uid.csv ...`);
  const res = await fetch(FINMA_UID_CSV_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download FINMA uid.csv: HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(path));
  return path;
}
