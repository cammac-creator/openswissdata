/**
 * Table locale des sources citées par la fiche de vérification d'une société suisse
 * (tâche osd.fiche, tâche 4).
 *
 * `src/` ne peut pas importer `etl/` (`tsconfig.json` fixe `rootDir: "./src"` et exclut
 * `etl`, qui n'est de toute façon jamais compilé dans `dist/` — voir le commentaire
 * équivalent dans `lindas.ts`). Ces quatre entrées sont donc des copies littérales des
 * mêmes champs (`url`, `licence.reference`) du registre unique
 * `etl/shared/sources/registry.ts`. `tests/mcp/company-sources-registry.test.ts`, qui vit
 * hors de la frontière tsc (`tests/` est exclu de `tsconfig.json`), vérifie l'égalité à
 * chaque exécution.
 */

import { LINDAS_ENDPOINT } from "./lindas.js";
import { GLEIF_LEI_API_URL } from "./gleif.js";

export interface CompanySourceRef {
  url: string;
  licence_reference: string;
}

// Copie littérale de `FINMA_UID_CSV_URL` (`etl/finma/sources.ts`) : CSV consolidé FINMA
// des institutions autorisées, une ligne par autorisation.
const FINMA_UID_CSV_URL = "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/csv/uid.csv";

// Copie littérale de `SWISSTOPO_LOCALITIES_STAC_ITEMS_URL` (`etl/localities/sources.ts`) :
// catalogue STAC du répertoire officiel des localités (tâche osd.localites).
const SWISSTOPO_LOCALITIES_STAC_ITEMS_URL =
  "https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo-vd.ortschaftenverzeichnis_plz/items";

export type CompanySourceId = "ofrc.zefix_lindas" | "finma.uid_csv" | "gleif.lei_api" | "swisstopo.localities";

export const COMPANY_SOURCES: Record<CompanySourceId, CompanySourceRef> = {
  "ofrc.zefix_lindas": { url: LINDAS_ENDPOINT, licence_reference: "PUBLIC-OFFICIAL-SOURCE-OFRC-OPEN-USE" },
  "finma.uid_csv": { url: FINMA_UID_CSV_URL, licence_reference: "PUBLIC-OFFICIAL-SOURCE-FINMA" },
  "gleif.lei_api": { url: GLEIF_LEI_API_URL, licence_reference: "PUBLIC-OFFICIAL-SOURCE-GLEIF-CC0" },
  "swisstopo.localities": { url: SWISSTOPO_LOCALITIES_STAC_ITEMS_URL, licence_reference: "PUBLIC-OFFICIAL-SOURCE-SWISSTOPO-OPEN-USE" },
};
