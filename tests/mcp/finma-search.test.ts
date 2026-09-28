import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boundedEditDistance, finmaSearchHandler, MAX_QUERY_TOKENS, type FinmaSearchResult } from "../../src/mcp/tools/finma-search.js";
import { _resetDataLoaderCache, getFinmaRegistry, setFinmaRegistry, setFinmaVersion, setFinmaWarnings, type FinmaRegistryRow, type FinmaWarningRow } from "../../src/mcp/data-loader.js";

function entity(name: string, uid = ""): FinmaRegistryRow {
  return {
    entity_type: "bank", name, uid, lei: "", licence_type: "Bank", licence_type_de: "Bank", licence_type_fr: "Banque",
    licence_type_it: "Banca", licence_date: "", status: "", canton: "", city: "Zürich", address: "", source_list: "fictif",
    source_url: "https://www.finma.ch/", is_warning_listed: "false",
  };
}
function warning(name: string): FinmaWarningRow {
  return { name, country: "", date_added: "2026-01-01", category: "fictif", source_url: "https://www.finma.ch/", source_list: "fictif", warning_type: "unauthorized_provider", additional_info: "" };
}
function search(name: string, extra: Record<string, unknown> = {}): FinmaSearchResult {
  const out = finmaSearchHandler({ name, top_k: 20, ...extra });
  expect(out.isError).not.toBe(true);
  return out.structured!;
}
const names = (r: FinmaSearchResult) => r.matches.map((m) => `${m.name} [${m.match_type}]`);

// Registre fictif : noms inventés, structure identique au registre publié.
const REGISTRY = [
  "Banque Exemple du Clos SA", "Exemple Fonds (Suisse) AG", "Exemple AG", "Exemple Switzerland AG", "Vieille Exemplerie Sàrl",
  "Bank Muster Bär & Co. AG", "Muster Bär Family Office AG", "Zürcher Musterbank", "Luzerner Musterbank AG", "Musterbank Basler",
  "Postmuster AG", "Treuhand Beispiel GmbH", "Beispiel Treuhand S.A.",
].map((n, i) => entity(n, `CHE-000.000.${String(i).padStart(3, "0")}`));

