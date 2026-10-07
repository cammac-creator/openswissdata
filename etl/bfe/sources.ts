/**
 * Rétribution unique pour les installations photovoltaïques (Einmalvergütung für
 * Photovoltaikanlagen) — OFEN (tâche osd.donnees, tâche B5 du plan
 * `2026-10-06-prospection-et-api.md`).
 *
 * Source : catalogue opendata.swiss « einmalvergutung-fur-photovoltaikanlagen », ressource
 * CSV ci-dessous, `rights = terms_by` (attribution obligatoire), fréquence annuelle, éditeur
 * BFE (Office fédéral de l'énergie). Relevé le 07.10.2026 (voir
 * `etl/shared/sources/registry.ts`, source `bfe.pv_one_time_remuneration`) : 260 lignes
 * (26 cantons × 10 années 2014-2023), BOM UTF-8, séparateur virgule, en-tête
 * `Jahr,Kanton,Anzahl_Anlagen,Installierte_Leistung_kW,Verguetung_CHF,
 * Anzahl_Anlagen_pro_100000_Einwohner,Installierte_Leistung_kW_pro_100000_Einwohner` (voir
 * `scripts/sync-bfe-pv.ts`). Neuf lignes de l'année 2014 (GE, GL, JU, NW, OW, SH, TG, UR, ZG —
 * pas spécialement les plus petits cantons, GE et TG en particulier) portent la valeur publiée
 * `NA` sur les cinq colonnes numériques, toujours ensemble — jamais un zéro deviné, recopiée
 * telle quelle.
 *
 * Adresse directe, contrairement aux répertoires swisstopo (STAC) : pas de catalogue
 * intermédiaire à résoudre, le lien change seulement si l'OFEN republie le jeu de données
 * sous une autre adresse — `scripts/sync-bfe-pv.ts` contrôle lui-même la forme du fichier et
 * échoue visiblement si elle change.
 */

export const BFE_PV_CSV_URL =
  "https://www.uvek-gis.admin.ch/BFE/ogd/84/ogd84_einmalverguetung_fuer_photovoltaikanlagen.csv";
