/**
 * Lecture d'une ligne des fichiers de l'OFDF. Étage lu : source (ligne en mémoire). Étage écrit : rien.
 *
 * LE PIÈGE (mesuré le 05.11.2026) : le libellé du tarif contient des points-virgules, protégés par des
 * guillemets, et des guillemets internes échappés par `\"`, ce qu'un lecteur CSV standard ne comprend
 * pas. 898 609 lignes des recettes débordent ainsi. Lues par position depuis la gauche, elles donnent
 * des droits environ neuf fois trop hauts.
 *
 * Donc on ne lit JAMAIS le libellé : les colonnes à gauche de lui et celles à droite sont fixes, on
 * compte depuis chaque bout et on jette le milieu. Chaque champ gardé passe un contrôle strict : un
 * point-virgule dans une autre colonne décale la lecture et arrête la collecte, au lieu de fausser un total.
 */
import type { DouaneFileKind } from "./sources.js";

export class DouaneFormatError extends Error {
  constructor(reason: string) {
    super(`Fichier de l'OFDF refusé (${reason})`);
    this.name = "DouaneFormatError";
  }
}

const DUTIES_COLUMNS = [
  "Annee", "Trimestre", "Trimestre_txt", "Mois", "Mois_txt", "Numero_tarif", "Numero_tarif_txt", "Pays_isoAlpha2",
  "Pays_Num", "Pays_Txt", "Type_biens_code", "Type_biens_txt", "Type_de_taux", "Genre_taux_code", "Genre_taux_txt",
  "Unite_douniere_code", "Unite_douniere_txt", "Quantite_douniere", "Quantite_kg", "Valeur_CHF", "Valeur_EUR",
  "Valeur_USD", "Recettes_douanieres_CHF", "Recettes_douanieres_EUR", "Recettes_douanieres_USD", "Etat", "Date_actualisation",
] as const;

const TRADE_COLUMNS = [
  "Direction_trafic", "Annee", "Trimestre", "Trimestre_txt", "Mois", "Mois_txt", "Numero_tarif8", "Numero_tarif8_txt",
  "Numero_tarif6", "Numero_tarif4", "Numero_tarif2", "Total_conjoncturel", "Total_general", "Pays_isoAlpha2", "Pays_num",
  "Pays_txt", "Unite_supplementaire_code", "Unite_supplementaire_txt", "Quantite_supplementaire", "Quantite_kg",
  "Valeur_CHF", "Valeur_EUR", "Valeur_USD", "Etat", "Date_actualisation",
] as const;

const COLUMNS: Readonly<Record<DouaneFileKind, readonly string[]>> = {
  duties: DUTIES_COLUMNS,
  imports: TRADE_COLUMNS,
  exports: TRADE_COLUMNS,
};

/** Liste exacte, ordre compris. Une colonne ajoutée, retirée ou renommée arrête la collecte. */
export function checkHeader(kind: DouaneFileKind, header: string): void {
  if (header !== COLUMNS[kind].join(";")) throw new DouaneFormatError("colonnes inattendues");
}

export interface DouaneRecord {
  year: number;
  month: number;
  /** Numéro de tarif sans le point, 8 chiffres. */
  tn8: string;
  country: string;
  status: "def" | "prov";
  /** Date de mise à jour de la source, telle qu'écrite (`Date_actualisation`). */
  updatedAt: string;
  /** Vide dans la source : `null`, jamais 0 (absence n'est pas zéro). */
  kg: number | null;
  valueChf: number | null;
  /** Recettes douanières ; `null` hors du fichier des recettes. */
  dutiesChf: number | null;
  /** Compte dans le total conjoncturel de l'OFDF (or et assimilés exclus) ; `null` dans les recettes. */
  conjunctural: boolean | null;
  /** La ligne avait des points-virgules dans son libellé. */
  labelOverflow: boolean;
}

/** 1980 à 2099 : la clé d'agrégat (`aggregate.ts`) ne connaît pas d'année plus ancienne. */
const YEAR = /^(?:19[89]\d|20\d{2})$/;
const MONTH = /^(?:[1-9]|1[0-2])$/;
const TARIFF = /^(\d{4})\.(\d{4})$/;
const COUNTRY = /^[A-Z]{2}$/;
const DIGITS = /^\d+$/;
const OPTIONAL_DIGITS = /^\d*$/;
const UPDATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;
const NUMBER = /^\d+(?:\.\d+)?(?:E\d+)?$/;

