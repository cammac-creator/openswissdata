/**
 * Tool: classify_text
 *
 * Description libre d'une activité → genres NOGA 2025 (6 chiffres) les plus proches.
 *
 * Index (`data/embeddings/noga_2025_index.*`, voir `search-index.ts`) : une entrée par genre, son
 * libellé officiel dans les quatre langues. Les niveaux supérieurs (section, division, groupe,
 * classe) accompagnent chaque résultat sans être ajoutés au texte vectorisé : mesuré sur le jeu
 * d'évaluation, les ajouter dégradait le classement (voir docs/recherche-semantique.md). Une classe
 * n'apparaît plus à côté de son genre identique : l'ancien index occupait deux places sur cinq
 * avec le même libellé.
 *
 * Score = cosinus maximal entre la description et les quatre libellés du genre (modèle figé partagé
 * avec tariff_semantic_search). Un code saisi (« 62.10 », « NOGA 1071 ») liste ses genres.
 *
 * Il n'existe pas de réponse officielle à une classification libre : le score aide à juger, il ne
 * remplace pas l'attribution par l'OFS (registre REE/BUR).
 */

import { z } from "zod";
import { getClassificationLinks, getNogaEmbeddings } from "../data-loader.js";
import { embedQuery, EMBEDDING_MODEL } from "../embedder.js";
import { reportSemanticFailure } from "../semantic-failure.js";
import { indexProvenance, nodeText, SEARCH_LANGS, semanticScores, type SearchIndex, type SearchLang } from "../search-index.js";

export const classifyTextSchema = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 5, maxLength: 500, description: "Business activity description in French, German, Italian or English, or a NOGA 2025 code (e.g. 62.10)" },
    top_k: { type: "integer", minimum: 1, maximum: 10, default: 3 },
    lang: { type: "string", enum: ["fr", "de", "it", "en"], default: "fr", description: "Language of the returned labels; the search itself covers all four languages" },
    scheme: { type: "string", enum: ["NOGA_2025", "NACE_2.1"], default: "NOGA_2025" },
  },
  required: ["text"],
} as const;

const InputZ = z.object({
  text: z.string().min(5).max(500),
  top_k: z.number().int().min(1).max(10).default(3),
  lang: z.enum(SEARCH_LANGS).default("fr"),
  scheme: z.enum(["NOGA_2025", "NACE_2.1"]).default("NOGA_2025"),
});

export interface ClassifyHit {
  /** Genre NOGA 2025 (6 chiffres). */
  code: string;
  label: string;
  /** Classe à 4 chiffres, identique à la classe NACE 2.1. */
  class_code: string;
  /** Libellés de la section, de la division, du groupe et de la classe. */
  path: string[];
  /** Cosinus maximal entre la description et les libellés du genre ; 1 pour un code saisi. */
  score: number;
  scheme: "NOGA_2025";
}

export interface ClassifyTextResult {
  query: string;
  scheme_requested: "NOGA_2025" | "NACE_2.1";
  scheme_returned: "NOGA_2025";
  method: "semantic" | "code";
  hits: ClassifyHit[];
  count: number;
  model: string;
  /** Version du référentiel de classifications servi par cross_walk ; null s'il est illisible. */
  reference_version: string | null;
  index: ReturnType<typeof indexProvenance>;
  /** True if the user requested a scheme other than NOGA_2025 (we still returned NOGA). */
  degraded?: boolean;
}

/** Code NOGA saisi comme texte : 2 à 6 chiffres, points et préfixe « NOGA » tolérés. */
export function nogaCodeQuery(text: string): string | null {
  const digits = text.trim().replace(/^noga(\s*2025)?\s*/i, "").replace(/[\s.]/g, "");
  return /^\d{2,6}$/.test(digits) ? digits : null;
}

function referenceVersion(): string | null {
  try {
    return getClassificationLinks().version;
  } catch {
    return null;
  }
}

