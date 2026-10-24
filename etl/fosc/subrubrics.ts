/**
 * Sous-rubriques lues par la collecte FOSC hors du registre du commerce : faillites (KK),
 * concordats (NA), appels aux créanciers suite à une liquidation (LS) et autres appels aux
 * créanciers relevant du droit des sociétés (SR). Lot du 24.10.2026 : décision de Claude-Alain
 * d'étendre la collecte à ces rubriques « pour les sociétés seulement ».
 *
 * Sources (relevées le 24.10.2026, requêtes de lecture seule) :
 *   - codes et intitulés officiels FR, DE, EN : catalogue des rubriques du portail,
 *     `https://www.shab.ch/api/v1/rubrics` (locataire `shab`) ;
 *   - structure : schémas d'export 1.26,
 *     `https://www.shab.ch/api/v1/schemas/shab/1.26/<code>-export.xsd`, et 78 détails réels lus en
 *     mémoire (seuls les noms de balises et des comptes ont été relevés).
 *
 * Ce module ne contient que des données de description (aucune lecture, aucune écriture). Les
 * chemins sont relatifs à `publication/content`.
 */

export interface LocalizedLabel { fr: string; de: string; en: string }

export type InsolvencyRubric = "KK" | "NA" | "LS" | "SR";

export interface InsolvencySpec {
  code: string;
  rubric: InsolvencyRubric;
  label: LocalizedLabel;
  /** Blocs société de l'avis (débiteur, société dissoute, sociétés qui fusionnent…). */
  companyPaths: readonly string[];
  /**
   * `false` : « autre avis », dont l'événement n'est décrit que dans le texte libre ; jamais de
   * ligne, et le détail n'est pas lu (totaux seulement, forme « inconnue »).
   */
  rows: boolean;
  /**
   * Dates de la procédure gardées sur une ligne : balises propres directement sous `content`,
   * une seule occurrence, date valide. Jamais une date sous `debtor/person`, jamais un groupe
   * répété (`creditorMeeting`, `auction`, `claimOfCreditors`…).
   */
  dates: readonly string[];
  /**
   * Forme juridique que l'intitulé annonce (LS01 à LS07). CONTRÔLE de cohérence seulement : une
   * forme lue qui la contredit envoie l'avis dans les totaux ; elle ne remplace jamais une forme
   * absente (une forme absente = totaux seulement).
   */
  expectedLegalForm?: string;
}

const DEBTOR = ["debtor/companies/company"] as const;
const DISSOLVED = ["dissolved/companies/company"] as const;

const RUBRIC_LABELS_INSOLVENCY: Record<InsolvencyRubric, LocalizedLabel> = {
  KK: { fr: "Faillites", de: "Konkurse", en: "Bankruptcies" },
  NA: { fr: "Concordats", de: "Nachlassverfahren", en: "Composition proceedings" },
  LS: { fr: "Appels aux créanciers suite à la liquidation", de: "Liquidationsschuldenrufe", en: "Calls to creditors following liquidation" },
  SR: { fr: "Autres appels aux créanciers relevant du droit des sociétés", de: "Weitere gesellschaftsrechtliche Schuldenrufe", en: "Other calls to creditors issued under company law" },
};

export const RUBRIC_LABELS: Readonly<Record<string, LocalizedLabel>> = {
  HR: { fr: "Inscriptions au registre du commerce", de: "Handelsregistereinträge", en: "Commercial Register" },
  ...RUBRIC_LABELS_INSOLVENCY,
};

const spec = (code: string, label: LocalizedLabel, companyPaths: readonly string[], dates: readonly string[], extra: Partial<InsolvencySpec> = {}): InsolvencySpec => ({
  code, rubric: code.slice(0, 2) as InsolvencyRubric, label, companyPaths, rows: true, dates, ...extra,
});

