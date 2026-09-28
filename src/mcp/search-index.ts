/**
 * Index de recherche livrés avec le serveur MCP (TARES et NOGA 2025).
 *
 * Deux fichiers par index dans `data/embeddings/` :
 *   - `<nom>_index.json` : métadonnées (source et sa version, modèle, date de construction, empreinte
 *     des vecteurs), textes officiels des nœuds dans les quatre langues et chemin de chaque entrée ;
 *   - `<nom>_index.bin` : `per_entry` vecteurs par entrée, dans l'ordre des entrées, chacun sur 772 octets
 *     (échelle float32 little-endian puis 768 composantes int8 ; valeur ≈ échelle × composante).
 *     Index livrés : un vecteur par entrée, moyenne renormalisée des vecteurs de ses quatre textes
 *     (FR, DE, IT, EN) ; mesurée au moins aussi juste qu'un vecteur par langue, quatre fois plus petite.
 *
 * Le chargement vérifie taille, SHA-256, modèle, révision et dimension avant usage : un index
 * incomplet, altéré ou construit avec un autre modèle est refusé (message fixe côté outil).
 * Construction : `scripts/build-search-indexes.ts`.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EMBEDDING_MODEL, EMBEDDING_REVISION } from "../lib/embedding-model.js";
import { TrigramIndex } from "./lexical-index.js";

export const SEARCH_LANGS = ["fr", "de", "it", "en"] as const;
export type SearchLang = (typeof SEARCH_LANGS)[number];
export const INDEX_DIMENSIONS = 768;
export const INDEX_RECORD_BYTES = 4 + INDEX_DIMENSIONS;
export const INDEX_FORMAT = "openswissdata-search-index";

export interface SearchIndexMeta {
  format: typeof INDEX_FORMAT;
  format_version: 1;
  dataset: "tares" | "noga_2025";
  built_at: string;
  /** Fichier officiel lu, sa version publiée et son empreinte. */
  source: { name: string; url: string; version: string; sha256: string; bytes: number; retrieved_at?: string; last_modified?: string };
  model: { id: string; revision: string; engine: string; dtype: string; pooling: string; normalize: boolean; dimensions: number };
  /** Composition des textes vectorisés et langues présentes, dans l'ordre des vecteurs. */
  text: { composition: string; languages: SearchLang[] };
  /** `per_entry` : 1 (langues combinées, voir `combination`) ou un vecteur par langue, dans l'ordre de `languages`. */
  vectors: { file: string; bytes: number; sha256: string; encoding: string; count: number; per_entry: number; combination: string };
  entries: number;
  coverage?: Record<string, number | string>;
}

export interface SearchIndexFile extends SearchIndexMeta {
  /** Textes officiels d'un nœud dans l'ordre de `SEARCH_LANGS`. */
  nodes: string[][];
  /** Code de l'entrée et ses nœuds, du plus général à l'entrée elle-même. */
  items: [string, number[]][];
}

export interface SearchIndex {
  meta: SearchIndexMeta;
  codes: string[];
  paths: number[][];
  nodes: string[][];
  byCode: Map<string, number>;
  vectors: Int8Array;
  scales: Float32Array;
  /** Index lexical des chemins dans les quatre langues, construit au premier usage. */
  lexical(): TrigramIndex;
}

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "data", "embeddings");

/** Texte d'un nœud dans une langue ; repli sur le français si la langue manque. */
export function nodeText(index: Pick<SearchIndex, "nodes">, node: number, lang: SearchLang): string {
  const texts = index.nodes[node];
  return texts[SEARCH_LANGS.indexOf(lang)] || texts[0];
}

