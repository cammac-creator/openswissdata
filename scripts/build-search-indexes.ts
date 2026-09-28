/**
 * Construit les index de recherche livrés avec le serveur MCP, à partir des fichiers officiels.
 *
 *   npx tsx scripts/build-search-indexes.ts --tares --tarifstruktur <Tarifstruktur.xlsx> [--cache <dossier>]
 *   npx tsx scripts/build-search-indexes.ts --noga [--noga-csv <noga_2025.csv>] [--cache <dossier>]
 *
 * TARES : structure tarifaire publiée par l'OFDF (lue dans le bronze daté de l'ETL ; son fichier
 * `.meta.json` voisin, s'il existe, fournit l'URL et la date de lecture). Une entrée par ligne à
 * 8 chiffres ; texte vectorisé = position › textes intermédiaires › ligne, dans les quatre langues.
 * NOGA 2025 : une entrée par genre (6 chiffres) ; texte vectorisé = libellé du genre, quatre langues
 * (les niveaux parents dégradent la mesure : voir docs/recherche-semantique.md) ; chemin complet
 * conservé pour l'affichage.
 * Un vecteur par entrée : moyenne renormalisée des vecteurs de ses quatre textes, encodée sur 8 bits.
 *
 * Préalable : `npm run models:prepare:embedding`. Même modèle, même révision et même moteur que les
 * requêtes. Écrit `src/mcp/data/embeddings/<nom>_index.{json,bin}` ; `--cache` réutilise des vecteurs
 * déjà calculés pour la même liste de textes (clé : empreinte de la révision et des textes).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import xlsx from "../etl/shared/xlsx.js";
import { BAZG_SOURCES } from "../etl/tares/sources.js";
import { buildTaresPaths, cleanDesignation, readStructureLines, type StructureLine } from "../etl/tares/hierarchy.js";
import { createEmbeddingExtractor, EMBEDDING_MODEL, EMBEDDING_REVISION } from "../src/lib/embedding-model.js";
import { encodeVector, INDEX_DIMENSIONS, INDEX_FORMAT, INDEX_RECORD_BYTES, meanVector, SEARCH_LANGS, type SearchIndexFile, type SearchIndexMeta } from "../src/mcp/search-index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = `${root}src/mcp/data/embeddings/`;
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const cacheDir = option("--cache");

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const MODEL: SearchIndexMeta["model"] = {
  id: EMBEDDING_MODEL, revision: EMBEDDING_REVISION, engine: "@huggingface/transformers 3.8.1", dtype: "q8",
  pooling: "mean", normalize: true, dimensions: INDEX_DIMENSIONS,
};

let extractor: Awaited<ReturnType<typeof createEmbeddingExtractor>> | null = null;
/** Vecteurs normalisés d'une liste de textes ; lots de 32 triés par longueur (moins de remplissage). */
async function embed(texts: string[], label: string): Promise<Float32Array[]> {
  const key = sha256(`${EMBEDDING_REVISION}\n${JSON.stringify(texts)}`);
  const cached = cacheDir ? `${cacheDir}/${key}.f32` : null;
  if (cached && existsSync(cached)) {
    const buf = readFileSync(cached);
    if (buf.length === texts.length * INDEX_DIMENSIONS * 4) {
      console.log(`[${label}] ${texts.length} vecteurs repris du cache`);
      const all = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
      return texts.map((_, i) => all.slice(i * INDEX_DIMENSIONS, (i + 1) * INDEX_DIMENSIONS));
    }
  }
  extractor ??= await createEmbeddingExtractor();
  const out = new Float32Array(texts.length * INDEX_DIMENSIONS);
  const order = texts.map((_, i) => i).sort((a, b) => texts[a].length - texts[b].length);
  const started = Date.now();
  for (let i = 0; i < order.length; i += 32) {
    const batch = order.slice(i, i + 32);
    const tensor = await extractor(batch.map((j) => texts[j]), { pooling: "mean", normalize: true });
    const flat = tensor.data as Float32Array;
    if (flat.length !== batch.length * INDEX_DIMENSIONS) throw new Error("Sortie du modèle de forme inattendue");
    batch.forEach((j, b) => out.set(flat.subarray(b * INDEX_DIMENSIONS, (b + 1) * INDEX_DIMENSIONS), j * INDEX_DIMENSIONS));
    if (i % 1600 === 0) console.log(`[${label}] ${i}/${texts.length} (${Math.round((Date.now() - started) / 1000)} s)`);
  }
  if (cached) { mkdirSync(cacheDir!, { recursive: true }); writeFileSync(cached, Buffer.from(out.buffer)); }
  console.log(`[${label}] ${texts.length} textes vectorisés en ${Math.round((Date.now() - started) / 1000)} s`);
  return texts.map((_, i) => out.slice(i * INDEX_DIMENSIONS, (i + 1) * INDEX_DIMENSIONS));
}