export const INSOLVENCY_SPECS: readonly InsolvencySpec[] = [
  spec("KK01", { fr: "Avis préalable d'ouverture de faillite", de: "Vorläufige Konkursanzeige", en: "Prior notification of launch of bankruptcy proceedings" }, DEBTOR, ["resolutionDate"]),
  spec("KK02", { fr: "Publication de faillite/appel aux créanciers", de: "Konkurspublikation/Schuldenruf", en: "Notification of bankruptcy proceedings/Call to creditors" }, DEBTOR, ["resolutionDate", "entryDeadline"]),
  spec("KK03", { fr: "Suspension de la procédure de faillite", de: "Einstellung des Konkursverfahrens", en: "Suspension of bankruptcy proceedings" }, DEBTOR, ["resolutionDate", "cessationDate", "entryDeadline"]),
  spec("KK04", { fr: "Etat de collocation et inventaire", de: "Kollokationsplan und Inventar", en: "Schedule of claims and inventory" }, DEBTOR, []),
  spec("KK05", { fr: "Tableau de distribution et compte final", de: "Verteilungsliste und Schlussrechnung", en: "Distribution plan and the final counting" }, DEBTOR, ["entryDeadline"]),
  spec("KK06", { fr: "Clôture de la faillite", de: "Schluss des Konkursverfahrens", en: "Closing of bankruptcy proceedings" }, DEBTOR, ["proceedingEndDate"]),
  spec("KK07", { fr: "Révocation de faillite", de: "Widerruf des Konkurses", en: "Revocation of bankruptcy proceedings" }, DEBTOR, ["proceedingRevocationDate"]),
  spec("KK08", { fr: "Vente aux enchères forcée d'immeubles", de: "Konkursamtliche Grundstücksteigerung", en: "Property auction initiated by the bankruptcy office" }, DEBTOR, ["entryStart", "entryDeadline"]),
  spec("KK09", { fr: "État des charges", de: "Lastenverzeichnis", en: "Schedule of charges" }, DEBTOR, ["entryDeadline"]),
  spec("KK10", { fr: "Autre avis", de: "Weitere Bekanntmachung", en: "Other public notice" }, DEBTOR, [], { rows: false }),
  spec("KK11", { fr: "Reconnaissance d’une faillite étrangère (cf. art. 166 ss. LDIP)", de: "Anerkennung eines ausländischen Konkurses (Art. 166 ff. IPRG)", en: "Recognition of a foreign bankruptcy (Art. 166 et seq. IPLA)" }, DEBTOR, ["resolutionDate", "entryDeadline"]),
  spec("KK12", { fr: "Renonciation à la procédure de faillite prévue par la LDIP (cf. art. 174a LDIP)", de: "Verzicht auf die Durchführung eines IPRG-Konkursverfahrens (Art. 174a IPRG)", en: "Waiver of an IPLA bankruptcy proceeding (Art. 174a IPLA)" }, DEBTOR, ["dateWaiverDecision"]),

  spec("NA01", { fr: "Sursis concordataire provisoire", de: "Provisorische Nachlassstundung", en: "Provisional composition moratorium" }, DEBTOR, ["moratoriumDateFrom", "moratoriumDateTo", "hearingDate"]),
  spec("NA02", { fr: "Sursis concordataire définitif", de: "Definitive Nachlassstundung", en: "Definitive composition moratorium" }, DEBTOR, ["moratoriumDateFrom", "entryDeadline"]),
  spec("NA03", { fr: "Appel aux créanciers lors d'un concordat/assemblée des créanciers", de: "Schuldenruf im Nachlassverfahren/Gläubigerversammlung", en: "Call to creditors as part of composition proceedings/creditors meeting" }, DEBTOR, ["creditorHearingDate", "entryDeadline"]),
  spec("NA04", { fr: "Prolongation du sursis concordataire", de: "Verlängerung der Nachlassstundung", en: "Extension of the composition moratorium" }, DEBTOR, ["moratoriumDateFrom", "moratoriumDateTo"]),
  spec("NA05", { fr: "Faillite lors d'un concordat", de: "Konkurs im Nachlassverfahren", en: "Bankruptcy during composition proceedings" }, DEBTOR, ["resolutionDate", "entryDeadline"]),
  spec("NA06", { fr: "Audience d'homologation du concordat", de: "Verhandlung über die Bestätigung des Nachlassvertrages", en: "Approval hearing on the composition agreement" }, DEBTOR, ["hearingDate"]),
  spec("NA07", { fr: "Confirmation du concordat", de: "Bestätigung des Nachlassvertrages", en: "Approval of the composition agreement" }, DEBTOR, ["agreementDate"]),
  spec("NA08", { fr: "Annulation du sursis suite à une restructuration", de: "Aufhebung der Nachlassstundung infolge Sanierung", en: "Lifting of composition moratorium following restructuring" }, DEBTOR, ["dateOfDissolution"]),
  spec("NA09", { fr: "Etat de collocation dans une procédure de concordat avec cession d'actifs", de: "Kollokationsplan im Nachlassverfahren mit Vermögensabtretung", en: "Schedule of claims in the composition proceedings, including assignment of assets" }, DEBTOR, ["entryDeadline"]),
  spec("NA10", { fr: "Rapport d'activité / Liste de répartition et décompte final dans la procédure de concordat avec cession d'actifs", de: "Rechenschaftsbericht/Verteilungsliste und Schlussrechnung im Nachlassverfahren mit Vermögensabtretung", en: "Report of activities/distribution plan and the final counting in the composition proceedings, including assignment of assets" }, DEBTOR, ["entryDeadline"]),
  spec("NA11", { fr: "Autre avis", de: "Weitere Bekanntmachung", en: "Other public notice" }, DEBTOR, [], { rows: false }),
  spec("NA12", { fr: "Sursis COVID-19", de: "COVID-19-Stundung", en: "Moratorium COVID-19" }, DEBTOR, ["decisionDateCovid", "entryDeadline"]),

  spec("LS01", { fr: "Appel aux créanciers à la liquidation d'une société anonyme", de: "Liquidationsschuldenruf einer Aktiengesellschaft", en: "Call to creditors referred to liquidation of a share company" }, DISSOLVED, ["entryDeadline"], { expectedLegalForm: "0106" }),
  spec("LS02", { fr: "Appel aux créanciers à la liquidation d’une société à responsabilité limitée", de: "Liquidationsschuldenruf einer Gesellschaft mit beschränkter Haftung", en: "Call to creditors following the liquidation of a limited liability company" }, DISSOLVED, ["entryDeadline"], { expectedLegalForm: "0107" }),
  spec("LS03", { fr: "Appel aux créanciers à la liquidation d'une société coopérative", de: "Liquidationsschuldenruf einer Genossenschaft", en: "Call to creditors following the liquidation of a cooperative" }, DISSOLVED, ["entryDeadline"], { expectedLegalForm: "0108" }),
  spec("LS04", { fr: "Appel aux créanciers à la liquidation d'une association", de: "Liquidationsschuldenruf eines Vereins", en: "Call to creditors following the liquidation of an association" }, DISSOLVED, ["entryDeadline"], { expectedLegalForm: "0109" }),
  spec("LS05", { fr: "Appel aux créanciers à la liquidation d’une fondation", de: "Liquidationsschuldenruf einer Stiftung", en: "Call to creditors following the liquidation of a foundation" }, DISSOLVED, ["entryDeadline"], { expectedLegalForm: "0110" }),
  spec("LS06", { fr: "Appel aux créanciers d'une société en nom collectif", de: "Liquidationsschuldenruf einer Kollektivgesellschaft", en: "Call to creditors following the liquidation of a general partnership" }, DISSOLVED, ["entryDeadline"], { expectedLegalForm: "0103" }),
  spec("LS07", { fr: "Appel aux créanciers à la liquidation d'une société en commandite", de: "Liquidationsschuldenruf einer Kommanditgesellschaft", en: "Call to creditors following the liquidation of a limited partnership" }, DISSOLVED, ["entryDeadline"], { expectedLegalForm: "0104" }),
  spec("LS08", { fr: "Appel aux créanciers à la liquidation d'une société en commandite par actions/autre forme juridique", de: "Liquidationsschuldenruf einer Kommanditaktiengesellschaft/anderer Rechtsform", en: "Call to creditors following the liquidation of a partnership/other legal form" }, DISSOLVED, ["entryDeadline"]),

  // SR01 à SR04 et SR06 portent structurellement plusieurs sociétés (qui transfèrent, qui
  // reprennent) : « plusieurs parties », donc totaux seulement, sauf avis à un seul bloc.
  spec("SR01", { fr: "Appel aux créanciers suite à une fusion selon la LFus", de: "Schuldenruf infolge Fusion nach FusG", en: "Call to creditors following the merger of companies limited by shares under MergA" },
    ["general", "provisionInstitute", "foreignCountry"].flatMap((g) => [`${g}/transmitting/companies/company`, `${g}/acquiring/companies/company`]), []),
  spec("SR02", { fr: "Appel aux créanciers suite à une scission", de: "Schuldenruf infolge Spaltung", en: "Call to creditors following a demerger" },
    ["transmitting/companies/company", "acquiring/multi/companies/company"], ["demergerAgreementDate", "entryDeadline"]),
  spec("SR03", { fr: "Appel aux créanciers suite à la transformation d'une société anonyme en une société à responsabilité limitée", de: "Schuldenruf infolge Umwandlung einer Aktiengesellschaft in eine Gesellschaft mit beschränkter Haftung", en: "Call to creditors following the transformation of a company limited by shares into a limited liability company" },
    ["dissolved/companies/company", "acquiring/companies/company"], ["conversionDecisionDate", "entryDeadline"]),
  spec("SR04", { fr: "Appel aux créanciers suite au transfert du siège de la société de la Suisse à l'étranger", de: "Schuldenruf infolge Sitzverlegung ins Ausland", en: "Call to creditors following the transfer of the company's registered office from Switzerland to another country" },
    ["dissolved/companies/company", "acquiring/companies/company"], ["relocationDecisionDate", "entryDeadline"]),
  spec("SR05", { fr: "Appel aux créanciers suite à la réduction du capital / réduction ou suppression des parts sociales", de: "Schuldenruf infolge Kapitalherabsetzung / Herabsetzung oder Aufhebung der Anteilsscheine", en: "Call to creditors following a reduction in capital/reduction or cancellation of share certificates" },
    ["capitalreduction/companies/company"], ["resolutionDate", "entryDeadline"]),
  spec("SR06", { fr: "Appel aux créanciers suite à une fusion selon le CO (ancien droit)", de: "Schuldenruf infolge Fusion nach Altrecht (OR)", en: "Call to creditors following the merger under CO (previous version)" },
    ["transmitting/companies/company", "acquiring/companies/company"], ["resolutionDate", "entryDeadline"]),
];

