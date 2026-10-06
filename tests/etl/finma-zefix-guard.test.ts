import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildBundle as buildProductionBundle } from "../../etl/finma/bundle.js";
import { withTestSignature } from "../helpers/signature.js";
import { ingestOneSource } from "../../etl/finma/ingest.js";
import { FINMA_SOURCES } from "../../etl/finma/sources.js";
import type { ZefixData } from "../../etl/finma/ingest-zefix.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const buildBundle = withTestSignature(buildProductionBundle);
const fixtureDir = join(process.cwd(), "etl/finma/fixtures");
const banques = () =>
  ingestOneSource(join(fixtureDir, "finma-banks-sample.xlsx"), FINMA_SOURCES.find(s => s.entity_type === "bank")!);

// Garde-fou du 06.10.2026 (tâche osd.socle) : une archive FINMA qui contient des données Zefix
// alors qu'aucune source Zefix n'est déclarée au registre et dans la liste du produit est refusée,
// pour qu'un manifeste signé ne taise jamais une source réellement assemblée.
describe("archive FINMA : garde-fou des données Zefix", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "osd-finma-zefix-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("refuse l'archive quand des données Zefix sont présentes sans source Zefix déclarée", async () => {
    const zefixByUid = new Map<string, ZefixData>([
      ["CHE-999.999.999", { uid: "CHE-999.999.999", status: "active", legal_form: "AG/SA" }],
    ]);
    await expect(buildBundle({ entities: banques(), zefixByUid }, "2026.04.17", workDir))
      .rejects.toThrow(/provenance FINMA : données Zefix présentes mais aucune source Zefix au registre/);
  });

  it("refuse aussi une table Zefix vide : les colonnes zefix_* entreraient quand même dans le schéma", async () => {
    await expect(buildBundle({ entities: banques(), zefixByUid: new Map() }, "2026.04.17", workDir))
      .rejects.toThrow(/provenance FINMA : données Zefix présentes/);
  });

  it("sans données Zefix, l'archive se construit comme avant", async () => {
    const result = await buildBundle({ entities: banques() }, "2026.04.17", workDir);
    expect(result.zefixEnrichedCount).toBe(0);
    expect(existsSync(result.zipPath)).toBe(true);
  });
});
