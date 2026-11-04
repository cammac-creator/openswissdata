import { describe, expect, it } from "vitest";
import { PRODUCT_SOURCES } from "../../etl/shared/sources/products.js";
import { getSource } from "../../etl/shared/sources/registry.js";
import { SESAM_XML_URL } from "../../etl/sanctions/sources.js";
import { getPublicSource } from "../../src/lib/public-sources.js";

describe("registre des sources : liste des sanctions (SECO)", () => {
  it("au registre, sans canari, sous la réponse écrite du SECO", () => {
    const s = getSource("seco.sesam_sanctions");
    expect(s.institution).toBe("SECO");
    expect(s.url).toBe(SESAM_XML_URL);
    expect(s.canary).toBeUndefined();
    expect(s.licence.date).toBe("2026-11-04");
  });
  it("n'entre dans aucune archive vendue", () => {
    for (const ids of Object.values(PRODUCT_SOURCES)) expect(ids).not.toContain("seco.sesam_sanctions");
  });
  it("la copie publique suit le registre", () => {
    expect(getPublicSource("seco.sesam_sanctions")?.url).toBe(SESAM_XML_URL);
  });
});