/** Nœuds dédoublonnés par textes (« autres », « andere »… une seule fois). */
class Nodes {
  readonly list: string[][] = [];
  private readonly ids = new Map<string, number>();
  add(texts: string[]): number {
    const key = JSON.stringify(texts);
    let id = this.ids.get(key);
    if (id === undefined) { id = this.list.length; this.list.push(texts); this.ids.set(key, id); }
    return id;
  }
}

async function write(name: string, meta: Omit<SearchIndexMeta, "vectors" | "built_at" | "format" | "format_version" | "model">, nodes: string[][], items: [string, number[]][], texts: string[][]) {
  // texts[entrée][langue] → un vecteur par langue, puis leur moyenne renormalisée : un vecteur par entrée.
  const perLang: Float32Array[][] = [];
  for (let l = 0; l < SEARCH_LANGS.length; l++) perLang.push(await embed(texts.map((t) => t[l]), `${name}:${SEARCH_LANGS[l]}`));
  const count = items.length;
  const bin = Buffer.alloc(count * INDEX_RECORD_BYTES);
  for (let e = 0; e < items.length; e++) encodeVector(meanVector(perLang.map((vectors) => vectors[e])), bin, e * INDEX_RECORD_BYTES);
  const file: SearchIndexFile = {
    format: INDEX_FORMAT, format_version: 1, ...meta, built_at: new Date().toISOString(), model: MODEL,
    vectors: {
      file: `${name}_index.bin`, bytes: bin.length, sha256: sha256(bin), encoding: "int8 par composante, échelle float32 par vecteur", count,
      per_entry: 1, combination: "moyenne renormalisée des vecteurs des textes FR, DE, IT et EN",
    },
    nodes, items,
  };
  writeFileSync(`${outDir}${name}_index.bin`, bin);
  writeFileSync(`${outDir}${name}_index.json`, JSON.stringify(file));
  console.log(`${name} : ${items.length} entrées (textes ${SEARCH_LANGS.join("/")} moyennés), vecteurs ${bin.length} octets, textes ${Buffer.byteLength(JSON.stringify(file))} octets`);
}

async function buildTares(structurePath: string) {
  const bytes = readFileSync(structurePath);
  const metaPath = `${structurePath}.meta.json`;
  const bronze = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) as { url: string; fetched_at: string; sha256: string; bytes: number; last_modified: string | null } : null;
  if (bronze && (bronze.sha256 !== sha256(bytes) || bronze.bytes !== bytes.length)) throw new Error("Structure tarifaire différente de son relevé de collecte");
  const book = xlsx.readFile(structurePath);
  const sheet = book.SheetNames[0];
  const header = (xlsx.utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, defval: null })[0] ?? []).map((c) => String(c ?? ""));
  const stand = header.find((c) => /Stand/.test(c))?.match(/(\d{2}\.\d{2}\.\d{4})/)?.[1];
  const paths = [...buildTaresPaths(readStructureLines(structurePath)).values()];

  const bundled = new Set((parse(readFileSync(`${root}src/mcp/data/tares.csv`, "utf8"), { columns: true }) as { hs8: string }[]).map((r) => r.hs8));
  const codes = new Set(paths.map((p) => p.hs8));
  const coverage = {
    structure_lines: paths.length,
    bundled_tares_lines: bundled.size,
    absent_from_bundled_tares: [...codes].filter((c) => !bundled.has(c)).length,
    bundled_lines_without_structure: [...bundled].filter((c) => !codes.has(c)).length,
  };
  if (coverage.absent_from_bundled_tares || coverage.bundled_lines_without_structure) console.warn("Couverture différente du TARES embarqué :", coverage);

  const nodes = new Nodes();
  const node = (line: StructureLine) => nodes.add(SEARCH_LANGS.map((l) => cleanDesignation(line.text[l])));
  const items: [string, number[]][] = [];
  const texts: string[][] = [];
  for (const p of paths) {
    const lines = [...(p.heading ? [p.heading] : []), ...p.steps, p.leaf];
    items.push([p.hs8, lines.map(node)]);
    texts.push(SEARCH_LANGS.map((l) => lines.map((x) => cleanDesignation(x.text[l] || x.text.fr)).join(" › ")));
  }
  await write("tares", {
    dataset: "tares",
    source: {
      name: "OFDF/BAZG Tarifstruktur.xlsx (structure tarifaire, désignations FR/DE/IT/EN)",
      url: bronze?.url ?? BAZG_SOURCES.tarifstruktur.url,
      version: `${sheet}${stand ? `, Stand ${stand}` : ""}`,
      sha256: sha256(bytes), bytes: bytes.length,
      ...(bronze ? { retrieved_at: bronze.fetched_at } : {}),
      ...(bronze?.last_modified ? { last_modified: bronze.last_modified } : {}),
    },
    text: { composition: "position › textes intermédiaires › ligne à 8 chiffres", languages: [...SEARCH_LANGS] },
    entries: items.length,
    coverage,
  }, nodes.list, items, texts);
}

