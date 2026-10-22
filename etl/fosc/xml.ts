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
 *   - `publication/content/commonsNew/company/{uid,legalForm,seat}` : état après l'événement ;
 *   - `publication/content/commonsActual/company/{uid,legalForm,seat}` : état avant (mutation,
 *     radiation).
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
}

export interface AvisDetail {
  id: string | null;
  testImport: boolean;
  /** `commonsNew/company`, absent → null. */
  after: CompanyFields | null;
  /** `commonsActual/company`, absent → null. */
  before: CompanyFields | null;
}

export class FoscXmlError extends Error {
  constructor(reason: string) {
    super(`Détail XML d'avis illisible (${reason})`);
    this.name = "FoscXmlError";
  }
}

/** Plafond de taille d'un détail (un avis HR pèse environ 10 Ko, mesuré le 22.10.2026). */
export const MAX_DETAIL_CHARS = 2_000_000;

const WANTED = new Map<string, { side: "after" | "before" | "meta" | "test"; field: keyof CompanyFields | "id" | "testImport" }>([
  ["publication/meta/id", { side: "meta", field: "id" }],
  ["publication/content/testImport", { side: "test", field: "testImport" }],
  ["publication/content/commonsNew/company/uid", { side: "after", field: "uid" }],
  ["publication/content/commonsNew/company/legalForm", { side: "after", field: "legalForm" }],
  ["publication/content/commonsNew/company/seat", { side: "after", field: "seat" }],
  ["publication/content/commonsActual/company/uid", { side: "before", field: "uid" }],
  ["publication/content/commonsActual/company/legalForm", { side: "before", field: "legalForm" }],
  ["publication/content/commonsActual/company/seat", { side: "before", field: "seat" }],
]);
const AFTER_COMPANY = "publication/content/commonsNew/company";
const BEFORE_COMPANY = "publication/content/commonsActual/company";

const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (_, ent: string) => {
    if (ent.startsWith("#x")) return String.fromCodePoint(Number.parseInt(ent.slice(2), 16));
    if (ent.startsWith("#")) return String.fromCodePoint(Number.parseInt(ent.slice(1), 10));
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
 * résolue). Seul le texte des chemins de `WANTED` est conservé.
 */
export function parseAvisDetail(xml: string): AvisDetail {
  if (xml.length > MAX_DETAIL_CHARS) throw new FoscXmlError("document trop volumineux");
  const out: AvisDetail = { id: null, testImport: false, after: null, before: null };
  const stack: string[] = [];
  let capture: { path: string; text: string } | null = null;
  const seen = new Set<string>();
  let i = 0;
  const n = xml.length;
  let rootSeen = false;

  const commit = (path: string, raw: string) => {
    if (seen.has(path)) return; // première occurrence seulement
    seen.add(path);
    const target = WANTED.get(path);
    if (!target) return;
    const value = raw.trim();
    if (target.side === "meta") out.id = value || null;
    else if (target.side === "test") out.testImport = value === "true";
    else {
      const side = target.side === "after" ? out.after : out.before;
      if (side) side[target.field as keyof CompanyFields] = value || null;
    }
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
      // Texte littéral : marqué pour ne pas être décodé deux fois.
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
        commit(path, decodeEntities(capture.text));
        capture = null;
      }
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
    if (path === AFTER_COMPANY && !out.after) out.after = { uid: null, legalForm: null, seat: null };
    if (path === BEFORE_COMPANY && !out.before) out.before = { uid: null, legalForm: null, seat: null };
    if (selfClosing) {
      if (WANTED.has(path)) commit(path, "");
      continue;
    }
    stack.push(name);
    if (!capture && WANTED.has(path)) capture = { path, text: "" };
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
