/**
 * Formes juridiques des avis HR et règle de stockage.
 *
 * Codes et libellés : liste officielle de l'OFS, concept I14Y « Rechtsform eines Unternehmens »
 * v1.2.0 (`OFS_LEGAL_FORMS_I14Y_URL`, export relu le 22.10.2026, 38 codes) ; ce sont aussi les
 * valeurs de l'élément `legalForm` du schéma d'export HR du portail (version 1.26).
 *
 * Règle (décision du 16.10.2026, appliquée de façon FERMÉE) : une ligne d'événement n'est
 * stockée que pour une forme de la liste blanche `ROW_STORABLE_LEGAL_FORMS`, des personnes
 * morales sans personne physique à la place de l'entreprise. Tout le reste n'entre que dans
 * des totaux : l'entreprise individuelle (0101, art. 945 CO : la raison sociale porte le nom du
 * titulaire), la procuration non commerciale (0118) et le représentant d'indivision (0119), qui
 * désignent une personne ; la société en nom collectif (0103) et la société en commandite
 * (0104), dont les associés indéfiniment responsables sont des personnes physiques ; les
 * succursales (0111, 0151), dont l'entreprise principale peut être une entreprise
 * individuelle ; la forme particulière (0113) ; tout code absent, inconnu ou hors registre.
 * Élargir cette liste est une décision de Claude-Alain (point ouvert du lot, 22.10.2026).
 */

export interface LegalFormLabel { fr: string; de: string; en: string }

/** Libellés officiels (OFS, I14Y v1.2.0) des codes que le schéma HR autorise. */
export const LEGAL_FORM_LABELS: Readonly<Record<string, LegalFormLabel>> = {
  "0101": { fr: "Entreprise individuelle", de: "Einzelunternehmen", en: "Sole proprietorship" },
  "0103": { fr: "Société en nom collectif (SNC)", de: "Kollektivgesellschaft (KlG)", en: "General partnership (GP)" },
  "0104": { fr: "Société en commandite (SCm)", de: "Kommanditgesellschaft (KmG)", en: "Limited partnership (LP)" },
  "0105": { fr: "Société en commandite par actions (SCmA)", de: "Kommanditaktiengesellschaft (KmAG)", en: "Corporation with unlimited partners (CUP)" },
  "0106": { fr: "Société anonyme (SA)", de: "Aktiengesellschaft (AG)", en: "Corporation (Ltd)" },
  "0107": { fr: "Société à responsabilité limitée (Sàrl)", de: "Gesellschaft mit beschränkter Haftung (GmbH)", en: "Limited liability company (LLC)" },
  "0108": { fr: "Société coopérative", de: "Genossenschaft", en: "Cooperative" },
  "0109": { fr: "Association", de: "Verein", en: "Association" },
  "0110": { fr: "Fondation", de: "Stiftung", en: "Foundation" },
  "0111": { fr: "Succursale d'une entreprise étrangère", de: "Zweigniederlassung eines ausländischen Unternehmens", en: "Branch of a foreign company" },
  "0113": { fr: "Forme juridique particulière", de: "Besondere Rechtsform", en: "Special legal form" },
  "0114": { fr: "Société en commandite de placements collectifs (SCmPC)", de: "Kommanditgesellschaft für kollektive Kapitalanlagen (KmGK)", en: "Limited Partnership for collective investment schemes (LPCI)" },
  "0115": { fr: "Société d'investissement à capital variable (SICAV)", de: "Investmentgesellschaft mit variablem Kapital (SICAV)", en: "Limited Partnership for collective investment schemes with a variable capital (SICAV)" },
  "0116": { fr: "Société d'investissement à capital fixe (SICAF)", de: "Investmentgesellschaft mit festem Kapital (SICAF)", en: "Limited Partnership for collective investment schemes with a fixed capital (SICAF)" },
  "0117": { fr: "Institut de droit public", de: "Institut des öffentlichen Rechts", en: "Public-law institution" },
  "0118": { fr: "Procuration non-commerciale", de: "Nichtkaufmännische Prokura", en: "Non-commercial power of attorney" },
  "0119": { fr: "Représentant d'indivision", de: "Haupt von Gemeinderschaft", en: "Representative of the community of property" },
  "0151": { fr: "Succursale", de: "Zweigniederlassung", en: "Branch" },
};

/** Code utilisé dans les totaux pour une forme absente ou hors de la liste ci-dessus. */
export const UNKNOWN_LEGAL_FORM = "inconnue";

export const SOLE_PROPRIETORSHIP = "0101";

/** Liste BLANCHE : seules ces formes peuvent avoir une ligne d'événement stockée. */
export const ROW_STORABLE_LEGAL_FORMS: ReadonlySet<string> = new Set([
  "0105", "0106", "0107", "0108", "0109", "0110", "0114", "0115", "0116", "0117",
]);

/** Code retenu pour les totaux : le code s'il est connu, sinon `UNKNOWN_LEGAL_FORM`. */
export function totalsLegalForm(code: string | null): string {
  return code && Object.hasOwn(LEGAL_FORM_LABELS, code) ? code : UNKNOWN_LEGAL_FORM;
}

/**
 * Une ligne n'est stockable que si TOUTES les formes lues dans l'avis (état après et, pour une
 * mutation, état avant) sont dans la liste blanche. Une transformation d'entreprise
 * individuelle en Sàrl, par exemple, reste dans les totaux seulement.
 */
export function isRowStorable(forms: readonly (string | null)[]): boolean {
  return forms.length > 0 && forms.every((f) => f !== null && ROW_STORABLE_LEGAL_FORMS.has(f));
}
