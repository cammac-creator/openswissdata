/**
 * Outils de recherche sur des index fictifs, sans modèle : chemin officiel, langue d'affichage,
 * recherche par numéro, traçabilité (version des données et provenance de l'index).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as data from "../../src/mcp/data-loader.js";
import * as embedder from "../../src/mcp/embedder.js";
import { loadSearchIndex, type SearchIndex } from "../../src/mcp/search-index.js";
import { tariffNumberQuery, tariffSemanticSearchHandler, type TariffSemanticSearchResult } from "../../src/mcp/tools/tariff-semantic-search.js";
import { classifyTextHandler, nogaCodeQuery, type ClassifyTextResult } from "../../src/mcp/tools/classify-text.js";
import { listTools } from "../../src/mcp/server.js";
import { unit, writeFixtureIndex } from "../helpers/search-index.js";

let dir: string;
let tares: SearchIndex;
let noga: SearchIndex;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "osd-tools-"));
  writeFixtureIndex(dir, "tares", "tares",
    [["09012100", [0, 1, 2]], ["09012200", [0, 1, 3]], ["85076000", [4, 5]], ["99999999", [6]]],
    [
      ["Café, même torréfié", "Kaffee, auch geröstet", "Caffè, anche torrefatto", "Coffee, whether or not roasted"],
      ["café torréfié", "Kaffee, geröstet", "caffè torrefatto", "coffee, roasted"],
      ["non décaféiné", "nicht entkoffeiniert", "non decaffeinizzato", "not decaffeinated"],
      ["décaféiné", "entkoffeiniert", "decaffeinizzato", "decaffeinated"],
      ["Accumulateurs électriques", "Elektrische Akkumulatoren", "Accumulatori elettrici", "Electric accumulators"],
      ["au lithium-ion", "Lithium-Ionen-Akkumulatoren", "agli ioni di litio", "lithium-ion"],
      ["Ligne fictive retirée", "Fiktive Linie", "Linea fittizia", "Fictitious line"],
    ],
    [[unit(0), unit(1), unit(2), unit(3)], [unit(4), unit(5), unit(6), unit(7)], [unit(8), unit(9), unit(10), unit(11)], [unit(12), unit(13), unit(14), unit(15)]]);
  writeFixtureIndex(dir, "noga_2025", "noga_2025",
    [["107100", [0, 1, 2, 3, 3]], ["621000", [4, 5, 6, 7, 7]]],
    [
      ["Industrie manufacturière", "Verarbeitendes Gewerbe", "Attività manifatturiere", "Manufacturing"],
      ["Industries alimentaires", "Herstellung von Nahrungsmitteln", "Industrie alimentari", "Manufacture of food products"],
      ["Fabrication de produits de boulangerie", "Herstellung von Back- und Teigwaren", "Produzione di prodotti da forno", "Manufacture of bakery products"],
      ["Fabrication de pain", "Herstellung von Backwaren", "Produzione di pane", "Manufacture of bread"],
      ["Télécommunications, programmation", "Telekommunikation, Softwareentwicklung", "Telecomunicazioni, programmazione", "Telecommunication, programming"],
      ["Programmation", "Programmierung", "Programmazione", "Programming"],
      ["Programmation informatique", "Programmierungstätigkeiten", "Programmazione informatica", "Computer programming"],
      ["Activités de programmation informatique", "Programmierungstätigkeiten", "Attività di programmazione informatica", "Computer programming activities"],
    ],
    [[unit(20), unit(21), unit(22), unit(23)], [unit(30), unit(31), unit(32), unit(33)]]);
  tares = await loadSearchIndex("tares", "tares", dir);
  noga = await loadSearchIndex("noga_2025", "noga_2025", dir);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => { vi.restoreAllMocks(); data._resetDataLoaderCache(); });

describe("tariff_semantic_search", () => {
  it("rend le chemin officiel de la ligne dans la langue demandée, avec version TARES et provenance", async () => {
    vi.spyOn(data, "getTaresEmbeddings").mockResolvedValue(tares);
    vi.spyOn(embedder, "embedQuery").mockResolvedValue(unit(5, 4, 0.2)); // proche du texte allemand de 09012200
    const out = await tariffSemanticSearchHandler({ query: "Kaffee geröstet entkoffeiniert", top_k: 2, lang: "de" });
    const r = out.structured as TariffSemanticSearchResult;
    expect(r.method).toBe("hybrid");
    expect(r.hits[0]).toMatchObject({ hs_code: "09012200", description: "entkoffeiniert", path: ["Kaffee, auch geröstet", "Kaffee, geröstet"], in_current_tares: true });
    expect(r.hits[0].lexical_rank).not.toBeNull();
    expect(r.hits[0].score).toBeLessThanOrEqual(1);
    expect(r.data_version).toBeNull();
    expect(r.index).toMatchObject({ built_at: "2026-09-28T00:00:00.000Z", source_version: "fictive 1", entries: 4, languages: ["fr", "de", "it", "en"] });
    const text = out.content[0].text;
    expect(text).toContain("INOFFIZIELLER HINWEIS");
    expect(text).toContain("HS8 09012200 — Kaffee, auch geröstet › Kaffee, geröstet › entkoffeiniert");
    expect(text).toContain("TARES data version: bundled copy");
    expect(text).toContain("Index built 2026-09-28");
  });

  it("signale une ligne de l'index absente de la version TARES servie", async () => {
    vi.spyOn(data, "getTaresEmbeddings").mockResolvedValue(tares);
    vi.spyOn(embedder, "embedQuery").mockResolvedValue(unit(12));
    const r = (await tariffSemanticSearchHandler({ query: "ligne fictive", top_k: 1 })).structured as TariffSemanticSearchResult;
    expect(r.hits[0]).toMatchObject({ hs_code: "99999999", in_current_tares: false });
  });

  it("un numéro tarifaire liste ses lignes sans charger le modèle", async () => {
    vi.spyOn(data, "getTaresEmbeddings").mockResolvedValue(tares);
    const embed = vi.spyOn(embedder, "embedQuery");
    const out = await tariffSemanticSearchHandler({ query: "0901.2", lang: "en" });
    const r = out.structured as TariffSemanticSearchResult;
    expect(embed).not.toHaveBeenCalled();
    expect(r.method).toBe("tariff_number");
    expect(r.hits.map((h) => [h.hs_code, h.description, h.similarity])).toEqual([["09012100", "not decaffeinated", null], ["09012200", "decaffeinated", null]]);
    expect(out.content[0].text).toContain("UNOFFICIAL NOTICE");
    expect(tariffNumberQuery("8507.6000")).toBe("85076000");
    expect(tariffNumberQuery("café 0901")).toBeNull();
  });

  it("garde l'anglais, l'allemand et l'italien comme langues d'affichage, refuse les autres", async () => {
    expect((await tariffSemanticSearchHandler({ query: "café", lang: "es" })).isError).toBe(true);
  });
});

describe("classify_text", () => {
  it("rend un genre à 6 chiffres, sa classe et ses niveaux supérieurs, sans doublon classe/genre", async () => {
    vi.spyOn(data, "getNogaEmbeddings").mockResolvedValue(noga);
    vi.spyOn(embedder, "embedQuery").mockResolvedValue(unit(21, 30, 0.3));
    const out = await classifyTextHandler({ text: "Bäckerei mit Konditorei", top_k: 2, lang: "de" });
    const r = out.structured as ClassifyTextResult;
    expect(r.method).toBe("semantic");
    expect(r.hits.map((h) => h.code)).toEqual(["107100", "621000"]);
    expect(r.hits[0]).toMatchObject({ label: "Herstellung von Backwaren", class_code: "1071", path: ["Verarbeitendes Gewerbe", "Herstellung von Nahrungsmitteln", "Herstellung von Back- und Teigwaren", "Herstellung von Backwaren"] });
    expect(r.index.entries).toBe(2);
    expect(r.reference_version).toMatch(/^\d{4}\.\d{2}\.\d{2}/);
    expect(out.content[0].text).toContain("Classification reference version");
  });

  it("un code NOGA saisi liste ses genres sans charger le modèle", async () => {
    vi.spyOn(data, "getNogaEmbeddings").mockResolvedValue(noga);
    const embed = vi.spyOn(embedder, "embedQuery");
    const r = (await classifyTextHandler({ text: "62.10" })).structured as ClassifyTextResult;
    expect(embed).not.toHaveBeenCalled();
    expect(r.method).toBe("code");
    expect(r.hits.map((h) => [h.code, h.label])).toEqual([["621000", "Activités de programmation informatique"]]);
    expect(nogaCodeQuery("NOGA 1071")).toBe("1071");
    expect(nogaCodeQuery("boulangerie 1071")).toBeNull();
  });

  it("NACE 2.1 demandé : genres NOGA rendus et signalés, la classe à 4 chiffres étant la classe NACE", async () => {
    vi.spyOn(data, "getNogaEmbeddings").mockResolvedValue(noga);
    vi.spyOn(embedder, "embedQuery").mockResolvedValue(unit(30));
    const out = await classifyTextHandler({ text: "software development", scheme: "NACE_2.1", top_k: 1 });
    expect(out.structured).toMatchObject({ degraded: true, scheme_returned: "NOGA_2025", hits: [{ code: "621000", class_code: "6210" }] });
  });
});

describe("description des outils", () => {
  it("la liste complète des outils (jeton Pro) ne contient jamais « data » suivi de deux-points", () => {
    const text = JSON.stringify(listTools(() => true));
    expect(text).toContain("tariff_semantic_search");
    expect(text).toContain("finma_search");
    expect(text).not.toContain("data:");
  });
});
