/**
 * i18n des pages NOGA (fr/de/en) — strings, métadonnées et exemples localisés.
 *
 * Les libellés de codes (label_fr/de/it/en) viennent de la donnée OFS ; ici on
 * traduit l'enrobage éditorial + UI une seule fois, partagé par les ~1047 pages
 * de chaque langue. Détection de catégorie d'exemple faite sur label_fr (stable),
 * rendu de la prose dans la langue cible.
 */
import type { Lang } from "../i18n/utils";
import { dottedCode, type NogaRow, type Level } from "./noga-helpers";

export function labelFor(row: { label_fr: string; label_de: string; label_en: string }, lang: Lang): string {
  if (lang === "de") return row.label_de || row.label_fr;
  if (lang === "en") return row.label_en || row.label_fr;
  return row.label_fr;
}

export const LEVEL_LABEL: Record<Lang, Record<Level, string>> = {
  fr: { section: "section", division: "division", group: "groupe", class: "classe", subclass: "sous-classe" },
  de: { section: "Abschnitt", division: "Abteilung", group: "Gruppe", class: "Klasse", subclass: "Unterklasse" },
  en: { section: "section", division: "division", group: "group", class: "class", subclass: "subclass" },
};

export interface NogaStrings {
  bcHome: string;
  bcCodes: string;
  bcScheme: string;
  ledeHtml: (classificationsHref: string) => string;
  priceBoxLabel: string;
  rawCode: string;
  descTitle: string; descTitleEm: string; descIntro: string;
  thLang: string; thDesignation: string;
  hierTitle: string; hierTitleEm: string; hierIntro: (dotted: string) => string;
  thLevel: string; thCode: string;
  subTitle: string; subTitleEm: string; subIntro: (total: number) => string;
  cwTitle: string; cwTitleEm: string; cwIntro: (dotted: string) => string;
  thStandard: string; thType: string; cwNote: string;
  neighTitle: string; neighTitleEm: string; neighIntro: (dotted: string) => string;
  exTitle: string; exTitleEm: string; exIntro: (dotted: string) => string;
  usedTitle: string; usedTitleEm: string; usedIntro: (dotted: string) => string; usedList: string[];
  srcTitle: string; srcTitleEm: string; srcIntro: string; srcLinkText: string; srcUrl: string;
  mcpTitle: string; mcpTitleEm: string; mcpIntro: string; mcpCta: string;
  fullTitle: string; fullTitleEm: string; fullIntro: string; fullCta: string;
  footer: string;
  metaTitle: (dotted: string, labelShort: string) => string;
  metaDesc: (dotted: string, labelShort: string) => string;
}

const BFS_URL: Record<Lang, string> = {
  fr: "https://www.bfs.admin.ch/bfs/fr/home/statistiques/industrie-services/nomenclatures/noga.html",
  de: "https://www.bfs.admin.ch/bfs/de/home/statistiken/industrie-dienstleistungen/nomenklaturen/noga.html",
  en: "https://www.bfs.admin.ch/bfs/en/home/statistics/industry-services/nomenclatures/noga.html",
};

