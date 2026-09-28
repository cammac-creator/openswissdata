/**
 * Tool: finma_search
 *
 * Recherche d'un établissement dans le registre FINMA par son nom, avec variantes et fautes de frappe.
 *
 * Classement (le plus proche d'abord), repris du classement de kyc_check (`name-match.ts`) :
 *   exact > début sur un mot entier > mot entier > début de nom > sous-chaîne > tous les mots dans
 *   un autre ordre > faute de frappe. Une faute de frappe ne passe jamais devant une correspondance
 *   lexicale, et chaque résultat indique son type de correspondance (`match_type`).
 *
 * Comparaison sur une forme normalisée des deux côtés : casse, accents, ponctuation, formes
 * juridiques (AG, SA, Sàrl, GmbH, Ltd, S.A., société anonyme…) retirées ; « ä/ö/ü » comparés aussi
 * sous leur forme « ae/oe/ue » (« Julius Baer » trouve « Bank Julius Bär & Co. AG »).
 *
 * Coût borné : requête de 200 caractères et huit mots distincts au plus ; distance d'édition limitée
 * à 1 (mots de 4 à 7 lettres) ou 2 (8 lettres et plus), calculée une fois par mot distinct du
 * registre ; formes normalisées du registre calculées une fois par version chargée.
 */

import { z } from "zod";
import { getFinmaRegistry, getFinmaVersion, getFinmaWarnings } from "../data-loader.js";
import { foldName, MATCH_RANKS, nameMatcher } from "../name-match.js";

export const finmaSearchSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 2, maxLength: 200, description: "Entity name, or a distinctive part of it (typos, accents and legal forms such as AG/SA/Ltd are tolerated)" },
    top_k: { type: "integer", minimum: 1, maximum: 20, default: 5 },
    include_warnings: { type: "boolean", default: false, description: "Also search the FINMA warnings list" },
  },
  required: ["name"],
} as const;

const InputZ = z.object({
  name: z.string().min(2).max(200),
  top_k: z.number().int().min(1).max(20).default(5),
  include_warnings: z.boolean().default(false),
});

export const MAX_QUERY_TOKENS = 8;

/** Formes juridiques retirées des deux côtés ; « co » et « cie » seulement après le premier mot. */
const LEGAL_TOKENS = new Set([
  "ag", "sa", "gmbh", "sarl", "sagl", "srl", "spa", "sas", "ltd", "limited", "llc", "llp", "lp", "inc", "plc",
  "se", "nv", "bv", "kg", "kgaa", "scrl", "scma", "corp", "corporation", "aktiengesellschaft", "genossenschaft",
]);
const TRAILING_LEGAL_TOKENS = new Set(["co", "cie"]);
const LEGAL_PHRASES = [
  "societe anonyme", "societa anonima", "societe cooperative", "societa cooperativa", "societe a responsabilite limitee",
  "societa a responsabilita limitata", "in liquidation", "en liquidation", "in liquidazione",
];

/** Mots d'une forme repliée ; les lettres isolées successives sont réunies (« s a » → « sa », « s.à r.l. » → « sarl »). */
function words(folded: string): string[] {
  const raw = folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].length === 1 && i + 1 < raw.length && raw[i + 1].length === 1) {
      let merged = raw[i];
      while (i + 1 < raw.length && raw[i + 1].length === 1) merged += raw[++i];
      out.push(merged);
    } else out.push(raw[i]);
  }
  return out;
}

/** Nom réduit à l'essentiel : mots sans forme juridique ; le nom entier si rien d'autre ne reste. */
function coreWords(folded: string): string[] {
  let text = ` ${words(folded).join(" ")} `;
  for (const phrase of LEGAL_PHRASES) text = text.split(` ${phrase} `).join(" ");
  const all = text.trim().split(" ").filter(Boolean);
  const core = all.filter((w, i) => !LEGAL_TOKENS.has(w) && !(i > 0 && TRAILING_LEGAL_TOKENS.has(w)));
  return core.length ? core : all;
}

