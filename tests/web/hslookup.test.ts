/**
 * Tests for commit c1d1e22 — live demos on the 3 dataset detail pages.
 *
 * These are build-time source tests (no browser needed):
 * - Each dataset page imports and renders its Lookup component.
 * - Depuis le 28.09.2026, les démonstrateurs lisent l'échantillon publié par le catalogue
 *   au lieu d'embarquer des valeurs figées.
 *
 * We check the Astro source files directly because building the site in CI would
 * require Node 20+ with Astro installed, which may time out.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "web/src");

describe("HSLookup live demos — source-level presence (commit c1d1e22)", () => {
  it("datasets/tares.astro imports and uses HSLookup", () => {
    const src = readFileSync(join(ROOT, "pages/datasets/tares.astro"), "utf8");
    expect(src, "tares.astro should import HSLookup").toMatch(/import\s+HSLookup/);
    expect(src, "tares.astro should render <HSLookup />").toMatch(/<HSLookup\s*\/>/);
  });

  it("datasets/classifications.astro imports and uses ClassificationsLookup", () => {
    const src = readFileSync(join(ROOT, "pages/datasets/classifications.astro"), "utf8");
    expect(src, "classifications.astro should import ClassificationsLookup").toMatch(
      /import\s+ClassificationsLookup/
    );
    expect(src, "classifications.astro should render <ClassificationsLookup />").toMatch(
      /<ClassificationsLookup\s*\/>/
    );
  });

  // Le démonstrateur classifications est vérifié par ses réponses réelles dans routes/catalog.test.ts.

  it("TARES lit son échantillon publié et n'embarque plus de taux figés", () => {
    const lookup = readFileSync(join(ROOT, "components/HSLookup.astro"), "utf8");
    const explorer = readFileSync(join(ROOT, "scripts/tares-explorer.ts"), "utf8");
    const catalogue = readFileSync(join(ROOT, "lib/tares-catalogue.ts"), "utf8");
    expect(lookup).not.toContain("TARES_SAMPLE");
    expect(lookup).not.toMatch(/is:inline|innerHTML/);
    expect(explorer).toContain("loadTaresCatalogue");
    expect(explorer).not.toContain("innerHTML");
    expect(catalogue).toContain("readPublicCatalogue('tares')");
    for (const lang of ["de", "en"]) {
      const page = readFileSync(join(ROOT, `pages/${lang}/datasets/tares.astro`), "utf8");
      expect(page).toMatch(/<TaresProduct><HSLookup \/><\/TaresProduct>/);
    }
  });

  it("FINMA charge son échantillon publié et n'embarque plus des identifiants non vérifiés", () => {
    // L'ancien composant components/FinmaLookup.astro (jamais importé par une
    // page, seulement un lien vers /datasets/finma) a été retiré le
    // 30.09.2026 : plus rien à relire ici, son ancien contenu FINMA_SAMPLE
    // avait déjà disparu avant sa suppression.
    const product=readFileSync(join(ROOT,"components/FinmaProduct.astro"),"utf8");
    expect(product).toContain("/api/catalog/finma");
    expect(product).not.toContain("CHE-101.329.561");
    expect(product).not.toContain("licdate:");
  });
});
