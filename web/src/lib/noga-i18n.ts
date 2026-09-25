/**
 * i18n des pages NOGA (fr/de/en) — strings, métadonnées et exemples localisés.
 *
 * Les libellés de codes (label_fr/de/it/en) viennent de la donnée OFS ; ici on
 * traduit l'enrobage éditorial + UI une seule fois, partagé par les ~1047 pages
 * de chaque langue. Aucune activité additionnelle déduite d’un simple mot du libellé.
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
    ledeHtml: (href) => `Activité de la nomenclature générale des activités économiques suisse (NOGA 2025), publiée par l'Office fédéral de la statistique (OFS). Le jeu de codes et de correspondances documentées est inclus dans <a href="${href}">Classifications (399 CHF)</a>.`,
    priceBoxLabel: "Niveau", rawCode: "Code brut :",
    descTitle: "Description", descTitleEm: "multilingue",
    descIntro: "La nomenclature NOGA 2025 fournit la désignation officielle dans les quatre langues utilisées par les autorités fédérales suisses et leurs équivalents européens.",
    thLang: "Langue", thDesignation: "Désignation",
    hierTitle: "Hiérarchie", hierTitleEm: "NOGA",
    hierIntro: (d) => `Le code NOGA <strong>${d}</strong> s'inscrit dans la hiérarchie suivante (du plus général au plus spécifique).`,
    thLevel: "Niveau", thCode: "Code",
    subTitle: "Sous-niveaux", subTitleEm: "directs",
    subIntro: (n) => `Ce code se décompose en ${n} sous-${n === 1 ? "niveau plus précis" : "niveaux plus précis"}.`,
    cwTitle: "Correspondances", cwTitleEm: "documentées",
    cwIntro: (d) => `Relations disponibles pour le code NOGA ${d}, établies à partir de sources OFS et Eurostat. Une correspondance approchée exige de vérifier l’activité concernée.`,
    thStandard: "Standard", thType: "Type",
    cwNote: "Deux relations non exactes ne sont jamais chaînées. Une absence de résultat ne prouve pas l’absence d’équivalent. Référence",
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
    mcpIntro: "Interrogez les correspondances avec cross_walk, accessible sans compte dans le serveur MCP. La classification de texte et les autres outils protégés exigent des droits distincts.",
    mcpCta: "Brancher le MCP — gratuit",
    fullTitle: "Données", fullTitleEm: "complètes",
    fullIntro: "Besoin des fichiers pour vos systèmes ? Le jeu Classifications comprend cinq nomenclatures, dont NOGA 2025, et les correspondances documentées disponibles. Il ne garantit pas un équivalent pour chaque paire de codes.",
    fullCta: "Voir le bundle Classifications",
    footer: "Cette page est générée à partir de la nomenclature NOGA 2025 publiée par l'Office fédéral de la statistique (OFS / BFS). openswissdata.com n'est pas affilié à l'OFS. Désignations officielles utilisées avec attribution. Pour la version faisant foi, consultez bfs.admin.ch.",
    metaTitle: (d, l) => `Code NOGA ${d} — ${l} | openswissdata.com`,
    metaDesc: (d, l) => `Définition du code NOGA ${d} (${l}), correspondances documentées disponibles et codes voisins. Source officielle OFS.`,
  },
  de: {
    bcHome: "Startseite", bcCodes: "Codes", bcScheme: "noga 2025",
    ledeHtml: (href) => `Tätigkeit der Allgemeinen Systematik der Wirtschaftszweige (NOGA 2025), herausgegeben vom Bundesamt für Statistik (BFS). Der Datensatz mit Codes und dokumentierten Zuordnungen ist in <a href="${href}">Klassifikationen (399 CHF)</a> enthalten.`,
    priceBoxLabel: "Ebene", rawCode: "Roher Code:",
    descTitle: "Bezeichnung", descTitleEm: "mehrsprachig",
    descIntro: "Die NOGA 2025 liefert die offizielle Bezeichnung in den vier von den Schweizer Bundesbehörden verwendeten Sprachen sowie deren europäische Entsprechung.",
    thLang: "Sprache", thDesignation: "Bezeichnung",
    hierTitle: "NOGA-", hierTitleEm: "Hierarchie",
    hierIntro: (d) => `Der NOGA-Code <strong>${d}</strong> ist in folgende Hierarchie eingeordnet (vom Allgemeinen zum Spezifischen).`,
    thLevel: "Ebene", thCode: "Code",
    subTitle: "Direkte", subTitleEm: "Unterebenen",
    subIntro: (n) => `Dieser Code gliedert sich in ${n} genauere Unterebene${n === 1 ? "" : "n"}.`,
    cwTitle: "Dokumentierte", cwTitleEm: "Zuordnungen",
    cwIntro: (d) => `Verfügbare Beziehungen für NOGA ${d} auf Grundlage von BFS- und Eurostat-Quellen. Ungefähre Zuordnungen erfordern eine Prüfung der Tätigkeit.`,
    thStandard: "Standard", thType: "Typ",
    cwNote: "Zwei nicht exakte Beziehungen werden nicht verkettet. Ein fehlendes Ergebnis beweist nicht, dass es keine Entsprechung gibt. Referenz",
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
    mcpIntro: "Fragen Sie Zuordnungen mit cross_walk im MCP-Server ohne Konto ab. Textklassifikation und andere geschützte Werkzeuge benötigen separate Berechtigungen.",
    mcpCta: "MCP einbinden — gratis",
    fullTitle: "Vollständige", fullTitleEm: "Daten",
    fullIntro: "Benötigen Sie Dateien für Ihre Systeme? Der Datensatz enthält fünf Systematiken, darunter NOGA 2025, und verfügbare dokumentierte Zuordnungen. Eine Entsprechung für jedes Codepaar ist nicht garantiert.",
    fullCta: "Klassifikationen-Bundle ansehen",
    footer: "Diese Seite wird aus der vom Bundesamt für Statistik (BFS) herausgegebenen NOGA 2025 generiert. openswissdata.com ist nicht mit dem BFS verbunden. Offizielle Bezeichnungen mit Quellenangabe verwendet. Für die massgebende Fassung siehe bfs.admin.ch.",
    metaTitle: (d, l) => `NOGA-Code ${d} — ${l} | openswissdata.com`,
    metaDesc: (d, l) => `Bedeutung des NOGA-Codes ${d} (${l}), verfügbare dokumentierte Zuordnungen und benachbarte Codes. Offizielle Quelle BFS.`,
  },
  en: {
    bcHome: "home", bcCodes: "codes", bcScheme: "noga 2025",
    ledeHtml: (href) => `Activity from the Swiss General Classification of Economic Activities (NOGA 2025), published by the Federal Statistical Office (FSO). The dataset of codes and documented mappings is included in <a href="${href}">Classifications (399 CHF)</a>.`,
    priceBoxLabel: "Level", rawCode: "Raw code:",
    descTitle: "Multilingual", descTitleEm: "description",
    descIntro: "NOGA 2025 provides the official designation in the four languages used by the Swiss federal authorities, alongside their European equivalents.",
    thLang: "Language", thDesignation: "Designation",
    hierTitle: "NOGA", hierTitleEm: "hierarchy",
    hierIntro: (d) => `The NOGA code <strong>${d}</strong> sits within the following hierarchy (from broadest to most specific).`,
    thLevel: "Level", thCode: "Code",
    subTitle: "Direct", subTitleEm: "sub-levels",
    subIntro: (n) => `This code breaks down into ${n} more specific sub-level${n === 1 ? "" : "s"}.`,
    cwTitle: "Documented", cwTitleEm: "mappings",
    cwIntro: (d) => `Available relationships for NOGA ${d}, based on FSO and Eurostat sources. Approximate mappings require a review of the business activity.`,
    thStandard: "Standard", thType: "Type",
    cwNote: "Two non-exact relationships are never chained. A missing result does not prove there is no equivalent. Reference",
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
    mcpIntro: "Query mappings with cross_walk in the MCP server without an account. Text classification and other protected tools require separate access rights.",
    mcpCta: "Connect the MCP — free",
    fullTitle: "Complete", fullTitleEm: "dataset",
    fullIntro: "Need files for your systems? The Classifications dataset contains five classifications, including NOGA 2025, and available documented mappings. It does not guarantee an equivalent for every pair of codes.",
    fullCta: "See the Classifications bundle",
    footer: "This page is generated from the NOGA 2025 classification published by the Federal Statistical Office (FSO / BFS). openswissdata.com is not affiliated with the FSO. Official designations used with attribution. For the authoritative version, see bfs.admin.ch.",
    metaTitle: (d, l) => `NOGA code ${d} — ${l} | openswissdata.com`,
    metaDesc: (d, l) => `Meaning of NOGA code ${d} (${l}), available documented mappings and neighbouring codes. Official FSO source.`,
  },
};

export function nogaMeta(row: NogaRow, lang: Lang): { title: string; description: string } {
  const dotted = dottedCode(row.code);
  const label = labelFor(row, lang);
  const short = label.length > 80 ? label.slice(0, 77) + "..." : label;
  return { title: NOGA_STR[lang].metaTitle(dotted, short), description: NOGA_STR[lang].metaDesc(dotted, short) };
}