export const NOGA_STR: Record<Lang, NogaStrings> = {
  fr: {
    bcHome: "accueil", bcCodes: "codes", bcScheme: "noga 2025",
    ledeHtml: (href) => `Activité de la nomenclature générale des activités économiques suisse (NOGA 2025), publiée par l'Office fédéral de la statistique (OFS). Le dataset complet (cross-walks NACE 2.1 + ISIC 4) est inclus dans <a href="${href}">Classifications (399 CHF)</a>.`,
    priceBoxLabel: "Niveau", rawCode: "Code brut :",
    descTitle: "Description", descTitleEm: "multilingue",
    descIntro: "La nomenclature NOGA 2025 fournit la désignation officielle dans les quatre langues utilisées par les autorités fédérales suisses et leurs équivalents européens.",
    thLang: "Langue", thDesignation: "Désignation",
    hierTitle: "Hiérarchie", hierTitleEm: "NOGA",
    hierIntro: (d) => `Le code NOGA <strong>${d}</strong> s'inscrit dans la hiérarchie suivante (du plus général au plus spécifique).`,
    thLevel: "Niveau", thCode: "Code",
    subTitle: "Sous-niveaux", subTitleEm: "directs",
    subIntro: (n) => `Ce code se décompose en ${n} sous-${n === 1 ? "niveau plus précis" : "niveaux plus précis"}.`,
    cwTitle: "Cross-walks", cwTitleEm: "officiels",
    cwIntro: (d) => `Équivalence du code NOGA ${d} dans les standards européens (NACE) et internationaux (ISIC), issue des tables officielles de l'OFS et d'Eurostat.`,
    thStandard: "Standard", thType: "Type",
    cwNote: "Type exact = équivalence stricte 1:1. partial = recouvrement partiel. multi = un code source mappe vers plusieurs codes cibles.",
    neighTitle: "Codes", neighTitleEm: "voisins",
    neighIntro: (d) => `Codes NOGA proches du code ${d}, dans le même groupe parent ou au même niveau hiérarchique.`,
    exTitle: "Exemples", exTitleEm: "d'activités",
    exIntro: (d) => `Profils d'entreprises typiquement classées sous le code NOGA ${d}.`,
    usedTitle: "Comment", usedTitleEm: "ce code est utilisé",
    usedIntro: (d) => `Le code NOGA <strong>${d}</strong> est utilisé par les autorités fédérales suisses pour classer les entreprises selon leur activité économique principale, notamment :`,
    usedList: [
      "<strong>Office fédéral de la statistique (OFS)</strong> : registre des entreprises et des établissements (REE / BUR), recensements et statistiques structurelles.",
      "<strong>Caisses de compensation AVS</strong> : classification de l'activité de l'employeur lors de l'affiliation.",
      "<strong>Administration fédérale des contributions (AFC)</strong> : profilage TVA, taux de la dette fiscale nette et statistiques sectorielles.",
      "<strong>Registre du commerce</strong> : champ « activités » lors de l'inscription d'une nouvelle entité juridique.",
      "<strong>SUVA et caisses LAA</strong> : tarification des cotisations assurance-accidents selon classe de risque.",
      "<strong>SECO et statistique du marché du travail</strong> : analyses sectorielles et mesures de soutien ciblées.",
    ],
    srcTitle: "Source", srcTitleEm: "officielle",
    srcIntro: "Cette page reprend les informations du standard NOGA 2025 publié par l'Office fédéral de la statistique. Pour la version officielle :",
    srcLinkText: "bfs.admin.ch — NOGA — Nomenclature générale des activités économiques", srcUrl: BFS_URL.fr,
    mcpTitle: "NOGA à la", mcpTitleEm: "demande",
    mcpIntro: "Classifiez du texte libre vers le top-3 NOGA et interrogez l'arbre complet (cross-walks NACE/ISIC inclus) via le serveur MCP — directement dans Claude Code, Cursor ou Cline. Gratuit pour tester, sans compte.",
    mcpCta: "Brancher le MCP — gratuit",
    fullTitle: "Données", fullTitleEm: "complètes",
    fullIntro: "Besoin du dataset complet (1 845 codes NOGA 2025 + 5 nomenclatures alignées + cross-walks 5-way) pour vos systèmes ?",
    fullCta: "Voir le bundle Classifications",
    footer: "Cette page est générée à partir de la nomenclature NOGA 2025 publiée par l'Office fédéral de la statistique (OFS / BFS). openswissdata.com n'est pas affilié à l'OFS. Désignations officielles utilisées avec attribution. Pour la version faisant foi, consultez bfs.admin.ch.",
    metaTitle: (d, l) => `Code NOGA ${d} — ${l} | openswissdata.com`,
    metaDesc: (d, l) => `Définition du code NOGA ${d} (${l}), cross-walks NACE 2.1 et ISIC Rev 4, codes voisins. Source officielle OFS.`,
  },
  de: {
    bcHome: "Startseite", bcCodes: "Codes", bcScheme: "noga 2025",
    ledeHtml: (href) => `Tätigkeit der Allgemeinen Systematik der Wirtschaftszweige (NOGA 2025), herausgegeben vom Bundesamt für Statistik (BFS). Der vollständige Datensatz (Cross-Walks NACE 2.1 + ISIC 4) ist in <a href="${href}">Klassifikationen (399 CHF)</a> enthalten.`,
    priceBoxLabel: "Ebene", rawCode: "Roher Code:",
    descTitle: "Bezeichnung", descTitleEm: "mehrsprachig",
    descIntro: "Die NOGA 2025 liefert die offizielle Bezeichnung in den vier von den Schweizer Bundesbehörden verwendeten Sprachen sowie deren europäische Entsprechung.",
    thLang: "Sprache", thDesignation: "Bezeichnung",
    hierTitle: "NOGA-", hierTitleEm: "Hierarchie",
    hierIntro: (d) => `Der NOGA-Code <strong>${d}</strong> ist in folgende Hierarchie eingeordnet (vom Allgemeinen zum Spezifischen).`,
    thLevel: "Ebene", thCode: "Code",
    subTitle: "Direkte", subTitleEm: "Unterebenen",
    subIntro: (n) => `Dieser Code gliedert sich in ${n} genauere Unterebene${n === 1 ? "" : "n"}.`,
    cwTitle: "Offizielle", cwTitleEm: "Cross-Walks",
    cwIntro: (d) => `Entsprechung des NOGA-Codes ${d} in den europäischen (NACE) und internationalen (ISIC) Standards, gemäss den offiziellen Tabellen von BFS und Eurostat.`,
    thStandard: "Standard", thType: "Typ",
    cwNote: "Typ exact = strikte 1:1-Entsprechung. partial = teilweise Überschneidung. multi = ein Quellcode wird auf mehrere Zielcodes abgebildet.",
    neighTitle: "Benachbarte", neighTitleEm: "Codes",
    neighIntro: (d) => `NOGA-Codes in der Nähe von ${d}, in derselben übergeordneten Gruppe oder auf derselben Hierarchieebene.`,
    exTitle: "Tätigkeits-", exTitleEm: "beispiele",
    exIntro: (d) => `Unternehmensprofile, die typischerweise unter dem NOGA-Code ${d} klassifiziert werden.`,
    usedTitle: "Wofür", usedTitleEm: "dieser Code verwendet wird",
    usedIntro: (d) => `Der NOGA-Code <strong>${d}</strong> wird von den Schweizer Bundesbehörden zur Klassifizierung von Unternehmen nach ihrer wirtschaftlichen Haupttätigkeit verwendet, insbesondere:`,
    usedList: [
      "<strong>Bundesamt für Statistik (BFS)</strong>: Betriebs- und Unternehmensregister (BUR), Zählungen und Strukturstatistiken.",
      "<strong>AHV-Ausgleichskassen</strong>: Klassifizierung der Arbeitgebertätigkeit bei der Anmeldung.",
      "<strong>Eidgenössische Steuerverwaltung (ESTV)</strong>: MWST-Profilierung, Saldosteuersätze und Branchenstatistiken.",
      `<strong>Handelsregister</strong>: Feld „Tätigkeiten" bei der Eintragung einer neuen juristischen Person.`,
      "<strong>SUVA und UVG-Kassen</strong>: Tarifierung der Unfallversicherungsbeiträge nach Risikoklasse.",
      "<strong>SECO und Arbeitsmarktstatistik</strong>: Branchenanalysen und gezielte Fördermassnahmen.",
    ],
    srcTitle: "Offizielle", srcTitleEm: "Quelle",
    srcIntro: "Diese Seite gibt die Informationen des vom Bundesamt für Statistik herausgegebenen Standards NOGA 2025 wieder. Für die offizielle Fassung:",
    srcLinkText: "bfs.admin.ch — NOGA — Allgemeine Systematik der Wirtschaftszweige", srcUrl: BFS_URL.de,
    mcpTitle: "NOGA auf", mcpTitleEm: "Abruf",
    mcpIntro: "Klassifizieren Sie Freitext in die Top-3-NOGA-Codes und durchsuchen Sie den vollständigen Baum (inkl. NACE/ISIC-Cross-Walks) über den MCP-Server — direkt in Claude Code, Cursor oder Cline. Kostenlos testen, ohne Konto.",
    mcpCta: "MCP einbinden — gratis",
    fullTitle: "Vollständige", fullTitleEm: "Daten",
    fullIntro: "Benötigen Sie den vollständigen Datensatz (1 845 NOGA-2025-Codes + 5 abgeglichene Systematiken + 5-Wege-Cross-Walks) für Ihre Systeme?",
    fullCta: "Klassifikationen-Bundle ansehen",
    footer: "Diese Seite wird aus der vom Bundesamt für Statistik (BFS) herausgegebenen NOGA 2025 generiert. openswissdata.com ist nicht mit dem BFS verbunden. Offizielle Bezeichnungen mit Quellenangabe verwendet. Für die massgebende Fassung siehe bfs.admin.ch.",
    metaTitle: (d, l) => `NOGA-Code ${d} — ${l} | openswissdata.com`,
    metaDesc: (d, l) => `Bedeutung des NOGA-Codes ${d} (${l}), Cross-Walks NACE 2.1 und ISIC Rev 4, benachbarte Codes. Offizielle Quelle BFS.`,
  },
  en: {
    bcHome: "home", bcCodes: "codes", bcScheme: "noga 2025",
    ledeHtml: (href) => `Activity from the Swiss General Classification of Economic Activities (NOGA 2025), published by the Federal Statistical Office (FSO). The full dataset (NACE 2.1 + ISIC 4 cross-walks) is included in <a href="${href}">Classifications (399 CHF)</a>.`,
    priceBoxLabel: "Level", rawCode: "Raw code:",
    descTitle: "Multilingual", descTitleEm: "description",
    descIntro: "NOGA 2025 provides the official designation in the four languages used by the Swiss federal authorities, alongside their European equivalents.",
    thLang: "Language", thDesignation: "Designation",
    hierTitle: "NOGA", hierTitleEm: "hierarchy",
    hierIntro: (d) => `The NOGA code <strong>${d}</strong> sits within the following hierarchy (from broadest to most specific).`,
    thLevel: "Level", thCode: "Code",
    subTitle: "Direct", subTitleEm: "sub-levels",
    subIntro: (n) => `This code breaks down into ${n} more specific sub-level${n === 1 ? "" : "s"}.`,
    cwTitle: "Official", cwTitleEm: "cross-walks",
    cwIntro: (d) => `Equivalence of NOGA code ${d} in the European (NACE) and international (ISIC) standards, from the official FSO and Eurostat tables.`,
    thStandard: "Standard", thType: "Type",
    cwNote: "Type exact = strict 1:1 equivalence. partial = partial overlap. multi = one source code maps to several target codes.",
    neighTitle: "Neighbouring", neighTitleEm: "codes",
    neighIntro: (d) => `NOGA codes close to ${d}, within the same parent group or at the same hierarchical level.`,
    exTitle: "Activity", exTitleEm: "examples",
    exIntro: (d) => `Company profiles typically classified under NOGA code ${d}.`,
    usedTitle: "How", usedTitleEm: "this code is used",
    usedIntro: (d) => `NOGA code <strong>${d}</strong> is used by the Swiss federal authorities to classify companies by their main economic activity, notably:`,
    usedList: [
      "<strong>Federal Statistical Office (FSO)</strong>: business and establishment register (BER), censuses and structural statistics.",
      "<strong>OASI compensation funds</strong>: classification of the employer's activity at registration.",
      "<strong>Federal Tax Administration (FTA)</strong>: VAT profiling, net tax debt rates and sector statistics.",
      "<strong>Commercial register</strong>: \"activities\" field when registering a new legal entity.",
      "<strong>SUVA and accident-insurance funds</strong>: pricing of accident-insurance contributions by risk class.",
      "<strong>SECO and labour-market statistics</strong>: sector analyses and targeted support measures.",
    ],
    srcTitle: "Official", srcTitleEm: "source",
    srcIntro: "This page reproduces information from the NOGA 2025 standard published by the Federal Statistical Office. For the official version:",
    srcLinkText: "bfs.admin.ch — NOGA — General Classification of Economic Activities", srcUrl: BFS_URL.en,
    mcpTitle: "NOGA on", mcpTitleEm: "demand",
    mcpIntro: "Classify free text into the top-3 NOGA codes and query the full tree (NACE/ISIC cross-walks included) via the MCP server — straight from Claude Code, Cursor or Cline. Free to try, no account.",
    mcpCta: "Connect the MCP — free",
    fullTitle: "Complete", fullTitleEm: "dataset",
    fullIntro: "Need the full dataset (1,845 NOGA 2025 codes + 5 aligned classifications + 5-way cross-walks) for your systems?",
    fullCta: "See the Classifications bundle",
    footer: "This page is generated from the NOGA 2025 classification published by the Federal Statistical Office (FSO / BFS). openswissdata.com is not affiliated with the FSO. Official designations used with attribution. For the authoritative version, see bfs.admin.ch.",
    metaTitle: (d, l) => `NOGA code ${d} — ${l} | openswissdata.com`,
    metaDesc: (d, l) => `Meaning of NOGA code ${d} (${l}), NACE 2.1 and ISIC Rev 4 cross-walks, neighbouring codes. Official FSO source.`,
  },
};

