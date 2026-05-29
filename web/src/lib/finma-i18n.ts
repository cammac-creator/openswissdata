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
    ledeAuthorized: (n) => `<strong>${n}</strong> figure dans le registre des établissements et personnes autorisés et surveillés par l'Autorité fédérale de surveillance des marchés financiers (FINMA).`,
    thField: "Champ", thValue: "Valeur",
    fName: "Nom", fType: "Type", fLicence: "Type d'autorisation", fUid: "IDE (UID)", fLei: "LEI", fCity: "Siège", fDate: "Date d'autorisation",
    detailsTitle: "Données", detailsEm: "officielles",
    meansTitle: "Ce que signifie", meansEm: "cette autorisation",
    verifyTitle: "Vérifier", verifyEm: "à la source",
    verifyIntro: "Cette fiche reprend des données publiques du registre FINMA. Pour le statut faisant foi et à jour, consultez le registre officiel :",
    verifyCta: "Registre officiel FINMA",
    neighborsTitle: (t) => `Autres ${t.toLowerCase()}`, neighborsEm: "autorisés",
    footer: "Fiche générée à partir du registre public des autorisations de la FINMA (établissements et personnes surveillés). openswissdata.com n'est pas affilié à la FINMA et ne se substitue pas à la consultation directe de finma.ch. Figurer dans le registre reflète une autorisation au moment de l'extraction ; le statut faisant foi est celui de la FINMA.",
    metaTitle: (n, t) => `${n} — ${t} autorisé(e) FINMA | openswissdata.com`,
    metaDesc: (n, t, c) => `${n}${c ? `, ${c}` : ""} : ${t} autorisé(e) et surveillé(e) par la FINMA. Type d'autorisation, IDE, LEI et lien vers le registre officiel.`,
    idxMetaTitle: "Registre FINMA — établissements autorisés en Suisse | openswissdata.com",
    idxMetaDesc: "Répertoire des établissements et personnes autorisés et surveillés par la FINMA : banques, assurances, gestionnaires de fortune, maisons de titres. Recherche par nom, navigation par type.",
    idxEyebrow: "Registre FINMA", idxH1a: "Établissements", idxH1b: "autorisés FINMA.",
    idxLede: "Répertoire des établissements et personnes autorisés et surveillés par la FINMA. Vérifiez si une société est régulée, et sous quel type d'autorisation. Données publiques du registre officiel.",
    idxSearchTitle: "Vérifier", idxSearchEm: "une société.", idxSearchIntro: "Tapez le nom d'un établissement (banque, assurance, gestionnaire de fortune…).", idxSearchPlaceholder: "Nom de l'établissement…",
    idxBrowseTitle: "Parcourir", idxBrowseEm: "par type.", idxBrowseIntro: "Les autorisations FINMA par catégorie.",
    idxLoading: "Chargement…", idxNoResult: "Aucun établissement ne correspond.",
  },
  de: {
    bcHome: "Startseite", bcRegistry: "FINMA-Register", eyebrow: "FINMA-Register",
    ledeAuthorized: (n) => `<strong>${n}</strong> ist im Register der von der Eidgenössischen Finanzmarktaufsicht (FINMA) bewilligten und beaufsichtigten Institute und Personen eingetragen.`,
    thField: "Feld", thValue: "Wert",
    fName: "Name", fType: "Typ", fLicence: "Bewilligungsart", fUid: "UID", fLei: "LEI", fCity: "Sitz", fDate: "Bewilligungsdatum",
    detailsTitle: "Offizielle", detailsEm: "Daten",
    meansTitle: "Was diese", meansEm: "Bewilligung bedeutet",
    verifyTitle: "An der Quelle", verifyEm: "prüfen",
    verifyIntro: "Dieser Eintrag gibt öffentliche Daten des FINMA-Registers wieder. Für den massgebenden und aktuellen Status konsultieren Sie das offizielle Register:",
    verifyCta: "Offizielles FINMA-Register",
    neighborsTitle: (t) => `Weitere bewilligte ${t}`, neighborsEm: "",
    footer: "Eintrag generiert aus dem öffentlichen Bewilligungsregister der FINMA (beaufsichtigte Institute und Personen). openswissdata.com ist nicht mit der FINMA verbunden und ersetzt nicht die direkte Konsultation von finma.ch. Der Registereintrag spiegelt eine Bewilligung zum Zeitpunkt der Extraktion wider; massgebend ist der Status der FINMA.",
    metaTitle: (n, t) => `${n} — von der FINMA bewilligt (${t}) | openswissdata.com`,
    metaDesc: (n, t, c) => `${n}${c ? `, ${c}` : ""}: von der FINMA bewilligt und beaufsichtigt (${t}). Bewilligungsart, UID, LEI und Link zum offiziellen Register.`,
    idxMetaTitle: "FINMA-Register — bewilligte Institute in der Schweiz | openswissdata.com",
    idxMetaDesc: "Verzeichnis der von der FINMA bewilligten und beaufsichtigten Institute und Personen: Banken, Versicherungen, Vermögensverwalter, Wertpapierhäuser. Suche nach Name, Navigation nach Typ.",
    idxEyebrow: "FINMA-Register", idxH1a: "Von der FINMA", idxH1b: "bewilligte Institute.",
    idxLede: "Verzeichnis der von der FINMA bewilligten und beaufsichtigten Institute und Personen. Prüfen Sie, ob ein Unternehmen reguliert ist und unter welcher Bewilligungsart. Öffentliche Daten aus dem offiziellen Register.",
    idxSearchTitle: "Ein Unternehmen", idxSearchEm: "prüfen.", idxSearchIntro: "Geben Sie den Namen eines Instituts ein (Bank, Versicherung, Vermögensverwalter…).", idxSearchPlaceholder: "Name des Instituts…",
    idxBrowseTitle: "Nach Typ", idxBrowseEm: "blättern.", idxBrowseIntro: "Die FINMA-Bewilligungen nach Kategorie.",
    idxLoading: "Wird geladen…", idxNoResult: "Kein Institut gefunden.",
  },
  en: {
    bcHome: "home", bcRegistry: "FINMA registry", eyebrow: "FINMA registry",
    ledeAuthorized: (n) => `<strong>${n}</strong> is listed in the register of institutions and persons authorised and supervised by the Swiss Financial Market Supervisory Authority (FINMA).`,
    thField: "Field", thValue: "Value",
    fName: "Name", fType: "Type", fLicence: "Authorisation type", fUid: "UID", fLei: "LEI", fCity: "Registered seat", fDate: "Authorisation date",
    detailsTitle: "Official", detailsEm: "data",
    meansTitle: "What this", meansEm: "authorisation means",
    verifyTitle: "Verify", verifyEm: "at source",
    verifyIntro: "This entry reproduces public data from the FINMA register. For the authoritative, up-to-date status, consult the official register:",
    verifyCta: "Official FINMA register",
    neighborsTitle: (t) => `Other authorised ${t.toLowerCase()}`, neighborsEm: "entities",
    footer: "Entry generated from FINMA's public authorisation register (supervised institutions and persons). openswissdata.com is not affiliated with FINMA and does not replace direct consultation of finma.ch. A register entry reflects an authorisation at extraction time; the authoritative status is FINMA's.",
    metaTitle: (n, t) => `${n} — FINMA-authorised ${t} | openswissdata.com`,
    metaDesc: (n, t, c) => `${n}${c ? `, ${c}` : ""}: ${t} authorised and supervised by FINMA. Authorisation type, UID, LEI and link to the official register.`,
    idxMetaTitle: "FINMA registry — authorised institutions in Switzerland | openswissdata.com",
    idxMetaDesc: "Directory of institutions and persons authorised and supervised by FINMA: banks, insurers, portfolio managers, securities firms. Search by name, browse by type.",
    idxEyebrow: "FINMA registry", idxH1a: "FINMA-authorised", idxH1b: "institutions.",
    idxLede: "Directory of institutions and persons authorised and supervised by FINMA. Check whether a company is regulated, and under which authorisation type. Public data from the official register.",
    idxSearchTitle: "Check a", idxSearchEm: "company.", idxSearchIntro: "Type the name of an institution (bank, insurer, portfolio manager…).", idxSearchPlaceholder: "Institution name…",
    idxBrowseTitle: "Browse", idxBrowseEm: "by type.", idxBrowseIntro: "FINMA authorisations by category.",
    idxLoading: "Loading…", idxNoResult: "No matching institution.",
  },
};

export function finmaMeta(e: FinmaEntity, lang: Lang): { title: string; description: string } {
  const S = FINMA_STR[lang];
  const t = typeLabel(e.type, lang);
  return { title: S.metaTitle(e.name, t), description: S.metaDesc(e.name, t, e.city) };
}
