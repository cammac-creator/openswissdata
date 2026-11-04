/**
 * Lecture du fichier XML de la liste des sanctions (SESAM), EN MÉMOIRE seulement.
 *
 * Étage lu : source (fichier officiel entier, qui contient des personnes physiques). Étage écrit :
 * rien ; ce module rend les seuls champs d'une liste blanche. Décision de Claude-Alain du
 * 04.11.2026 : organisations et bateaux seulement.
 *
 * Trois règles que ce lecteur tient par construction :
 *   - les chemins sont comparés EN ENTIER depuis la racine. Le texte libre (`justification`,
 *     `other-information` des organisations), les relations, les lignes d'adresse, les pièces
 *     d'identité et l'historique (`modification/added`, `modification/removed`) ne sont jamais
 *     lus ; l'historique contient une seconde copie de chaque fiche sous un élément `target` ;
 *   - le genre d'une entrée vient du seul élément qu'elle porte (`individual`, `entity`, `object`),
 *     jamais de `name-part-type` : des organisations y sont étiquetées `family-name`, ce qui ne
 *     dit rien d'une personne. Un genre inconnu arrête la lecture, il ne devient jamais une ligne ;
 *   - une entrée qui porte une modification `de-listed` est radiée, quelle que soit sa position
 *     dans le fichier (l'ordre n'y est pas chronologique ; relu sur la recherche officielle le
 *     04.11.2026, `SOURCES.md`). Une modification plus tardive arrête la lecture : une
 *     réinscription à cette forme n'a jamais été vue, et la trancher en silence serait faux dans
 *     les deux sens.
 *
 * Écarter le genre « personne » ne suffit pas : des organisations portent le nom de leur
 * propriétaire, lui-même sur la liste (bureaux de change, relevé du 04.11.2026). Un nom
 * d'organisation qui contient le nom d'une personne de la liste, ou un titre personnel, est retiré ;
 * si c'est son nom principal, l'entrée entière est écartée et comptée (`carriesPersonName`). Même
 * raison que les entreprises individuelles de la FOSC. Une institution d'État « named after » un
 * personnage reste une organisation : comptée, gardée.
 *
 * Les messages d'erreur ne citent jamais un extrait du fichier : les journaux GitHub d'un dépôt
 * public sont lisibles par tous.
 */
import type { SanctionEntry, SanctionNameType } from "../../src/lib/sanctions.js";

export class SesamXmlError extends Error {
  constructor(reason: string) {
    super(`Fichier SESAM refusé (${reason})`);
    this.name = "SesamXmlError";
  }
}

export const MAX_XML_CHARS = 200_000_000;

const ROOT = "swiss-sanctions-list";
const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const TARGET_CHILDREN = new Set(["foreign-identifier", "modification", "sanctions-set-id", "individual", "entity", "object"]);
const MODIFICATION_TYPES = new Set(["listed", "amended", "de-listed"]);
const NAME_TYPES: Record<string, SanctionNameType> = { "primary-name": "primary", alias: "alias", "formerly-known-as": "former" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// « IMO number: 1234567 », relevé sur les 731 bateaux le 04.11.2026 (une faute de frappe de la
// source comprise, d'où la tolérance sur le mot). Rien d'autre de ce texte n'est gardé.
const IMO = /\bIMO\b[^0-9]{0,12}(\d{7})\b/gi;

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (_, ent: string) => {
    if (ent.startsWith("#")) {
      const value = ent.startsWith("#x") ? Number.parseInt(ent.slice(2), 16) : Number.parseInt(ent.slice(1), 10);
      if (!Number.isInteger(value) || value < 0x9 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
        throw new SesamXmlError("référence numérique invalide");
      }
      return String.fromCodePoint(value);
    }
    const named = NAMED_ENTITIES[ent];
    if (named === undefined) throw new SesamXmlError("entité inconnue");
    return named;
  });
}

function attributes(inner: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][\w.\-:]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(inner); m; m = re.exec(inner)) out[m[1]] = decodeEntities(m[3] ?? m[4] ?? "");
  return out;
}

function findTagEnd(xml: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < xml.length; i++) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