/** Lit et contrôle un index livré ; toute incohérence lève une erreur sans servir de résultat partiel. */
export async function loadSearchIndex(name: string, dataset: SearchIndexMeta["dataset"], dir = DATA_DIR): Promise<SearchIndex> {
  const file = JSON.parse(await readFile(join(dir, `${name}_index.json`), "utf8")) as SearchIndexFile;
  const { nodes, items, ...meta } = file;
  if (meta.format !== INDEX_FORMAT || meta.format_version !== 1 || meta.dataset !== dataset) throw new Error("Index de recherche : format inattendu");
  if (meta.model.id !== EMBEDDING_MODEL || meta.model.revision !== EMBEDDING_REVISION || meta.model.dimensions !== INDEX_DIMENSIONS) {
    throw new Error("Index de recherche : modèle différent de celui des requêtes");
  }
  const languages = meta.text.languages;
  if (!languages.length || languages.some((l) => !SEARCH_LANGS.includes(l)) || new Set(languages).size !== languages.length) throw new Error("Index de recherche : langues invalides");
  const perEntry = meta.vectors.per_entry;
  if (perEntry !== 1 && perEntry !== languages.length) throw new Error("Index de recherche : vecteurs par entrée invalides");
  if (!Array.isArray(items) || items.length !== meta.entries || meta.vectors.count !== meta.entries * perEntry) throw new Error("Index de recherche : nombre d'entrées incohérent");
  if (meta.vectors.file !== `${name}_index.bin`) throw new Error("Index de recherche : fichier de vecteurs inattendu");
  const bytes = await readFile(join(dir, meta.vectors.file));
  if (bytes.length !== meta.vectors.bytes || bytes.length !== meta.vectors.count * INDEX_RECORD_BYTES) throw new Error("Index de recherche : taille des vecteurs incohérente");
  if (createHash("sha256").update(bytes).digest("hex") !== meta.vectors.sha256) throw new Error("Index de recherche : empreinte des vecteurs différente");
  if (!Array.isArray(nodes) || nodes.some((texts) => !Array.isArray(texts) || texts.length !== SEARCH_LANGS.length || !texts[0])) throw new Error("Index de recherche : textes invalides");

  const vectors = new Int8Array(meta.vectors.count * INDEX_DIMENSIONS);
  const scales = new Float32Array(meta.vectors.count);
  for (let v = 0; v < meta.vectors.count; v++) {
    const at = v * INDEX_RECORD_BYTES;
    scales[v] = bytes.readFloatLE(at);
    vectors.set(new Int8Array(bytes.buffer, bytes.byteOffset + at + 4, INDEX_DIMENSIONS), v * INDEX_DIMENSIONS);
  }
  const codes = items.map(([code]) => code);
  const paths = items.map(([, path]) => path);
  if (paths.some((path) => !path.length || path.some((n) => !Number.isInteger(n) || n < 0 || n >= nodes.length))) throw new Error("Index de recherche : chemin invalide");
  const byCode = new Map(codes.map((code, i) => [code, i]));
  if (byCode.size !== codes.length) throw new Error("Index de recherche : code en double");

  let lexical: TrigramIndex | null = null;
  const index: SearchIndex = {
    meta, codes, paths, nodes, byCode, vectors, scales,
    lexical: () => (lexical ??= new TrigramIndex(paths.map((path) => SEARCH_LANGS.map((_, l) => path.map((n) => nodes[n][l] || nodes[n][0]).join(" › ")).join(" | ")))),
  };
  return index;
}

/** Encodage d'un vecteur normalisé : échelle symétrique propre au vecteur, composantes arrondies sur 8 bits. */
export function encodeVector(vector: ArrayLike<number>, out: Buffer, offset: number): void {
  if (vector.length !== INDEX_DIMENSIONS) throw new Error("Vecteur de dimension inattendue");
  let max = 0;
  for (let k = 0; k < INDEX_DIMENSIONS; k++) max = Math.max(max, Math.abs(vector[k]));
  const scale = max > 0 ? max / 127 : 1;
  out.writeFloatLE(scale, offset);
  for (let k = 0; k < INDEX_DIMENSIONS; k++) out.writeInt8(Math.max(-127, Math.min(127, Math.round(vector[k] / scale))), offset + 4 + k);
}

/** Similarité de chaque entrée avec la requête : cosinus (maximum parmi ses vecteurs s'il y en a plusieurs). */
export function semanticScores(index: SearchIndex, query: Float32Array): Float32Array {
  if (query.length !== INDEX_DIMENSIONS) throw new Error("Requête de dimension inattendue");
  const perEntry = index.meta.vectors.per_entry;
  const scores = new Float32Array(index.meta.entries).fill(-Infinity);
  const { vectors, scales } = index;
  for (let v = 0; v < index.meta.vectors.count; v++) {
    let dot = 0;
    const base = v * INDEX_DIMENSIONS;
    for (let k = 0; k < INDEX_DIMENSIONS; k++) dot += query[k] * vectors[base + k];
    const score = dot * scales[v];
    const entry = (v / perEntry) | 0;
    if (score > scores[entry]) scores[entry] = score;
  }
  return scores;
}

/** Moyenne de vecteurs normalisés, renormalisée : un seul vecteur pour les textes d'une entrée dans plusieurs langues. */
export function meanVector(vectors: readonly ArrayLike<number>[]): Float32Array {
  const mean = new Float32Array(INDEX_DIMENSIONS);
  for (const v of vectors) for (let k = 0; k < INDEX_DIMENSIONS; k++) mean[k] += v[k];
  let norm = 0;
  for (let k = 0; k < INDEX_DIMENSIONS; k++) norm += mean[k] * mean[k];
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < INDEX_DIMENSIONS; k++) mean[k] /= norm;
  return mean;
}

/** Métadonnées utiles à la traçabilité d'une réponse (sans les textes). */
export function indexProvenance(index: SearchIndex): {
  built_at: string; source: string; source_version: string; source_sha256: string; entries: number; languages: SearchLang[]; model: string; model_revision: string;
} {
  const { meta } = index;
  return {
    built_at: meta.built_at,
    source: meta.source.name,
    source_version: meta.source.version,
    source_sha256: meta.source.sha256,
    entries: meta.entries,
    languages: meta.text.languages,
    model: meta.model.id,
    model_revision: meta.model.revision,
  };
}
