/** Registre unique des sources publiques lues par OpenSwissData. Tâche osd.socle.
 * Ce fichier est la seule déclaration de chaque source : `CANARIES` dans
 * `scripts/monitor-sources.ts` est dérivé de `SOURCES` (celles qui ont un
 * champ `canary`), jamais l'inverse. Le test `tests/etl/sources-registry.test.ts`
 * compare chaque adresse du registre à la liste figée du canari.
 */
import type { Institution, SourceDescriptor, SourceLicence } from "./types.js";
import { PERMISSION_PROFILES } from "../provenance.js";
import { FINMA_UID_CSV_URL, FINMA_VVTR_XLSX_URL, FINMA_SRO_XLSX_URL, FINMA_AO_XLSX_URL } from "../../finma/sources.js";
import { FINMA_WARNINGS_API_URL } from "../../finma/ingest-warnings.js";
import { NACE_2_1_RDF_URL, ISIC_CSV_BY_LANG } from "../../classifications/ingest-real.js";
import { NACE2_URL } from "../../classifications/nace-official.js";
import { NACE_ISIC_URL, OFS_METHODOLOGY_URL } from "../../classifications/links.js";
import { CENSUS_NAICS_ISIC_URL } from "../../classifications/naics-crosswalk.js";

const BAZG: SourceLicence = {
  reference: PERMISSION_PROFILES.tares.permissionReference,   // jamais recopiée en clair (osd.T05)
  authority: PERMISSION_PROFILES.tares.permissionAuthority,
  date: PERMISSION_PROFILES.tares.permissionDate,
  jurisdiction: PERMISSION_PROFILES.tares.jurisdiction,
};
const FINMA: SourceLicence = {
  reference: PERMISSION_PROFILES.finma.permissionReference,
  authority: PERMISSION_PROFILES.finma.permissionAuthority,
  jurisdiction: PERMISSION_PROFILES.finma.jurisdiction,
};
const CLASSIF: SourceLicence = {
  reference: PERMISSION_PROFILES.classifications.permissionReference,
  authority: PERMISSION_PROFILES.classifications.permissionAuthority,
  jurisdiction: PERMISSION_PROFILES.classifications.jurisdiction,
};
const GLEIF: SourceLicence = {
  reference: "PUBLIC-OFFICIAL-SOURCE-GLEIF-CC0",
  authority: "GLEIF (Global Legal Entity Identifier Foundation), CC0 1.0",
  jurisdiction: "Switzerland (re-publication of GLEIF open data)",
};

