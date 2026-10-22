/**
 * Lecture du détail XML d'un avis HR, EN MÉMOIRE seulement (écart documenté à la règle « bronze
 * d'abord » : le document contient le texte libre de l'avis, des noms de personnes, le but et des
 * adresses ; il n'est jamais écrit, ni en bronze ni ailleurs, et n'apparaît dans aucun journal).
 *
 * Étage lu : source (réponse HTTP du portail). Étage écrit : rien ; seuls les champs ci-dessous
 * sortent de ce module, et le reste du document est jeté avec la chaîne.
 *
 * Champs lus (schéma d'export HR 1.26, `https://amtsblattportal.ch/api/v1/schemas/shab/1.26/HR0x-export.xsd`) :
 *   - `publication/meta/id` (contrôle : même avis que celui demandé) ;
 *   - `publication/content/testImport` (avis d'essai : écarté) ;
 *   - chaque bloc `publication/content/commonsNew/company` : état après l'événement ;
 *   - chaque bloc `publication/content/commonsActual/company` : état avant (mutation, radiation) ;
 *   et, dans chaque bloc, ses propres `uid`, `legalForm` et `seat`.
 *
 * Lecture BLOC PAR BLOC (correction du 22.10.2026 après relecture) : le schéma autorise plusieurs
 * `commonsNew` (HR01) et plusieurs `company` par côté (HR02, HR03), et `uid` y est facultatif.
 * Chaque bloc société est rendu séparément, avec les seuls champs lus À L'INTÉRIEUR de ce bloc :
 * un IDE ne peut jamais être associé à la forme juridique d'un autre bloc. Un champ répété dans un
 * même bloc le marque `repeated` (et le classement l'écarte des lignes).
 * Le chemin est comparé EN ENTIER : l'IDE de l'organe de révision
 * (`commonsNew/revision/revisionCompany/uid`) ou tout autre `uid` imbriqué ne sont jamais lus.
 *
 * Les messages d'erreur ne citent jamais un extrait du document (les journaux GitHub d'un dépôt
 * public sont lisibles par tous).
 */

export interface CompanyFields {
  uid: string | null;
  legalForm: string | null;
  seat: string | null;
  /** Un des trois champs apparaît plus d'une fois dans ce bloc. */
  repeated: boolean;
}

export interface AvisDetail {
  id: string | null;
  testImport: boolean;
  /** Un élément par bloc `commonsNew/company`, dans l'ordre du document. */
  after: CompanyFields[];
  /** Un élément par bloc `commonsActual/company`, dans l'ordre du document. */
  before: CompanyFields[];
}

export class FoscXmlError extends Error {
  constructor(reason: string) {
    super(`Détail XML d'avis illisible (${reason})`);
    this.name = "FoscXmlError";
  }
}

/** Plafond de taille d'un détail (un avis HR pèse environ 10 Ko, mesuré le 22.10.2026). */
export const MAX_DETAIL_CHARS = 2_000_000;

const META_ID = "publication/meta/id";
const TEST_IMPORT = "publication/content/testImport";
const COMPANY_BLOCKS: Record<string, "after" | "before"> = {
  "publication/content/commonsNew/company": "after",
  "publication/content/commonsActual/company": "before",
};
const COMPANY_FIELDS = new Set<keyof CompanyFields>(["uid", "legalForm", "seat"]);

const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Point de code autorisé par XML 1.0 (Char) : jamais de RangeError, toujours une FoscXmlError. */
function codePoint(value: number): string {
  const allowed = value === 0x9 || value === 0xa || value === 0xd
    || (value >= 0x20 && value <= 0xd7ff) || (value >= 0xe000 && value <= 0xfffd) || (value >= 0x10000 && value <= 0x10ffff);
  if (!Number.isInteger(value) || !allowed) throw new FoscXmlError("référence numérique invalide");
  return String.fromCodePoint(value);
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (_, ent: string) => {
    if (ent.startsWith("#x")) return codePoint(Number.parseInt(ent.slice(2), 16));
    if (ent.startsWith("#")) return codePoint(Number.parseInt(ent.slice(1), 10));
    const v = NAMED_ENTITIES[ent];
    if (v === undefined) throw new FoscXmlError("entité inconnue");
    return v;
  });
}

const localName = (qname: string): string => {
  const i = qname.indexOf(":");
  return i === -1 ? qname : qname.slice(i + 1);
};

/**
 * Analyse minimale et stricte : balises équilibrées, commentaires, instructions et sections
 * CDATA reconnus, aucune déclaration DOCTYPE (refusée : aucune entité externe ne peut être
 * résolue). Seuls l'identifiant, le drapeau d'essai et les champs des blocs société sont gardés.
 */
