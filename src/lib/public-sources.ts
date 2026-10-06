/**
 * Registre public des sources servies par l'API `/api/v1/sources` (tâche osd.donnees, tâche B3
 * du plan `2026-10-06-prospection-et-api.md`).
 *
 * `src/` ne peut pas importer `etl/` (`tsconfig.json` fixe `rootDir: "./src"` et exclut `etl` —
 * voir le commentaire équivalent dans `src/mcp/company/sources.ts`, déjà construit sur ce
 * principe). Les entrées ci-dessous sont donc des copies littérales des champs publics (`url`,
 * `licence`, `description`) du registre unique `etl/shared/sources/registry.ts` (`SOURCES`), en
 * anglais (textes publics de l'API). `tests/routes/api-v1.test.ts`, qui vit hors de la frontière
 * tsc (`tests/` est exclu de `tsconfig.json`), compare chaque entrée reprise ici à sa source dans
 * le registre unique.
 *
 * Exclusions volontaires (jamais copiées, pour ne jamais risquer une URL inexacte) :
 * `eurostat.nace2_sparql` et `eurostat.nace2_isic4_sparql` — leurs URL sont des requêtes SPARQL
 * construites dynamiquement (gabarit + encodage), pas des chaînes littérales qu'on peut recopier
 * à l'identique sans risque de divergence silencieuse.
 *
 * `finma.uid_csv`, `swisstopo.localities`, `swisstopo.streets`, `ofrc.zefix_lindas` et
 * `gleif.lei_api` ne sont PAS redupliqués ici : ce sont les cinq entrées déjà tenues à jour dans
 * `src/mcp/company/sources.ts` (`COMPANY_SOURCES`), elles-mêmes vérifiées contre le registre par
 * `tests/mcp/company-sources-registry.test.ts`. Ce fichier les réutilise directement.
 *
 * Référence de permission TARES (décision de Claude-Alain, tâche B3) : `PERMISSION_PROFILES.tares`
 * porte le nom d'une personne physique dans sa référence — n'importe jamais ce profil ici. Les
 * sept sources BAZG/TARES portent donc `licence: "see the provenance file of the archive"`
 * (une chaîne, jamais l'objet `{ reference, authority, jurisdiction }` des autres sources).
 */

import { COMPANY_SOURCES, type CompanySourceId } from "../mcp/company/sources.js";

export type PublicSourceLicence = string | { reference: string; authority: string; jurisdiction: string };

export interface PublicSourceEntry {
  id: string;
  institution: string;
  url: string;
  licence: PublicSourceLicence;
  description: string;
}

const TARES_LICENCE = "see the provenance file of the archive" as const;

const FINMA_LICENCE: PublicSourceLicence = {
  reference: "PUBLIC-OFFICIAL-SOURCE-FINMA",
  authority: "FINMA (Swiss Financial Market Supervisory Authority)",
  jurisdiction: "Switzerland (re-publication of FINMA public registry)",
};

const CLASSIF_LICENCE: PublicSourceLicence = {
  reference: "PUBLIC-OFFICIAL-SOURCE-BFS-EUROSTAT-UNSD",
  authority: "BFS (Federal Statistical Office), Eurostat (Ramon), UN Statistics Division",
  jurisdiction: "Switzerland (re-publication of public official sources)",
};

const GLEIF_LICENCE: PublicSourceLicence = {
  reference: "PUBLIC-OFFICIAL-SOURCE-GLEIF-CC0",
  authority: "GLEIF (Global Legal Entity Identifier Foundation), CC0 1.0",
  jurisdiction: "Switzerland (re-publication of GLEIF open data)",
};

const CENSUS_LICENCE: PublicSourceLicence = {
  reference: "PUBLIC-OFFICIAL-SOURCE-US-CENSUS-PUBLIC-DOMAIN",
  authority: "U.S. Census Bureau (Public Domain, US Government Work)",
  jurisdiction: "United States (public domain)",
};

const OFRC_LICENCE: PublicSourceLicence = {
  reference: "PUBLIC-OFFICIAL-SOURCE-OFRC-OPEN-USE",
  authority: "Federal Office of the Commercial Register (FOCR), opendata.swiss open use (terms_open)",
  jurisdiction: "Switzerland",
};

const SWISSTOPO_LICENCE: PublicSourceLicence = {
  reference: "PUBLIC-OFFICIAL-SOURCE-SWISSTOPO-OPEN-USE",
  authority: "Federal Office of Topography swisstopo, opendata.swiss open use (terms_open)",
  jurisdiction: "Switzerland",
};

function fromCompanySources(id: CompanySourceId, institution: string, description: string, licence: PublicSourceLicence): PublicSourceEntry {
  return { id, institution, url: COMPANY_SOURCES[id].url, licence, description };
}

