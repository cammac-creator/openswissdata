/**
 * Reconnaît SANS modèle un candidat de la prospection qui est hors de la spécialité du service.
 *
 * Décision de Claude-Alain du 05.11.2026 : la spécialité est « la mémoire des listes officielles »,
 * avec la douane et le commerce extérieur ; on n'ajoute plus de jeux communaux hors de ce thème.
 * Les deux lots examinés ensuite (19.11 et 24.11.2026, 61 candidats) ont été écartés en entier.
 * Le motif le plus net et le plus fréquent : une statistique d'un canton ou d'une commune,
 * ventilée par commune (ou par numéro postal), qui ne se raccorde que par cette clé locale. Un tel
 * jeu est marqué `hors_specialite` dans `prospection.json` ; le veilleur des jeux ne le propose
 * plus à l'examen.
 *
 * Règle, volontairement étroite (dans le doute, le candidat reste proposé : mieux vaut un lot de
 * trop qu'un bon jeu perdu). Les QUATRE conditions sont exigées :
 *   1. éditeur de niveau « canton » ou « commune » EXACTEMENT : un éditeur fédéral ou de niveau
 *      inconnu n'est jamais marqué (la douane, le commerce extérieur et les listes officielles
 *      d'autorisation sont fédéraux) ;
 *   2. au moins une clé de jointure, et TOUTES sont locales (`commune`, `npa`, confirmées par un
 *      en-tête ou déduites du titre) : une clé cantonale, IDE, NOGA ou tarifaire à côté, ou une clé
 *      que cette liste ne connaît pas, garde le candidat ;
 *   3. le titre dit lui-même que le jeu est VENTILÉ par commune ou par numéro postal (« nach
 *      Gemeinde », « nach …, Gemeinde und Jahr », « pro Gemeinde », « par commune », « per comune »,
 *      « by municipality », « nach Postleitzahl »). Sans cette tournure, une clé communale seule ne
 *      distingue pas une statistique d'une liste d'établissements avec leur adresse (première
 *      version refusée en relecture le 24.11.2026 : elle marquait la liste cantonale des cafés et
 *      restaurants autorisés, « nach Betriebsart und Standort », jumelle d'une liste gardée) ;
 *   4. aucun mot d'une liste officielle ni de la spécialité dans le titre (`hasSpecialtyWord`) :
 *      liste, répertoire, registre, inventaire, cadastre, autorisation, permis, patente, agrément,
 *      reconnaissance, concession, « officiel », sanction, douane, importation, exportation, tarif.
 *      Le mot suffit, sans chercher à savoir s'il désigne une statistique.
 *
 * Pure, sans E/S : ne lit que trois champs déjà publiés du candidat. Ne retire rien du rapport,
 * ne change ni le tri ni le plafond ; ne dit rien de la licence ni des données personnelles.
 */

export type OutOfSpecialtyReason = "clé communale seule" | "clé locale seule";

export interface SpecialtyInput {
  title: string;
  editor_level: string;
  join_keys: readonly string[];
}

const LOCAL_EDITOR_LEVELS = new Set(["canton", "commune"]);
const COMMUNE_KEYS = new Set(["commune", "commune (titre)"]);
const POSTAL_KEYS = new Set(["npa", "npa (titre)"]);

