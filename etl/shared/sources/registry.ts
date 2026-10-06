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
import { NACE_2_1_RDF_URL, ISIC_CSV_BY_LANG, NOGA_2025_URL, NOGA_2008_URL } from "../../classifications/ingest-real.js";
import { NACE2_URL } from "../../classifications/nace-official.js";
import { NACE_ISIC_URL, OFS_METHODOLOGY_URL } from "../../classifications/links.js";
import { CENSUS_NAICS_ISIC_URL } from "../../classifications/naics-crosswalk.js";
import { LINDAS_SPARQL_ENDPOINT } from "../../finma/ingest-zefix.js";
import { SWISSTOPO_LOCALITIES_STAC_ITEMS_URL } from "../../localities/sources.js";
import { SWISSTOPO_STREETS_STAC_ITEMS_URL } from "../../streets/sources.js";
// Adresses BAZG : dérivées de la même déclaration que la collecte (etl/tares/sources.ts,
// BAZG_SOURCES), jamais recopiées en dur ici (tâche osd.socle).
import { BAZG_SOURCES } from "../../tares/sources.js";

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
// Licence propre, distincte de CLASSIF (BFS/Eurostat/UNSD) : le Census est un
// domaine public américain, cohérent avec le README de l'archive (osd.socle).
const CENSUS: SourceLicence = {
  reference: "PUBLIC-OFFICIAL-SOURCE-US-CENSUS-PUBLIC-DOMAIN",
  authority: "U.S. Census Bureau (Public Domain, US Government Work)",
  jurisdiction: "United States (public domain)",
};

// Registre du commerce en données liées (LINDAS, graphe Zefix de l'OFRC). Preuve de licence :
// catalogue opendata.swiss « zefix-zentraler-firmenindex », ressource « Zefix Linked Data Query »,
// rights = terms_open (usage commercial autorisé, source recommandée), relu le 06.10.2026 (osd.fiche).
const OFRC_OPEN: SourceLicence = {
  reference: "PUBLIC-OFFICIAL-SOURCE-OFRC-OPEN-USE",
  authority: "Federal Office of the Commercial Register (FOCR), opendata.swiss open use (terms_open)",
  jurisdiction: "Switzerland",
};

// Répertoire officiel des localités (NPA, commune, canton). Preuve de licence : catalogue
// opendata.swiss « amtliches-ortschaftenverzeichnis-mit-postleitzahl-und-perimeter »,
// ressources `rights = terms_open`, éditeur swisstopo, relu le 06.10.2026 (osd.localites).
const SWISSTOPO_OPEN: SourceLicence = {
  reference: "PUBLIC-OFFICIAL-SOURCE-SWISSTOPO-OPEN-USE",
  authority: "Federal Office of Topography swisstopo, opendata.swiss open use (terms_open)",
  jurisdiction: "Switzerland",
};