export function parseAvisDetail(xml: string): AvisDetail {
  if (xml.length > MAX_DETAIL_CHARS) throw new FoscXmlError("document trop volumineux");
  const out: AvisDetail = { id: null, testImport: false, after: [], before: [] };
  const stack: string[] = [];
  /** Bloc société ouvert et profondeur de la pile à laquelle il a été ouvert. */
  let block: { fields: CompanyFields; depth: number; path: string; seen: Set<string> } | null = null;
  let capture: { path: string; text: string; field: keyof CompanyFields | "id" | "testImport" } | null = null;
  let idSeen = false;
  let i = 0;
  const n = xml.length;
  let rootSeen = false;

  const commit = (field: keyof CompanyFields | "id" | "testImport", raw: string) => {
    const value = raw.trim();
    if (field === "id") {
      if (idSeen) throw new FoscXmlError("identifiant d'avis répété");
      idSeen = true;
      out.id = value || null;
    } else if (field === "testImport") {
      // Prudence : un seul « true » suffit à écarter l'avis.
      out.testImport = out.testImport || value === "true";
    } else if (block && field !== "repeated") {
      if (block.seen.has(field)) block.fields.repeated = true;
      else {
        block.seen.add(field);
        block.fields[field] = value || null;
      }
    }
  };

  /** Champ à lire pour ce chemin, ou null. Les champs société ne sont lus qu'en enfants directs d'un bloc. */
  const wanted = (path: string, depth: number): keyof CompanyFields | "id" | "testImport" | null => {
    if (path === META_ID) return "id";
    if (path === TEST_IMPORT) return "testImport";
    if (block && depth === block.depth + 1) {
      const name = path.slice(block.path.length + 1) as keyof CompanyFields;
      if (COMPANY_FIELDS.has(name)) return name;
    }
    return null;
  };

  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      if (capture) capture.text += xml.slice(i);
      break;
    }
    if (capture && lt > i) capture.text += xml.slice(i, lt);
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end === -1) throw new FoscXmlError("commentaire non fermé");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end === -1) throw new FoscXmlError("section CDATA non fermée");
      // Texte littéral : échappé ici pour ne pas être décodé deux fois.
      if (capture) capture.text += xml.slice(lt + 9, end).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end === -1) throw new FoscXmlError("instruction non fermée");
      i = end + 2;
      continue;
    }
    if (xml.startsWith("<!", lt)) throw new FoscXmlError("déclaration non admise");
    const gt = findTagEnd(xml, lt + 1);
    if (gt === -1) throw new FoscXmlError("balise non fermée");
    const inner = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (inner.startsWith("/")) {
      const name = localName(inner.slice(1).trim());
      const top = stack.pop();
      if (top !== name) throw new FoscXmlError("balises déséquilibrées");
      const path = [...stack, name].join("/");
      if (capture && capture.path === path) {
        commit(capture.field, decodeEntities(capture.text));
        capture = null;
      }
      if (block && stack.length === block.depth) block = null;
      continue;
    }
    const selfClosing = inner.endsWith("/");
    const nameMatch = /^([A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?)/.exec(selfClosing ? inner.slice(0, -1) : inner);
    if (!nameMatch) throw new FoscXmlError("nom de balise invalide");
    const name = localName(nameMatch[1]);
    if (stack.length === 0) {
      if (rootSeen) throw new FoscXmlError("plusieurs éléments racine");
      rootSeen = true;
    }
    const path = [...stack, name].join("/");
    const side = COMPANY_BLOCKS[path];
    if (side) {
      const fields: CompanyFields = { uid: null, legalForm: null, seat: null, repeated: false };
      out[side].push(fields);
      if (!selfClosing) block = { fields, depth: stack.length, path, seen: new Set() };
      if (!selfClosing) stack.push(name);
      continue;
    }
    const field: keyof CompanyFields | "id" | "testImport" | null = capture ? null : wanted(path, stack.length);
    if (selfClosing) {
      if (field) commit(field, "");
      continue;
    }
    stack.push(name);
    if (field) capture = { path, text: "", field };
  }
  if (stack.length !== 0) throw new FoscXmlError("document tronqué");
  if (!rootSeen) throw new FoscXmlError("document vide");
  return out;
}

/** Fin de balise en tenant compte des guillemets d'attributs (un `>` dans une valeur). */
function findTagEnd(xml: string, from: number): number {
  let quote: string | null = null;
  for (let j = from; j < xml.length; j++) {
    const c = xml[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return j;
  }
  return -1;
}
