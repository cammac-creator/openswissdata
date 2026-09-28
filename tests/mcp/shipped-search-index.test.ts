/**
 * Index réellement livrés : provenance, couverture du TARES embarqué, recherche par numéro et
 * recherche par mots officiels (vecteur de requête nul : aucun modèle chargé).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { EMBEDDING_REVISION } from "../../src/lib/embedding-model.js";
import * as data from "../../src/mcp/data-loader.js";
import * as embedder from "../../src/mcp/embedder.js";
import { tariffSemanticSearchHandler, type TariffSemanticSearchResult } from "../../src/mcp/tools/tariff-semantic-search.js";
import { classifyTextHandler, type ClassifyTextResult } from "../../src/mcp/tools/classify-text.js";

afterEach(() => vi.restoreAllMocks());

describe("index TARES livré", () => {
  it("couvre exactement les lignes du TARES embarqué, avec sa source officielle et le modèle des requêtes", async () => {
    const index = await data.getTaresEmbeddings();
    const csv = parse(readFileSync(new URL("../../src/mcp/data/tares.csv", import.meta.url), "utf8"), { columns: true }) as { hs8: string }[];
    expect(new Set(index.codes)).toEqual(new Set(csv.map((r) => r.hs8)));
    expect(index.meta).toMatchObject({
      entries: 7511,
      model: { revision: EMBEDDING_REVISION, dimensions: 768 },
      text: { languages: ["fr", "de", "it", "en"] },
      vectors: { per_entry: 1, count: 7511 },
      source: { sha256: "5610cb42ce6aa92e0d8ab40afdebd48d5aab27b6307d3ee2f3ab56da88601126", version: "Struktur_01.03.2025, Stand 11.02.2025" },
      coverage: { absent_from_bundled_tares: 0, bundled_lines_without_structure: 0 },
    });
  });

  it("un numéro tarifaire rend la ligne avec son chemin officiel", async () => {
    const r = (await tariffSemanticSearchHandler({ query: "8507.6000", lang: "de" })).structured as TariffSemanticSearchResult;
    expect(r.hits[0]).toMatchObject({ hs_code: "85076000", description: "Lithium-Ionen-Akkumulatoren", in_current_tares: true });
    expect(r.hits[0].path[0]).toMatch(/^Elektrische Akkumulatoren/);
    const coffee = (await tariffSemanticSearchHandler({ query: "0901.21" })).structured as TariffSemanticSearchResult;
    expect(coffee.hits.map((h) => h.hs_code)).toEqual(["09012100"]);
    expect(coffee.hits[0].path).toContain("café torréfié");
  });

  it("grâce au chemin officiel, les mots seuls mènent au café même quand la ligne dit seulement « décaféiné »", async () => {
    // Vecteur de requête nul : seul l'index par mots classe. « nicht geröstet » partage aussi « geröstet » :
    // départager torréfié / non torréfié revient au sens (voir l'évaluation), pas aux mots.
    vi.spyOn(embedder, "embedQuery").mockResolvedValue(new Float32Array(768));
    for (const query of ["Kaffee geröstet", "caffè torrefatto", "roasted coffee"]) {
      const r = (await tariffSemanticSearchHandler({ query, top_k: 3 })).structured as TariffSemanticSearchResult;
      expect(r.hits.map((h) => h.hs_code.slice(0, 4)), query).toEqual(["0901", "0901", "0901"]);
      expect(r.hits[0].lexical_rank, query).toBe(1);
    }
  });
});

describe("index NOGA 2025 livré", () => {
  it("une entrée par genre, source OFS et version du référentiel ; un code liste ses genres", async () => {
    const index = await data.getNogaEmbeddings();
    expect(index.meta).toMatchObject({ entries: 798, vectors: { per_entry: 1, count: 798 }, source: { version: "référentiel classifications 2026.09.25" } });
    const r = (await classifyTextHandler({ text: "NOGA 71.11", lang: "en" })).structured as ClassifyTextResult;
    expect(r.hits.map((h) => h.code)).toEqual(["711101", "711102", "711103"]);
    expect(r.hits[0].path[0]).toBe("Professional, scientific and technical activities");
  });
});
