import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMBEDDING_MODEL } from "../../src/lib/embedding-model.js";
import { TrigramIndex, trigrams } from "../../src/mcp/lexical-index.js";
import { encodeVector, INDEX_DIMENSIONS, INDEX_RECORD_BYTES, loadSearchIndex, meanVector, nodeText, semanticScores, type SearchIndexFile } from "../../src/mcp/search-index.js";
import { rankTariffLines, SEMANTIC_WEIGHT } from "../../src/mcp/tools/tariff-semantic-search.js";
import { unit, writeFixtureIndex } from "../helpers/search-index.js";

const NODES = [
  ["Café, même torréfié", "Kaffee, auch geröstet", "Caffè, anche torrefatto", "Coffee, whether or not roasted"],
  ["café torréfié", "Kaffee, geröstet", "caffè torrefatto", "coffee, roasted"],
  ["non décaféiné", "nicht entkoffeiniert", "non decaffeinizzato", "not decaffeinated"],
  ["Thé", "Tee", "Tè", "Tea"],
];
const ITEMS: [string, number[]][] = [["09012100", [0, 1, 2]], ["09021000", [3]]];

describe("index de recherche livré", () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });
  const fixture = (override: Partial<SearchIndexFile> = {}) => {
    dir = mkdtempSync(join(tmpdir(), "osd-index-"));
    writeFixtureIndex(dir, "tares", "tares", ITEMS, NODES, [[unit(0), unit(1), unit(2), unit(3)], [unit(10), unit(11), unit(12), unit(13)]], override);
    return dir;
  };

  it("lit les vecteurs int8 et garde le cosinus maximal parmi les langues de chaque entrée", async () => {
    const index = await loadSearchIndex("tares", "tares", fixture());
    expect(index.codes).toEqual(["09012100", "09021000"]);
    expect(nodeText(index, index.paths[0][1], "de")).toBe("Kaffee, geröstet");
    const scores = semanticScores(index, unit(2, 12, 0.5));
    // Entrée 0 : sa langue italienne (composante 2) ; entrée 1 : sa langue italienne (composante 12).
    expect(scores[0]).toBeCloseTo(1 / Math.hypot(1, 0.5), 2);
    expect(scores[1]).toBeCloseTo(0.5 / Math.hypot(1, 0.5), 2);
  });

  it("un vecteur par entrée : moyenne renormalisée des langues, lue telle quelle", async () => {
    dir = mkdtempSync(join(tmpdir(), "osd-index-"));
    const mean = meanVector([unit(0), unit(1), unit(2), unit(3)]);
    expect(Math.hypot(...mean)).toBeCloseTo(1, 5);
    writeFixtureIndex(dir, "tares", "tares", ITEMS, NODES, [[mean], [unit(10)]]);
    const index = await loadSearchIndex("tares", "tares", dir);
    expect(index.meta.vectors.per_entry).toBe(1);
    const scores = semanticScores(index, unit(1));
    expect(scores[0]).toBeCloseTo(0.5, 2);
    expect(scores[1]).toBeCloseTo(0, 2);
  });

  it("encode sans perte notable : écart de cosinus inférieur à 1 % sur un vecteur quelconque", () => {
    const v = new Float32Array(INDEX_DIMENSIONS).map((_, k) => Math.sin(k * 1.7) + 0.3 * Math.cos(k * 0.11));
    const norm = Math.hypot(...v);
    const unitV = v.map((x) => x / norm);
    const buf = Buffer.alloc(INDEX_RECORD_BYTES);
    encodeVector(unitV, buf, 0);
    const scale = buf.readFloatLE(0);
    let dot = 0;
    for (let k = 0; k < INDEX_DIMENSIONS; k++) dot += unitV[k] * buf.readInt8(4 + k) * scale;
    expect(Math.abs(dot - 1)).toBeLessThan(0.01);
  });

  it("refuse un index altéré, tronqué ou construit avec un autre modèle", async () => {
    const good = fixture();
    const bin = join(good, "tares_index.bin");
    const bytes = readFileSync(bin);
    bytes[10] ^= 1;
    writeFileSync(bin, bytes);
    await expect(loadSearchIndex("tares", "tares", good)).rejects.toThrow(/empreinte/);
    rmSync(good, { recursive: true, force: true });

    const other = fixture({ model: { id: EMBEDDING_MODEL, revision: "autre-revision", engine: "test", dtype: "q8", pooling: "mean", normalize: true, dimensions: INDEX_DIMENSIONS } });
    await expect(loadSearchIndex("tares", "tares", other)).rejects.toThrow(/modèle/);
    rmSync(other, { recursive: true, force: true });

    const short = fixture({ entries: 3 });
    await expect(loadSearchIndex("tares", "tares", short)).rejects.toThrow(/entrées/);
    rmSync(short, { recursive: true, force: true });

    const wrong = fixture();
    await expect(loadSearchIndex("tares", "noga_2025", wrong)).rejects.toThrow(/format/);
  });
});

describe("index lexical par trigrammes", () => {
  it("découpe en trigrammes bornés, sans accents ni mots vides", () => {
    expect(trigrams("Café de Noël")).toEqual([" ca", "caf", "afe", "fe ", " no", "noe", "oel", "el "]);
    expect(trigrams("les et the und")).toEqual([]);
  });

  it("classe d'abord le texte qui partage les trigrammes rares, y compris un mot composé", () => {
    const index = new TrigramIndex([
      "Meubles en bois des types utilisés dans les chambres à coucher | Holzmöbel für Schlafzimmer",
      "Palettes simples en bois | Flachpaletten aus Holz",
      "Caisses et cageots | Kisten und Verschläge",
    ]);
    expect(index.search("Holzpaletten").map((h) => h.doc)[0]).toBe(1);
    expect(index.search("Schlafzimmermöbel").map((h) => h.doc)[0]).toBe(0);
    expect(index.search("zzzz")).toEqual([]);
  });

  it("classe les mots officiels d'abord : le sens départage, sans supplanter un mot partagé", () => {
    // Ligne 0 : meilleur score de mots ; ligne 1 : meilleur sens, mots plus faibles ; ligne 2 : aucun mot commun.
    const similarity = Float32Array.from([0.40, 0.90, 0.95, 0.10, 0.20]);
    const { order, combined } = rankTariffLines(similarity, [{ doc: 0, score: 10 }, { doc: 1, score: 6 }]);
    expect(order.slice(0, 3)).toEqual([0, 1, 2]);
    expect(combined[0]).toBeLessThanOrEqual(1 + SEMANTIC_WEIGHT);
    // Scores de mots égaux : le sens décide.
    expect(rankTariffLines(similarity, [{ doc: 0, score: 5 }, { doc: 1, score: 5 }]).order[0]).toBe(1);
    // Aucun mot commun : ordre du sens seul.
    expect(rankTariffLines(similarity, []).order.slice(0, 3)).toEqual([2, 1, 0]);
  });
});
