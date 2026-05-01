/**
 * NOGA helpers — chargement et agrégation des classifications NOGA 2025
 * + cross-walks NACE 2.0 / NACE 2.1 / ISIC Rev 4.
 *
 * Lecture stricte au build time (Astro SSG). Aucune dépendance runtime.
 * Source : data/classifications/classifications-2026.04.29-test-work/*.csv
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Astro lance le build depuis web/. process.cwd() pointe donc sur web/.
// Le dataset est dans repo-root/data/classifications/...
const REPO_ROOT = resolve(process.cwd(), "..");
const DATA_DIR = resolve(
  REPO_ROOT,
  "data/classifications/classifications-2026.04.29-test-work",
);

// Defensive: if the dataset is missing (e.g. partial clone, fresh CI runner
// without the data dir), emit a warning and let the loaders return empty
// arrays. Astro's getStaticPaths() then produces ZERO /codes/noga/* pages,
// but the rest of the site still builds. Better than failing the whole
// deploy on a missing optional asset.
const DATASET_AVAILABLE = existsSync(DATA_DIR);
if (!DATASET_AVAILABLE) {
  console.warn(
    `[noga-helpers] Classification dataset not found at ${DATA_DIR}. ` +
      `SEO programmatic pages (/codes/noga/*) will be skipped. ` +
      `cwd=${process.cwd()}`,
  );
}

export type Level = "section" | "division" | "group" | "class" | "subclass";

export interface NogaRow {
  scheme: string;
  code: string;
  level: Level;
  parent: string;
  label_fr: string;
  label_de: string;
  label_it: string;
  label_en: string;
}

export interface NaceRow {
  scheme: string;
  code: string;
  level: Level;
  parent: string;
  label_fr: string;
  label_de: string;
  label_it: string;
  label_en: string;
}

export interface IsicRow {
  scheme: string;
  code: string;
  level: Level;
  parent: string;
  label_fr: string;
  label_de: string;
  label_it: string;
  label_en: string;
}

export interface CrosswalkRow {
  noga_2008: string;
  noga_2025: string;
  nace_2_0: string;
  nace_2_1: string;
  isic_4: string;
  mapping_type: string;
  notes: string;
}

/**
 * Mini parseur CSV qui respecte les guillemets doubles (RFC 4180 simplifié).
 * Évite d'ajouter csv-parse comme dépendance dans web/.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

function parseCsv<T extends Record<string, string>>(text: string): T[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? "";
    }
    rows.push(row as T);
  }
  return rows;
}

let _noga: NogaRow[] | null = null;
let _nace21: NaceRow[] | null = null;
let _nace20: NaceRow[] | null = null;
let _isic: IsicRow[] | null = null;
let _crosswalks: CrosswalkRow[] | null = null;

export function loadNoga2025(): NogaRow[] {
  if (_noga) return _noga;
  if (!DATASET_AVAILABLE) { _noga = []; return _noga; }
  const raw = readFileSync(resolve(DATA_DIR, "noga_2025.csv"), "utf-8");
  _noga = parseCsv<NogaRow>(raw);
  return _noga;
}

export function loadNace21(): NaceRow[] {
  if (_nace21) return _nace21;
  if (!DATASET_AVAILABLE) { _nace21 = []; return _nace21; }
  const raw = readFileSync(resolve(DATA_DIR, "nace_2_1.csv"), "utf-8");
  _nace21 = parseCsv<NaceRow>(raw);
  return _nace21;
}

export function loadNace20(): NaceRow[] {
  if (_nace20) return _nace20;
  if (!DATASET_AVAILABLE) { _nace20 = []; return _nace20; }
  const raw = readFileSync(resolve(DATA_DIR, "nace_2_0.csv"), "utf-8");
  _nace20 = parseCsv<NaceRow>(raw);
  return _nace20;
}

export function loadIsic4(): IsicRow[] {
  if (_isic) return _isic;
  if (!DATASET_AVAILABLE) { _isic = []; return _isic; }
  const raw = readFileSync(resolve(DATA_DIR, "isic_4.csv"), "utf-8");
  _isic = parseCsv<IsicRow>(raw);
  return _isic;
}

export function loadCrosswalks(): CrosswalkRow[] {
  if (_crosswalks) return _crosswalks;
  if (!DATASET_AVAILABLE) { _crosswalks = []; return _crosswalks; }
  const raw = readFileSync(resolve(DATA_DIR, "crosswalks.csv"), "utf-8");
  _crosswalks = parseCsv<CrosswalkRow>(raw);
  return _crosswalks;
}

/**
 * Affiche un code NOGA en notation pointée pour l'humain.
 * 01 → 01 (division)
 * 011 → 01.1 (groupe)
 * 0111 → 01.11 (classe)
 * 011100 → 01.11.00 (sous-classe)
 */
