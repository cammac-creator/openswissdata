/**
 * Adresse du fichier officiel de la liste des sanctions (SESAM, SECO). Détail : `SOURCES.md`.
 * Chaînes reprises à la main dans `src/lib/public-sources.ts` et `src/lib/sanctions.ts`, qui ne
 * peuvent pas importer `etl/` ; `tests/etl/sources-registry-sanctions.test.ts` compare les copies.
 */
export const SESAM_XML_URL =
  "https://www.sesam.search.admin.ch/sesam-search-web/pages/downloadXmlGesamtliste.xhtml?lang=fr&action=downloadXmlGesamtlisteAction";
