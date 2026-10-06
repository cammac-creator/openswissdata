/**
 * Quelles sources chaque produit assemble dans son manifeste de provenance (tâche osd.socle, tâche 4).
 *
 * Relevé du 06.10.2026 par `grep -rn "fetchBronze\|fetch(\|_URL\b" etl/tares etl/classifications etl/finma | grep -v test` :
 *
 * - TARES (etl/tares/sources.ts, une boucle `fetch(src.url)` sur TARES_SOURCES) : les sept fichiers BAZG,
 *   déjà au registre → tares.tariff_8_digit, tares.tarifstruktur, tares.duty_rates_01_30,
 *   tares.duty_rates_31_63, tares.duty_rates_64_83, tares.duty_rates_84_97, tares.customs_facilities.
 * - classifications (etl/classifications/ingest-real.ts, naics-crosswalk.ts) : bfs.noga_2025,
 *   bfs.noga_2008 (API i14y), eurostat.nace2_sparql (NACE2_URL), eurostat.nace21_rdf (NACE_2_1_RDF_URL),
 *   eurostat.nace2_isic4_sparql (NACE_ISIC_URL), bfs.noga_methodologie (OFS_METHODOLOGY_URL),
 *   unsd.isic4_en / unsd.isic4_fr / unsd.isic4_es (ISIC_CSV_BY_LANG ne connaît que ces trois langues),
 *   census.naics_isic (CENSUS_NAICS_ISIC_URL, naics-crosswalk.ts) — **source conditionnelle** (correction
 *   du 06.10.2026, relecture) : `ingestNaicsCrosswalk` n'a aucun appelant hors des tests et
 *   `etl/classifications/bundle.ts` n'écrit `naics_nace_crosswalk.*` que si `input.naics` est fourni
 *   (variable `hasNaics`, ligne ~372). `census.naics_isic` reste dans `PRODUCT_SOURCES.classifications`
 *   (ce que le produit PEUT assembler) mais `bundle.ts` la retire de la liste passée à
 *   `provenanceFieldsFor` quand `hasNaics` est faux, pour qu'un manifeste signé ne cite jamais une
 *   source dont l'archive ne contient aucun fichier.
 * - FINMA, collecte de production (etl/finma/release.ts, chemin `!useFixture`, pas de FINMA_TIER=zefix) :
 *   ingestFromFinmaCsv (finma.uid_csv), ingestFinmaWarnings (finma.warnings_api), ingestGleif
 *   (gleif.lei_api), ingestFinmaSupervision (finma.vvtr_xlsx, finma.sro_xlsx, finma.ao_xlsx).
 *   `FINMA_SOURCES` / `ingestOneSource` (etl/finma/sources.ts) ne servent qu'au chemin `useFixture`
 *   (fixtures locales par catégorie : banques, PSP, assurances…), jamais à la collecte de production.
 *
 * Source lue mais volontairement absente de cette liste (DONE_WITH_CONCERNS, tâche 4) :
 * `etl/finma/ingest-zefix.ts` (LINDAS SPARQL, `https://register.ld.admin.ch/query`) est bien lu par
 * release.ts, mais seulement si `FINMA_TIER=zefix` (tier optionnel "FINMA + Zefix Sync" ; le tier par
 * défaut "standard" ne l'active jamais). Aucune preuve de licence trouvée pour LINDAS/Zefix (absent de
 * `docs/droits-des-sources.md`, aucun profil dans `PERMISSION_PROFILES`) : conformément à la consigne,
 * la source reste hors du registre et hors de cette liste plutôt que d'être devinée. Ce tier n'est de
 * toute façon jamais actif en production (défaut "standard"), donc aucune archive vendue aujourd'hui
 * n'omet une source qu'elle contient réellement. `ingest-statent.ts` (STATENT, Pro) a été vérifié pour
 * la même raison : `etl/classifications/release.ts` ne construit jamais `input.statent`, cette voie du
 * bundle est du code mort depuis le retrait du 25.09.2026 (voir AGENTS.md) ; elle ne figure donc pas
 * non plus dans la liste des classifications.
 */
import { PERMISSION_PROFILES, type GenerateProvenanceArgs, type ProvenanceSourceRef } from "../provenance.js";
import { getSource } from "./registry.js";

export type Product = "tares" | "classifications" | "finma";

export const PRODUCT_SOURCES: Record<Product, readonly string[]> = {
  tares: [
    "tares.tariff_8_digit",
    "tares.tarifstruktur",
    "tares.duty_rates_01_30",
    "tares.duty_rates_31_63",
    "tares.duty_rates_64_83",
    "tares.duty_rates_84_97",
    "tares.customs_facilities",
  ],
  classifications: [
    "bfs.noga_2025",
    "bfs.noga_2008",
    "eurostat.nace21_rdf",
    "eurostat.nace2_sparql",
    "eurostat.nace2_isic4_sparql",
    "unsd.isic4_en",
    "unsd.isic4_fr",
    "unsd.isic4_es",
    "bfs.noga_methodologie",
    "census.naics_isic",
  ],
  finma: ["finma.uid_csv", "finma.warnings_api", "finma.vvtr_xlsx", "finma.sro_xlsx", "finma.ao_xlsx", "gleif.lei_api"],
};

export function provenanceFieldsFor(
  product: Product,
  ids: readonly string[] = PRODUCT_SOURCES[product],
): Pick<GenerateProvenanceArgs, "sourceUrl" | "permissionReference" | "permissionAuthority" | "permissionDate" | "jurisdiction" | "sources"> {
  const profile = PERMISSION_PROFILES[product];
  const sources: ProvenanceSourceRef[] = ids.map((id) => {
    const s = getSource(id);
    return {
      id: s.id,
      institution: s.institution,
      url: s.url,
      permission_reference: s.licence.reference,
      permission_authority: s.licence.authority,
      permission_date: s.licence.date,
      jurisdiction: s.licence.jurisdiction,
    };
  });
  return {
    sourceUrl: profile.sourceUrl,
    permissionReference: profile.permissionReference,
    permissionAuthority: profile.permissionAuthority,
    permissionDate: "permissionDate" in profile ? profile.permissionDate : undefined,
    jurisdiction: profile.jurisdiction,
    sources,
  };
}
