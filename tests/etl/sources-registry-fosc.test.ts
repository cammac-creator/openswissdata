import { describe, expect, it } from "vitest";
import { getSource, SOURCES } from "../../etl/shared/sources/registry.js";
import { PRODUCT_SOURCES } from "../../etl/shared/sources/products.js";
import { FOSC_PUBLICATIONS_URL } from "../../etl/fosc/sources.js";

describe("registre des sources : FOSC (SECO)", () => {
  it("la FOSC est au registre, sans canari, sous les conditions du portail", () => {
    const s = getSource("seco.fosc_hr");
    expect(s.institution).toBe("SECO");
    expect(s.url).toBe(FOSC_PUBLICATIONS_URL);
    expect(s.url).toBe("https://www.shab.ch/api/v1/publications");
    expect(s.canary).toBeUndefined();
    expect(s.licence.reference).toBe("PUBLIC-OFFICIAL-SOURCE-SECO-FOSC-TERMS");
    expect(s.licence.authority).toMatch(/07\.06\.2024/);
  });
  it("la FOSC n'entre dans aucune archive vendue", () => {
    for (const ids of Object.values(PRODUCT_SOURCES)) expect(ids).not.toContain("seco.fosc_hr");
  });
  it("les identifiants du registre restent uniques", () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
  });
});