/** Comparaison en minuscules, sans diacritiques (« Répertoire », « agréés », « extérieur »). */
function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Tournure de ventilation, sur le titre replié par `fold` : une préposition, puis, sans quitter le
// membre de phrase (ni deux-points, ni point-virgule, ni parenthèse, ni crochet), le nom de l'unité
// locale en mot entier. Couvre l'énumération allemande « nach Kategorie, Gemeinde und Jahr » et
// « nach Politischer Gemeinde ». « Nach Standort » (une ligne par établissement) n'en fait pas partie.
// Une unité précédée d'un article (« der Gemeinde Riehen », « par la commune », « del comune ») désigne
// UNE commune, pas une ventilation : elle ne compte pas (remarque de la relecture du 24.11.2026).
const LOCAL_BREAKDOWN_PATTERN =
  /(?<![a-z])(nach|pro|je|par|per|by|selon)(?![a-z])[^:;(\[]*?(?<![a-z])(?<!(?<![a-z])(der|die|den|dem|des|einer|eine|la|le|les|l'|du|del|della|dello|dei|delle|il|i|the|this|each|every) ?)(gemeinden?|communes?|comun[ei]|municipalit(y|ies)|postleitzahl(en)?|plz|npa|codes? posta(l|ux))(?![a-z])/;

export function hasLocalBreakdownTitle(title: string): boolean {
  return LOCAL_BREAKDOWN_PATTERN.test(fold(title));
}

// Sous-chaînes (les mots composés allemands collent le mot du thème à la fin : « Verkaufsbewilligung »,
// « Wohnungsregister », « Ortschaftenverzeichnis »), à comparer au titre replié par `fold`. Un mot
// trop large coûte seulement un candidat proposé de plus, jamais un bon jeu perdu.
const SPECIALTY_WORDS = [
  // douane et commerce extérieur
  "douan", "zoll", "dogan", "customs", "grenz", "frontier", "confine", "valich",
  "commerce exterieur", "aussenhandel", "außenhandel", "commercio estero", "foreign trade",
  "import", "export", "einfuhr", "ausfuhr", "esportazion", "ausland", "freihandel", "libre-echange", "libre echange",
  "tarif", "tares",
  // sanctions
  "sanktion", "sanction", "sanzion", "embargo",
  // listes officielles : répertoires, registres, inventaires, cadastres
  "verzeichnis", "regist", "repertoire", "elenc", "listing", "albo", // « regist » : Register, registre, registro, registry, registriert
  "inventar", "inventaire", "kataster", "cadastr", "catast",
  // autorisations, permis, patentes, licences, concessions, agréments, reconnaissances
  "bewillig", "zulass", "zugelassen", "genehmig", "autoris", "autorizz", "permis", "patent",
  "lizenz", "licen", "konzession", "concession", "agree", "agrement",
  "anerkannt", "reconnu", "riconosciut", "akkredit", "accredit", "zertifi", "certifi", "homolog",
  // « officiel »
  "offiziell", "amtlich", "officiel", "ufficial", "official",
];

// « Liste » : le mot entier, dans toutes ses formes (« Liste », « Listen », « liste officielle des… »,
// « Lista ufficiale », « list of », « Liste: … »), ou collé à la fin d'un mot composé
// (« Sanktionsliste », « Positivlisten »). Seul le mot composé qui COMMENCE par lui n'en est pas un
// (« Listenergebnisse », « Listenstimmen » : résultats d'un scrutin).
const LIST_PATTERN = /(?<![a-z])list[ea]?[ns]?(?![a-z])|[a-z]liste(n)?(?![a-z])/;

export function hasSpecialtyWord(title: string): boolean {
  const folded = fold(title);
  return SPECIALTY_WORDS.some((word) => folded.includes(word)) || LIST_PATTERN.test(folded);
}

/** Motif pour lequel ce candidat est hors spécialité, ou `null` s'il reste proposé à l'examen. */
export function outOfSpecialtyReason(candidate: SpecialtyInput): OutOfSpecialtyReason | null {
  if (!LOCAL_EDITOR_LEVELS.has(candidate.editor_level)) return null;
  const keys = candidate.join_keys;
  if (keys.length === 0) return null;
  if (!keys.every((key) => COMMUNE_KEYS.has(key) || POSTAL_KEYS.has(key))) return null;
  if (!hasLocalBreakdownTitle(candidate.title)) return null;
  if (hasSpecialtyWord(candidate.title)) return null;
  return keys.every((key) => COMMUNE_KEYS.has(key)) ? "clé communale seule" : "clé locale seule";
}
