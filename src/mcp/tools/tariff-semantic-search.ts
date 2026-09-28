/**
 * Tool: tariff_semantic_search
 *
 * Recherche d'une ligne du tarif douanier suisse (TARES) à partir d'une description libre en
 * français, allemand, italien ou anglais, ou d'un numéro tarifaire.
 *
 * Index (`data/embeddings/tares_index.*`, voir `search-index.ts`) : une entrée par ligne à 8 chiffres,
 * décrite par son chemin officiel (position › textes intermédiaires › ligne) dans les quatre langues.
 * Sans ce chemin, « non décaféiné » ou « autres » ne disait pas de quoi il s'agissait.
 *
 * Classement, mots d'abord (mesuré : docs/recherche-semantique.md) :
 *   - mots : BM25 sur les trigrammes des quatre chemins (mot rare, pluriel, mot composé allemand),
 *     divisé par le meilleur score de la requête (0 à 1) ;
 *   - sens : cosinus avec le vecteur de la ligne (moyenne de ses quatre textes, modèle figé), ramené
 *     entre la médiane et le maximum des lignes (0 à 1), pondéré par 0,3 : il départage et rattrape
 *     les synonymes sans supplanter un mot officiel partagé ;
 *   - aucune ligne ne partage un trigramme avec la requête : ordre du sens seul.
 * La fusion par rangs réciproques des deux listes, mesurée aussi, classait moins bien.
 * Une requête en forme de numéro (2 à 8 chiffres, points admis) liste les lignes de ce numéro.
 *
 * Chaque réponse indique la version TARES servie par ailleurs (tariff_lookup) et la provenance de
 * l'index (fichier officiel, sa version, date de construction). L'index n'est pas actualisé par
 * la publication hebdomadaire : une ligne absente des données servies est signalée.
 */

import { z } from "zod";
import { getTares, getTaresEmbeddings } from "../data-loader.js";
import { embedQuery, EMBEDDING_MODEL } from "../embedder.js";
import { reportSemanticFailure } from "../semantic-failure.js";
import { indexProvenance, nodeText, SEARCH_LANGS, semanticScores, type SearchIndex, type SearchLang } from "../search-index.js";

export const tariffSemanticSearchSchema = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 2, maxLength: 200, description: "Description of a good in French, German, Italian or English, or a Swiss tariff number (2 to 8 digits, dots allowed)" },
    top_k: { type: "integer", minimum: 1, maximum: 20, default: 5 },
    lang: { type: "string", enum: ["fr", "de", "it", "en"], default: "fr", description: "Language of the returned designations; the search itself covers all four languages" },
  },
  required: ["query"],
} as const;

const InputZ = z.object({
  query: z.string().min(2).max(200),
  top_k: z.number().int().min(1).max(20).default(5),
  lang: z.enum(SEARCH_LANGS).default("fr"),
});

const DISCLAIMERS: Record<SearchLang, string> = {
  fr: "AVIS NON-OFFICIEL : ces résultats sont une recherche sémantique sur une copie OpenSwissData du TARES (BAZG/OFDF). La concordance avec un code HS8 réel doit toujours être validée sur xtares.admin.ch. OpenSwissData ne garantit ni l'exactitude ni l'actualité, et n'est pas responsable des décisions douanières prises sur cette base.",
  de: "INOFFIZIELLER HINWEIS: Diese Ergebnisse sind eine semantische Suche in einer OpenSwissData-Kopie der TARES (BAZG/OFDF). Die Zuordnung zu einer Tarifnummer ist immer auf xtares.admin.ch zu prüfen. OpenSwissData garantiert weder Genauigkeit noch Aktualität und haftet nicht für daraus abgeleitete Zollentscheidungen.",
  it: "AVVISO NON UFFICIALE: questi risultati sono una ricerca semantica su una copia OpenSwissData del TARES (BAZG/UDSC). La corrispondenza con una voce di tariffa va sempre verificata su xtares.admin.ch. OpenSwissData non garantisce né l'esattezza né l'attualità e non è responsabile delle decisioni doganali prese su questa base.",
  en: "UNOFFICIAL NOTICE: these results are a semantic search over an OpenSwissData copy of TARES (BAZG/FOCBS). Always confirm the tariff number on xtares.admin.ch. OpenSwissData does not warrant accuracy or freshness and is not liable for any customs decision based on it.",
};

export interface TariffSemanticHit {
  hs_code: string;
  /** Désignation officielle de la ligne dans la langue demandée. */
  description: string;
  /** Ascendants officiels, de la position au texte le plus proche de la ligne. */
  path: string[];
  /** Pertinence relative 0–1 (mots d'abord, sens en appoint) ; ce n'est pas une probabilité. */
  score: number;
  /** Cosinus entre la requête et le vecteur de la ligne ; null pour une recherche par numéro. */
  similarity: number | null;
  /** Rang dans la liste par mots communs ; null si aucun mot ne correspond. */
  lexical_rank: number | null;
  /** Faux si la ligne manque dans la version TARES actuellement servie. */
  in_current_tares: boolean;
}

export interface TariffSemanticSearchResult {
  query: string;
  lang: SearchLang;
  method: "hybrid" | "tariff_number";
  hits: TariffSemanticHit[];
  count: number;
  model: string;
  /** Version TARES servie par ailleurs ; null = copie embarquée au déploiement. */
  data_version: string | null;
  index: ReturnType<typeof indexProvenance>;
  disclaimer: string;
}

/** Poids du sens face aux mots, fixé avant mesure ; stable de 0,15 à 1 sur le jeu d'évaluation. */
export const SEMANTIC_WEIGHT = 0.3;

