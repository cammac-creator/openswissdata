/**
 * Balisage schema.org des fiches produit, identique dans les trois langues.
 * Aucune donnée volatile (volume, version, date) n'est figée au build : elles se lisent
 * sur la fiche, depuis le catalogue servi. Aucune distribution ne pointe vers une page
 * HTML : les archives payantes ne sont pas téléchargeables publiquement.
 */
import { localizePath, type Lang } from '../i18n/utils';
import { BUNDLE_OFFER, FILE_OFFERS, type FileProductId } from './offers';

const ORIGIN = 'https://www.openswissdata.com';
const LANGUAGE_TAGS: Record<Lang, string> = { fr: 'fr-CH', de: 'de-CH', en: 'en' };
const organisation = { '@type': 'Organization', name: 'openswissdata', url: ORIGIN };

/** Adresse canonique d'une route, dans la forme produite par le site (barre finale). */
export function canonicalUrl(path: string, lang: Lang): string {
  const localized = localizePath(path, lang);
  return ORIGIN + (localized.endsWith('/') ? localized : `${localized}/`);
}

interface DatasetCopy { name: string; keywords: string[]; variables: string[] }
const DATASETS: Record<FileProductId, Record<Lang, DatasetCopy>> = {
  tares: {
    fr: { name: 'TARES — tarif douanier suisse en fichiers structurés', keywords: ['TARES', 'tarif douanier suisse', 'numéro de tarif', 'Système harmonisé', 'droits de douane', 'préférences tarifaires', 'OFDF'],
      variables: ['Numéro de tarif à huit chiffres', 'Désignations en français, allemand, italien et anglais', 'Résumé du droit de base et de son unité', 'Résumé des préférences sans variante conditionnelle', 'Lignes de taux détaillées : accord, unité, validité et conditions'] },
    de: { name: 'TARES — Schweizer Zolltarif als strukturierte Dateien', keywords: ['TARES', 'Schweizer Zolltarif', 'Tarifnummer', 'Harmonisiertes System', 'Zollansatz', 'Präferenzzoll', 'BAZG'],
      variables: ['Achtstellige Tarifnummer', 'Bezeichnungen auf Französisch, Deutsch, Italienisch und Englisch', 'Zusammenfassung des Normalansatzes und seiner Einheit', 'Zusammenfassung der Präferenzen ohne bedingte Varianten', 'Detaillierte Tarifzeilen: Abkommen, Einheit, Gültigkeit und Bedingungen'] },
    en: { name: 'TARES — Swiss customs tariff as structured files', keywords: ['TARES', 'Swiss customs tariff', 'tariff number', 'Harmonized System', 'customs duty', 'tariff preferences', 'FOCBS'],
      variables: ['Eight-digit tariff number', 'Descriptions in French, German, Italian and English', 'Summary of the base duty and its unit', 'Summary of preferences without conditional variants', 'Detailed rate rows: agreement, unit, validity and conditions'] },
  },
  classifications: {
    fr: { name: 'Classifications NOGA, NACE et ISIC avec correspondances sourcées', keywords: ['NOGA 2008', 'NOGA 2025', 'NACE Rév. 2', 'NACE Rév. 2.1', 'ISIC Rév. 4', 'nomenclature des activités économiques', 'table de correspondance'],
      variables: ['Code, niveau et parent de chaque nomenclature', 'Libellés NOGA et NACE en français, allemand, italien et anglais', 'Libellés ISIC en français, anglais et espagnol', 'Correspondances par paire avec relation et source'] },
    de: { name: 'Klassifikationen NOGA, NACE und ISIC mit belegten Zuordnungen', keywords: ['NOGA 2008', 'NOGA 2025', 'NACE Rev. 2', 'NACE Rev. 2.1', 'ISIC Rev. 4', 'Wirtschaftszweige', 'Korrespondenztabelle'],
      variables: ['Code, Ebene und übergeordneter Code jeder Nomenklatur', 'NOGA- und NACE-Bezeichnungen auf Französisch, Deutsch, Italienisch und Englisch', 'ISIC-Bezeichnungen auf Französisch, Englisch und Spanisch', 'Paarweise Zuordnungen mit Beziehung und Quelle'] },
    en: { name: 'NOGA, NACE and ISIC classifications with sourced mappings', keywords: ['NOGA 2008', 'NOGA 2025', 'NACE Rev. 2', 'NACE Rev. 2.1', 'ISIC Rev. 4', 'economic activity classification', 'correspondence table'],
      variables: ['Code, level and parent in each classification', 'NOGA and NACE labels in French, German, Italian and English', 'ISIC labels in French, English and Spanish', 'Pairwise mappings with relation and source'] },
  },
  finma: {
    fr: { name: 'Registre FINMA — autorisations et liste d’avertissement', keywords: ['FINMA', 'registre FINMA', 'établissements autorisés', 'liste d’avertissement', 'UID', 'LEI', 'conformité'],
      variables: ['Institution et catégorie d’autorisation', 'UID', 'LEI par correspondance exacte de l’UID', 'Adresse, localité et canton lorsque disponibles', 'Liste d’avertissement séparée'] },
    de: { name: 'FINMA-Register — Bewilligungen und Warnliste', keywords: ['FINMA', 'FINMA-Register', 'bewilligte Institute', 'Warnliste', 'UID', 'LEI', 'Compliance'],
      variables: ['Institut und Bewilligungskategorie', 'UID', 'LEI über exakte UID-Zuordnung', 'Adresse, Ort und Kanton, sofern verfügbar', 'Separate Warnliste'] },
    en: { name: 'FINMA Registry — authorisations and warning list', keywords: ['FINMA', 'FINMA registry', 'authorised institutions', 'warning list', 'UID', 'LEI', 'compliance'],
      variables: ['Institution and authorisation category', 'UID', 'LEI through exact UID matches', 'Address, city and canton when available', 'Separate warning list'] },
  },
};

