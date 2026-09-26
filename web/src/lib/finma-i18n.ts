/**
 * i18n des pages registre FINMA (fr/de/en). Enrobage éditorial traduit une fois,
 * partagé par toutes les fiches. Données factuelles (entités autorisées).
 */
import type { Lang } from "../i18n/utils";
import type { FinmaEntity } from "./finma-helpers";

export const TYPE_LABEL: Record<Lang, Record<string, string>> = {
  fr: {
    bank: "Banque", insurance: "Assurance", securities_firm: "Maison de titres",
    asset_manager_collective: "Gestionnaire de fortune collective", asset_manager_individual: "Gestionnaire de fortune",
    fund_representative: "Représentant de fonds", infrastructure: "Infrastructure des marchés financiers",
    fintech: "Fintech (art. 1b LB)", supervisory_org: "Organisme de surveillance",
  },
  de: {
    bank: "Bank", insurance: "Versicherung", securities_firm: "Wertpapierhaus",
    asset_manager_collective: "Verwalter von Kollektivvermögen", asset_manager_individual: "Vermögensverwalter",
    fund_representative: "Fondsvertreter", infrastructure: "Finanzmarktinfrastruktur",
    fintech: "Fintech (Art. 1b BankG)", supervisory_org: "Aufsichtsorganisation",
  },
  en: {
    bank: "Bank", insurance: "Insurer", securities_firm: "Securities firm",
    asset_manager_collective: "Manager of collective assets", asset_manager_individual: "Portfolio manager",
    fund_representative: "Fund representative", infrastructure: "Financial market infrastructure",
    fintech: "Fintech (art. 1b BankA)", supervisory_org: "Supervisory organisation",
  },
};

export function typeLabel(type: string, lang: Lang): string {
  return TYPE_LABEL[lang][type] || TYPE_LABEL.fr[type] || type;
}

export function licenceFor(e: FinmaEntity, lang: Lang): string {
  if (lang === "de") return e.lic_de || e.lic || e.lic_fr;
  if (lang === "en") return e.lic || e.lic_fr || e.lic_de;
  return e.lic_fr || e.lic || e.lic_de;
}