/** Un montant ou un poids : entier positif ou nul. Une décimale, un signe, un texte arrêtent la collecte. */
function amount(text: string, field: string): number {
  if (!NUMBER.test(text)) throw new DouaneFormatError(`${field} illisible`);
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new DouaneFormatError(`${field} non entier`);
  return value;
}

function optionalAmount(text: string, field: string): number | null {
  return text === "" ? null : amount(text, field);
}

function common(year: string, month: string, tariff: string, country: string, status: string, updatedAt: string): Pick<DouaneRecord, "year" | "month" | "tn8" | "country" | "status" | "updatedAt"> {
  if (!YEAR.test(year)) throw new DouaneFormatError("année illisible");
  if (!MONTH.test(month)) throw new DouaneFormatError("mois illisible");
  const t = TARIFF.exec(tariff);
  if (!t) throw new DouaneFormatError("numéro de tarif illisible");
  if (!COUNTRY.test(country)) throw new DouaneFormatError("code de pays illisible");
  if (status !== "def" && status !== "prov") throw new DouaneFormatError("état inconnu");
  if (!UPDATED_AT.test(updatedAt)) throw new DouaneFormatError("date de mise à jour illisible");
  return { year: Number(year), month: Number(month), tn8: t[1] + t[2], country, status, updatedAt };
}

/** Recettes douanières : 6 colonnes à gauche du libellé, 20 à droite. */
function readDutiesLine(line: string): DouaneRecord {
  const p = line.split(";");
  if (p.length < DUTIES_COLUMNS.length) throw new DouaneFormatError("ligne trop courte");
  const r = p.length - 20;
  if (!DIGITS.test(p[r + 1])) throw new DouaneFormatError("numéro de pays illisible");
  for (const code of [p[r + 3], p[r + 5], p[r + 6], p[r + 8]]) {
    if (!DIGITS.test(code)) throw new DouaneFormatError("code illisible");
  }
  return {
    ...common(p[0], p[3], p[5], p[r], p[r + 18], p[r + 19]),
    kg: optionalAmount(p[r + 11], "poids"),
    valueChf: optionalAmount(p[r + 12], "valeur"),
    dutiesChf: optionalAmount(p[r + 15], "droits"),
    conjunctural: null,
    labelOverflow: p.length > DUTIES_COLUMNS.length,
  };
}

/** Commerce : 7 colonnes à gauche du libellé, 17 à droite. */
function readTradeLine(line: string, direction: "I" | "E"): DouaneRecord {
  const p = line.split(";");
  if (p.length < TRADE_COLUMNS.length) throw new DouaneFormatError("ligne trop courte");
  if (p[0] !== direction) throw new DouaneFormatError("sens du trafic inattendu");
  const r = p.length - 17;
  const record = common(p[1], p[4], p[6], p[r + 5], p[r + 15], p[r + 16]);
  // Les trois découpes du tarif ancrent la droite : elles redisent le numéro lu à gauche.
  if (p[r] !== `${record.tn8.slice(0, 4)}.${record.tn8.slice(4, 6)}` || p[r + 1] !== record.tn8.slice(0, 4) || p[r + 2] !== record.tn8.slice(0, 2)) {
    throw new DouaneFormatError("découpe du tarif incohérente");
  }
  const conjunctural = p[r + 3];
  if (conjunctural !== "Oui" && conjunctural !== "Non") throw new DouaneFormatError("total conjoncturel inconnu");
  if (p[r + 4] !== "oui") throw new DouaneFormatError("total général inconnu");
  if (!DIGITS.test(p[r + 6]) || !OPTIONAL_DIGITS.test(p[r + 8])) throw new DouaneFormatError("code illisible");
  return {
    ...record,
    kg: optionalAmount(p[r + 11], "poids"),
    valueChf: optionalAmount(p[r + 12], "valeur"),
    dutiesChf: null,
    conjunctural: conjunctural === "Oui",
    labelOverflow: p.length > TRADE_COLUMNS.length,
  };
}

export function readLine(kind: DouaneFileKind, line: string): DouaneRecord {
  if (kind === "duties") return readDutiesLine(line);
  return readTradeLine(line, kind === "imports" ? "I" : "E");
}