const SOURCES: Record<FileProductId, Array<{ name: string; url: string }>> = {
  tares: [{ name: 'Tares — OFDF / BAZG / FOCBS', url: 'https://xtares.admin.ch/' }],
  classifications: [
    { name: 'NOGA 2008 et NOGA 2025 — OFS / BFS / FSO', url: 'https://www.i14y.admin.ch/' },
    { name: 'NACE Rev. 2 et Rev. 2.1 — Eurostat', url: 'https://ec.europa.eu/eurostat/web/nace' },
    { name: 'ISIC Rev. 4 — United Nations Statistics Division', url: 'https://unstats.un.org/unsd/classifications/Econ/isic' },
  ],
  finma: [
    { name: 'FINMA — authorised institutions', url: 'https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/' },
    { name: 'GLEIF — LEI data', url: 'https://www.gleif.org/' },
  ],
};

const SWITZERLAND: Record<Lang, string> = { fr: 'Suisse', de: 'Schweiz', en: 'Switzerland' };

/** Dataset schema.org complet et localisé ; la description est celle de la fiche. */
export function datasetJsonLd(id: FileProductId, lang: Lang, description: string): Record<string, unknown> {
  const copy = DATASETS[id][lang];
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: copy.name,
    description,
    url: canonicalUrl(`/datasets/${id}`, lang),
    identifier: `openswissdata:${id}`,
    inLanguage: LANGUAGE_TAGS[lang],
    license: canonicalUrl('/legal/cgv', lang),
    isAccessibleForFree: false,
    creator: organisation,
    publisher: organisation,
    isBasedOn: SOURCES[id].map(source => ({ '@type': 'Dataset', name: source.name, url: source.url })),
    keywords: copy.keywords,
    variableMeasured: copy.variables,
    // NACE et ISIC dépassent la Suisse : la couverture n'est déclarée que pour TARES et FINMA.
    ...(id === 'classifications' ? {} : { spatialCoverage: { '@type': 'Place', name: SWITZERLAND[lang], address: { '@type': 'PostalAddress', addressCountry: 'CH' } } }),
  };
}

/** Offre schema.org sans date de validité, livraison ni retour inventés. */
export function productJsonLd(id: FileProductId | 'bundle', lang: Lang, details: { name: string; description: string; image: string }): Record<string, unknown> {
  const path = id === 'bundle' ? '/bundle' : `/datasets/${id}`;
  const url = canonicalUrl(path, lang);
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: details.name,
    description: details.description,
    image: ORIGIN + details.image,
    url,
    brand: { '@type': 'Brand', name: 'openswissdata' },
    offers: {
      '@type': 'Offer',
      price: String(id === 'bundle' ? BUNDLE_OFFER.price : FILE_OFFERS[id].price),
      priceCurrency: 'CHF',
      availability: 'https://schema.org/InStock',
      url: `${url}#acheter`,
      seller: organisation,
    },
    ...(id === 'bundle' ? { isRelatedTo: BUNDLE_OFFER.products.map(product => ({ '@type': 'Product', name: product === 'finma' ? 'FINMA Registry' : product === 'tares' ? 'TARES' : 'Classifications', url: canonicalUrl(`/datasets/${product}`, lang) })) } : {}),
  };
}
