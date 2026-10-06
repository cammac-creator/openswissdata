import { describe, expect, it } from "vitest";
import { getSource, SOURCES } from "../../etl/shared/sources/registry.js";
import { PRODUCT_SOURCES } from "../../etl/shared/sources/products.js";

describe("registre des sources : registre du commerce (LINDAS)", () => {
  it("LINDAS est au registre, sans canari, sous licence open use", () => {
    const s = getSource("ofrc.zefix_lindas");
    expect(s.institution).toBe("OFRC");
    expect(s.url).toBe("https://register.ld.admin.ch/query");
    expect(s.canary).toBeUndefined();
    expect(s.licence.reference).toBe("PUBLIC-OFFICIAL-SOURCE-OFRC-OPEN-USE");
  });
  it("LINDAS n'entre dans aucune archive vendue (le garde-fou Zefix FINMA reste actif)", () => {
    for (const ids of Object.values(PRODUCT_SOURCES)) expect(ids).not.toContain("ofrc.zefix_lindas");
  });
  it("les identifiants du registre restent uniques", () => {
    expect(new Set(SOURCES.map(s => s.id)).size).toBe(SOURCES.length);
  });
});
