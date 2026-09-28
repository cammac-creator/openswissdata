/**
 * Hiérarchie officielle du TARES, lue dans la structure tarifaire publiée par l'OFDF (Tarifstruktur).
 *
 * Une ligne à 8 chiffres ne se comprend souvent qu'avec ses ascendants : « non décaféiné » n'est du café
 * torréfié que parce qu'il se trouve sous la position 0901 et sous le texte intermédiaire « café torréfié ».
 * Ces textes intermédiaires (VT6, VT8) n'ont pas de numéro : `parseTarifstruktur` les écarte, ce module
 * les conserve et reconstruit le chemin de chaque ligne à partir du retrait officiel (« Einrueck »).
 *
 * Seules les désignations de la structure tarifaire sont lues : ni notes explicatives ni décisions
 * (conditions de redistribution de l'OFDF, voir `normalize.ts`).
 */
import xlsx from "../shared/xlsx.js";

export const TARES_LANGS = ["fr", "de", "it", "en"] as const;
export type TaresLang = (typeof TARES_LANGS)[number];

/** Types de lignes publiés : section, chapitre, sous-chapitre, position, textes intermédiaires, sous-positions, lignes. */
export const STRUCTURE_TYPES = ["TAB", "TN2", "TUK", "TN4", "VT6", "TN6", "VT8", "TN8"] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number];

export interface StructureLine {
  type: StructureType;
  /** Code sans point (« 09 », « 0901 », « 090190 », « 09012100 ») ; null pour les textes intermédiaires. */
  code: string | null;
  /** Retrait officiel ; 0 lorsqu'il est absent (section, chapitre, sous-chapitre, position, ligne sans position). */
  indent: number;
  text: Record<TaresLang, string>;
}

export interface TaresPath {
  hs8: string;
  chapter: StructureLine | null;
  /** Position à quatre chiffres ; null lorsque la ligne à 8 chiffres est elle-même la position (ex. 0903.0000 Maté). */
  heading: StructureLine | null;
  /** Ascendants entre la position et la ligne, du plus général au plus précis (VT6, TN6, VT8, TN8 de niveau supérieur). */
  steps: StructureLine[];
  leaf: StructureLine;
}

const HEADERS = ["Typ", "Numm", "Einrueck", "Text D", "Text F", "Text I", "Text E"] as const;

