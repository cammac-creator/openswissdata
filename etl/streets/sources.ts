/**
 * Répertoire officiel des rues suisses (STN_LABEL, NPA, localité, commune, canton) —
 * swisstopo (tâche osd.localites, tâche B1 du plan `2026-10-06-prospection-et-api.md`).
 * Sur le modèle exact de `etl/localities/sources.ts`.
 *
 * Catalogue STAC de geo.admin.ch : la collection ne change pas d'adresse d'un mois à
 * l'autre, seul le contenu de l'actif est régénéré. `scripts/sync-streets.ts` lit cette
 * adresse pour retrouver le lien de téléchargement réel de l'actif ZIP (`assets.<nom>.href`
 * de la première entité), jamais une adresse de téléchargement codée en dur.
 *
 * Source : catalogue opendata.swiss « amtliches-verzeichnis-der-strassen », ressources
 * `rights = terms_open`, éditeur swisstopo, relevé le 06.10.2026 (voir
 * `etl/shared/sources/registry.ts`, source `swisstopo.streets`). Fichier STAC
 * `ch.swisstopo.amtliches-strassenverzeichnis`, item `amtliches-strassenverzeichnis_ch`,
 * actif `amtliches-strassenverzeichnis_ch_2056.csv.zip` (projection LV95, EPSG:2056).
 */

export const SWISSTOPO_STREETS_STAC_ITEMS_URL =
  "https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.amtliches-strassenverzeichnis/items";

/** Nom de l'actif STAC suivi (projection LV95/EPSG:2056). */
export const SWISSTOPO_STREETS_ASSET_NAME = "amtliches-strassenverzeichnis_ch_2056.csv.zip";

/** Nom du fichier CSV à l'intérieur du ZIP officiel, recherché par nom de fichier seul (un
 *  changement de dossier dans l'archive ne doit pas faire échouer la collecte). */
export const SWISSTOPO_STREETS_CSV_BASENAME = "amtliches-strassenverzeichnis_ch_2056.csv";