interface NamePart { order: number; type: string; value: string; variants: string[] }
interface RawName { type: string; parts: NamePart[] }
interface RawModification { type: string; dates: string[]; effective: string | null }
interface RawTarget {
  id: string;
  kinds: string[];
  objectType: string | null;
  names: RawName[];
  placeIds: string[];
  otherInformation: string[];
  setIds: string[];
  modifications: RawModification[];
}

/** Ce que la lecture rend. `personNameKeys` ne sert qu'au contrôle en mémoire et n'est jamais écrit. */
export interface ParsedSesam {
  listDate: string;
  entries: SanctionEntry[];
  sourceEntries: { natural_persons: number; organisations: number; vessels: number };
  excluded: {
    natural_persons: number;
    delisted_organisations: number;
    delisted_vessels: number;
    organisations_primary_name_carries_person: number;
  };
  organisationNamesRemovedCarryingPerson: number;
  vesselsNameEqualsPerson: number;
  organisationNamesHonouringAPersonKept: number;
  vesselsWithoutImo: number;
  personNameKeys: ReadonlySet<string>;
}

/** Nom complet : parties dans l'ordre de leur attribut `order`. */
const wholeName = (parts: NamePart[]): string =>
  [...parts].sort((a, b) => a.order - b.order).map((p) => p.value).join(" ").replace(/\s+/gu, " ").trim();

/** Mots d'un nom, sans casse ni ponctuation : « Khairullah-Haji » et « khairullah haji » se valent. */
const personTokens = (value: string): string[] =>
  value.normalize("NFKC").toLocaleLowerCase("en").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Clé du seul contrôle des personnes, plus large que la clé de recherche : une correspondance de trop retire un nom, jamais l'inverse. */
export const personCheckKey = (value: string): string => personTokens(value).join(" ");

// Relevés sur la liste du 04.11.2026 : ces titres précèdent le nom d'un propriétaire.
const PERSONAL_TITLES = new Set(["haji", "hajji", "hadji", "alhaj", "maulawi", "mawlawi", "mawlavi", "maulavi", "mullah", "mulla", "sheikh", "shaykh"]);
const MIN_INNER_NAME_CHARS = 8;
const MAX_INNER_NAME_WORDS = 8;
const HONOURS_A_PERSON = /\bnamed after\b/i;

/**
 * Le nom contient-il un nom de personne ? Nom entier identique, suite d'au moins deux mots égale au
 * nom d'une personne de la liste (8 caractères au moins, pour ne pas écarter sur deux mots courts),
 * ou titre personnel. Jamais d'après `name-part-type`, qui étiquette à tort des organisations.
 */
export function carriesPersonName(value: string, personNames: ReadonlySet<string>): boolean {
  const tokens = personTokens(value);
  if (tokens.some((t) => PERSONAL_TITLES.has(t))) return true;
  if (personNames.has(tokens.join(" "))) return true;
  for (let start = 0; start < tokens.length; start++) {
    for (let words = 2; words <= MAX_INNER_NAME_WORDS && start + words <= tokens.length; words++) {
      const inner = tokens.slice(start, start + words).join(" ");
      if (inner.length >= MIN_INNER_NAME_CHARS && personNames.has(inner)) return true;
    }
  }
  return false;
}

function personKeys(names: RawName[], into: Set<string>): void {
  for (const name of names) {
    const whole = wholeName(name.parts);
    if (whole) into.add(personCheckKey(whole));
    const family = name.parts.find((p) => p.type === "family-name")?.value;
    const given = name.parts.find((p) => p.type === "given-name")?.value;
    if (family && given) {
      into.add(personCheckKey(`${given} ${family}`));
      into.add(personCheckKey(`${family} ${given}`));
    }
  }
}

