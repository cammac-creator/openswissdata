/**
 * Fiches Atlas TARES, classifications et bundle : prix lus dans une seule source,
 * balisage schema.org complet dans les trois langues, données du catalogue contrôlées
 * avant affichage, aucune promesse retirée réintroduite dans les pages.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_OFFER, BUNDLE_SAVING, BUNDLE_SAVING_PERCENT, FILE_OFFERS, SEPARATE_TOTAL } from "../../web/src/lib/offers";
import { canonicalUrl, datasetJsonLd, productJsonLd } from "../../web/src/lib/structured-data";
import { isTaresCatalogue, dottedTariff, officialSourceUrl } from "../../web/src/lib/tares-catalogue";
import { isClassificationsCatalogue } from "../../web/src/lib/classifications-catalogue";

const ROOT = join(process.cwd(), "web/src");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const LANGS = ["fr", "de", "en"] as const;
const PRODUCTS = ["tares", "classifications", "finma"] as const;

describe("Prix des fichiers", () => {
  it("reprend les montants du référentiel serveur, sans les modifier", () => {
    const seed = readFileSync(join(process.cwd(), "src/db/seed.ts"), "utf8");
    for (const id of PRODUCTS) {
      const block = seed.slice(seed.indexOf(`id: "${id}"`));
      expect(Number(/price_chf:\s*(\d+)/.exec(block)?.[1]) / 100, id).toBe(FILE_OFFERS[id].price);
    }
    expect([FILE_OFFERS.finma.price, FILE_OFFERS.tares.price, FILE_OFFERS.classifications.price, BUNDLE_OFFER.price]).toEqual([299, 299, 399, 797]);
    expect([FILE_OFFERS.tares.renewal, FILE_OFFERS.classifications.renewal, FILE_OFFERS.finma.renewal]).toEqual([120, 160, 120]);
  });

  it("calcule l’économie du bundle au lieu de l’écrire à la main", () => {
    expect(SEPARATE_TOTAL).toBe(997);
    expect(BUNDLE_SAVING).toBe(200);
    expect(BUNDLE_SAVING_PERCENT).toBe(20);
  });

  it("ne réécrit aucun prix en dur dans les composants Atlas", () => {
    for (const file of ["components/TaresProduct.astro", "components/ClassificationsProduct.astro", "components/BundleProduct.astro", "components/FinmaProduct.astro", "components/HomePage.astro"]) {
      const source = read(file).replace(/\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/\b(299|399|797|997)\b/);
      expect(source, file).not.toMatch(/\b(120|160) ?CHF|CHF ?(120|160)\b/);
    }
  });
});

describe("Balisage schema.org des fiches produit", () => {
  it.each(PRODUCTS.flatMap(id => LANGS.map(lang => [id, lang] as const)))("Dataset complet pour %s en %s", (id, lang) => {
    const description = "Description de test assez longue pour respecter le minimum recommandé par les moteurs.";
    const data = datasetJsonLd(id, lang, description);
    expect(data["@type"]).toBe("Dataset");
    expect(data.url).toBe(canonicalUrl(`/datasets/${id}`, lang));
    expect(data.url).toBe(`https://www.openswissdata.com${lang === "fr" ? "" : `/${lang}`}/datasets/${id}/`);
    expect(data.license).toBe(`https://www.openswissdata.com${lang === "fr" ? "" : `/${lang}`}/legal/cgv/`);
    expect(data.inLanguage).toBe({ fr: "fr-CH", de: "de-CH", en: "en" }[lang]);
    expect(data.isAccessibleForFree).toBe(false);
    expect(String(data.name).length).toBeGreaterThan(10);
    expect((data.keywords as string[]).length).toBeGreaterThan(4);
    expect((data.isBasedOn as unknown[]).length).toBeGreaterThan(0);
    // Une distribution pointant vers une page HTML serait un usage faux ; aucun volume figé au build.
    expect(data).not.toHaveProperty("distribution");
    expect(JSON.stringify(data)).not.toMatch(/7[ ,.]?5\d\d|6[ ,.]?444|automatic updates|mises à jour automatiques/);
  });

  it.each([...PRODUCTS.filter(id => id !== "finma"), "bundle" as const].flatMap(id => LANGS.map(lang => [id, lang] as const)))("offre sans promesse inventée pour %s en %s", (id, lang) => {
    const data = productJsonLd(id, lang, { name: "Nom", description: "Description", image: "/og-default.png" });
    const offer = data.offers as Record<string, unknown>;
    expect(offer.price).toBe(String(id === "bundle" ? BUNDLE_OFFER.price : FILE_OFFERS[id].price));
    expect(offer.priceCurrency).toBe("CHF");
    expect(offer.url).toBe(`${data.url}#acheter`);
    for (const key of ["priceValidUntil", "shippingDetails", "hasMerchantReturnPolicy"]) expect(offer).not.toHaveProperty(key);
  });

  it("chaque fiche transmet son Dataset et sa description localisée", () => {
    for (const [file, id] of [["components/TaresProduct.astro", "tares"], ["components/ClassificationsProduct.astro", "classifications"], ["components/FinmaProduct.astro", "finma"]]) {
      expect(read(file), file).toMatch(new RegExp(`[dD]atasetJsonLd\\("${id}", lang, copy\\.description\\)`));
    }
  });
});

const taresRow = { hs8: "22011000", hs6: "220110", chapter: 22, heading: "2201", designation_fr: "eaux minérales", designation_de: "Mineralwasser", designation_it: "acque minerali", designation_en: "mineral waters", unit_stat: "per 100 kg gross", duty_mfn_value: 1, duty_mfn_unit: "par 100 kg brut", duty_mfn_currency: "CHF", preferential_regimes: { eu: "free", efta: "free" }, restrictions_codes: [], valid_from: "1988-01-01", duty_rates_count: 36, source_url: "https://xtares.admin.ch/tares/control/searchSimpleTarifNumber?number=22011000" };
const tares = { version: "2026.09.28", schema_version: 2, checked_at: "2026-09-28T10:45:10.435Z", rows: 7511, rates: 244588, missing_mfn_summary: 654, previous_version: "2026.09.25", added: 0, removed: 0, changed_fields: 0, interpretation: "Fictif", sample: [taresRow, { ...taresRow, hs8: "01012911", duty_mfn_value: undefined, duty_mfn_unit: undefined, unit_stat: "", preferential_regimes: {} }] };

describe("Catalogue TARES affiché sur la fiche", () => {
  it("accepte la forme réelle du schéma 2, lignes sans résumé comprises", () => { expect(isTaresCatalogue(tares)).toBe(true); });
  it.each([
    ["schéma 1", { ...tares, schema_version: 1 }],
    ["plus de numéros sans résumé que de numéros", { ...tares, missing_mfn_summary: 8000 }],
    ["moins de lignes de taux que de numéros", { ...tares, rates: 10 }],
    ["numéro à sept chiffres", { ...tares, sample: [{ ...taresRow, hs8: "2201100" }] }],
    ["droit négatif", { ...tares, sample: [{ ...taresRow, duty_mfn_value: -1 }] }],
    ["droit sans unité", { ...tares, sample: [{ ...taresRow, duty_mfn_unit: undefined }] }],
    ["préférence illisible", { ...tares, sample: [{ ...taresRow, preferential_regimes: { eu: "0 %" } }] }],
    ["date de contrôle absente", { ...tares, checked_at: "hier" }],
  ])("refuse une réponse incohérente : %s", (_, value) => { expect(isTaresCatalogue(value)).toBe(false); });
  it("garde la notation Tares et ne reprend que les liens de la source officielle", () => {
    expect(dottedTariff("85011000")).toBe("8501.1000");
    expect(officialSourceUrl(taresRow.source_url)).toBe(taresRow.source_url);
    expect(officialSourceUrl("javascript:alert(1)")).toBeNull();
    expect(officialSourceUrl("https://xtares.admin.ch.example.test/")).toBeNull();
  });
});

const scheme = (rows: number, classes: number) => ({ rows, sections: 21, classes });
const classifications = { version: "2026.09.25", schema_version: 2, checked_at: "2026-09-25T17:58:48.417Z", rows: 6444, links: 6220, exact: 2043, approximate: 4177, orphan_parents: 0,
  schemes: { NOGA_2008: scheme(1790, 615), NOGA_2025: scheme(1845, 651), "NACE_2.0": scheme(996, 615), "NACE_2.1": scheme(1047, 651), ISIC_4: scheme(766, 419) },
  sample: [{ scheme: "NOGA_2025", code: "011100", level: "subclass", parent: "0111", label_fr: "Culture de céréales" }, { scheme: "ISIC_4", code: "01", level: "division", parent: "A", label_en: "Crop production", label_es: "Agricultura" }] };

describe("Catalogue des classifications affiché sur la fiche", () => {
  it("accepte les clés de production et les libellés absents d’ISIC", () => { expect(isClassificationsCatalogue(classifications)).toBe(true); });
  it.each([
    ["exacts et approchés ne font pas le total", { ...classifications, exact: 2000 }],
    ["nomenclature absente", { ...classifications, schemes: { ...classifications.schemes, ISIC_4: undefined } }],
    ["somme des volumes différente", { ...classifications, rows: 6000 }],
    ["plus de classes que de codes", { ...classifications, schemes: { ...classifications.schemes, ISIC_4: scheme(10, 419) }, rows: 5688 }],
    ["niveau inconnu", { ...classifications, sample: [{ scheme: "ISIC_4", code: "01", level: "branche", parent: null }] }],
    ["code avec balise", { ...classifications, sample: [{ scheme: "ISIC_4", code: "<b>", level: "class", parent: null }] }],
  ])("refuse une réponse incohérente : %s", (_, value) => { expect(isClassificationsCatalogue(value)).toBe(false); });
});

describe("Promesses retirées des fiches", () => {
  const pages = ["components/TaresProduct.astro", "components/ClassificationsProduct.astro", "components/BundleProduct.astro", "components/HSLookup.astro"];
  it.each(pages)("%s ne réintroduit ni intégration ERP promise, ni volume figé, ni remboursement sans condition", file => {
    const source = read(file);
    for (const pattern of [/SAP GTS/, /ONESOURCE/, /Descartes/, /Bexio/, /Salesforce/, /rembours[^.]{0,40}sans condition/i, /no questions asked/i, /~ ?7[ ,]?500/, /10[  ,]?000 codes/, /30\+/, /6[  ]?444/, /priceValidUntil/, /time-series/i, /TARES_SAMPLE/]) {
      expect(source, `${file} ${pattern}`).not.toMatch(pattern);
    }
  });
  it("chaque fiche garde un paiement unique, ses conditions et aucune clé MCP payante annoncée", () => {
    for (const file of pages.slice(0, 3)) {
      const source = read(file);
      expect(source, file).toContain('action="/api/checkout/start"');
      expect(source, file).toContain("<CheckoutNotice />");
    }
    expect(read("components/BundleProduct.astro")).toMatch(/aucune clé MCP payante n’est livrée/);
    expect(read("components/ClassificationsProduct.astro")).toMatch(/Classifications Pro est temporairement indisponible/);
    expect(read("components/TaresProduct.astro")).toMatch(/Dies ist keine offizielle Veröffentlichung/);
  });
});
