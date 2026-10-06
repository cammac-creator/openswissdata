/**
 * Répertoire officiel des localités (NPA, commune, canton) — swisstopo (tâche osd.localites).
 *
 * Catalogue STAC de geo.admin.ch : la collection ne change pas d'adresse d'un mois à
 * l'autre, seul le contenu de l'actif est régénéré. `scripts/sync-localities.ts` lit cette
 * adresse pour retrouver le lien de téléchargement réel de l'actif CSV (`assets.<nom>.href`
 * de la première entité), jamais une adresse de téléchargement codée en dur (elle peut
 * changer sans préavis, contrairement à l'adresse de la collection).
 *
 * Source : catalogue opendata.swiss « amtliches-ortschaftenverzeichnis-mit-postleitzahl-
 * und-perimeter », ressources `rights = terms_open`, éditeur swisstopo, relu le 06.10.2026
 * (voir `etl/shared/sources/registry.ts`, source `swisstopo.localities`).
 */

export const SWISSTOPO_LOCALITIES_STAC_ITEMS_URL =
  "https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo-vd.ortschaftenverzeichnis_plz/items";

/** Nom de l'actif STAC suivi (projection WGS84) ; seules les colonnes non géographiques du
 *  CSV qu'il contient sont conservées dans le fichier distribué — voir `sync-localities.ts`. */
export const SWISSTOPO_LOCALITIES_ASSET_NAME = "ortschaftenverzeichnis_plz_4326.csv.zip";

/** Nom du fichier CSV à l'intérieur du ZIP officiel (dossier `AMTOVZ_CSV_WGS84/` au 06.10.2026,
 *  recherché par nom de fichier seul : un changement de dossier ne doit pas faire échouer la
 *  collecte). */
export const SWISSTOPO_LOCALITIES_CSV_BASENAME = "AMTOVZ_CSV_WGS84.csv";