/** « ä/ö/ü/ß » écrits « ae/oe/ue/ss », puis accents retirés : « Bär » → « baer ». */
function transliterate(s: string): string {
  return foldName(s.normalize("NFC").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss"));
}

interface NameForms {
  /** Formes comparées : repliée, et translittérée si elle diffère. */
  cores: string[];
  words: Set<string>;
  size: number;
}

function formsOf(name: string): NameForms {
  const folded = coreWords(foldName(name));
  const translit = coreWords(transliterate(name));
  const cores = [...new Set([folded.join(" "), translit.join(" ")])];
  return { cores, words: new Set([...folded, ...translit]), size: folded.length };
}

/** Formes et vocabulaire d'une liste chargée ; recalculés automatiquement quand l'actualisation remplace la liste. */
const FORMS_CACHE = new WeakMap<readonly { name: string }[], { forms: NameForms[]; vocabulary: string[] }>();
function indexOf(rows: readonly { name: string }[]): { forms: NameForms[]; vocabulary: string[] } {
  let index = FORMS_CACHE.get(rows);
  if (!index) {
    const forms = rows.map((row) => formsOf(row.name));
    const vocabulary = [...new Set(forms.flatMap((f) => [...f.words]))];
    index = { forms, vocabulary };
    FORMS_CACHE.set(rows, index);
  }
  return index;
}

/** Distance d'édition avec transposition (Damerau restreinte), abandonnée au-delà de `max`. */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prevPrev[j - 2] + 1);
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = curr;
  }
  return prev[b.length];
}

/** Tolérance d'un mot de la requête : aucune sous 4 lettres, 1 jusqu'à 7 lettres, 2 au-delà. */
function tolerance(word: string): number {
  return word.length < 4 ? 0 : word.length < 8 ? 1 : 2;
}

export type FinmaMatchType = (typeof MATCH_RANKS)[number] | "fuzzy";
const TYPE_SCORE: Record<FinmaMatchType, number> = {
  exact: 1, word_start: 0.95, whole_word: 0.9, prefix: 0.85, substring: 0.8, all_words: 0.75, fuzzy: 0.7,
};

interface Ranked<T> { row: T; index: number; tier: number; distance: number; extra: number }

/** Mots comparés d'une requête brute : repliés, sans forme juridique, distincts, huit au plus. */
export function queryWordsOf(query: string): string[] {
  return [...new Set(coreWords(foldName(query)))].slice(0, MAX_QUERY_TOKENS);
}

/** Correspondances classées d'une liste (registre ou mises en garde) pour la requête brute. */
export function rankFinmaNames<T extends { name: string }>(rows: readonly T[], query: string): Ranked<T>[] {
  const queryWords = queryWordsOf(query);
  const translitWords = [...new Set(coreWords(transliterate(query)))].slice(0, MAX_QUERY_TOKENS);
  const needles = [...new Set([queryWords.join(" "), translitWords.join(" ")])].filter(Boolean);
  const matchers = needles.map((needle) => nameMatcher(needle));
  const { forms, vocabulary } = indexOf(rows);
  const aligned = translitWords.length === queryWords.length;

  // Mots proches de chaque mot de la requête, calculés une fois sur le vocabulaire distinct de la liste.
  const near = queryWords.map((word, i) => {
    const variants = [...new Set([word, aligned ? translitWords[i] : word])];
    const found = new Map<string, number>();
    const max = tolerance(word);
    for (const candidate of vocabulary) {
      let best = max + 1;
      for (const v of variants) best = Math.min(best, candidate === v ? 0 : max ? boundedEditDistance(v, candidate, max) : max + 1);
      if (best <= max) found.set(candidate, best);
    }
    return found;
  });

  const out: Ranked<T>[] = [];
  forms.forEach((form, index) => {
    let tier: number | null = null;
    for (const match of matchers) for (const core of form.cores) {
      const t = match(core);
      if (t !== null && (tier === null || t < tier)) tier = t;
    }
    let distance = 0;
    if (tier === null) {
      if (!queryWords.length) return;
      for (const candidates of near) {
        let best = Infinity;
        for (const word of form.words) {
          const d = candidates.get(word);
          if (d !== undefined && d < best) best = d;
        }
        if (best === Infinity) return;
        distance += best;
      }
      tier = MATCH_RANKS.length;
    }
    out.push({ row: rows[index], index, tier, distance, extra: Math.max(0, form.size - queryWords.length) });
  });
  return out.sort((a, b) => a.tier - b.tier || a.distance - b.distance || a.extra - b.extra || a.index - b.index);
}

function matchType(tier: number): FinmaMatchType {
  return tier < MATCH_RANKS.length ? MATCH_RANKS[tier] : "fuzzy";
}

function scoreOf(r: Ranked<unknown>): number {
  const type = matchType(r.tier);
  return type === "fuzzy" ? Number(Math.max(0.5, TYPE_SCORE.fuzzy - 0.05 * (r.distance - 1)).toFixed(2)) : TYPE_SCORE[type];
}

export interface FinmaSearchMatch {
  name: string;
  uid: string | null;
  lei: string | null;
  entity_type: string;
  licence_type: string;
  status: string;
  city: string;
  canton: string | null;
  is_warning_listed: boolean | null;
  source_url: string;
  /** Proximité selon le type de correspondance : 1 exact, 0.95 début de mot, … 0.7 et moins pour une faute de frappe. */
  score: number;
  match_type: FinmaMatchType;
}