function hit(index: SearchIndex, entry: number, lang: SearchLang, score: number): ClassifyHit {
  const path = index.paths[entry];
  const code = index.codes[entry];
  return {
    code,
    label: nodeText(index, path[path.length - 1], lang),
    class_code: code.slice(0, 4),
    path: path.slice(0, -1).map((n) => nodeText(index, n, lang)),
    score,
    scheme: "NOGA_2025",
  };
}

export async function classifyTextHandler(args: unknown): Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: ClassifyTextResult;
}> {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const { text, top_k, lang, scheme } = parsed.data;
  const code = nogaCodeQuery(text);

  let index: SearchIndex;
  let queryVec: Float32Array | null = null;
  try {
    if (code) index = await getNogaEmbeddings();
    else [index, queryVec] = await Promise.all([getNogaEmbeddings(), embedQuery(text)]);
  } catch {
    reportSemanticFailure("classify_text");
    return {
      content: [{ type: "text", text: "Recherche sémantique temporairement indisponible." }],
      isError: true,
    };
  }

  let hits: ClassifyHit[];
  if (code) {
    hits = index.codes
      .map((c, entry) => ({ c, entry }))
      .filter((e) => e.c.startsWith(code))
      .slice(0, top_k)
      .map((e) => hit(index, e.entry, lang, 1));
  } else {
    const scores = semanticScores(index, queryVec!);
    hits = [...scores.keys()]
      .sort((a, b) => scores[b] - scores[a] || a - b)
      .slice(0, top_k)
      .map((entry) => hit(index, entry, lang, Number(scores[entry].toFixed(4))));
  }

  const degraded = scheme !== "NOGA_2025";
  const provenance = indexProvenance(index);
  const reference = referenceVersion();
  const result: ClassifyTextResult = {
    query: text,
    scheme_requested: scheme,
    scheme_returned: "NOGA_2025",
    method: code ? "code" : "semantic",
    hits,
    count: hits.length,
    model: EMBEDDING_MODEL,
    reference_version: reference,
    index: provenance,
    ...(degraded ? { degraded: true } : {}),
  };

  const lines: string[] = [];
  if (degraded) {
    lines.push(
      `NOTE: scheme="${scheme}" requested but only NOGA 2025 is indexed. The 4-digit class_code is the NACE 2.1 class; use cross_walk for other correspondences.`,
    );
    lines.push("");
  }
  lines.push(code ? `NOGA 2025 subclasses under ${code} — ${hits.length} shown:` : `NOGA 2025 classification of "${text}" — top ${hits.length}:`);
  for (const h of hits) {
    const parent = h.path[h.path.length - 1];
    lines.push(`  ${h.score.toFixed(3)}  ${h.code} — ${h.label}${parent && parent !== h.label ? ` (class ${h.class_code}: ${parent})` : ` (class ${h.class_code})`}`);
  }
  if (!hits.length) lines.push("  (no NOGA 2025 code)");
  lines.push("");
  lines.push(`Index built ${provenance.built_at.slice(0, 10)} from ${provenance.source} (${provenance.source_version}), ${provenance.entries} subclasses in ${provenance.languages.join("/")}; model ${EMBEDDING_MODEL}.`);
  lines.push(`Classification reference version: ${reference ?? "unavailable"}. A similarity score is not an official classification by the Federal Statistical Office.`);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structured: result,
  };
}

export const classifyTextTool = {
  name: "classify_text",
  description:
    "Classify a business activity description (French, German, Italian or English) into the closest NOGA 2025 subclasses (6 digits) with their class (the NACE 2.1 class), official hierarchy and a similarity score, using a pinned multilingual mpnet model. A NOGA code as text lists its subclasses. Each answer states the index provenance and the classification reference version; combine with cross_walk for NACE, ISIC or NOGA 2008.",
  inputSchema: classifyTextSchema,
  handler: classifyTextHandler,
} as const;
