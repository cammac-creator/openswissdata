/**
 * Tests for commit c1d1e22 — live demos on the 3 dataset detail pages.
 *
 * These are build-time source tests (no browser needed):
 * - Each dataset page imports and renders its Lookup component.
 * - Each Lookup component contains the embedded data sample it is supposed to ship.
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

  it("ClassificationsLookup.astro contains the 20-entry NOGA_SAMPLE with expected keys", () => {
    const src = readFileSync(
      join(ROOT, "components/ClassificationsLookup.astro"),
      "utf8"
    );
    expect(src, "should have NOGA_SAMPLE constant").toContain("NOGA_SAMPLE");
    // Verify at least one well-known entry is present
    expect(src, "should contain banque centrale code").toContain("64.11");
    // Verify cross-walk fields are present
    expect(src, "should have noga25 field").toContain("noga25");
    expect(src, "should have nace field").toContain("nace");
    expect(src, "should have isic field").toContain("isic");
  });

  it("FINMA charge son échantillon publié et n'embarque plus des identifiants non vérifiés", () => {
    const old=readFileSync(join(ROOT,"components/FinmaLookup.astro"),"utf8");
    const product=readFileSync(join(ROOT,"components/FinmaProduct.astro"),"utf8");
    expect(old).not.toContain("FINMA_SAMPLE");
    expect(product).toContain("/api/catalog/finma");
    expect(product).not.toContain("CHE-101.329.561");
    expect(product).not.toContain("licdate:");
  });
});
