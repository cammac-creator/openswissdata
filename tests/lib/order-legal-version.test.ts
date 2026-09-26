import { describe, it, expect } from "vitest";
import { termsDigest, termsText } from "../../src/lib/order-legal.js";
import { contractDocument } from "../../src/legal/catalog.js";
import type { LegalLocale } from "../../src/legal/terms-2026-09-26.js";

// Une modification du contrat déjà publié doit créer une autre version, pas réécrire ces références.
const hashes = {
  "fr": "9bd63e9ea002d007d793dc47199aa19b2d18f1afc5abdf5d2005063cc3628a82",
  "de": "4f977f16493bf51fe3294619a371c63ae1fe78cd095ba92fa1be3834bf8fafc2",
  "en": "34c3d0dda2165afcebc20fe836a08ef345ce6735d2d6f1ec37c2102a6b54d442"
};
describe("Conservation des contrats publiés", () => {
  it.each(Object.keys(hashes) as LegalLocale[])("garde le contrat du 26 septembre en %s", locale => {
    expect(termsDigest(locale,"2026-09-26")).toBe(hashes[locale]);
    expect(termsText(locale,"2026-09-26")).toContain("contact@openswissdata.com");
  });
  it("refuse une version ou une langue inconnue sans substitution silencieuse", () => {
    expect(contractDocument("2099-01-01","fr")).toBeUndefined();
    expect(contractDocument("2026-09-26","__proto__")).toBeUndefined();
    expect(() => termsText("fr","2099-01-01")).toThrow("Version contractuelle inconnue");
  });
});