/** Paragraphe explicatif par type d'autorisation (varie le contenu par fiche). */
const TYPE_EXPLAIN: Record<Lang, Record<string, string>> = {
  fr: {
    bank: "Les banques sont autorisées et surveillées par la FINMA au titre de la loi sur les banques (LB). Elles peuvent accepter des dépôts du public et sont soumises à des exigences de fonds propres, de liquidité et de gouvernance.",
    insurance: "Les entreprises d'assurance sont surveillées par la FINMA au titre de la loi sur la surveillance des assurances (LSA), avec des exigences de solvabilité et de protection des assurés.",
    securities_firm: "Les maisons de titres (anciennement négociants en valeurs mobilières) sont autorisées au titre de la loi sur les établissements financiers (LEFin) pour le négoce de valeurs mobilières pour le compte de clients.",
    asset_manager_collective: "Les gestionnaires de fortune collective gèrent des placements collectifs de capitaux et sont autorisés au titre de la LEFin, avec des exigences renforcées par rapport aux gestionnaires individuels.",
    asset_manager_individual: "Les gestionnaires de fortune (individuels) gèrent des avoirs de clients sur la base d'un mandat et doivent être autorisés au titre de la LEFin et affiliés à un organisme de surveillance.",
    fund_representative: "Les représentants de placements collectifs étrangers assurent la distribution conforme en Suisse de fonds établis à l'étranger.",
    infrastructure: "Les infrastructures des marchés financiers (bourses, contreparties centrales, dépositaires) sont autorisées au titre de la loi sur l'infrastructure des marchés financiers (LIMF).",
    fintech: "Les établissements fintech bénéficient d'une autorisation allégée (art. 1b LB) permettant d'accepter des dépôts du public jusqu'à un plafond, sans statut bancaire complet.",
    supervisory_org: "Les organismes de surveillance (OS) sont habilités par la FINMA à surveiller en cours les gestionnaires de fortune et trustees.",
  },
  de: {
    bank: "Banken sind nach dem Bankengesetz (BankG) von der FINMA bewilligt und beaufsichtigt. Sie dürfen Publikumseinlagen entgegennehmen und unterliegen Eigenmittel-, Liquiditäts- und Governance-Anforderungen.",
    insurance: "Versicherungsunternehmen werden nach dem Versicherungsaufsichtsgesetz (VAG) von der FINMA beaufsichtigt, mit Solvenz- und Versichertenschutzanforderungen.",
    securities_firm: "Wertpapierhäuser (früher Effektenhändler) sind nach dem Finanzinstitutsgesetz (FINIG) für den Wertpapierhandel auf Kundenrechnung bewilligt.",
    asset_manager_collective: "Verwalter von Kollektivvermögen verwalten kollektive Kapitalanlagen und sind nach dem FINIG bewilligt, mit erhöhten Anforderungen gegenüber individuellen Vermögensverwaltern.",
    asset_manager_individual: "Vermögensverwalter verwalten Kundenvermögen aufgrund eines Auftrags und benötigen eine Bewilligung nach dem FINIG sowie den Anschluss an eine Aufsichtsorganisation.",
    fund_representative: "Vertreter ausländischer kollektiver Kapitalanlagen stellen den regelkonformen Vertrieb in der Schweiz sicher.",
    infrastructure: "Finanzmarktinfrastrukturen (Börsen, zentrale Gegenparteien, Verwahrer) sind nach dem Finanzmarktinfrastrukturgesetz (FinfraG) bewilligt.",
    fintech: "Fintech-Institute verfügen über eine erleichterte Bewilligung (Art. 1b BankG), um Publikumseinlagen bis zu einer Obergrenze entgegenzunehmen, ohne vollen Bankenstatus.",
    supervisory_org: "Aufsichtsorganisationen (AO) sind von der FINMA ermächtigt, Vermögensverwalter und Trustees laufend zu beaufsichtigen.",
  },
  en: {
    bank: "Banks are authorised and supervised by FINMA under the Banking Act (BA). They may accept public deposits and are subject to capital, liquidity and governance requirements.",
    insurance: "Insurance companies are supervised by FINMA under the Insurance Supervision Act (ISA), with solvency and policyholder-protection requirements.",
    securities_firm: "Securities firms (formerly securities dealers) are authorised under the Financial Institutions Act (FinIA) to trade securities on behalf of clients.",
    asset_manager_collective: "Managers of collective assets manage collective investment schemes and are authorised under FinIA, with stricter requirements than individual portfolio managers.",
    asset_manager_individual: "Portfolio managers manage client assets under a mandate and must be authorised under FinIA and affiliated with a supervisory organisation.",
    fund_representative: "Representatives of foreign collective investment schemes ensure compliant distribution in Switzerland.",
    infrastructure: "Financial market infrastructures (exchanges, central counterparties, custodians) are authorised under the Financial Market Infrastructure Act (FMIA).",
    fintech: "Fintech institutions hold a lighter authorisation (art. 1b BA) allowing them to accept public deposits up to a cap, without full banking status.",
    supervisory_org: "Supervisory organisations (SO) are empowered by FINMA to conduct ongoing supervision of portfolio managers and trustees.",
  },
};
export function typeExplain(type: string, lang: Lang): string {
  return TYPE_EXPLAIN[lang][type] || TYPE_EXPLAIN.fr[type] || "";
}

export interface FinmaStrings {
  bcHome: string; bcRegistry: string;
  eyebrow: string;
  ledeAuthorized: (name: string) => string;
  thField: string; thValue: string;
  fName: string; fType: string; fLicence: string; fUid: string; fLei: string; fCity: string; fDate: string;
  detailsTitle: string; detailsEm: string;
  meansTitle: string; meansEm: string;
  verifyTitle: string; verifyEm: string; verifyIntro: string; verifyCta: string;
  mcpCtaTitle: string; mcpCtaEm: string; mcpCtaIntro: string; mcpCtaButton: string;
  neighborsTitle: (typeLabel: string) => string; neighborsEm: string;
  footer: string;
  metaTitle: (name: string, typeLabel: string) => string;
  metaDesc: (name: string, typeLabel: string, city: string) => string;
  // index
  idxMetaTitle: string; idxMetaDesc: string;
  idxEyebrow: string; idxH1a: string; idxH1b: string; idxLede: string;
  idxSearchTitle: string; idxSearchEm: string; idxSearchIntro: string; idxSearchPlaceholder: string;
  idxBrowseTitle: string; idxBrowseEm: string; idxBrowseIntro: string;
  idxLoading: string; idxNoResult: string;
}