export const SOURCES: readonly SourceDescriptor[] = [
  { id: "tares.tariff_8_digit", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/F1BV6N4GlA4l/tariff_8_digit.xlsx", canary: "raw", licence: BAZG, description: "BAZG — Liste des numéros tarifaires HS8" },
  { id: "tares.tarifstruktur", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/x0cFz-OgqaF2/Tarifstruktur.xlsx", canary: "raw", licence: BAZG, description: "BAZG — Structure tarifaire hiérarchique multilingue" },
  { id: "tares.duty_rates_01_30", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/suXEbuatJI1d/duty%20rates%20chapter%2001%20to%2030.xlsx", canary: "raw", licence: BAZG, description: "BAZG — Droits MFN chapitres 01-30" },
  { id: "tares.duty_rates_31_63", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/8HOWtwQe30-s/duty_rates_chapter_31_to_63.xlsx", canary: "raw", licence: BAZG, description: "BAZG — Droits MFN chapitres 31-63" },
  { id: "tares.duty_rates_64_83", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/dxAKUBpiFgx2/duty_rates_chapter_64_to_83.xlsx", canary: "raw", licence: BAZG, description: "BAZG — Droits MFN chapitres 64-83" },
  { id: "tares.duty_rates_84_97", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/vCLXp0mDCgBz/duty_rates_chapter_84_to_97.xlsx", canary: "raw", licence: BAZG, description: "BAZG — Droits MFN chapitres 84-97" },
  { id: "tares.customs_facilities", institution: "BAZG", url: "https://www.bazg.admin.ch/dam/de/sd-web/CAEsoXoBTdJY/customs_facilities.xlsx", canary: "raw", licence: BAZG, description: "BAZG — Codes ZCO d'allègement douanier" },
  // FINMA — single consolidated CSV. Updated daily as institutions are
  // added/removed → use csv-shape (headers only) to avoid daily false positives.
  { id: "finma.uid_csv", institution: "FINMA", url: FINMA_UID_CSV_URL, canary: "csv-shape", licence: FINMA, description: "FINMA — CSV consolidé des institutions autorisées (UID)" },
  { id: "finma.vvtr_xlsx", institution: "FINMA", url: FINMA_VVTR_XLSX_URL, canary: "xlsx-shape", licence: FINMA, description: "FINMA — gestionnaires de fortune et trustees et leur organisme de surveillance (LEFin)" },
  { id: "finma.sro_xlsx", institution: "FINMA", url: FINMA_SRO_XLSX_URL, canary: "xlsx-shape", licence: FINMA, description: "FINMA — organismes d'autorégulation (OAR) reconnus" },
  { id: "finma.ao_xlsx", institution: "FINMA", url: FINMA_AO_XLSX_URL, canary: "xlsx-shape", licence: FINMA, description: "FINMA — organismes de surveillance (OS) autorisés" },
  { id: "bfs.noga_2025", institution: "BFS", url: "https://api.i14y.admin.ch/api/public/v1/concepts/001bfaa8-fa57-4d66-acfd-c795d67fcf80?includeCodeListEntries=true", canary: "json-shape", licence: CLASSIF, description: "BFS — NOGA 2025 (concept i14y)" },
  { id: "bfs.noga_2008", institution: "BFS", url: "https://api.i14y.admin.ch/api/public/v1/concepts/08dc481b-2add-1232-b5fe-b1fae7a1ac02?includeCodeListEntries=true", canary: "json-shape", licence: CLASSIF, description: "BFS — NOGA 2008 (concept i14y)" },
  // Classifications — mêmes adresses que la publication (etl/classifications).
  // Le 28.09.2026, op.europa.eu bloquait NACE 2.1 : seule la publication l'avait vu.
  { id: "eurostat.nace21_rdf", institution: "Eurostat", url: NACE_2_1_RDF_URL, canary: "document", licence: CLASSIF, description: "Eurostat — NACE Rév. 2.1, RDF officiel (document cellar)" },
  { id: "eurostat.nace2_sparql", institution: "Eurostat", url: NACE2_URL, canary: "json-shape", licence: CLASSIF, description: "Eurostat — NACE Rév. 2 par le point SPARQL de l'Office des publications" },
  { id: "eurostat.nace2_isic4_sparql", institution: "Eurostat", url: NACE_ISIC_URL, canary: "json-shape", licence: CLASSIF, description: "Eurostat — correspondances NACE Rév. 2 → ISIC Rév. 4 (SPARQL)" },
  { id: "unsd.isic4_en", institution: "UNSD", url: ISIC_CSV_BY_LANG.en, canary: "document", licence: CLASSIF, description: "ONU (UNSD) — structure ISIC Rév. 4 (en)" },
  { id: "unsd.isic4_fr", institution: "UNSD", url: ISIC_CSV_BY_LANG.fr, canary: "document", licence: CLASSIF, description: "ONU (UNSD) — structure ISIC Rév. 4 (fr)" },
  { id: "unsd.isic4_es", institution: "UNSD", url: ISIC_CSV_BY_LANG.es, canary: "document", licence: CLASSIF, description: "ONU (UNSD) — structure ISIC Rév. 4 (es)" },
  { id: "bfs.noga_methodologie", institution: "BFS", url: OFS_METHODOLOGY_URL, canary: "document", licence: CLASSIF, description: "OFS — méthodologie des correspondances NOGA" },
  // Sources lues par les produits mais pas surveillées par le canari (pas de champ canary) :
  { id: "finma.warnings_api", institution: "FINMA", url: FINMA_WARNINGS_API_URL, licence: FINMA,
    description: "Liste d'alerte FINMA (API de recherche du site FINMA), lue par la collecte quotidienne." },
  { id: "gleif.lei_api", institution: "GLEIF", url: "https://api.gleif.org/api/v1/lei-records", licence: GLEIF,
    description: "Registre LEI de GLEIF (API publique), pour rattacher un LEI aux entités FINMA par UID." },
  { id: "census.naics_isic", institution: "US Census", url: CENSUS_NAICS_ISIC_URL, licence: CLASSIF,
    description: "Correspondance NAICS–ISIC du US Census Bureau, utilisée par les classifications." },
];

const PAR_ID = new Map(SOURCES.map(s => [s.id, s]));
export function getSource(id: string): SourceDescriptor {
  const s = PAR_ID.get(id);
  if (!s) throw new Error(`source inconnue : ${id}`);
  return s;
}
export function sourcesByInstitution(): Map<Institution, SourceDescriptor[]> {
  const m = new Map<Institution, SourceDescriptor[]>();
  for (const s of SOURCES) m.set(s.institution, [...(m.get(s.institution) ?? []), s]);
  return m;
}
