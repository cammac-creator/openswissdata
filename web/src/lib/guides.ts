/**
 * Guides FINMA : types, sources primaires archivées, textes communs et mise en forme.
 *
 * Les guides sont rédigés dans chaque langue à partir de sources officielles consultées
 * le 29.09.2026 et archivées (URL, date, SHA-256) dans le dossier privé du chantier.
 * Aucun chiffre du produit n'est figé ici : les volumes et la version se lisent sur la
 * fiche produit, depuis le catalogue servi.
 */
import { localizePath, type Lang } from '../i18n/utils';

export const GUIDE_IDS = ['finma-authorisation-check', 'finma-warning-list', 'finma-screening-automation'] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

/** Date de consultation des sources : un fait daté, jamais une date de construction. */
export const SOURCES_CONSULTED = '2026-09-29';
const [YEAR, MONTH, DAY] = SOURCES_CONSULTED.split('-');
/** Même date, écrite selon l’usage de chaque langue. */
export const CONSULTED_ON = {
  fr: `${DAY}.${MONTH}.${YEAR}`,
  de: `${DAY}.${MONTH}.${YEAR}`,
  en: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${SOURCES_CONSULTED}T00:00:00Z`)),
} as const;

export type SourceId =
  | 'finma-autorises' | 'finma-uid-csv' | 'finma-intermediaires' | 'finma-oar' | 'finma-sans-droit'
  | 'finma-alertes' | 'finma-liste-alerte' | 'finma-sanctions'
  | 'seco-sanctions' | 'ofs-uid' | 'uid-register' | 'ofj-zefix' | 'gleif-lei' | 'gleif-cdf';

export interface SourceDoc {
  publisher: Record<Lang, string>;
  title: Record<Lang, string>;
  url: Record<Lang, string>;
  /** Langue du document lorsqu'il n'existe pas dans la langue de la page. */
  documentLanguage?: Partial<Record<Lang, string>>;
}

const FINMA = { fr: 'FINMA', de: 'FINMA', en: 'FINMA' };
const same = (value: string) => ({ fr: value, de: value, en: value });

/** Pages officielles effectivement citées ; l'archive privée garde leurs octets et empreintes. */
export const SOURCES: Record<SourceId, SourceDoc> = {
  'finma-autorises': {
    publisher: FINMA,
    title: { fr: 'Établissements, personnes et produits autorisés ou enregistrés', de: 'Bewilligte oder registrierte Institute, Personen und Produkte', en: 'Authorised or registered institutions, persons and products' },
    url: { fr: 'https://www.finma.ch/fr/finma-public/etablissements-personnes-et-produits-autorises/', de: 'https://www.finma.ch/de/finma-public/bewilligte-institute-personen-und-produkte/', en: 'https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/' },
  },
  'finma-uid-csv': {
    publisher: FINMA,
    title: { fr: 'Liste des numéros d’identification d’entreprises autorisées (fichier CSV)', de: 'Liste Unternehmens-Identifikationsnummern bewilligter Unternehmen (CSV-Datei)', en: 'List of business identification numbers for authorised companies (CSV file)' },
    url: { fr: 'https://www.finma.ch/fr/~/media/finma/dokumente/bewilligungstraeger/csv/uid.csv', de: 'https://www.finma.ch/de/~/media/finma/dokumente/bewilligungstraeger/csv/uid.csv', en: 'https://www.finma.ch/en/~/media/finma/dokumente/bewilligungstraeger/csv/uid.csv' },
  },
  'finma-intermediaires': {
    publisher: FINMA,
    title: { fr: 'Registre des intermédiaires d’assurance', de: 'Register für Versicherungsvermittlerinnen und Versicherungsvermittler', en: 'Register for insurance intermediaries' },
    url: { fr: 'https://www.finma.ch/fr/surveillance/versicherungsvermittler/registersuche/', de: 'https://www.finma.ch/de/ueberwachung/versicherungsvermittler/registersuche/', en: 'https://www.finma.ch/en/supervision/versicherungsvermittler/registersuche/' },
  },
  'finma-oar': {
    publisher: FINMA,
    title: { fr: 'Recherche de membres OAR', de: 'SRO-Mitglieder-Suche', en: 'SRO member search' },
    url: { fr: 'https://www.finma.ch/fr/autorisation/organisme-d-autoregulation-oar/recherche-de-membres-oar/', de: 'https://www.finma.ch/de/bewilligung/selbstregulierungsorganisationen-sro/sro-mitglieder-suche/', en: 'https://www.finma.ch/en/authorisation/self-regulatory-organisations-sros/sro-member-search/' },
  },
  'finma-sans-droit': {
    publisher: FINMA,
    title: { fr: 'Activités exercées sans droit', de: 'Unerlaubte Tätigkeiten', en: 'Unauthorised activities' },
    url: { fr: 'https://www.finma.ch/fr/mise-en-oeuvre/activites-exercees-sans-droit/', de: 'https://www.finma.ch/de/durchsetzung/unerlaubte-taetigkeiten/', en: 'https://www.finma.ch/en/enforcement/unauthorised-activities/' },
  },
  'finma-alertes': {
    publisher: FINMA,
    title: { fr: 'Alertes de la FINMA', de: 'Warnungen der FINMA', en: 'Public warnings issued by FINMA' },
    url: { fr: 'https://www.finma.ch/fr/finma-public/warnungen/', de: 'https://www.finma.ch/de/finma-public/warnungen/', en: 'https://www.finma.ch/en/finma-public/warnungen/' },
  },
  'finma-liste-alerte': {
    publisher: FINMA,
    title: { fr: 'Liste d’alerte', de: 'Warnliste', en: 'Warning list' },
    url: { fr: 'https://www.finma.ch/fr/finma-public/warnungen/liste-d\'alerte/', de: 'https://www.finma.ch/de/finma-public/warnungen/warnliste/', en: 'https://www.finma.ch/en/finma-public/warnungen/warning-list/' },
  },
  'finma-sanctions': {
    publisher: FINMA,
    title: { fr: 'Sanctions et déclarations du GAFI', de: 'Sanktionen und FATF-Statements', en: 'Sanctions and FATF statements' },
    url: { fr: 'https://www.finma.ch/fr/documentation/sanctions-internationales-et-lutte-contre-le-terrorisme/', de: 'https://www.finma.ch/de/dokumentation/internationale-sanktionen-und-terrorismusbekaempfung/', en: 'https://www.finma.ch/en/documentation/international-sanctions-and-combating-terrorism/' },
  },
  'seco-sanctions': {
    publisher: same('SECO'),
    title: { fr: 'Recherche des destinataires de sanctions et liste récapitulative', de: 'Suche nach Sanktionsadressaten und Gesamtliste', en: 'Searching for subjects of sanctions and overall list' },
    url: { fr: 'https://www.seco.admin.ch/fr/recherche-destinataires-sanctions', de: 'https://www.seco.admin.ch/de/suche-nach-sanktionsadressaten', en: 'https://www.seco.admin.ch/en/searching-for-subjects-sanctions' },
  },
  'ofs-uid': {
    publisher: { fr: 'Office fédéral de la statistique (OFS)', de: 'Bundesamt für Statistik (BFS)', en: 'Federal Statistical Office (FSO)' },
    title: { fr: 'L’IDE en général', de: 'Allgemeines zur UID', en: 'The UID in general' },
    url: { fr: 'https://www.bfs.admin.ch/bfs/fr/home/registres/registre-entreprises/numero-identification-entreprises/ide-general.html', de: 'https://www.bfs.admin.ch/bfs/de/home/register/unternehmensregister/unternehmens-identifikationsnummer/allgemeines-uid.html', en: 'https://www.bfs.admin.ch/bfs/en/home/registers/enterprise-register/enterprise-identification/uid-general.html' },
  },
  'uid-register': {
    publisher: { fr: 'Office fédéral de la statistique (OFS)', de: 'Bundesamt für Statistik (BFS)', en: 'Federal Statistical Office (FSO)' },
    title: { fr: 'Registre IDE : recherche', de: 'UID-Register: Suche', en: 'UID Register: search' },
    url: same('https://www.uid.admin.ch/'),
  },
  'ofj-zefix': {
    publisher: { fr: 'Office fédéral de la justice (OFJ)', de: 'Bundesamt für Justiz (BJ)', en: 'Federal Office of Justice (FOJ)' },
    title: { fr: 'Registre du commerce, Zefix® et Regix', de: 'Handelsregister, Zefix® und Regix', en: 'Handelsregister, Zefix® und Regix' },
    url: { fr: 'https://www.bj.admin.ch/fr/registre-du-commerce-zefix-et-regix', de: 'https://www.bj.admin.ch/de/handelsregister-zefix-und-regix', en: 'https://www.bj.admin.ch/de/handelsregister-zefix-und-regix' },
    documentLanguage: { en: 'German' },
  },
  'gleif-lei': {
    publisher: same('GLEIF'),
    title: same('The Legal Entity Identifier (LEI)'),
    url: same('https://www.gleif.org/en/organizational-identity/lei-vlei/the-legal-entity-identifier-lei'),
    documentLanguage: { fr: 'anglais', de: 'Englisch' },
  },
  'gleif-cdf': {
    publisher: same('GLEIF'),
    title: same('Level 1 Data: LEI-CDF Format 3.1'),
    url: same('https://www.gleif.org/en/lei-data/access-and-use-lei-data/level-1-data-lei-cdf-3-1-format'),
    documentLanguage: { fr: 'anglais', de: 'Englisch' },
  },
};

/* ---------- Contenu ---------- */

export interface PathStep { title: string; text: string }
export type Block =
  | { type: 'p'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'quote'; text: string; source: SourceId }
  | { type: 'callout'; title: string; text: string; tone?: 'note' | 'warn' }
  | { type: 'table'; caption: string; head: string[]; rows: string[][]; note?: string }
  | { type: 'code'; label: string; language: 'sql' | 'sh' | 'csv' | 'python'; code: string }
  | { type: 'path'; label: string; steps: PathStep[] }
  | { type: 'entry'; label: string; window: string; fields: Array<{ name: string; note: string }>; saysTitle: string; says: string[]; notTitle: string; not: string[] };

export interface GuideSection { id: string; title: string; blocks: Block[] }

export interface GuideCopy {
  /** Titre de l’onglet et du balisage (sans le nom du site), 110 caractères au plus. */
  title: string;
  /** Description des moteurs de recherche, 160 caractères au plus. */
  description: string;
  /** Nom court : fil d’Ariane et liens entre guides. */
  short: string;
  /** Résumé d’une phrase pour les liens entre guides. */
  summary: string;
  h1: string;
  accent: string;
  lede: string;
  sections: GuideSection[];
}

export type GuideDefinition = { schemaType: 'Article' | 'TechArticle'; order: number } & Record<Lang, GuideCopy>;

/* ---------- Textes communs ---------- */

export const GUIDE_UI: Record<Lang, {
  catalogue: string; product: string; guides: string; breadcrumb: string; kicker: (n: number, total: number) => string;
  toc: string; reading: (minutes: number) => string; sourcesCount: (n: number) => string; consulted: string;
  sourcesTitle: string; sourcesIntro: string; sourceLang: string; citeLabel: (n: number) => string;
  disclaimerTitle: string; disclaimer: string;
  ctaKicker: string; ctaTitle: string; ctaText: (price: number) => string; ctaProduct: string; ctaSample: string; ctaSampleNote: string;
  relatedTitle: string; relatedLink: string; codeLabel: string; tableLabel: string; backToTop: string;
}> = {
  fr: {
    catalogue: 'Les données', product: 'FINMA Registry', guides: 'Guides', breadcrumb: 'Fil d’Ariane',
    kicker: (n, total) => `Guide FINMA · ${n} sur ${total}`,
    toc: 'Sommaire', reading: minutes => `Lecture : ${minutes} min`, sourcesCount: n => `${n} sources officielles`, consulted: `consultées le ${CONSULTED_ON.fr}`,
    sourcesTitle: 'Sources officielles', sourcesIntro: `Les citations et les faits de ce guide proviennent de ces pages, consultées le ${CONSULTED_ON.fr}. Seules ces sources font foi ; elles peuvent avoir changé depuis.`,
    sourceLang: 'document en', citeLabel: n => `Source ${n}`,
    disclaimerTitle: 'À lire avant d’utiliser ce guide',
    disclaimer: 'Ce guide est publié par OpenSwissData, service privé indépendant, sans affiliation à la FINMA. Il n’engage pas la FINMA et ne remplace pas un avis juridique ou professionnel. Il décrit des sources publiques et une méthode de travail ; vos obligations dépendent de votre activité et de votre cadre interne.',
    ctaKicker: 'Pour travailler avec les données', ctaTitle: 'Le registre FINMA en fichiers.',
    ctaText: price => `La liste des UID d’entreprises autorisées publiée par la FINMA, en Excel, CSV, JSON, Parquet et SQL. Le LEI est ajouté lorsque l’IDE correspond exactement à un seul LEI chez la GLEIF, la liste d’alerte reste dans des fichiers séparés, et chaque version est signée. Paiement unique de ${price} CHF.`,
    ctaProduct: 'Voir la fiche produit', ctaSample: 'Télécharger l’échantillon CSV', ctaSampleNote: 'Échantillon gratuit, sans compte : jusqu’à 20 lignes du registre par catégorie.',
    relatedTitle: 'Les autres guides FINMA', relatedLink: 'Lire le guide', codeLabel: 'Exemple de code', tableLabel: 'Faites défiler le tableau pour voir toutes les colonnes', backToTop: 'Revenir au sommaire',
  },
  de: {
    catalogue: 'Datensätze', product: 'FINMA Registry', guides: 'Leitfäden', breadcrumb: 'Pfadnavigation',
    kicker: (n, total) => `FINMA-Leitfaden · ${n} von ${total}`,
    toc: 'Inhalt', reading: minutes => `Lesezeit: ${minutes} Min.`, sourcesCount: n => `${n} offizielle Quellen`, consulted: `abgerufen am ${CONSULTED_ON.de}`,
    sourcesTitle: 'Offizielle Quellen', sourcesIntro: `Die Zitate und Fakten dieses Leitfadens stammen aus diesen Seiten, abgerufen am ${CONSULTED_ON.de}. Massgebend sind allein diese Quellen; sie können sich seither geändert haben.`,
    sourceLang: 'Dokument auf', citeLabel: n => `Quelle ${n}`,
    disclaimerTitle: 'Bitte vor der Verwendung lesen',
    disclaimer: 'Dieser Leitfaden wird von OpenSwissData veröffentlicht, einem unabhängigen privaten Dienst ohne Verbindung zur FINMA. Er bindet die FINMA nicht und ersetzt keine rechtliche oder fachliche Beratung. Er beschreibt öffentliche Quellen und eine Arbeitsweise; Ihre Pflichten hängen von Ihrer Tätigkeit und Ihren internen Vorgaben ab.',
    ctaKicker: 'Mit den Daten arbeiten', ctaTitle: 'Das FINMA-Register als Dateien.',
    ctaText: price => `Die von der FINMA veröffentlichte Liste der UID bewilligter Unternehmen als Excel, CSV, JSON, Parquet und SQL. Ein LEI wird ergänzt, wenn die UID genau einem LEI bei der GLEIF entspricht; die Warnliste bleibt in separaten Dateien, und jede Version ist signiert. Einmalige Zahlung: CHF ${price}.`,
    ctaProduct: 'Zur Produktseite', ctaSample: 'CSV-Muster herunterladen', ctaSampleNote: 'Kostenloses Muster ohne Konto: bis zu 20 Registerzeilen je Kategorie.',
    relatedTitle: 'Die anderen FINMA-Leitfäden', relatedLink: 'Leitfaden lesen', codeLabel: 'Codebeispiel', tableLabel: 'Scrollen Sie die Tabelle, um alle Spalten zu sehen', backToTop: 'Zurück zum Inhalt',
  },
  en: {
    catalogue: 'The data', product: 'FINMA Registry', guides: 'Guides', breadcrumb: 'Breadcrumb',
    kicker: (n, total) => `FINMA guide · ${n} of ${total}`,
    toc: 'Contents', reading: minutes => `${minutes} min read`, sourcesCount: n => `${n} official sources`, consulted: `consulted on ${CONSULTED_ON.en}`,
    sourcesTitle: 'Official sources', sourcesIntro: `The quotations and facts in this guide come from these pages, consulted on ${CONSULTED_ON.en}. Only these sources are authoritative, and they may have changed since.`,
    sourceLang: 'document in', citeLabel: n => `Source ${n}`,
    disclaimerTitle: 'Please read before using this guide',
    disclaimer: 'This guide is published by OpenSwissData, an independent private service not affiliated with FINMA. It does not bind FINMA and is no substitute for legal or professional advice. It describes public sources and a way of working; your obligations depend on your activity and your internal framework.',
    ctaKicker: 'Working with the data', ctaTitle: 'The FINMA registry as files.',
    ctaText: price => `The list of UIDs of authorised companies published by FINMA, as Excel, CSV, JSON, Parquet and SQL. An LEI is added when the UID matches exactly one LEI at GLEIF, the warning list stays in separate files, and every version is signed. One-time payment of CHF ${price}.`,
    ctaProduct: 'View the product page', ctaSample: 'Download the CSV sample', ctaSampleNote: 'Free sample, no account needed: up to 20 registry rows per category.',
    relatedTitle: 'The other FINMA guides', relatedLink: 'Read the guide', codeLabel: 'Code example', tableLabel: 'Scroll the table to see all columns', backToTop: 'Back to contents',
  },
};

/* ---------- Adresses ---------- */

/** Adresse publique d’un guide, identique dans les trois langues à l’exception du préfixe. */
export function guidePath(id: GuideId, lang: Lang): string {
  return localizePath(`/guides/${id}/`, lang);
}

export const SAMPLE_CSV_URL = '/api/catalog/finma?format=csv';

/* ---------- Texte enrichi minimal ---------- */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string; external: boolean }
  | { kind: 'cite'; source: SourceId };

const INLINE = /\[\^([a-z0-9-]+)\]|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*(.+?)\*\*/g;

export function isSourceId(value: string): value is SourceId {
  return Object.hasOwn(SOURCES, value);
}

/**
 * Découpe un texte en segments : [^source], [lien](adresse), `code` et **gras**.
 * « @/chemin » désigne une page du site, localisée dans la langue courante.
 */
export function parseInline(text: string, lang: Lang): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: text.slice(last, index) });
    const [, cite, label, href, code, strong] = match;
    if (cite !== undefined) {
      if (!isSourceId(cite)) throw new Error(`Source inconnue : ${cite}`);
      out.push({ kind: 'cite', source: cite });
    } else if (label !== undefined && href !== undefined) {
      const local = href.startsWith('@/');
      out.push({ kind: 'link', text: label, href: local ? localizePath(href.slice(1), lang) : href, external: /^https?:/.test(href) });
    } else if (code !== undefined) {
      out.push({ kind: 'code', text: code });
    } else if (strong !== undefined) {
      out.push({ kind: 'strong', text: strong });
    }
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** Textes d’un bloc, dans l’ordre de lecture, pour les citations et le temps de lecture. */
export function blockTexts(block: Block): string[] {
  switch (block.type) {
    case 'p': case 'h3': return [block.text];
    case 'list': return block.items;
    case 'quote': return [block.text];
    case 'callout': return [block.title, block.text];
    case 'table': return [block.caption, ...block.head, ...block.rows.flat(), ...(block.note ? [block.note] : [])];
    case 'code': return [block.label];
    case 'path': return [block.label, ...block.steps.flatMap(step => [step.title, step.text])];
    case 'entry': return [block.label, block.window, ...block.fields.flatMap(field => [field.name, field.note]), block.saysTitle, ...block.says, block.notTitle, ...block.not];
  }
}

/** Sources dans l’ordre de leur première citation : numéros de renvoi et liste finale. */
export function citationOrder(copy: GuideCopy): SourceId[] {
  const order: SourceId[] = [];
  const add = (id: SourceId) => { if (!order.includes(id)) order.push(id); };
  for (const section of copy.sections) {
    for (const block of section.blocks) {
      for (const text of blockTexts(block)) {
        for (const match of text.matchAll(/\[\^([a-z0-9-]+)\]/g)) {
          if (!isSourceId(match[1])) throw new Error(`Source inconnue : ${match[1]}`);
          add(match[1]);
        }
      }
      if (block.type === 'quote') add(block.source);
    }
  }
  return order;
}

/** Temps de lecture calculé sur le texte réellement publié (200 mots par minute, code compris). */
export function readingMinutes(copy: GuideCopy): number {
  const words = [copy.lede, ...copy.sections.flatMap(section => [section.title, ...section.blocks.flatMap(block => [...blockTexts(block), ...(block.type === 'code' ? [block.code] : [])])])]
    .join(' ').replace(/\[\^[a-z0-9-]+\]/g, '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
