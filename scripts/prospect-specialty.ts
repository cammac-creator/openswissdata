/**
 * Reconnaît SANS modèle un candidat de la prospection qui est hors de la spécialité du service.
 *
 * Décision de Claude-Alain du 05.11.2026 : la spécialité est « la mémoire des listes officielles »,
 * avec la douane et le commerce extérieur ; on n'ajoute plus de jeux communaux hors de ce thème.
 * Les deux lots examinés ensuite (19.11 et 24.11.2026, 61 candidats) ont été écartés en entier.
 * Le motif le plus net et le plus fréquent : un jeu d'un canton ou d'une commune qui ne se
 * raccorde que par une clé locale (numéro de commune, numéro postal). Un tel jeu est marqué
 * `hors_specialite` dans `prospection.json` ; le veilleur des jeux ne le propose plus à l'examen.
 *
 * Règle, volontairement étroite (dans le doute, le candidat reste proposé : mieux vaut un lot de
 * trop qu'un bon jeu perdu) :
 *   1. éditeur de niveau « canton » ou « commune » EXACTEMENT : un éditeur fédéral ou de niveau
 *      inconnu n'est jamais marqué (la douane, le commerce extérieur et les listes officielles
 *      d'autorisation sont fédéraux) ;
 *   2. au moins une clé de jointure, et TOUTES sont locales (`commune`, `npa`, confirmées par un
 *      en-tête ou déduites du titre) : une clé cantonale, IDE, NOGA ou tarifaire à côté, ou une clé
 *      que cette liste ne connaît pas, garde le candidat ;
 *   3. aucun mot de la spécialité dans le titre (`SPECIALTY_TITLE_PATTERN`) : liste, répertoire,
 *      registre, autorisation, agrément, concession, sanction, douane, importation, exportation,
 *      tarif. Le mot suffit, sans chercher à savoir s'il désigne une statistique.
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
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Sous-chaînes (les mots composés allemands collent le mot du thème à la fin : « Verkaufsbewilligung »,
// « Wohnungsregister », « Ortschaftenverzeichnis »), à comparer au titre replié par `fold`. Un mot
// trop large coûte seulement un candidat proposé de plus, jamais un bon jeu perdu.
const SPECIALTY_WORDS = [
  // douane et commerce extérieur
  "douan", "zoll", "dogan", "customs",
  "commerce exterieur", "aussenhandel", "außenhandel", "commercio estero", "foreign trade",
  "import", "export", "einfuhr", "ausfuhr", "esportazion",
  "tarif", "tares",
  // sanctions
  "sanktion", "sanction", "sanzion", "embargo",
  // listes officielles : répertoires, registres, autorisations, agréments, concessions
  "verzeichnis", "register", "registre", "registro", "repertoire", "elenco",
  "bewillig", "zulass", "zugelassen", "autoris", "autorizz",
  "konzession", "concession", "agree", "agrement",
];

// « Liste » à part : le mot nu désigne aussi une liste électorale (« nach Liste und Gemeinde »,
// « Listenergebnisse », « Listenstimmen », trois jeux du lot du 19.11). Il ne compte que collé à
// la fin d'un mot composé (« Sanktionsliste », « Positivlisten ») ou suivi de son complément
// (« Liste der… », « Liste des… », « list of… »).
const LIST_PATTERN = /[a-z]liste(n)?(?![a-z])|(?<![a-z])list[ea]?s?\s+(de|des|du|der|von|dei|delle|degli|of)(?![a-z])/;

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
  if (hasSpecialtyWord(candidate.title)) return null;
  return keys.every((key) => COMMUNE_KEYS.has(key)) ? "clé communale seule" : "clé locale seule";
}
