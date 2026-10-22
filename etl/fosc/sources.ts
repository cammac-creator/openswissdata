/**
 * FOSC (Feuille officielle suisse du commerce), Portail des feuilles officielles du SECO :
 * rubrique HR (registre du commerce). Décision de Claude-Alain du 16.10.2026 (d3 = A, F8
 * accordé) : « des totaux, et les événements des sociétés ». Détail et preuves :
 * `etl/fosc/SOURCES.md` et la ligne « SECO / FOSC » de `docs/droits-des-sources.md`.
 *
 * API publique, sans compte : documentation technique https://www.amtsblattportal.ch/docs/api/
 * (relue le 22.10.2026). Une liste par jour de publication, puis le détail XML de chaque avis
 * (« Step 1 … Step 2 : iterate over this list and get the single XML responses »).
 */

export const FOSC_API_BASE = "https://www.shab.ch/api/v1";

/** Adresse déclarée au registre des sources : point d'entrée de la liste des avis. */
export const FOSC_PUBLICATIONS_URL = `${FOSC_API_BASE}/publications`;

/** Rubrique du registre du commerce. Sous-rubriques documentées : HR01 à HR03. */
export const FOSC_RUBRIC = "HR";

/** Plafond documenté : « More than 2000 hits are not allowed » par page. */
export const FOSC_MAX_PAGE_SIZE = 2000;

/** Liste des avis encore publiés (`publicationStates=PUBLISHED`) d'un jour de publication. */
export function listUrl(day: string, page: number, size = FOSC_MAX_PAGE_SIZE): string {
  const params = new URLSearchParams({
    publicationStates: "PUBLISHED",
    rubrics: FOSC_RUBRIC,
    "publicationDate.start": day,
    "publicationDate.end": day,
    "pageRequest.page": String(page),
    "pageRequest.size": String(size),
    // Tri stable (numéro de publication croissant) : sans lui, l'ordre entre deux pages d'un
    // même jour n'est pas garanti (tri par défaut = date de publication, identique pour tous).
    "pageRequest.sortOrders": "column:PUBLICATION_NUMBER|direction:ASC",
  });
  return `${FOSC_PUBLICATIONS_URL}?${params.toString()}`;
}

/** Détail XML d'un avis. L'identifiant est vérifié (UUID) avant de construire l'adresse. */
export function detailXmlUrl(publicationId: string): string {
  if (!PUBLICATION_ID_RE.test(publicationId)) throw new Error("Identifiant d'avis invalide");
  return `${FOSC_PUBLICATIONS_URL}/${publicationId}/xml`;
}

export const PUBLICATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Même forme que les autres collectes ; aucune adresse e-mail (consigne du projet). */
export const FOSC_USER_AGENT = "OpenSwissData-collect/1.0 (+https://www.openswissdata.com)";

/**
 * Conditions générales du portail (CG), version du 07.06.2024, relue le 16.10.2026 et le
 * 22.10.2026. Empreinte du PDF français mesurée le 22.10.2026 (216 659 octets). La collecte
 * relit le PDF à chaque passage et s'arrête si l'empreinte change (CG 1.1 al. 4 : s'informer de
 * la version actuelle) : une nouvelle version demande une relecture, puis un nouvel accord.
 */
export const FOSC_TERMS_URL = "https://shab.ch/static/agb_fr.pdf";
export const FOSC_TERMS_VERSION = "2024-06-07";
export const FOSC_TERMS_SHA256 = "e8770a63beb1b9a6344e347023410c9ad4c3d287187a8efa88745ce237bf708e";

/**
 * Acceptation des CG pour le compte du service : décision de Claude-Alain du 16.10.2026
 * (d3 = A, F8 accordé). CG 1.2 al. 1 : acceptation avant la première utilisation, « puis à
 * intervalles de 90 jours ». Au-delà, la collecte refuse de lire le portail (la purge continue)
 * jusqu'à une nouvelle acceptation, qui reste un geste de Claude-Alain (bouton F8).
 */
export const FOSC_TERMS_ACCEPTED_ON = "2026-10-16";
export const FOSC_TERMS_RENEWAL_DAYS = 90;

/** Formules exactes des CG 3.3 (versions FR, DE, EN du PDF du 07.06.2024). */
export const FOSC_NOT_OFFICIAL_NOTICE = {
  fr: "Ceci n'est pas une publication officielle. Seules font foi les données du Portail des feuilles officielles que le SECO a pourvues d'une signature ou d'un cachet électroniques.",
  de: "Dies ist keine amtliche Veröffentlichung. Massgebend sind die vom SECO mit einer elektronischen Signatur oder einem elektronischen Siegel versehenen Daten im Amtsblattportal.",
  en: "This is not an official publication. The authoritative data are those which appear on the Official Gazettes Portal and bear the SECO electronic signature or stamp.",
} as const;

/**
 * Indications de qualité du SECO, à reprendre dans toute exploitation (CG 3.3, dernier tiret) :
 * CG 2 al. 1 et avertissement de la documentation de l'API (relue le 22.10.2026).
 */
export const FOSC_QUALITY_NOTICE = {
  fr: "La transmission intégrale et correcte des données ne peut être garantie à 100 % en cas d'utilisation de l'interface de programmation d'application (API) (CG du Portail des feuilles officielles, point 2). Seul le document PDF signé fait foi.",
  de: "Bei der Nutzung des Application-Programming-Interface (API) kann die vollständige und richtige Übertragung der Daten nicht in jedem Fall gewährleistet werden (AGB des Amtsblattportals, Ziffer 2). Rechtsverbindlich ist allein das signierte PDF-Dokument.",
  en: "The operator does not guarantee the completeness and accuracy of the data transferred via API. The legally binding nature of a publication is exclusively guaranteed by the content of the signed PDF document (Official Gazettes Portal, API documentation).",
} as const;

export const FOSC_SOURCE_LABEL = {
  fr: "Feuille officielle suisse du commerce (FOSC), Portail des feuilles officielles du SECO, rubrique Registre du commerce",
  de: "Schweizerisches Handelsamtsblatt (SHAB), Amtsblattportal des SECO, Rubrik Handelsregister",
  en: "Swiss Official Gazette of Commerce (SOGC), SECO Official Gazettes Portal, Commercial Register section",
} as const;

/** Liste des formes juridiques de l'OFS (source des codes et libellés de `legal-forms.ts`). */
export const OFS_LEGAL_FORMS_I14Y_URL =
  "https://api.i14y.admin.ch/api/public/v1/concepts/89bc55cc-3858-4c13-a5c8-7dc935dff29b/codelist-entries/exports/json";
