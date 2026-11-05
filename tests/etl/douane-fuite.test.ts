/**
 * Test de fuite, lancé par `refresh-douane.yml` AVANT toute lecture de la source : un témoin placé dans
 * chaque colonne de texte (libellé du tarif, pays, trimestre, mois, biens, genre de taux, unité) et
 * dans chaque colonne numérique écartée (euros, dollars, quantité) n'apparaît nulle part dans le document écrit.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { DouaneAggregator, MEASURES, readZipInto } from "../../etl/douane/aggregate.js";
import { buildMeta, writeDocument } from "../../etl/douane/build.js";
import { DUTIES_HEADER, dutiesLine, TRADE_HEADER, tradeLine, writeZip } from "./douane-fixtures.js";

const dir = mkdtempSync(join(tmpdir(), "osd-douane-fuite-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("commerce extérieur : aucune fuite vers le document écrit", () => {
  it("aucun témoin ni aucune colonne écartée ne sort", async () => {
    const dutiesCsv = [DUTIES_HEADER, dutiesLine({ label: '"Prénom Nom TEMOIN-PERSONNE; \\"TEMOIN-b\\"; TEMOIN-c"' })].join("\n");
    const importsCsv = [TRADE_HEADER, tradeLine("I", { label: '"TEMOIN-PERSONNE; TEMOIN-d"' })].join("\n");
    const exportsCsv = [TRADE_HEADER, tradeLine("E", { label: "TEMOIN-e; non protégé" })].join("\n");
    // Le test ne passe pas à vide : les fichiers portent bien les témoins et les valeurs écartées.
    expect(`${dutiesCsv}${importsCsv}${exportsCsv}`.match(/TEMOIN-/g)?.length).toBeGreaterThan(15);
    expect(dutiesCsv).toContain("888.0");

    const paths = { duties: join(dir, "ze.zip"), imports: join(dir, "imp.zip"), exports: join(dir, "exp.zip") };
    await writeZip(paths.duties, [{ name: "ZE.csv", text: dutiesCsv }]);
    await writeZip(paths.imports, [{ name: "IMP.csv", text: importsCsv }]);
    await writeZip(paths.exports, [{ name: "EXP.csv", text: exportsCsv }]);

    const aggregator = new DouaneAggregator();
    const ledgers = {
      duties: await readZipInto("duties", paths.duties, aggregator),
      imports: await readZipInto("imports", paths.imports, aggregator),
      exports: await readZipInto("exports", paths.exports, aggregator),
    };
    const meta = buildMeta({ aggregator, ledgers, sources: [], concordance: [], collectedAt: "2026-11-05T12:00:00.000Z" });
    const out = join(dir, "doc.txt.gz");
    await writeDocument(meta, aggregator, out);
    const written = gunzipSync(readFileSync(out)).toString("utf8");

    expect(written).not.toContain("TEMOIN");
    expect(written).not.toMatch(/Prénom|Nom\b/);
    // 888, 777, 666, 555 (euros et dollars) et 999 (quantité douanière) : écartés.
    const rows = written.trimEnd().split("\n").slice(1).join("\n");
    expect(rows).not.toMatch(/\b(888|777|666|555|999)\b/);
    for (const row of rows.split("\n")) expect(row).toMatch(/^\d{8};[A-Z]{2};\d{4}(;\d*){5}$/);
  });
  it("la liste des colonnes du document est fermée", () => {
    expect([...MEASURES]).toEqual(["import_value_chf", "import_kg", "duties_chf", "export_value_chf", "export_kg"]);
  });
});
