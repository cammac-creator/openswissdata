import { describe, expect, it } from "vitest";
import { getSource } from "../../etl/shared/sources/registry.js";
import { LINDAS_ZEFIX_GRAPH as LINDAS_ZEFIX_GRAPH_ETL } from "../../etl/finma/ingest-zefix.js";
import { LINDAS_ENDPOINT, LINDAS_ZEFIX_GRAPH } from "../../src/mcp/company/lindas.js";
import { GLEIF_LEI_API_URL } from "../../src/mcp/company/gleif.js";

// `src/` ne peut pas importer `etl/` (tsconfig rootDir "./src", etl jamais compilé dans
// dist/) : les constantes de lindas.ts et gleif.ts sont donc des copies littérales des
// adresses déclarées une seule fois dans etl/shared/sources/registry.ts. Ce test, qui vit
// hors de la frontière tsc (tests/ exclu de tsconfig.json), est le seul garde-fou contre
// un écart silencieux entre les deux côtés (tâche osd.fiche, tâche 3).
describe("les adresses en direct de la fiche société restent identiques au registre des sources", () => {
  it("LINDAS : endpoint et graphe", () => {
    expect(LINDAS_ENDPOINT).toBe(getSource("ofrc.zefix_lindas").url);
    expect(LINDAS_ZEFIX_GRAPH).toBe(LINDAS_ZEFIX_GRAPH_ETL);
  });
  it("GLEIF : adresse de l'API", () => {
    expect(GLEIF_LEI_API_URL).toBe(getSource("gleif.lei_api").url);
  });
});
