import { describe, expect, it } from "vitest";
import { getSource } from "../../etl/shared/sources/registry.js";
import { COMPANY_SOURCES, type CompanySourceId } from "../../src/mcp/company/sources.js";

// `src/` ne peut pas importer `etl/` (voir le commentaire de `company/sources.ts`) :
// ce test, hors de la frontière tsc, est le seul garde-fou contre un écart silencieux
// entre la table locale de la fiche société et le registre unique des sources
// (tâche osd.fiche, tâche 4). Couvre aussi le test 7 de la consigne ("chaque source_id
// existe au registre") pour les trois sources de la fiche.
describe("COMPANY_SOURCES (fiche société) reste identique au registre unique des sources", () => {
  const ids = Object.keys(COMPANY_SOURCES) as CompanySourceId[];

  it.each(ids)("%s : adresse et référence de licence identiques au registre", (id) => {
    const source = getSource(id);
    expect(COMPANY_SOURCES[id].url).toBe(source.url);
    expect(COMPANY_SOURCES[id].licence_reference).toBe(source.licence.reference);
  });

  it("la référence de licence FINMA reste publique (aucun nom de personne)", () => {
    expect(COMPANY_SOURCES["finma.uid_csv"].licence_reference).toMatch(/^PUBLIC-OFFICIAL-SOURCE-/);
  });
});