export function dottedCode(code: string): string {
  if (code.length <= 2) return code;
  if (code.length === 3) return `${code.slice(0, 2)}.${code.slice(2)}`;
  if (code.length === 4)
    return `${code.slice(0, 2)}.${code.slice(2, 4)}`;
  if (code.length === 6)
    return `${code.slice(0, 2)}.${code.slice(2, 4)}.${code.slice(4, 6)}`;
  return code;
}

/**
 * Slug URL safe : on garde les chiffres bruts (les sections gardent leur lettre).
 */
export function slugCode(code: string): string {
  return code;
}

/**
 * Récupère un code par sa valeur brute.
 */
export function getNogaByCode(code: string): NogaRow | undefined {
  return loadNoga2025().find((r) => r.code === code);
}

/**
 * Hiérarchie : remonte tous les ancêtres jusqu'à la section.
 * Retourne dans l'ordre du plus haut (section) au plus bas (le code lui-même exclus).
 */
export function getAncestors(code: string): NogaRow[] {
  const all = loadNoga2025();
  const byCode = new Map(all.map((r) => [r.code, r]));
  const chain: NogaRow[] = [];
  let cur = byCode.get(code);
  while (cur && cur.parent) {
    const parent = byCode.get(cur.parent);
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  return chain;
}

/**
 * Enfants directs d'un code (1 niveau plus bas).
 */
export function getChildren(code: string): NogaRow[] {
  return loadNoga2025().filter((r) => r.parent === code);
}

/**
 * Codes voisins : fratrie (même parent) + cousins (autres groupes/divisions proches).
 * Retourne jusqu'à `limit` codes du même niveau, en ordre code croissant.
 */
export function getNeighbors(code: string, limit = 10): NogaRow[] {
  const all = loadNoga2025();
  const target = all.find((r) => r.code === code);
  if (!target) return [];
  // Fratrie
  const siblings = all
    .filter((r) => r.parent === target.parent && r.code !== code)
    .sort((a, b) => a.code.localeCompare(b.code));
  if (siblings.length >= limit) return siblings.slice(0, limit);
  // Étendre aux cousins (même niveau, parent différent)
  const cousins = all
    .filter(
      (r) =>
        r.level === target.level &&
        r.parent !== target.parent &&
        r.code !== code,
    )
    .sort((a, b) => {
      // proximité numérique : trier par |code-target|
      const da = Math.abs(numericPrefix(a.code) - numericPrefix(code));
      const db = Math.abs(numericPrefix(b.code) - numericPrefix(code));
      return da - db;
    });
  return [...siblings, ...cousins].slice(0, limit);
}

function numericPrefix(code: string): number {
  const n = parseInt(code, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Cross-walks d'un code NOGA 2025 vers les autres standards.
 * Retourne un tableau (peut être >1 si mapping multi).
 */
export interface ResolvedCrosswalk {
  noga_2008: string;
  noga_2008_label_fr: string;
  nace_2_0: string;
  nace_2_0_label_en: string;
  nace_2_1: string;
  nace_2_1_label_en: string;
  isic_4: string;
  isic_4_label_en: string;
  mapping_type: string;
  notes: string;
}

export function getCrosswalksFor(noga2025Code: string): ResolvedCrosswalk[] {
  const xw = loadCrosswalks().filter((r) => r.noga_2025 === noga2025Code);
  if (xw.length === 0) return [];

  const noga2008Index = new Map(
    loadNoga2025().map((r) => [r.code, r]), // fallback FR pour NOGA 2008 (mêmes labels souvent)
  );
  const nace21Index = new Map(loadNace21().map((r) => [r.code, r]));
  const nace20Index = new Map(loadNace20().map((r) => [r.code, r]));
  const isicIndex = new Map(loadIsic4().map((r) => [r.code, r]));

  return xw.map((row) => ({
    noga_2008: row.noga_2008,
    noga_2008_label_fr: noga2008Index.get(row.noga_2008)?.label_fr ?? "",
    nace_2_0: row.nace_2_0,
    nace_2_0_label_en: nace20Index.get(row.nace_2_0)?.label_en ?? "",
    nace_2_1: row.nace_2_1,
    nace_2_1_label_en: nace21Index.get(row.nace_2_1)?.label_en ?? "",
    isic_4: row.isic_4,
    isic_4_label_en: isicIndex.get(row.isic_4)?.label_en ?? "",
    mapping_type: row.mapping_type,
    notes: row.notes,
  }));
}

/**
 * Retourne les codes à inclure dans la génération SEO.
 * Par défaut : division, group, class (cible long-tail "code NOGA XX.XX").
 * Sections incluses pour la navigation (22 codes en plus).
 */
export function getSeoCodes(): NogaRow[] {
  const all = loadNoga2025();
  return all.filter(
    (r) =>
      r.level === "section" ||
      r.level === "division" ||
      r.level === "group" ||
      r.level === "class",
  );
}

/**
 * Sections (niveau 1) — pour l'index hiérarchique.
 */
export function getSections(): NogaRow[] {
  return loadNoga2025()
    .filter((r) => r.level === "section")
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Divisions sous une section donnée (lettre A-V).
 */
export function getDivisionsBySection(section: string): NogaRow[] {
  return loadNoga2025()
    .filter((r) => r.level === "division" && r.parent === section)
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Génère 4-5 phrases d'exemples concrets à partir du label NOGA.
 * Approche déterministe (pas d'IA) — basée sur des patterns de mots-clés.
 */
export function generateActivityExamples(noga: NogaRow): string[] {
  const label = noga.label_fr;
  const lower = label.toLowerCase();
  const examples: string[] = [];

  // Verbe d'attaque selon thème
  const isManufacturing =
    lower.includes("fabrication") ||
    lower.includes("production") ||
    lower.includes("industrie");
  const isService =
    lower.includes("service") ||
    lower.includes("activité") ||
    lower.includes("conseil");
  const isCommerce =
    lower.includes("commerce") ||
    lower.includes("vente") ||
    lower.includes("réparation");
  const isAgri =
    lower.includes("culture") ||
    lower.includes("élevage") ||
    lower.includes("pêche") ||
    lower.includes("forest");
  const isConstruction =
    lower.includes("construction") || lower.includes("bâtiment");
  const isFinance =
    lower.includes("banque") ||
    lower.includes("assurance") ||
    lower.includes("financier");

  examples.push(
    `Une entreprise dont l'activité principale relève de « ${label} » est classée sous le code NOGA ${dottedCode(
      noga.code,
    )}.`,
  );

  if (isManufacturing) {
    examples.push(
      `Cette catégorie regroupe les unités industrielles et ateliers qui transforment des matières premières ou des composants en produits finis ou semi-finis.`,
    );
    examples.push(
      `Sont concernées : usines, manufactures, fabriques, ateliers de production, lignes d'assemblage et sites de transformation.`,
    );
  } else if (isService) {
    examples.push(
      `Cette catégorie regroupe les sociétés de services, cabinets, agences et entreprises individuelles dont la prestation principale correspond à cette activité.`,
    );
    examples.push(
      `Sont concernées : sociétés de conseil, cabinets professionnels, prestataires indépendants et entreprises de services.`,
    );
  } else if (isCommerce) {
    examples.push(
      `Cette catégorie regroupe les commerces de gros et de détail, les revendeurs, distributeurs et points de vente concernés par cette activité.`,
    );
    examples.push(
      `Sont concernés : magasins, boutiques, e-commerces, grossistes, distributeurs et chaînes de revente.`,
    );
  } else if (isAgri) {
    examples.push(
      `Cette catégorie regroupe les exploitations agricoles, fermes, domaines et structures de production primaire concernés.`,
    );
    examples.push(
      `Sont concernés : exploitations familiales, domaines agricoles, coopératives de production et entreprises individuelles du secteur primaire.`,
    );
  } else if (isConstruction) {
    examples.push(
      `Cette catégorie regroupe les entreprises générales et de second œuvre, les artisans du bâtiment et les sociétés de génie civil.`,
    );
    examples.push(
      `Sont concernées : entreprises de construction, artisans, sous-traitants, bureaux techniques et sociétés de génie civil.`,
    );
  } else if (isFinance) {
    examples.push(
      `Cette catégorie regroupe les institutions financières, banques, assureurs, courtiers et sociétés de gestion concernés.`,
    );
    examples.push(
      `Sont concernés : banques, assureurs, sociétés de gestion d'actifs, courtiers, conseillers financiers et fintechs.`,
    );
  } else {
    examples.push(
      `Cette catégorie couvre l'ensemble des entreprises et entités dont l'activité économique principale correspond à cette description, quelle que soit leur taille.`,
    );
    examples.push(
      `Sont concernés : indépendants, PME, grandes entreprises, succursales et établissements suisses dont l'activité dominante relève de ce périmètre.`,
    );
  }

  examples.push(
    `Le code est attribué selon le principe de l'activité économique principale : si une entité a plusieurs activités, c'est celle qui génère le plus de valeur ajoutée qui détermine la classification.`,
  );

  return examples;
}