/**
 * Ordre des lignes pour une requête libre : score des mots (normalisé) + SEMANTIC_WEIGHT × sens relatif.
 * Égalités départagées par le cosinus puis par l'ordre du tarif.
 */
export function rankTariffLines(similarity: Float32Array, lexical: readonly { doc: number; score: number }[]): { order: number[]; combined: Float64Array } {
  const size = similarity.length;
  const sorted = Float32Array.from(similarity).sort();
  const median = sorted[size >> 1];
  const max = sorted[size - 1];
  const span = max - median || 1;
  const combined = new Float64Array(size);
  const best = lexical[0]?.score ?? 0;
  for (const hit of lexical) combined[hit.doc] = hit.score / best;
  for (let doc = 0; doc < size; doc++) combined[doc] += SEMANTIC_WEIGHT * Math.min(1, Math.max(0, (similarity[doc] - median) / span));
  const order = [...combined.keys()].sort((a, b) => combined[b] - combined[a] || similarity[b] - similarity[a] || a - b);
  return { order, combined };
}

/** Numéro tarifaire saisi comme requête : 2 à 8 chiffres, points et espaces tolérés. */
export function tariffNumberQuery(query: string): string | null {
  const digits = query.replace(/[\s.]/g, "");
  return /^\d{2,8}$/.test(digits) ? digits : null;
}

const round = (x: number, digits = 4) => Number(x.toFixed(digits));

function hit(index: SearchIndex, entry: number, lang: SearchLang, current: ReadonlyMap<string, unknown>, extra: Pick<TariffSemanticHit, "score" | "similarity" | "lexical_rank">): TariffSemanticHit {
  const path = index.paths[entry];
  return {
    hs_code: index.codes[entry],
    description: nodeText(index, path[path.length - 1], lang),
    path: path.slice(0, -1).map((n) => nodeText(index, n, lang)),
    ...extra,
    in_current_tares: current.has(index.codes[entry]),
  };
}

export async function tariffSemanticSearchHandler(args: unknown): Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: TariffSemanticSearchResult;
}> {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const { query, top_k, lang } = parsed.data;
  const number = tariffNumberQuery(query);

  let index: SearchIndex;
  let queryVec: Float32Array | null = null;
  try {
    if (number) index = await getTaresEmbeddings();
    else [index, queryVec] = await Promise.all([getTaresEmbeddings(), embedQuery(query)]);
  } catch {
    reportSemanticFailure("tariff_semantic_search");
    return {
      content: [{ type: "text", text: "Recherche sémantique temporairement indisponible." }],
      isError: true,
    };
  }

  const { byHs8, version } = getTares();
  let hits: TariffSemanticHit[];
  if (number) {
    hits = index.codes
      .map((code, entry) => ({ code, entry }))
      .filter((e) => e.code.startsWith(number))
      .slice(0, top_k)
      .map((e) => hit(index, e.entry, lang, byHs8, { score: 1, similarity: null, lexical_rank: null }));
  } else {
    const similarity = semanticScores(index, queryVec!);
    const words = index.lexical().search(query);
    const lexicalRank = new Map(words.map((h, rank) => [h.doc, rank + 1]));
    const { order, combined } = rankTariffLines(similarity, words);
    hits = order.slice(0, top_k).map((entry) => hit(index, entry, lang, byHs8, {
      score: round(combined[entry] / (1 + SEMANTIC_WEIGHT), 3),
      similarity: round(similarity[entry]),
      lexical_rank: lexicalRank.get(entry) ?? null,
    }));
  }

  const provenance = indexProvenance(index);
  const result: TariffSemanticSearchResult = {
    query,
    lang,
    method: number ? "tariff_number" : "hybrid",
    hits,
    count: hits.length,
    model: EMBEDDING_MODEL,
    data_version: version,
    index: provenance,
    disclaimer: DISCLAIMERS[lang],
  };

  // Avis recopié dans le texte : un agent qui ne transmet que content[0].text le garde.
  const lines = [
    DISCLAIMERS[lang],
    "",
    number
      ? `Swiss tariff lines under ${number} — ${hits.length} shown:`
      : `Search for "${query}" — top ${hits.length} (official words first, meaning as a tie-breaker):`,
    ...hits.map((h) => {
      const context = h.path.length ? `${h.path.join(" › ")} › ` : "";
      const measure = h.similarity === null ? "" : ` (score ${h.score.toFixed(3)}, similarity ${h.similarity.toFixed(3)})`;
      return `  HS8 ${h.hs_code} — ${context}${h.description}${measure}${h.in_current_tares ? "" : " [absent from the TARES version currently served]"}`;
    }),
    ...(hits.length ? [] : ["  (no line)"]),
    "",
    `Index built ${provenance.built_at.slice(0, 10)} from ${provenance.source} (${provenance.source_version}), ${provenance.entries} lines in ${provenance.languages.join("/")}; model ${EMBEDDING_MODEL}.`,
    `TARES data version: ${version ?? "bundled copy (not refreshed since deployment)"}. Duties and conditions: call tariff_lookup with the tariff number.`,
  ];

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structured: result,
  };
}

export const tariffSemanticSearchTool = {
  name: "tariff_semantic_search",
  description:
    "Find Swiss customs tariff (TARES) lines from a description of the goods in French, German, Italian or English, or from a tariff number. Each line is indexed with its official hierarchy (heading, intermediate texts, 8-digit line) in the four languages; ranking puts shared official words first and uses meaning (pinned multilingual mpnet model) as a tie-breaker and for synonyms. Returns the 8-digit code, its official path, a relative score, the TARES data version and the index provenance. Always inlines a non-official disclaimer.",
  inputSchema: tariffSemanticSearchSchema,
  handler: tariffSemanticSearchHandler,
} as const;
