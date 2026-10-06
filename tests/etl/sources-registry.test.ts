import { describe, expect, it } from "vitest";
import { SOURCES, getSource, sourcesByInstitution } from "../../etl/shared/sources/registry.js";
import { CANARIES } from "../../scripts/monitor-sources.js";

describe("registre des sources", () => {
  it("chaque identifiant est unique et chaque adresse est en https", () => {
    const ids = SOURCES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SOURCES) expect(new URL(s.url).protocol, s.id).toBe("https:");
  });
  it("chaque source a une institution, une licence et une description", () => {
    for (const s of SOURCES) {
      expect(s.institution, s.id).toBeTruthy();
      expect(s.licence.authority, s.id).toBeTruthy();
      expect(s.licence.reference, s.id).toBeTruthy();
      expect(s.licence.jurisdiction, s.id).toBeTruthy();
      expect(s.description.length, s.id).toBeGreaterThan(10);
    }
  });
  it("chaque source du canari actuel est dans le registre, même adresse", () => {
    for (const c of CANARIES) expect(getSource(c.id).url, c.id).toBe(c.url);
  });
  it("getSource refuse un identifiant inconnu", () => {
    expect(() => getSource("inconnu.source")).toThrow(/source inconnue/);
  });
  it("regroupe par institution", () => {
    const parInstitution = sourcesByInstitution();
    expect(parInstitution.get("FINMA")?.some(s => s.id === "finma.uid_csv")).toBe(true);
    expect(parInstitution.get("GLEIF")?.some(s => s.id === "gleif.lei_api")).toBe(true);
  });
});
