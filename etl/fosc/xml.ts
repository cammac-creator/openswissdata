/**
 * Lecture du détail XML d'un avis, EN MÉMOIRE seulement (écart documenté à la règle « bronze
 * d'abord » : le document contient le texte libre de l'avis, des noms de personnes, le but et des
 * adresses ; il n'est jamais écrit, ni en bronze ni ailleurs, et n'apparaît dans aucun journal).
 *
 * Étage lu : source (réponse HTTP du portail). Étage écrit : rien ; seuls les champs demandés par
 * un « profil » sortent de ce module, et le reste du document est jeté avec la chaîne.
 *
 * Deux usages, un seul lecteur (`scanDetail`) :
 *   - avis HR (`parseAvisDetail`, schéma d'export HR 1.26,
 *     `https://amtsblattportal.ch/api/v1/schemas/shab/1.26/HR0x-export.xsd`) :
 *       - `publication/meta/id` (contrôle : même avis que celui demandé) ;
 *       - `publication/content/testImport` (avis d'essai : écarté) ;
 *       - chaque bloc `publication/content/commonsNew/company` : état après l'événement ;
 *       - chaque bloc `publication/content/commonsActual/company` : état avant (mutation, radiation) ;
 *       et, dans chaque bloc, ses propres `uid`, `legalForm` et `seat` ;
 *   - avis de faillite, de concordat, de liquidation et d'appel aux créanciers (`insolvency.ts`,
 *     lot du 24.10.2026), avec leur propre profil.
 *
 * Lecture BLOC PAR BLOC (correction du 22.10.2026 après relecture) : le schéma autorise plusieurs
 * blocs société par côté, et `uid` y est facultatif. Chaque bloc est rendu séparément, avec les
 * seuls champs lus À L'INTÉRIEUR de ce bloc (chemin relatif exact) : un IDE ne peut jamais être
 * associé à la forme juridique d'un autre bloc. Un champ répété dans un même bloc est signalé
 * (`repeated`) et le classement l'écarte des lignes.
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

/**
 * Ce qu'un lecteur demande au document. Tous les chemins sont complets (racine comprise, sans
 * préfixe d'espace de noms), comparés à l'identique.
 */
export interface DetailProfile {
  /** Bloc société : chemin complet → rôle (« after », « debtor »…). */
  blocks: Readonly<Record<string, string>>;
  /** Champs lus dans un bloc : chemin RELATIF au bloc (« uid », « address/town »). */
  blockFields: readonly string[];
  /** Valeurs isolées (feuilles) : chemin complet → clé ; toutes les occurrences sont gardées. */
  scalars: Readonly<Record<string, string>>;
  /** Éléments comptés par nom local, partout sous ce chemin (ouverture de balise). */
  countUnder?: { prefix: string; names: readonly string[] };
}

export interface ScannedBlock {
  role: string;
  /** Première valeur de chaque champ lu (`null` si vide). */
  fields: Record<string, string | null>;
  /** Champs vus plus d'une fois dans ce bloc. */
  repeated: string[];
}

export interface ScannedDetail {
  /** Nom qualifié de l'élément racine (`HR01:publication`), tel qu'écrit. */
  rootName: string | null;
  /** Déclarations d'espace de noms de la racine (`xmlns:KK01` → URI) et emplacement du schéma. */
  rootNamespaces: Record<string, string>;
  rootSchemaLocation: string | null;
  blocks: ScannedBlock[];
  scalars: Record<string, string[]>;
  counts: Record<string, number>;
}

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
 * Attributs de la balise racine : seulement les déclarations d'espace de noms et `schemaLocation`,
 * valeurs brutes (jamais décodées : une valeur inattendue ne peut que faire échouer la comparaison
 * avec l'espace de noms attendu, donc envoyer l'avis dans les totaux).
 */