describe("finma_search : classement", () => {
  beforeEach(() => {
    _resetDataLoaderCache();
    setFinmaRegistry(REGISTRY);
    setFinmaWarnings([warning("exemple-invest.example"), warning("Muster Crypto Ltd")]);
  });
  afterEach(() => _resetDataLoaderCache());

  it("classe exact, début de mot, mot entier, sous-chaîne, puis faute de frappe, sans jamais inverser", () => {
    const r = search("Exemple");
    expect(names(r)).toEqual([
      "Exemple AG [exact]",
      "Exemple Switzerland AG [word_start]",
      "Exemple Fonds (Suisse) AG [word_start]",
      "Banque Exemple du Clos SA [whole_word]",
      "Vieille Exemplerie Sàrl [substring]",
    ]);
    expect(r.matches.map((m) => m.score)).toEqual([1, 0.95, 0.95, 0.9, 0.8]);
  });

  it("ignore les formes juridiques des deux côtés, pas les mots qui distinguent deux entités", () => {
    expect(names(search("Exemple Switzerland SA"))[0]).toBe("Exemple Switzerland AG [exact]");
    expect(names(search("Beispiel Treuhand SA"))[0]).toBe("Beispiel Treuhand S.A. [exact]");
    expect(names(search("Treuhand Beispiel Sàrl"))[0]).toBe("Treuhand Beispiel GmbH [exact]");
  });

  it("compare « ä/ö/ü » aussi sous la forme « ae/oe/ue », dans les deux sens", () => {
    expect(names(search("Zuercher Musterbank"))).toEqual(["Zürcher Musterbank [exact]"]);
    expect(names(search("zurcher musterbank"))).toEqual(["Zürcher Musterbank [exact]"]);
    expect(names(search("Muster Baer"))).toEqual(["Muster Bär Family Office AG [word_start]", "Bank Muster Bär & Co. AG [whole_word]"]);
  });

  it("tolère une faute par mot, toujours après les correspondances exactes et étiquetée comme telle", () => {
    const typo = search("Postmustre");
    expect(names(typo)).toEqual(["Postmuster AG [fuzzy]"]);
    expect(typo.matches[0].score).toBeLessThan(0.75);
    expect(names(search("Luzerner Musterbnak"))).toEqual(["Luzerner Musterbank AG [fuzzy]"]);
    // Mots dans un autre ordre : correspondance lexicale, avant toute supposition de frappe.
    expect(names(search("Basler Musterbank"))[0]).toBe("Musterbank Basler [all_words]");
  });

  it("ne rend rien plutôt qu'un nom sans rapport quand aucun mot ne correspond", () => {
    const r = search("Banque Imaginaire du Léman");
    expect(r.matches).toEqual([]);
    expect(r.match_total).toBe(0);
    expect(finmaSearchHandler({ name: "Banque Imaginaire du Léman" }).content[0].text).toContain("(none");
  });

  it("recherche aussi la liste des mises en garde, avec le même classement", () => {
    const r = search("muster crypto", { include_warnings: true });
    expect(r.warnings?.map((w) => `${w.name} [${w.match_type}]`)).toEqual(["Muster Crypto Ltd [exact]"]);
  });

  it("indique la version des données servies : copie embarquée, puis version actualisée", () => {
    expect(search("Exemple").data_version).toBeNull();
    expect(finmaSearchHandler({ name: "Exemple" }).content[0].text).toContain("bundled copy");
    setFinmaVersion("2026.09.28");
    expect(search("Exemple").data_version).toBe("2026.09.28");
    expect(finmaSearchHandler({ name: "Exemple" }).content[0].text).toContain("Data version: 2026.09.28");
  });

  it("suit le remplacement du registre par l'actualisation, sans garder l'ancien index", () => {
    expect(names(search("Postmuster"))).toEqual(["Postmuster AG [exact]"]);
    setFinmaRegistry([entity("Postmuster Nouvelle AG")]);
    expect(names(search("Postmuster"))).toEqual(["Postmuster Nouvelle AG [word_start]"]);
  });
});

describe("finma_search : entrée bornée", () => {
  beforeEach(() => _resetDataLoaderCache());
  afterEach(() => _resetDataLoaderCache());

  it("refuse plus de 200 caractères et ne compare que les huit premiers mots distincts", () => {
    expect(finmaSearchHandler({ name: "a".repeat(201) }).isError).toBe(true);
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliett"];
    const r = search(words.join(" "));
    expect(r.normalised_query.split(" ")).toEqual(words.slice(0, MAX_QUERY_TOKENS));
  });

  it("une requête longue de mots proches du registre réel reste rapide (pas de coût quadratique)", () => {
    const registry = getFinmaRegistry();
    expect(registry.length).toBeGreaterThan(2000);
    const query = "Kantonalbenk Raiffeisenbenk Versicherungsgesellschaft Vermoegensverwaltung Beteiligungsgesellschaft Treuhandgesellschaft Investmentgesellschaft Lebensversicherungsgesellschaft".slice(0, 200);
    finmaSearchHandler({ name: query, include_warnings: true }); // préparation de l'index du registre
    const started = performance.now();
    finmaSearchHandler({ name: query, include_warnings: true });
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it("distance d'édition bornée : transposition comptée une fois, abandon au-delà du seuil", () => {
    expect(boundedEditDistance("kantonalbnak", "kantonalbank", 2)).toBe(1);
    expect(boundedEditDistance("postfinanse", "postfinance", 1)).toBe(1);
    expect(boundedEditDistance("vontobel", "vontobell", 1)).toBe(1);
    expect(boundedEditDistance("abcdefgh", "zyxwvuts", 2)).toBe(3);
    expect(boundedEditDistance("court", "beaucoup plus long", 2)).toBe(3);
  });
});
