import type { FinmaSource } from "./types.js";

/**
 * Reference registry of the 10 FINMA upstream lists.
 *
 * URLs and header maps are illustrative — to be verified and adjusted when
 * Alain provides the real downloaded XLSX files (they shift between FINMA
 * releases).
 */
export const FINMA_SOURCES: FinmaSource[] = [
  {
    entity_type: "bank",
    source_list: "finma-banks",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/banks/",
    headers_map: {
      "Name": "name",
      "Firma": "name",
      "Raison sociale": "name",
      "UID-Number": "uid",
      "UID": "uid",
      "Canton": "canton",
      "Kanton": "canton",
      "Address": "address",
      "Adresse": "address",
      "Licence date": "licence_date",
      "Datum der Bewilligung": "licence_date",
      "Status": "status",
      "Licence type": "licence_type",
    },
  },
  {
    entity_type: "insurance",
    source_list: "finma-insurance",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/insurance/",
    headers_map: {
      "Name": "name",
      "Firma": "name",
      "UID": "uid",
      "Canton": "canton",
      "Kanton": "canton",
      "Address": "address",
      "Adresse": "address",
      "Licence date": "licence_date",
      "Status": "status",
    },
  },
  {
    entity_type: "payment_institution",
    source_list: "finma-psp",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/fintechs/",
    headers_map: {
      "Name": "name",
      "UID": "uid",
      "Canton": "canton",
      "Address": "address",
      "Licence date": "licence_date",
      "Licence type": "licence_type",
    },
  },
  {
    entity_type: "asset_manager_collective",
    source_list: "finma-asset-manager-collective",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/asset-managers-collective/",
    headers_map: {
      "Name": "name",
      "Firma": "name",
      "UID": "uid",
      "Canton": "canton",
      "Kanton": "canton",
      "Address": "address",
      "Licence date": "licence_date",
    },
  },
  {
    entity_type: "asset_manager_individual",
    source_list: "finma-asset-manager-individual",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/asset-managers/",
    headers_map: {
      "Name": "name",
      "UID": "uid",
      "Canton": "canton",
      "Address": "address",
      "Licence date": "licence_date",
    },
  },
  {
    entity_type: "securities_firm",
    source_list: "finma-securities-firms",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/securities-firms/",
    headers_map: {
      "Name": "name",
      "UID": "uid",
      "Canton": "canton",
      "Address": "address",
      "Licence date": "licence_date",
    },
  },
  {
    entity_type: "fund_representative",
    source_list: "finma-fund-representatives",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/representatives/",
    headers_map: {
      "Name": "name",
      "UID": "uid",
      "Canton": "canton",
      "Address": "address",
      "Licence date": "licence_date",
    },
  },
  {
    entity_type: "sro_member",
    source_list: "finma-sro-members",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/sro-members/",
    headers_map: {
      "Name": "name",
      "UID": "uid",
      "Canton": "canton",
      "SRO": "licence_type",
    },
  },
  {
    entity_type: "supervisory_org",
    source_list: "finma-supervisory-orgs",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/supervisory-organisations/",
    headers_map: {
      "Name": "name",
      "UID": "uid",
      "Address": "address",
    },
  },
  {
    entity_type: "insurance_intermediary",
    source_list: "finma-insurance-intermediaries",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions/insurance-intermediaries/",
    headers_map: {
      "Name": "name",
      "UID": "uid",
      "Canton": "canton",
      "Address": "address",
      "Licence date": "licence_date",
    },
  },
];