function readRootAttributes(inner: string, out: ScannedDetail): void {
  const re = /([A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(inner); m; m = re.exec(inner)) {
    const name = m[1];
    const value = m[3] ?? m[4] ?? "";
    if (name === "xmlns" || name.startsWith("xmlns:")) out.rootNamespaces[name] = value;
    else if (localName(name) === "schemaLocation") out.rootSchemaLocation = value;
  }
}

/**
 * Analyse minimale et stricte : balises équilibrées, commentaires, instructions et sections
 * CDATA reconnus, aucune déclaration DOCTYPE (refusée : aucune entité externe ne peut être
 * résolue). Seuls les champs demandés par le profil sont gardés.
 */
export function scanDetail(xml: string, profile: DetailProfile): ScannedDetail {
  if (xml.length > MAX_DETAIL_CHARS) throw new FoscXmlError("document trop volumineux");
  const out: ScannedDetail = { rootName: null, rootNamespaces: {}, rootSchemaLocation: null, blocks: [], scalars: {}, counts: {} };
  const blockFields = new Set(profile.blockFields);
  const counted = profile.countUnder ? new Set(profile.countUnder.names) : null;
  const countPrefix = profile.countUnder ? `${profile.countUnder.prefix}/` : "";
  const stack: string[] = [];
  /** Bloc société ouvert et profondeur de la pile à laquelle il a été ouvert. */
  let block: { scanned: ScannedBlock; depth: number; path: string; seen: Set<string> } | null = null;
  type Target = { kind: "field"; name: string } | { kind: "scalar"; key: string };
  let capture: { path: string; text: string; target: Target } | null = null;
  let i = 0;
  const n = xml.length;
  let rootSeen = false;

  const commit = (target: Target, raw: string) => {
    const value = raw.trim();
    if (target.kind === "scalar") {
      (out.scalars[target.key] ??= []).push(value);
    } else if (block) {
      if (block.seen.has(target.name)) {
        if (!block.scanned.repeated.includes(target.name)) block.scanned.repeated.push(target.name);
      } else {
        block.seen.add(target.name);
        block.scanned.fields[target.name] = value || null;
      }
    }
  };

  /** Cible à lire pour ce chemin, ou null. Les champs d'un bloc ne sont lus qu'à leur chemin relatif exact. */
  const wanted = (path: string): Target | null => {
    const key = profile.scalars[path];
    if (key !== undefined) return { kind: "scalar", key };
    if (block && path.startsWith(`${block.path}/`)) {
      const rel = path.slice(block.path.length + 1);
      if (blockFields.has(rel)) return { kind: "field", name: rel };
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
        commit(capture.target, decodeEntities(capture.text));
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
      out.rootName = nameMatch[1];
      readRootAttributes(inner.slice(nameMatch[1].length), out);
    }
    const path = [...stack, name].join("/");
    if (counted && path.startsWith(countPrefix) && counted.has(name)) out.counts[name] = (out.counts[name] ?? 0) + 1;
    const role = profile.blocks[path];
    if (role !== undefined) {
      const scanned: ScannedBlock = { role, fields: {}, repeated: [] };
      out.blocks.push(scanned);
      if (!selfClosing) block = { scanned, depth: stack.length, path, seen: new Set() };
      if (!selfClosing) stack.push(name);
      continue;
    }
    const target: Target | null = capture ? null : wanted(path);
    if (selfClosing) {
      if (target) commit(target, "");
      continue;
    }
    stack.push(name);
    if (target) capture = { path, text: "", target };
  }
  if (stack.length !== 0) throw new FoscXmlError("document tronqué");
  if (!rootSeen) throw new FoscXmlError("document vide");
  return out;
}

const HR_PROFILE: DetailProfile = {
  blocks: {
    "publication/content/commonsNew/company": "after",
    "publication/content/commonsActual/company": "before",
  },
  blockFields: ["uid", "legalForm", "seat"],
  scalars: { "publication/meta/id": "id", "publication/content/testImport": "testImport" },
};

/** Identifiant d'avis (unique) et drapeau d'essai, communs à tous les profils. */
export function readIdAndTestImport(scanned: ScannedDetail): { id: string | null; testImport: boolean } {
  const ids = scanned.scalars.id ?? [];
  if (ids.length > 1) throw new FoscXmlError("identifiant d'avis répété");
  // Prudence : un seul « true » suffit à écarter l'avis.
  return { id: ids[0] || null, testImport: (scanned.scalars.testImport ?? []).includes("true") };
}

/** Lecture d'un avis HR (comportement inchangé depuis la relecture du 22.10.2026). */
export function parseAvisDetail(xml: string): AvisDetail {
  const scanned = scanDetail(xml, HR_PROFILE);
  const { id, testImport } = readIdAndTestImport(scanned);
  const toFields = (b: ScannedBlock): CompanyFields => ({
    uid: b.fields.uid ?? null,
    legalForm: b.fields.legalForm ?? null,
    seat: b.fields.seat ?? null,
    repeated: b.repeated.length > 0,
  });
  return {
    id,
    testImport,
    after: scanned.blocks.filter((b) => b.role === "after").map(toFields),
    before: scanned.blocks.filter((b) => b.role === "before").map(toFields),
  };
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
