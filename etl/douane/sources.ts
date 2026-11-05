/**
 * Adresses du commerce extérieur de l'OFDF (fiches opendata.swiss, relues le 05.11.2026). Déclaration
 * unique : le registre (`etl/shared/sources/registry.ts`) et la collecte la lisent toutes les deux.
 * Licence affichée `terms_by_ask` : voir `SOURCES.md`, aucune autorisation n'a été demandée.
 */
export type DouaneFileKind = "duties" | "imports" | "exports";

export interface DouaneSource {
  /** Identifiant du registre. */
  id: string;
  /** Fichier attendu dans `--from-dir`, nom du dernier segment de l'adresse. */
  fileName: string;
  url: string;
  /** Fiche du catalogue, pour citer la source. */
  datasetUrl: string;
}

export const DOUANE_ZIP_SOURCES: Readonly<Record<DouaneFileKind, DouaneSource>> = {
  duties: {
    id: "bazg.trade_duties_tn8_imports",
    fileName: "ZE_TN8_IMP_fr.zip",
    url: "https://ocean.bazg.admin.ch/open-data-reports/ZE_TN8_IMP_fr/ZE_TN8_IMP_fr.zip",
    datasetUrl: "https://opendata.swiss/fr/dataset/0e37ee1f-9e15-449f-8cf5-84069571d530",
  },
  imports: {
    id: "bazg.trade_tn8_imports",
    fileName: "TN8_IMP_fr.zip",
    url: "https://ocean.nivel.bazg.admin.ch/open-data-reports/TN8_IMP_fr/TN8_IMP_fr.zip",
    datasetUrl: "https://opendata.swiss/fr/dataset/e6bcc098-2c55-4305-a5ed-35c7bf7cde55",
  },
  exports: {
    id: "bazg.trade_tn8_exports",
    fileName: "TN8_EXP_fr.zip",
    url: "https://ocean.nivel.bazg.admin.ch/open-data-reports/TN8_EXP_fr/TN8_EXP_fr.zip",
    datasetUrl: "https://opendata.swiss/fr/dataset/e6bcc098-2c55-4305-a5ed-35c7bf7cde55",
  },
};

export const DOUANE_CONCORDANCE_SOURCE: DouaneSource = {
  id: "bazg.trade_concordance_cpa6_tn8",
  fileName: "CPA_TN_MAPPING_v1.csv",
  url: "https://ocean.bazg.admin.ch/open-data-reports/CPA_TN_MAPPING_v1/CPA_TN_MAPPING_v1.csv",
  datasetUrl: "https://opendata.swiss/fr/dataset/6ef9265a-070f-4b3a-9006-e9827ab1fc1b",
};

/** Un seul objet dans le bucket PRIVÉ, réécrit à chaque passage : jamais de copie datée, jamais dans le dépôt. */
export const DOUANE_R2_KEY = "douane/or/current-v1.txt.gz";
export const DOUANE_SCHEMA = "douane-or-v1";
export const DOUANE_USER_AGENT = "OpenSwissData-collecte-douane/1 (+https://openswissdata.com)";