export interface FinmaSearchWarning {
  name: string;
  warning_type: string;
  category: string;
  date_added: string;
  source_url: string;
  score: number;
  match_type: FinmaMatchType;
}

export interface FinmaSearchResult {
  query: string;
  /** Mots réellement comparés (huit au plus), sans formes juridiques ni accents. */
  normalised_query: string;
  matches: FinmaSearchMatch[];
  warnings?: FinmaSearchWarning[];
  match_count: number;
  /** Correspondances trouvées avant la limite top_k. */
  match_total: number;
  /** Version FINMA en mémoire ; null = copie embarquée au déploiement. */
  data_version: string | null;
  source: string;
}

const SOURCE = "FINMA public registers and warnings list (https://www.finma.ch), non-official copy";

export function finmaSearchHandler(args: unknown): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: FinmaSearchResult;
} {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const { name, top_k, include_warnings } = parsed.data;
  const normalised = queryWordsOf(name).join(" ");
  if (!normalised) {
    return {
      content: [{ type: "text", text: `Query reduces to empty after normalisation: "${name}"` }],
      isError: true,
    };
  }

  // Lecture synchrone du registre et des mises en garde, sans attente entre les deux (voir data-loader).
  const registry = getFinmaRegistry();
  const warningsList = include_warnings ? getFinmaWarnings() : null;
  const dataVersion = getFinmaVersion();

  const ranked = rankFinmaNames(registry, name);
  const matches: FinmaSearchMatch[] = ranked.slice(0, top_k).map((r) => ({
    name: r.row.name,
    uid: r.row.uid || null,
    lei: r.row.lei || null,
    entity_type: r.row.entity_type,
    licence_type: r.row.licence_type,
    status: r.row.status,
    city: r.row.city,
    canton: r.row.canton || null,
    is_warning_listed: null,
    source_url: r.row.source_url,
    score: scoreOf(r),
    match_type: matchType(r.tier),
  }));

  let warningMatches: FinmaSearchWarning[] | undefined;
  if (warningsList) {
    warningMatches = rankFinmaNames(warningsList, name).slice(0, top_k).map((r) => ({
      name: r.row.name,
      warning_type: r.row.warning_type,
      category: r.row.category,
      date_added: r.row.date_added,
      source_url: r.row.source_url,
      score: scoreOf(r),
      match_type: matchType(r.tier),
    }));
  }

  const result: FinmaSearchResult = {
    query: name,
    normalised_query: normalised,
    matches,
    ...(warningMatches ? { warnings: warningMatches } : {}),
    match_count: matches.length,
    match_total: ranked.length,
    data_version: dataVersion,
    source: SOURCE,
  };

  const lines: string[] = [];
  lines.push(`FINMA register search for "${name}" (compared as "${normalised}") — ${ranked.length} match(es)${ranked.length > matches.length ? `, closest ${matches.length} shown` : ""}:`);
  if (!matches.length) lines.push("  (none — no register name matches these words, even with one or two typos per word)");
  for (const m of matches) {
    lines.push(
      `  ${m.score.toFixed(2)} ${m.match_type}  ${m.name} (${m.entity_type}, ${m.licence_type}) — ${m.city || "?"} — ${m.uid || "no UID"}${m.lei ? ` — LEI ${m.lei}` : ""}`,
    );
  }
  if (warningMatches) {
    lines.push("");
    lines.push(`FINMA warnings list — ${warningMatches.length ? `closest ${warningMatches.length}` : "no match"}:`);
    for (const w of warningMatches) {
      lines.push(`  ${w.score.toFixed(2)} ${w.match_type}  ${w.name} (${w.warning_type}, added ${w.date_added})`);
    }
  }
  lines.push("");
  lines.push("A fuzzy match is a spelling guess, not an identity: check the UID. No result is not a compliance certificate.");
  lines.push(`Data version: ${dataVersion ?? "bundled copy (not refreshed since deployment)"}. Source: ${SOURCE}.`);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structured: result,
  };
}

export const finmaSearchTool = {
  name: "finma_search",
  description:
    "Search the FINMA register by entity name, tolerant of case, accents, legal forms (AG, SA, Sàrl, GmbH, Ltd), ae/oe/ue spellings and one or two typos per word. Results are ranked exact, word start, whole word, prefix, substring, all words in any order, then typo guesses, each labelled with match_type. Set include_warnings=true to also search the FINMA warnings list. Each answer states the FINMA data version.",
  inputSchema: finmaSearchSchema,
  handler: finmaSearchHandler,
} as const;