export const PUBLIC_SOURCES: readonly PublicSourceEntry[] = [
  // BAZG / TARES — copies littérales de `etl/tares/sources.ts` (`BAZG_SOURCES`).
  { id: "tares.tariff_8_digit", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/F1BV6N4GlA4l/tariff_8_digit.xlsx", licence: TARES_LICENCE, description: "BAZG — list of 8-digit Swiss tariff numbers" },
  { id: "tares.tarifstruktur", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/x0cFz-OgqaF2/Tarifstruktur.xlsx", licence: TARES_LICENCE, description: "BAZG — hierarchical multilingual tariff structure" },
  { id: "tares.duty_rates_01_30", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/suXEbuatJI1d/duty%20rates%20chapter%2001%20to%2030.xlsx", licence: TARES_LICENCE, description: "BAZG — MFN duty rates, chapters 01-30" },
  { id: "tares.duty_rates_31_63", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/8HOWtwQe30-s/duty_rates_chapter_31_to_63.xlsx", licence: TARES_LICENCE, description: "BAZG — MFN duty rates, chapters 31-63" },
  { id: "tares.duty_rates_64_83", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/dxAKUBpiFgx2/duty_rates_chapter_64_to_83.xlsx", licence: TARES_LICENCE, description: "BAZG — MFN duty rates, chapters 64-83" },
  { id: "tares.duty_rates_84_97", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/vCLXp0mDCgBz/duty_rates_chapter_84_to_97.xlsx", licence: TARES_LICENCE, description: "BAZG — MFN duty rates, chapters 84-97" },
  { id: "tares.customs_facilities", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/CAEsoXoBTdJY/customs_facilities.xlsx", licence: TARES_LICENCE, description: "BAZG — customs relief codes" },

  // FINMA — copies littérales de `etl/finma/sources.ts` / `etl/finma/ingest-warnings.ts`.
  fromCompanySources("finma.uid_csv", "FINMA", "FINMA — consolidated CSV of authorised institutions (UID)", FINMA_LICENCE),
  { id: "finma.vvtr_xlsx", institution: "FINMA", url: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/vvtr.xlsx", licence: FINMA_LICENCE, description: "FINMA — portfolio managers and trustees and their supervisory organisation (LEFin)" },
  { id: "finma.sro_xlsx", institution: "FINMA", url: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/sro.xlsx", licence: FINMA_LICENCE, description: "FINMA — recognised self-regulatory organisations (SRO)" },
  { id: "finma.ao_xlsx", institution: "FINMA", url: "https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/xlsx/ao.xlsx", licence: FINMA_LICENCE, description: "FINMA — authorised supervisory organisations (SO)" },
  { id: "finma.warnings_api", institution: "FINMA", url: "https://www.finma.ch/en/api/search/getresult", licence: FINMA_LICENCE, description: "FINMA warning list (FINMA website search API), read by the daily collection" },

  // Classifications — copies littérales de `etl/classifications/*.ts`.
  { id: "bfs.noga_2025", institution: "BFS", url: "https://api.i14y.admin.ch/api/public/v1/concepts/001bfaa8-fa57-4d66-acfd-c795d67fcf80?includeCodeListEntries=true", licence: CLASSIF_LICENCE, description: "BFS — NOGA 2025 (i14y concept)" },
  { id: "bfs.noga_2008", institution: "BFS", url: "https://api.i14y.admin.ch/api/public/v1/concepts/08dc481b-2add-1232-b5fe-b1fae7a1ac02?includeCodeListEntries=true", licence: CLASSIF_LICENCE, description: "BFS — NOGA 2008 (i14y concept)" },
  { id: "eurostat.nace21_rdf", institution: "Eurostat", url: "https://publications.europa.eu/resource/cellar/beb2efec-da9a-11ed-a05c-01aa75ed71a1.0001.02/DOC_1", licence: CLASSIF_LICENCE, description: "Eurostat — NACE Rev. 2.1, official RDF (cellar document)" },
  { id: "unsd.isic4_en", institution: "UNSD", url: "https://unstats.un.org/unsd/classifications/Econ/Download/In%20Text/ISIC_Rev_4_english_structure.Txt", licence: CLASSIF_LICENCE, description: "UN (UNSD) — ISIC Rev. 4 structure (en)" },
  { id: "unsd.isic4_fr", institution: "UNSD", url: "https://unstats.un.org/unsd/classifications/Econ/Download/In%20Text/ISIC_Rev_4_French_structure.Txt", licence: CLASSIF_LICENCE, description: "UN (UNSD) — ISIC Rev. 4 structure (fr)" },
  { id: "unsd.isic4_es", institution: "UNSD", url: "https://unstats.un.org/unsd/classifications/Econ/Download/In%20Text/ISIC_Rev_4_Spanish_structure.Txt", licence: CLASSIF_LICENCE, description: "UN (UNSD) — ISIC Rev. 4 structure (es)" },
  { id: "bfs.noga_methodologie", institution: "BFS", url: "https://dam-api.bfs.admin.ch/hub/api/dam/assets/33787996/master", licence: CLASSIF_LICENCE, description: "BFS — methodology of the NOGA correspondences" },
  { id: "census.naics_isic", institution: "US Census", url: "https://www.census.gov/naics/concordances/2022_NAICS_to_ISIC_Rev_4.xlsx", licence: CENSUS_LICENCE, description: "US Census Bureau — NAICS-ISIC correspondence, used by the classifications" },

  // GLEIF, registre du commerce et swisstopo : réutilisés depuis `COMPANY_SOURCES` (déjà testés).
  fromCompanySources("gleif.lei_api", "GLEIF", "GLEIF LEI registry (public API), used to attach a LEI to FINMA entities by UID", GLEIF_LICENCE),
  fromCompanySources("ofrc.zefix_lindas", "OFRC", "Commercial register as linked data (LINDAS, Zefix graph), public SPARQL endpoint", OFRC_LICENCE),
  fromCompanySources("swisstopo.localities", "swisstopo", "swisstopo — official directory of localities (postal code, municipality, canton), STAC catalogue, monthly collection", SWISSTOPO_LICENCE),
  fromCompanySources("swisstopo.streets", "swisstopo", "swisstopo — official directory of streets (street name, postal code, municipality, canton), STAC catalogue, monthly collection", SWISSTOPO_LICENCE),
];

const BY_ID = new Map(PUBLIC_SOURCES.map((s) => [s.id, s]));

export function getPublicSource(id: string): PublicSourceEntry | undefined {
  return BY_ID.get(id);
}
