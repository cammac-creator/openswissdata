export type FinmaEntityType =
  | "bank"
  | "insurance"
  | "asset_manager_collective"
  | "asset_manager_individual"
  | "securities_firm"
  | "fund_representative"
  | "payment_institution"
  | "supervisory_org"
  | "insurance_intermediary"
  | "fintech"
  | "infrastructure"
  | "other";

/**
 * Toutes les catégories effectivement livrées dans schema.json, le README et
 * les fichiers finma_<type>.csv (voir bundle.ts::buildBundle). Source unique :
 * ne pas dupliquer cette liste ailleurs (elle sert aussi de garde-fou dans
 * tests/etl/finma-coverage-promises.test.ts).
 */
export const FINMA_BUNDLE_ENTITY_TYPES: FinmaEntityType[] = [
  "bank", "insurance", "asset_manager_collective", "asset_manager_individual",
  "securities_firm", "fund_representative", "payment_institution",
  "supervisory_org", "insurance_intermediary",
  "fintech", "infrastructure", "other",
];

export interface FinmaEntity {
  entity_type: FinmaEntityType;
  name: string;
  uid?: string;             // Swiss UID (CHE-xxx.xxx.xxx)
  lei?: string;             // Legal Entity Identifier (GLEIF) — optional, not in uid.csv
  lei_source_url?: string;
  lei_registration_status?: string;
  lei_updated_at?: string;
  address_source_url?: string;
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
   * Champ historique retiré du calcul : une ressemblance de nom ne prouve
   * aucune identité. Null signifie non établi ; consulter la liste séparée.
   */
  is_warning_listed?: boolean | null;
  /**
   * Organisme de surveillance (OS) qui surveille ce gestionnaire de fortune ou
   * trustee selon la loi sur les établissements financiers (LEFin), libellé
   * FINMA recopié tel quel depuis vvtr.xlsx. Ce n'est PAS une affiliation à un
   * organisme d'autorégulation (OAR, loi sur le blanchiment d'argent).
   * Vide si le rapprochement exact n'est pas établi (voir ingest-supervision.ts).
   */
  supervisory_organisation?: string;
  supervisory_organisation_source_url?: string;
  /** Date (AAAA-MM-JJ, UTC) de la collecte du fichier FINMA qui porte la valeur. */
  supervisory_organisation_observed_on?: string;
}

/** Une ligne de vvtr.xlsx (gestionnaires de fortune et trustees surveillés par un OS). */
export interface FinmaSupervisedManager {
  name: string;
  city: string;
  portfolio_manager: boolean;
  trustee: boolean;
  /** Libellé FINMA de l'organisme de surveillance, recopié tel quel. */
  supervisory_organisation: string;
}

/**
 * Une ligne des tables de référence (sro.xlsx, ao.xlsx) : des institutions,
 * jamais des personnes. Les colonnes e-mail et téléphone de la FINMA ne sont
 * pas reprises (deux adresses e-mail de sro.xlsx désignent des personnes).
 */
export interface FinmaReferenceOrganisation {
  name: string;
  /** Adresse telle que publiée par la FINMA (retours à la ligne compris). */
  address: string;
  /** Colonne « City » de ao.xlsx (NPA et localité) ; absente de sro.xlsx. */
  city?: string;
  website?: string;
  source_url: string;
  /** Date (AAAA-MM-JJ, UTC) de la collecte du fichier FINMA. */
  observed_on: string;
}

/** Métadonnées du bronze d'un fichier source (fetchBronze, fichier .meta.json). */
export interface FinmaSourceFileMeta {
  url: string;
  fetched_at: string;
  last_modified: string | null;
  sha256: string;
  bytes: number;
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
