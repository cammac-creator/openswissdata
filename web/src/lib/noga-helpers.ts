/**
 * NOGA helpers — chargement et agrégation des classifications NOGA 2025
 * + cross-walks NACE 2.0 / NACE 2.1 / ISIC Rev 4.
 *
 * Lecture stricte au build time (Astro SSG). Aucune dépendance runtime.
 * Libellés NOGA : huit champs identiques aux 1 845 lignes de l’archive signée 2026.09.25.
 * Relations : même référence sourcée que le MCP, dans src/mcp/data/.
 */
import { parse } from "csv-parse/sync";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { CLASSIFICATION_SCHEMES, resolveClassificationLinks, type ClassificationLink, type ClassificationSource, type ClassificationRelation } from "../../../src/lib/classification-links";

// Astro lance le build depuis web/. process.cwd() pointe donc sur web/.
// Le dataset est dans repo-root/data/classifications/...
const REPO_ROOT = resolve(process.cwd(), "..");
const DATA_DIR = resolve(
  REPO_ROOT,
  "data/classifications/classifications-2026.04.29-test-work",
);

// Les fiches existantes ne doivent pas disparaître silencieusement au build.
if (!existsSync(DATA_DIR)) throw new Error("Référentiel NOGA absent : publication interrompue.");

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

/** Lecture stricte, y compris les champs cités contenant des retours à la ligne. */
function parseCsv<T>(text: string): T[] {
  return parse(text, { columns: true, skip_empty_lines: true, bom: true }) as T[];
}

let _noga: NogaRow[] | null = null;
export function loadNoga2025(): NogaRow[] {
  if (_noga) return _noga;
  const raw = readFileSync(resolve(DATA_DIR, "noga_2025.csv"), "utf-8");
  const rows = parseCsv<NogaRow>(raw);
  if (rows.length !== 1845 || new Set(rows.map(r => r.code)).size !== rows.length) {
    throw new Error("Le référentiel NOGA a changé : contrôler les fiches avant publication.");
  }
  _noga = rows;
  return rows;
}

let reference: { links: ClassificationLink[]; sources: ClassificationSource[]; version: string } | undefined;
function getReference() {
  if (reference) return reference;
  const dir = resolve(REPO_ROOT, "src/mcp/data");
  const links = parseCsv<Record<string, string>>(readFileSync(resolve(dir, "classification_links.csv"), "utf8")) as unknown as ClassificationLink[];
  const sources = parseCsv<Record<string, string>>(readFileSync(resolve(dir, "classification_sources.csv"), "utf8")) as unknown as ClassificationSource[];
  const versions = new Set(sources.map(s => s.version));
  if (versions.size !== 1 || !sources.length || !links.length || sources.some(s => !/^https:\/\//.test(s.url) || !/^[a-f0-9]{64}$/.test(s.sha256) || !/^\d{4}\.\d{2}\.\d{2}$/.test(s.version)) ||
      links.some(l => !sources.some(s => s.source_id === l.source_id) ||
        !CLASSIFICATION_SCHEMES.includes(l.source_scheme) || !CLASSIFICATION_SCHEMES.includes(l.target_scheme) ||
        !l.source_code || !l.target_code || !["exactMatch", "closeMatch", "broadMatch", "narrowMatch", "relatedMatch"].includes(l.relation))) {
    throw new Error("Référentiel des correspondances incomplet ou de versions mélangées.");
  }
  reference = { links, sources, version: sources[0].version };
  return reference;
}
export function getClassificationReferenceVersion(): string { return getReference().version; }

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

/** Même résolution sourcée que le MCP, sans chaîner deux approximations. */
export interface ResolvedCrosswalk {
  standard: string;
  code: string;
  relation: ClassificationRelation;
  requires_review: boolean;
  sources: ClassificationSource[];
}
const resolved = new Map<string, ResolvedCrosswalk[]>();
export function getCrosswalksFor(code: string): ResolvedCrosswalk[] {
  const cached = resolved.get(code);
  if (cached) return cached;
  const ref = getReference();
  const result: ResolvedCrosswalk[] = [];
  for (const target of ["NACE_2.1", "NACE_2.0", "ISIC_4", "NOGA_2008"] as const) {
    for (const mapping of resolveClassificationLinks(ref.links, "NOGA_2025", code, target)) {
      const ids = new Set(mapping.path.map(step => step.source_id));
      result.push({ standard: target.replaceAll("_", " "), code: mapping.target_code,
        relation: mapping.relation, requires_review: mapping.requires_review,
        sources: ref.sources.filter(s => ids.has(s.source_id)) });
    }
  }
  resolved.set(code, result);
  return result;
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
