/** Index de recherche fictifs au format livré, pour les tests sans modèle. */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { EMBEDDING_MODEL, EMBEDDING_REVISION } from "../../src/lib/embedding-model.js";
import { encodeVector, INDEX_DIMENSIONS, INDEX_FORMAT, INDEX_RECORD_BYTES, SEARCH_LANGS, type SearchIndexFile } from "../../src/mcp/search-index.js";

/** Vecteur unitaire fictif : une composante principale, une secondaire. */
export function unit(main: number, secondary = -1, weight = 0): Float32Array {
  const v = new Float32Array(INDEX_DIMENSIONS);
  v[main] = 1;
  if (secondary >= 0) v[secondary] = weight;
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

/** Écrit un petit index fictif au format livré ; `vectors[entrée]` : un vecteur (langues combinées) ou un par langue. */
export function writeFixtureIndex(dir: string, name: string, dataset: "tares" | "noga_2025", items: [string, number[]][], nodes: string[][], vectors: Float32Array[][], override: Partial<SearchIndexFile> = {}): void {
  const perEntry = vectors[0]?.length ?? 1;
  const count = items.length * perEntry;
  const bin = Buffer.alloc(count * INDEX_RECORD_BYTES);
  vectors.forEach((perLang, e) => perLang.forEach((v, l) => encodeVector(v, bin, (e * perEntry + l) * INDEX_RECORD_BYTES)));
  const file: SearchIndexFile = {
    format: INDEX_FORMAT, format_version: 1, dataset, built_at: "2026-09-28T00:00:00.000Z",
    source: { name: "Fichier fictif", url: "https://example.test/source", version: "fictive 1", sha256: "0".repeat(64), bytes: 1 },
    model: { id: EMBEDDING_MODEL, revision: EMBEDDING_REVISION, engine: "test", dtype: "q8", pooling: "mean", normalize: true, dimensions: INDEX_DIMENSIONS },
    text: { composition: "fictive", languages: [...SEARCH_LANGS] },
    vectors: {
      file: `${name}_index.bin`, bytes: bin.length, sha256: createHash("sha256").update(bin).digest("hex"), encoding: "int8", count,
      per_entry: perEntry, combination: perEntry === 1 ? "moyenne des langues" : "un vecteur par langue",
    },
    entries: items.length, nodes, items, ...override,
  };
  writeFileSync(join(dir, `${name}_index.bin`), bin);
  writeFileSync(join(dir, `${name}_index.json`), JSON.stringify(file));
}