function collectNames(names: RawName[]): { type: SanctionNameType; value: string }[] {
  const out: { type: SanctionNameType; value: string }[] = [];
  const seen = new Set<string>();
  const add = (type: SanctionNameType, value: string) => {
    const clean = value.replace(/\s+/gu, " ").trim();
    if (!clean || seen.has(`${type}\u0000${clean}`)) return;
    seen.add(`${type}\u0000${clean}`);
    out.push({ type, value: clean });
  };
  for (const name of names) {
    const type = NAME_TYPES[name.type];
    if (!type) throw new SesamXmlError("type de nom inconnu");
    add(type, wholeName(name.parts));
    // Une variante d'écriture (cyrillique, arabe) n'est un nom entier que si le nom n'a qu'une partie.
    if (name.parts.length === 1) for (const variant of name.parts[0].variants) add(type, variant);
  }
  // Le nom principal d'abord, pour un résultat lisible.
  const rank: Record<SanctionNameType, number> = { primary: 0, alias: 1, former: 2 };
  return out.sort((a, b) => rank[a.type] - rank[b.type]);
}

export function parseSesamXml(xml: string): ParsedSesam {
  if (xml.length > MAX_XML_CHARS) throw new SesamXmlError("document trop volumineux");

  let listType: string | null = null;
  let listDate: string | null = null;
  const programmes = new Map<string, { key: string | null; origin: string | null }>();
  const setToProgramme = new Map<string, string>();
  const places = new Map<string, string>();
  const targets: RawTarget[] = [];

  const stack: string[] = [];
  let rootSeen = false;
  let programme: string | null = null;
  let place: string | null = null;
  let target: RawTarget | null = null;
  let name: RawName | null = null;
  let part: NamePart | null = null;
  let capture: { depth: number; text: string; onDone: (text: string) => void } | null = null;

  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) break;
    if (capture && lt > i) capture.text += xml.slice(i, lt);
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end === -1) throw new SesamXmlError("commentaire non fermé");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end === -1) throw new SesamXmlError("section CDATA non fermée");
      // Texte littéral : échappé ici pour ne pas être décodé deux fois.
      if (capture) capture.text += xml.slice(lt + 9, end).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end === -1) throw new SesamXmlError("instruction non fermée");
      i = end + 2;
      continue;
    }
    // Aucune déclaration DOCTYPE : aucune entité externe ne peut être résolue.
    if (xml.startsWith("<!", lt)) throw new SesamXmlError("déclaration non admise");
    const gt = findTagEnd(xml, lt + 1);
    if (gt === -1) throw new SesamXmlError("balise non fermée");
    const inner = xml.slice(lt + 1, gt);
    i = gt + 1;

    if (inner.startsWith("/")) {
      const closing = inner.slice(1).trim();
      if (stack.pop() !== closing) throw new SesamXmlError("balises déséquilibrées");
      if (capture && capture.depth === stack.length) {
        capture.onDone(decodeEntities(capture.text));
        capture = null;
      }
      if (stack.length === 1) { programme = null; place = null; target = null; }
      if (part && closing === "name-part") part = null;
      if (name && closing === "name") name = null;
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = /^([A-Za-z_][\w.\-:]*)/.exec(body);
    if (!nameMatch) throw new SesamXmlError("nom de balise invalide");
    const tag = nameMatch[1];
    const attrText = body.slice(tag.length);
    const depth = stack.length;
    let wantText: ((text: string) => void) | null = null;

    if (depth === 0) {
      if (rootSeen) throw new SesamXmlError("plusieurs éléments racine");
      rootSeen = true;
      if (tag !== ROOT) throw new SesamXmlError("racine inattendue");
      const a = attributes(attrText);
      listType = a["list-type"] ?? null;
      listDate = a.date ?? null;
    } else if (depth === 1) {
      const a = tag === "sanctions-program" || tag === "place" || tag === "target" ? attributes(attrText) : {};
      if (tag === "sanctions-program") {
        if (!a.ssid) throw new SesamXmlError("programme sans numéro");
        programme = a.ssid;
        programmes.set(programme, { key: null, origin: null });
      } else if (tag === "place") {
        place = a.ssid ?? null;
      } else if (tag === "target") {
        if (!a.ssid) throw new SesamXmlError("entrée sans numéro");
        target = { id: a.ssid, kinds: [], objectType: null, names: [], placeIds: [], otherInformation: [], setIds: [], modifications: [] };
        targets.push(target);
      } else {
        throw new SesamXmlError("élément inattendu sous la racine");
      }
    } else if (programme && depth === 2) {
      const a = tag === "program-key" || tag === "sanctions-set" ? attributes(attrText) : {};
      const current = programmes.get(programme);
      if (tag === "program-key" && a.lang === "eng" && current) wantText = (text) => { current.key = text.trim(); };
      else if (tag === "origin" && current) wantText = (text) => { current.origin = text.trim(); };
      else if (tag === "sanctions-set" && a.ssid) setToProgramme.set(a.ssid, programme);
    } else if (place && depth === 2) {
      if (tag === "country") {
        const iso = attributes(attrText)["iso-code"];
        if (iso && /^[A-Za-z]{2}$/.test(iso)) places.set(place, iso.toUpperCase());
      }
    } else if (target && depth === 2) {
      if (!TARGET_CHILDREN.has(tag)) throw new SesamXmlError("élément inattendu dans une entrée");
      const current = target;
      if (tag === "individual" || tag === "entity" || tag === "object") {
        current.kinds.push(tag);
        if (tag === "object") current.objectType = attributes(attrText)["object-type"] ?? null;
      } else if (tag === "sanctions-set-id") {
        wantText = (text) => { current.setIds.push(text.trim()); };
      } else if (tag === "modification") {
        const a = attributes(attrText);
        const type = a["modification-type"] ?? "";
        if (!MODIFICATION_TYPES.has(type)) throw new SesamXmlError("type de modification inconnu");
        const dates = [a["publication-date"], a["effective-date"], a["enactment-date"]].filter((d): d is string => Boolean(d));
        if (dates.some((d) => !ISO_DATE.test(d))) throw new SesamXmlError("date de modification illisible");
        current.modifications.push({ type, dates, effective: a["effective-date"] ?? a["enactment-date"] ?? a["publication-date"] ?? null });
      }
    } else if (target && depth >= 3 && (stack[2] === "individual" || stack[2] === "entity" || stack[2] === "object")) {
      // Chemin complet sous la fiche, l'historique (`modification/…`) n'y passe jamais : `stack[2]`.
      const current = target;
      const below = stack.slice(3);
      if (depth === 3 && tag === "other-information" && stack[2] === "object") {
        wantText = (text) => { current.otherInformation.push(text); };
      } else if (below.length === 1 && below[0] === "identity" && tag === "name") {
        name = { type: attributes(attrText)["name-type"] ?? "", parts: [] };
        current.names.push(name);
      } else if (below.length === 1 && below[0] === "identity" && tag === "address" && stack[2] === "entity") {
        const placeId = attributes(attrText)["place-id"];
        if (placeId) current.placeIds.push(placeId);
      } else if (name && below.length === 2 && below[1] === "name" && tag === "name-part") {
        const a = attributes(attrText);
        part = { order: Number.parseInt(a.order ?? "0", 10) || 0, type: a["name-part-type"] ?? "", value: "", variants: [] };
        name.parts.push(part);
      } else if (part && below.length === 3 && below[2] === "name-part" && tag === "value") {
        const currentPart = part;
        wantText = (text) => { currentPart.value = text.replace(/\s+/gu, " ").trim(); };
      } else if (part && below.length === 3 && below[2] === "name-part" && tag === "spelling-variant") {
        const currentPart = part;
        wantText = (text) => { currentPart.variants.push(text); };
      }
    }

    if (selfClosing) {
      if (wantText) wantText("");
      continue;
    }
    if (wantText && !capture) capture = { depth: stack.length, text: "", onDone: wantText };
    stack.push(tag);
  }
  if (stack.length !== 0) throw new SesamXmlError("document tronqué");
  if (!rootSeen) throw new SesamXmlError("document vide");
  if (listType !== "whole-list") throw new SesamXmlError("type de liste inattendu");
  if (!listDate || !ISO_DATE.test(listDate)) throw new SesamXmlError("date de liste illisible");

  // Les noms de TOUTES les personnes, radiées comprises, servent au contrôle ci-dessous.
  const personNames = new Set<string>();
  const sourceEntries = { natural_persons: 0, organisations: 0, vessels: 0 };
  const excluded = { natural_persons: 0, delisted_organisations: 0, delisted_vessels: 0, organisations_primary_name_carries_person: 0 };
  const candidates: RawTarget[] = [];
  const seenIds = new Set<string>();
  for (const t of targets) {
    if (seenIds.has(t.id)) throw new SesamXmlError("numéro d'entrée en double");
    seenIds.add(t.id);
    if (t.kinds.length !== 1) throw new SesamXmlError("genre d'entrée inconnu");
    const kind = t.kinds[0];
    if (kind === "individual") {
      sourceEntries.natural_persons++;
      excluded.natural_persons++;
      personKeys(t.names, personNames);
      continue;
    }
    if (kind === "object" && t.objectType !== "vessel") throw new SesamXmlError("genre d'objet inconnu");
    if (kind === "entity") sourceEntries.organisations++;
    else sourceEntries.vessels++;
    const delisted = t.modifications.filter((m) => m.type === "de-listed");
    if (delisted.length > 0) {
      const lastDelisting = delisted.flatMap((m) => m.dates).sort().at(-1) ?? "";
      const later = t.modifications.some((m) => m.type !== "de-listed" && m.dates.some((d) => d > lastDelisting));
      if (later) throw new SesamXmlError("entrée radiée modifiée ensuite");
      if (kind === "entity") excluded.delisted_organisations++;
      else excluded.delisted_vessels++;
      continue;
    }
    candidates.push(t);
  }

  const entries: SanctionEntry[] = [];
  let namesRemoved = 0;
  let namesHonouring = 0;
  let vesselsNameEqualsPerson = 0;
  let vesselsWithoutImo = 0;
  for (const t of candidates) {
    const isVessel = t.kinds[0] === "object";
    let names = collectNames(t.names);
    if (!names.some((nm) => nm.type === "primary")) throw new SesamXmlError("entrée sans nom principal");
    if (isVessel) {
      // Le genre de l'entrée fait foi : un bateau peut porter le nom d'une personne, et ce nom est
      // son seul identifiant avec l'IMO. Compté, jamais écarté.
      if (names.some((nm) => personNames.has(personCheckKey(nm.value)))) vesselsNameEqualsPerson++;
    } else {
      if (names.some((nm) => nm.type === "primary" && carriesPersonName(nm.value, personNames))) {
        excluded.organisations_primary_name_carries_person++;
        continue;
      }
      const kept = names.filter((nm) => !carriesPersonName(nm.value, personNames));
      namesRemoved += names.length - kept.length;
      names = kept;
      namesHonouring += names.filter((nm) => HONOURS_A_PERSON.test(nm.value)).length;
    }
    const programmesOfEntry = new Map<string, { id: string; name: string; origin: string }>();
    for (const setId of t.setIds) {
      const programmeId = setToProgramme.get(setId);
      const known = programmeId ? programmes.get(programmeId) : undefined;
      if (!programmeId || !known?.key || !known.origin) throw new SesamXmlError("programme inconnu");
      programmesOfEntry.set(programmeId, { id: programmeId, name: known.key, origin: known.origin });
    }
    if (programmesOfEntry.size === 0) throw new SesamXmlError("entrée sans programme");
    const imos = isVessel
      ? [...new Set(t.otherInformation.flatMap((text) => [...text.matchAll(IMO)].map((m) => m[1])))]
      : [];
    if (isVessel && imos.length !== 1) vesselsWithoutImo++;
    const listed = t.modifications.find((m) => m.type === "listed");
    entries.push({
      id: t.id,
      kind: isVessel ? "vessel" : "organisation",
      names,
      programmes: [...programmesOfEntry.values()],
      listed_on: listed?.effective ?? null,
      countries: isVessel ? [] : [...new Set(t.placeIds.map((p) => places.get(p)).filter((c): c is string => Boolean(c)))].sort(),
      imo: imos.length === 1 ? imos[0] : null,
    });
  }

  return {
    listDate,
    entries,
    sourceEntries,
    excluded,
    organisationNamesRemovedCarryingPerson: namesRemoved,
    vesselsNameEqualsPerson,
    organisationNamesHonouringAPersonKept: namesHonouring,
    vesselsWithoutImo,
    personNameKeys: personNames,
  };
}