function cell(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

/** Lignes de la structure dans l'ordre du fichier, textes intermédiaires compris. */
export function readStructureLines(path: string): StructureLine[] {
  const workbook = xlsx.readFile(path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const table = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const headerIndex = table.findIndex((row) => HEADERS.every((h) => (row as unknown[]).map(cell).includes(h)));
  if (headerIndex < 0) throw new Error("Structure tarifaire : colonnes attendues absentes");
  const header = (table[headerIndex] as unknown[]).map(cell);
  const col = Object.fromEntries(HEADERS.map((h) => [h, header.indexOf(h)])) as Record<(typeof HEADERS)[number], number>;
  const lines: StructureLine[] = [];
  for (const raw of table.slice(headerIndex + 1)) {
    const row = raw as unknown[];
    const type = cell(row[col.Typ]);
    const texts = { fr: cell(row[col["Text F"]]), de: cell(row[col["Text D"]]), it: cell(row[col["Text I"]]), en: cell(row[col["Text E"]]) };
    if (!type) {
      if (Object.values(texts).some(Boolean) || cell(row[col.Numm])) throw new Error("Structure tarifaire : ligne sans type");
      continue;
    }
    if (!(STRUCTURE_TYPES as readonly string[]).includes(type)) throw new Error(`Structure tarifaire : type inconnu ${type}`);
    const indentCell = row[col.Einrueck];
    const indent = indentCell == null || indentCell === "" ? 0 : Number(indentCell);
    if (!Number.isInteger(indent) || indent < 0 || indent > 12) throw new Error("Structure tarifaire : retrait invalide");
    const numm = cell(row[col.Numm]).replace(/\./g, "");
    lines.push({ type: type as StructureType, code: numm || null, indent, text: texts });
  }
  return lines;
}

/**
 * Chemin de chaque ligne à 8 chiffres. Pile indexée par le retrait : une ligne de retrait k remplace
 * les entrées de retrait ≥ k. Section, chapitre, sous-chapitre et position vident la pile.
 */
export function buildTaresPaths(lines: readonly StructureLine[]): Map<string, TaresPath> {
  const paths = new Map<string, TaresPath>();
  let chapter: StructureLine | null = null;
  let heading: StructureLine | null = null;
  let stack: StructureLine[] = [];
  for (const line of lines) {
    switch (line.type) {
      case "TAB":
        chapter = null; heading = null; stack = [];
        break;
      case "TN2":
        if (!line.code || !/^\d{2}$/.test(line.code)) throw new Error("Structure tarifaire : chapitre invalide");
        chapter = line; heading = null; stack = [];
        break;
      case "TUK":
        // Sous-chapitre (ex. chapitre 28, « I. Éléments chimiques ») : il ne remplace pas le chapitre.
        heading = null; stack = [];
        break;
      case "TN4":
        if (!line.code || !/^\d{4}$/.test(line.code)) throw new Error("Structure tarifaire : position invalide");
        if (chapter?.code !== line.code.slice(0, 2)) throw new Error(`Structure tarifaire : position ${line.code} hors de son chapitre`);
        heading = line; stack = [];
        break;
      default: {
        if (line.type === "TN6" && (!line.code || !/^\d{6}$/.test(line.code))) throw new Error("Structure tarifaire : sous-position invalide");
        if ((line.type === "VT6" || line.type === "VT8") && line.code) throw new Error("Structure tarifaire : texte intermédiaire numéroté");
        stack = stack.filter((s) => s.indent < line.indent);
        if (line.type === "TN8") {
          const hs8 = line.code ?? "";
          if (!/^\d{8}$/.test(hs8)) throw new Error("Structure tarifaire : ligne tarifaire invalide");
          if (paths.has(hs8)) throw new Error(`Structure tarifaire : ligne ${hs8} en double`);
          if (chapter?.code !== hs8.slice(0, 2)) throw new Error(`Structure tarifaire : ligne ${hs8} hors de son chapitre`);
          // Une ligne sans retrait est sa propre position ; la position précédente ne s'applique plus.
          const ownHeading = heading?.code === hs8.slice(0, 4) && line.indent > 0 ? heading : null;
          if (!ownHeading && line.indent > 0) throw new Error(`Structure tarifaire : ligne ${hs8} sans sa position`);
          if (!ownHeading) stack = [];
          const steps = ownHeading ? [...stack] : [];
          for (const step of steps) {
            if (step.code && !hs8.startsWith(step.code)) throw new Error(`Structure tarifaire : ascendant ${step.code} incohérent pour ${hs8}`);
          }
          paths.set(hs8, { hs8, chapter, heading: ownHeading, steps, leaf: line });
          if (!ownHeading) heading = null;
        }
        stack.push(line);
      }
    }
  }
  return paths;
}

/** Texte lisible : espaces normalisés, césures conditionnelles retirées. */
export function cleanDesignation(text: string): string {
  return text.replace(/­/g, "").replace(/\s+/g, " ").trim();
}

/** Désignations du chemin dans une langue, de la position à la ligne ; repli sur le français si la langue manque. */
export function pathDesignations(path: TaresPath, lang: TaresLang, opts: { chapter?: boolean } = {}): string[] {
  const text = (line: StructureLine) => cleanDesignation(line.text[lang] || line.text.fr);
  const parts: string[] = [];
  if (opts.chapter && path.chapter) parts.push(text(path.chapter));
  if (path.heading) parts.push(text(path.heading));
  for (const step of path.steps) parts.push(text(step));
  parts.push(text(path.leaf));
  return parts.filter(Boolean);
}