export const FINMA_STR: Record<Lang, FinmaStrings> = {
  fr: {
    bcHome: "accueil", bcRegistry: "registre FINMA", eyebrow: "Registre FINMA",
    ledeAuthorized: (n) => `${n} figure dans notre copie historique des listes FINMA. Cette fiche ne confirme pas son statut actuel : consultez la source officielle avant une décision.`,
    thField: "Champ", thValue: "Valeur",
    fName: "Nom", fType: "Type", fLicence: "Type d'autorisation", fUid: "IDE (UID)", fLei: "LEI", fCity: "Siège", fDate: "Date d'autorisation",
    detailsTitle: "Données", detailsEm: "officielles",
    meansTitle: "Ce que signifie", meansEm: "cette autorisation",
    verifyTitle: "Vérifier", verifyEm: "à la source",
    verifyIntro: "Cette fiche reprend des données publiques du registre FINMA. Pour le statut faisant foi et à jour, consultez le registre officiel :",
    verifyCta: "Registre officiel FINMA",
    mcpCtaTitle: "Vérifier la FINMA", mcpCtaEm: "par API",
    mcpCtaIntro: "Interrogez le statut d'autorisation FINMA par API, dans vos workflows — via le serveur MCP, directement dans Claude Code, Cursor ou Cline. Données issues d'un instantané du registre public ; le statut faisant foi reste celui de finma.ch. Gratuit pour tester, sans compte.",
    mcpCtaButton: "Brancher le MCP — gratuit",
    neighborsTitle: (t) => `Autres ${t.toLowerCase()}`, neighborsEm: "dans cette copie",
    footer: "Fiche générée à partir du registre public des autorisations de la FINMA (établissements et personnes surveillés). openswissdata.com n'est pas affilié à la FINMA et ne se substitue pas à la consultation directe de finma.ch. Figurer dans le registre reflète une autorisation au moment de l'extraction ; le statut faisant foi est celui de la FINMA.",
    metaTitle: (n, t) => `${n} — fiche FINMA (${t}) | openswissdata.com`,
    metaDesc: (n, t, c) => `${n}${c ? `, ${c}` : ""} : fiche historique (${t}), informations d’identification et lien vers la FINMA pour vérifier le statut actuel.`,
    idxMetaTitle: "Annuaire FINMA et fichiers Excel | openswissdata.com",
    idxMetaDesc: "Recherchez dans notre annuaire historique FINMA, vérifiez les sources officielles et découvrez le registre en Excel et CSV, avec UID et LEI disponibles.",
    idxEyebrow: "Registre FINMA", idxH1a: "Répertoire", idxH1b: "des listes FINMA.",
    idxLede: "Copie historique de listes publiques FINMA, consultable par nom ou catégorie. Les fiches ne sont pas actualisées par chaque collecte quotidienne du fichier vendu. Vérifiez le statut actuel auprès de la FINMA.",
    idxSearchTitle: "Rechercher", idxSearchEm: "une institution.", idxSearchIntro: "Tapez le nom d'un établissement (banque, assurance, gestionnaire de fortune…).", idxSearchPlaceholder: "Nom de l'établissement…",
    idxBrowseTitle: "Parcourir", idxBrowseEm: "par type.", idxBrowseIntro: "Les autorisations FINMA par catégorie.",
    idxLoading: "Chargement…", idxNoResult: "Aucun résultat dans cette copie historique.",
  },
  de: {
    bcHome: "Startseite", bcRegistry: "FINMA-Register", eyebrow: "FINMA-Register",
    ledeAuthorized: (n) => `${n} ist in unserer historischen Kopie der FINMA-Listen enthalten. Dieser Eintrag bestätigt den aktuellen Status nicht. Prüfen Sie vor einer Entscheidung die offizielle Quelle.`,
    thField: "Feld", thValue: "Wert",
    fName: "Name", fType: "Typ", fLicence: "Bewilligungsart", fUid: "UID", fLei: "LEI", fCity: "Sitz", fDate: "Bewilligungsdatum",
    detailsTitle: "Offizielle", detailsEm: "Daten",
    meansTitle: "Was diese", meansEm: "Bewilligung bedeutet",
    verifyTitle: "An der Quelle", verifyEm: "prüfen",
    verifyIntro: "Dieser Eintrag gibt öffentliche Daten des FINMA-Registers wieder. Für den massgebenden und aktuellen Status konsultieren Sie das offizielle Register:",
    verifyCta: "Offizielles FINMA-Register",
    mcpCtaTitle: "FINMA-Status", mcpCtaEm: "per API",
    mcpCtaIntro: "Fragen Sie den FINMA-Bewilligungsstatus per API in Ihren Workflows ab — über den MCP-Server, direkt in Claude Code, Cursor oder Cline. Daten aus einem Auszug des öffentlichen Registers; massgebend bleibt der Status auf finma.ch. Kostenlos testen, ohne Konto.",
    mcpCtaButton: "MCP einbinden — gratis",
    neighborsTitle: (t) => `Weitere ${t} in dieser Kopie`, neighborsEm: "",
    footer: "Eintrag generiert aus dem öffentlichen Bewilligungsregister der FINMA (beaufsichtigte Institute und Personen). openswissdata.com ist nicht mit der FINMA verbunden und ersetzt nicht die direkte Konsultation von finma.ch. Der Registereintrag spiegelt eine Bewilligung zum Zeitpunkt der Extraktion wider; massgebend ist der Status der FINMA.",
    metaTitle: (n, t) => `${n} — FINMA-Eintrag (${t}) | openswissdata.com`,
    metaDesc: (n, t, c) => `${n}${c ? `, ${c}` : ""}: historischer Eintrag (${t}), Identifikationsdaten und FINMA-Quelle zur Prüfung des aktuellen Status.`,
    idxMetaTitle: "FINMA-Verzeichnis und Excel-Datensatz | openswissdata.com",
    idxMetaDesc: "Historische FINMA-Einträge durchsuchen, offizielle Quellen prüfen und den Datensatz für Excel und CSV mit verfügbaren UID- und LEI-Feldern entdecken.",
    idxEyebrow: "FINMA-Register", idxH1a: "Verzeichnis", idxH1b: "der FINMA-Listen.",
    idxLede: "Historische Kopie öffentlicher FINMA-Listen, nach Name oder Kategorie durchsuchbar. Die Einträge werden nicht mit jedem täglichen Datensatz aktualisiert. Den aktuellen Status bei der FINMA prüfen.",
    idxSearchTitle: "Ein Institut", idxSearchEm: "finden.", idxSearchIntro: "Geben Sie den Namen eines Instituts ein (Bank, Versicherung, Vermögensverwalter…).", idxSearchPlaceholder: "Name des Instituts…",
    idxBrowseTitle: "Nach Typ", idxBrowseEm: "blättern.", idxBrowseIntro: "Die FINMA-Bewilligungen nach Kategorie.",
    idxLoading: "Wird geladen…", idxNoResult: "Kein Treffer in dieser historischen Kopie.",
  },
  en: {
    bcHome: "home", bcRegistry: "FINMA registry", eyebrow: "FINMA registry",
    ledeAuthorized: (n) => `${n} appears in our historical copy of FINMA lists. This page does not confirm its current status. Check the official source before making a decision.`,
    thField: "Field", thValue: "Value",
    fName: "Name", fType: "Type", fLicence: "Authorisation type", fUid: "UID", fLei: "LEI", fCity: "Registered seat", fDate: "Authorisation date",
    detailsTitle: "Official", detailsEm: "data",
    meansTitle: "What this", meansEm: "authorisation means",
    verifyTitle: "Verify", verifyEm: "at source",
    verifyIntro: "This entry reproduces public data from the FINMA register. For the authoritative, up-to-date status, consult the official register:",
    verifyCta: "Official FINMA register",
    mcpCtaTitle: "Check FINMA", mcpCtaEm: "by API",
    mcpCtaIntro: "Query FINMA authorisation status by API, inside your workflows — via the MCP server, straight from Claude Code, Cursor or Cline. Data from a public-register snapshot; the authoritative status remains finma.ch's. Free to try, no account.",
    mcpCtaButton: "Connect the MCP — free",
    neighborsTitle: (t) => `Other ${t.toLowerCase()} in this copy`, neighborsEm: "entities",
    footer: "Entry generated from FINMA's public authorisation register (supervised institutions and persons). openswissdata.com is not affiliated with FINMA and does not replace direct consultation of finma.ch. A register entry reflects an authorisation at extraction time; the authoritative status is FINMA's.",
    metaTitle: (n, t) => `${n} — FINMA entry (${t}) | openswissdata.com`,
    metaDesc: (n, t, c) => `${n}${c ? `, ${c}` : ""}: historical entry (${t}), identifiers and the FINMA source to check its current status.`,
    idxMetaTitle: "FINMA directory and Excel dataset | openswissdata.com",
    idxMetaDesc: "Search our historical FINMA directory, check official sources, or explore the Excel and CSV dataset with available UID and LEI fields.",
    idxEyebrow: "FINMA registry", idxH1a: "FINMA", idxH1b: "list directory.",
    idxLede: "Historical copy of public FINMA lists, searchable by name or category. Entries are not updated with every daily dataset release. Check the current status with FINMA.",
    idxSearchTitle: "Find an", idxSearchEm: "institution.", idxSearchIntro: "Type the name of an institution (bank, insurer, portfolio manager…).", idxSearchPlaceholder: "Institution name…",
    idxBrowseTitle: "Browse", idxBrowseEm: "by type.", idxBrowseIntro: "FINMA authorisations by category.",
    idxLoading: "Loading…", idxNoResult: "No match in this historical copy.",
  },
};

export function finmaMeta(e: FinmaEntity, lang: Lang): { title: string; description: string } {
  const S = FINMA_STR[lang];
  const t = typeLabel(e.type, lang);
  return { title: S.metaTitle(e.name, t), description: S.metaDesc(e.name, t, e.city) };
}