export function nogaMeta(row: NogaRow, lang: Lang): { title: string; description: string } {
  const dotted = dottedCode(row.code);
  const label = labelFor(row, lang);
  const short = label.length > 80 ? label.slice(0, 77) + "..." : label;
  return { title: NOGA_STR[lang].metaTitle(dotted, short), description: NOGA_STR[lang].metaDesc(dotted, short) };
}

/**
 * Exemples d'activités localisés. Détection de catégorie sur label_fr (stable
 * dans toutes les langues), rendu de la prose dans la langue cible.
 */
export function nogaExamples(row: NogaRow, lang: Lang): string[] {
  const lower = row.label_fr.toLowerCase();
  const label = labelFor(row, lang);
  const dotted = dottedCode(row.code);
  const cat: "manuf" | "service" | "commerce" | "agri" | "construction" | "finance" | "generic" =
    lower.includes("fabrication") || lower.includes("production") || lower.includes("industrie") ? "manuf"
    : lower.includes("service") || lower.includes("activité") || lower.includes("conseil") ? "service"
    : lower.includes("commerce") || lower.includes("vente") || lower.includes("réparation") ? "commerce"
    : lower.includes("culture") || lower.includes("élevage") || lower.includes("pêche") || lower.includes("forest") ? "agri"
    : lower.includes("construction") || lower.includes("bâtiment") ? "construction"
    : lower.includes("banque") || lower.includes("assurance") || lower.includes("financier") ? "finance"
    : "generic";

  const T: Record<Lang, { lead: string; cats: Record<string, string>; rule: string }> = {
    fr: {
      lead: `Une entreprise dont l'activité principale relève de « ${label} » est classée sous le code NOGA ${dotted}.`,
      cats: {
        manuf: "Cette catégorie regroupe les unités industrielles et ateliers qui transforment des matières premières ou des composants en produits finis ou semi-finis : usines, manufactures, fabriques, ateliers de production et sites de transformation.",
        service: "Cette catégorie regroupe les sociétés de services, cabinets, agences et entreprises individuelles dont la prestation principale correspond à cette activité : sociétés de conseil, cabinets professionnels et prestataires indépendants.",
        commerce: "Cette catégorie regroupe les commerces de gros et de détail, revendeurs et distributeurs : magasins, boutiques, e-commerces, grossistes et chaînes de revente.",
        agri: "Cette catégorie regroupe les exploitations agricoles, fermes et domaines de production primaire : exploitations familiales, coopératives et entreprises du secteur primaire.",
        construction: "Cette catégorie regroupe les entreprises générales et de second œuvre, artisans du bâtiment et sociétés de génie civil : entreprises de construction, sous-traitants et bureaux techniques.",
        finance: "Cette catégorie regroupe les institutions financières, banques, assureurs, courtiers et sociétés de gestion : banques, assureurs, gestionnaires d'actifs, conseillers financiers et fintechs.",
        generic: "Cette catégorie couvre l'ensemble des entreprises dont l'activité économique principale correspond à cette description, quelle que soit leur taille : indépendants, PME, grandes entreprises, succursales et établissements suisses.",
      },
      rule: "Le code est attribué selon le principe de l'activité économique principale : si une entité a plusieurs activités, c'est celle qui génère le plus de valeur ajoutée qui détermine la classification.",
    },
    de: {
      lead: `Ein Unternehmen, dessen Haupttätigkeit unter „${label}" fällt, wird unter dem NOGA-Code ${dotted} klassifiziert.`,
      cats: {
        manuf: "Diese Kategorie umfasst Industrieeinheiten und Werkstätten, die Rohstoffe oder Komponenten in Fertig- oder Halbfertigprodukte umwandeln: Fabriken, Manufakturen, Produktionswerkstätten und Verarbeitungsbetriebe.",
        service: "Diese Kategorie umfasst Dienstleistungsunternehmen, Kanzleien, Agenturen und Einzelunternehmen, deren Hauptleistung dieser Tätigkeit entspricht: Beratungsfirmen, Fachkanzleien und unabhängige Dienstleister.",
        commerce: "Diese Kategorie umfasst Gross- und Detailhandel, Wiederverkäufer und Distributoren: Geschäfte, Läden, E-Commerce, Grosshändler und Vertriebsketten.",
        agri: "Diese Kategorie umfasst landwirtschaftliche Betriebe, Höfe und Betriebe der Primärproduktion: Familienbetriebe, Genossenschaften und Unternehmen des Primärsektors.",
        construction: "Diese Kategorie umfasst General- und Ausbauunternehmen, Bauhandwerker und Tiefbaufirmen: Bauunternehmen, Subunternehmer und technische Büros.",
        finance: "Diese Kategorie umfasst Finanzinstitute, Banken, Versicherer, Makler und Vermögensverwalter: Banken, Versicherer, Vermögensverwalter, Finanzberater und Fintechs.",
        generic: "Diese Kategorie umfasst alle Unternehmen, deren wirtschaftliche Haupttätigkeit dieser Beschreibung entspricht, unabhängig von ihrer Grösse: Selbstständige, KMU, Grossunternehmen, Filialen und Schweizer Niederlassungen.",
      },
      rule: "Der Code wird nach dem Prinzip der wirtschaftlichen Haupttätigkeit vergeben: Hat eine Einheit mehrere Tätigkeiten, ist diejenige mit der höchsten Wertschöpfung massgebend.",
    },
    en: {
      lead: `A company whose main activity falls under "${label}" is classified under NOGA code ${dotted}.`,
      cats: {
        manuf: "This category covers industrial units and workshops that transform raw materials or components into finished or semi-finished products: factories, manufacturing plants, production workshops and processing sites.",
        service: "This category covers service companies, firms, agencies and sole traders whose main offering matches this activity: consulting firms, professional practices and independent providers.",
        commerce: "This category covers wholesale and retail trade, resellers and distributors: shops, stores, e-commerce, wholesalers and resale chains.",
        agri: "This category covers farms, agricultural holdings and primary-production businesses: family farms, cooperatives and primary-sector companies.",
        construction: "This category covers general and finishing contractors, building trades and civil-engineering firms: construction companies, subcontractors and technical offices.",
        finance: "This category covers financial institutions, banks, insurers, brokers and asset managers: banks, insurers, asset managers, financial advisers and fintechs.",
        generic: "This category covers all companies whose main economic activity matches this description, whatever their size: sole traders, SMEs, large companies, branches and Swiss establishments.",
      },
      rule: "The code is assigned on the principle of the main economic activity: if an entity has several activities, the one generating the most value added determines the classification.",
    },
  };

  const t = T[lang];
  return [t.lead, t.cats[cat], t.rule];
}