export const INSOLVENCY_BY_CODE: ReadonlyMap<string, InsolvencySpec> = new Map(INSOLVENCY_SPECS.map((s) => [s.code, s]));
export const INSOLVENCY_RUBRICS: ReadonlySet<string> = new Set(Object.keys(RUBRIC_LABELS_INSOLVENCY));

/** Sous-rubriques HR (lot du 22.10.2026) : leurs lignes n'ont jamais de dates de procédure. */
export const HR_EVENT_TYPE_LABELS: Readonly<Record<string, LocalizedLabel>> = {
  HR01: { fr: "Nouvelles inscriptions", de: "Neueintragungen", en: "New registrations" },
  HR02: { fr: "Mutations", de: "Mutationen", en: "Changes" },
  HR03: { fr: "Radiations", de: "Löschungen", en: "Deletions" },
};

/** Intitulés de tous les types d'événement des totaux (sous-rubriques). */
export const ALL_EVENT_TYPE_LABELS: Readonly<Record<string, LocalizedLabel>> = {
  ...HR_EVENT_TYPE_LABELS,
  ...Object.fromEntries(INSOLVENCY_SPECS.map((s) => [s.code, s.label])),
};

/**
 * Dates qu'une ligne de ce type d'événement peut porter, ou `null` si ce type ne peut jamais être
 * une ligne (sous-rubrique inconnue, « autre avis »). Sert aussi au contrôle de l'état relu.
 */
export function rowDateTags(eventType: string): readonly string[] | null {
  if (Object.hasOwn(HR_EVENT_TYPE_LABELS, eventType)) return [];
  const s = INSOLVENCY_BY_CODE.get(eventType);
  return s && s.rows ? s.dates : null;
}