async function buildNoga(csvPath: string) {
  type Row = { scheme: string; code: string; level: string; parent: string; label_fr: string; label_de: string; label_it: string; label_en: string };
  const bytes = readFileSync(csvPath);
  const rows = (parse(bytes.toString("utf8"), { columns: true }) as Row[]).filter((r) => r.scheme === "NOGA_2025");
  if (rows.length !== 1845) throw new Error(`NOGA 2025 : ${rows.length} lignes au lieu des 1 845 validées`);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const sources = parse(readFileSync(`${root}src/mcp/data/classification_sources.csv`, "utf8"), { columns: true }) as { source_id: string; url: string; version: string }[];
  const ofs = sources.find((s) => s.source_id === "ofs-noga2025");
  if (!ofs) throw new Error("Source OFS NOGA 2025 absente du référentiel embarqué");
  // Libellés de section en capitales : même sens, casse ordinaire pour le modèle ; césures conditionnelles retirées.
  const clean = (s: string) => { const t = cleanDesignation(s); return t === t.toUpperCase() && /\p{Lu}/u.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t; };
  const labels = (r: Row) => SEARCH_LANGS.map((l) => clean(r[`label_${l}`] || r.label_fr));
  const nodes = new Nodes();
  const items: [string, number[]][] = [];
  const texts: string[][] = [];
  for (const r of rows.filter((x) => x.level === "subclass")) {
    const chain: Row[] = [r];
    for (let p = byCode.get(r.parent); p; p = p.parent ? byCode.get(p.parent) : undefined) chain.unshift(p);
    if (chain[0].level !== "section" || chain.length !== 5) throw new Error(`NOGA 2025 : hiérarchie incomplète pour ${r.code}`);
    items.push([r.code, chain.map((x) => nodes.add(labels(x)))]);
    texts.push(labels(r));
  }
  await write("noga_2025", {
    dataset: "noga_2025",
    source: {
      name: `OFS NOGA 2025 (i14y), copie du dépôt ${basename(csvPath)}`,
      url: ofs.url, version: `référentiel classifications ${ofs.version}`, sha256: sha256(bytes), bytes: bytes.length,
    },
    text: { composition: "libellé du genre (6 chiffres) ; section, division, groupe et classe conservés pour l'affichage", languages: [...SEARCH_LANGS] },
    entries: items.length,
  }, nodes.list, items, texts);
}

if (args.includes("--tares")) {
  const structurePath = option("--tarifstruktur");
  if (!structurePath) throw new Error("--tarifstruktur <Tarifstruktur.xlsx> requis");
  await buildTares(structurePath);
}
if (args.includes("--noga")) await buildNoga(option("--noga-csv") ?? `${root}data/classifications/classifications-2026.04.29-test-work/noga_2025.csv`);
if (!args.includes("--tares") && !args.includes("--noga")) throw new Error("Préciser --tares et/ou --noga");