export const SOURCES: readonly SourceDescriptor[] = [
  { id: "tares.tariff_8_digit", institution: "BAZG", url: BAZG_SOURCES.tariff_8_digit.url, canary: "raw", licence: BAZG, description: "BAZG — Liste des numéros tarifaires HS8" },
  { id: "tares.tarifstruktur", institution: "BAZG", url: BAZG_SOURCES.tarifstruktur.url, canary: "raw", licence: BAZG, description: "BAZG — Structure tarifaire hiérarchique multilingue" },
  { id: "tares.duty_rates_01_30", institution: "BAZG", url: BAZG_SOURCES.duty_rates_01_30.url, canary: "raw", licence: BAZG, description: "BAZG — Droits MFN chapitres 01-30" },
  { id: "tares.duty_rates_31_63", institution: "BAZG", url: BAZG_SOURCES.duty_rates_31_63.url, canary: "raw", licence: BAZG, description: "BAZG — Droits MFN chapitres 31-63" },
  { id: "tares.duty_rates_64_83", institution: "BAZG", url: BAZG_SOURCES.duty_rates_64_83.url, canary: "raw", licence: BAZG, description: "BAZG — Droits MFN chapitres 64-83" },
  { id: "tares.duty_rates_84_97", institution: "BAZG", url: BAZG_SOURCES.duty_rates_84_97.url, canary: "raw", licence: BAZG, description: "BAZG — Droits MFN chapitres 84-97" },
  { id: "tares.customs_facilities", institution: "BAZG", url: BAZG_SOURCES.customs_facilities.url, canary: "raw", licence: BAZG, description: "BAZG — Codes ZCO d'allègement douanier" },
  // FINMA — single consolidated CSV. Updated daily as institutions are
  // added/removed → use csv-shape (headers only) to avoid daily false positives.
  { id: "finma.uid_csv", institution: "FINMA", url: FINMA_UID_CSV_URL, canary: "csv-shape", licence: FINMA, description: "FINMA — CSV consolidé des institutions autorisées (UID)" },
  { id: "finma.vvtr_xlsx", institution: "FINMA", url: FINMA_VVTR_XLSX_URL, canary: "xlsx-shape", licence: FINMA, description: "FINMA — gestionnaires de fortune et trustees et leur organisme de surveillance (LEFin)" },
  { id: "finma.sro_xlsx", institution: "FINMA", url: FINMA_SRO_XLSX_URL, canary: "xlsx-shape", licence: FINMA, description: "FINMA — organismes d'autorégulation (OAR) reconnus" },
  { id: "finma.ao_xlsx", institution: "FINMA", url: FINMA_AO_XLSX_URL, canary: "xlsx-shape", licence: FINMA, description: "FINMA — organismes de surveillance (OS) autorisés" },
  { id: "bfs.noga_2025", institution: "BFS", url: NOGA_2025_URL, canary: "json-shape", licence: CLASSIF, description: "BFS — NOGA 2025 (concept i14y)" },
  { id: "bfs.noga_2008", institution: "BFS", url: NOGA_2008_URL, canary: "json-shape", licence: CLASSIF, description: "BFS — NOGA 2008 (concept i14y)" },
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
  { id: "census.naics_isic", institution: "US Census", url: CENSUS_NAICS_ISIC_URL, licence: CENSUS,
    description: "Correspondance NAICS–ISIC du US Census Bureau, utilisée par les classifications." },
  // Hors de toute archive vendue : lue en direct par la fiche société (osd.fiche). Ne pas l'ajouter à
  // PRODUCT_SOURCES.finma : le garde-fou Zefix de etl/finma/bundle.ts doit rester actif.
  { id: "ofrc.zefix_lindas", institution: "OFRC", url: LINDAS_SPARQL_ENDPOINT, licence: OFRC_OPEN,
    description: "Registre du commerce en données liées (LINDAS, graphe Zefix), point SPARQL public." },
  // Sans canari (osd.localites) : la collecte mensuelle (`scripts/sync-localities.ts`)
  // contrôle elle-même la forme du fichier officiel et échoue visiblement si elle change,
  // au lieu d'un canari séparé qui referait le même constat.
  { id: "swisstopo.localities", institution: "swisstopo", url: SWISSTOPO_LOCALITIES_STAC_ITEMS_URL, licence: SWISSTOPO_OPEN,
    description: "swisstopo — répertoire officiel des localités (NPA, commune, canton), catalogue STAC, collecte mensuelle." },
  // Même raisonnement que swisstopo.localities (osd.localites, tâche B1) : pas de canari
  // séparé, `scripts/sync-streets.ts` contrôle lui-même la forme du fichier officiel. Même
  // licence `terms_open` que le répertoire des localités (même éditeur, même catalogue).
  { id: "swisstopo.streets", institution: "swisstopo", url: SWISSTOPO_STREETS_STAC_ITEMS_URL, licence: SWISSTOPO_OPEN,
    description: "swisstopo — répertoire officiel des rues (nom de rue, NPA, commune, canton), catalogue STAC, collecte mensuelle." },
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
