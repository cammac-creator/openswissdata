import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClassificationLinks, linksToLegacyCrossWalks, parseNaceIsicLinks } from "../../etl/classifications/links.js";
import { parseIsicCsvLatin } from "../../etl/classifications/ingest-real.js";
import { parseOfficialNace2 } from "../../etl/classifications/nace-official.js";
import type { NomenclatureRow } from "../../etl/classifications/types.js";

const folders: string[] = [];
function file(content: string): string { const dir = mkdtempSync(join(tmpdir(), "osd-classifications-")); folders.push(dir); const path = join(dir, "source"); writeFileSync(path, content); return path; }
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
const row = (scheme: NomenclatureRow["scheme"], code: string, level: NomenclatureRow["level"] = "class", parent: string | null = null): NomenclatureRow => ({ scheme, code, level, parent });

describe("Sources et hiérarchies officielles", () => {
  it("rattache chaque division ISIC à la section précédente, jamais à un chiffre inexistant", () => {
    const rows = parseIsicCsvLatin(file('"Code","Description"\n"A","Agriculture"\n"01","Cultures"\n"011","Cultures annuelles"\n"0111","Céréales"\n"B","Extraction"\n"05","Charbon"'), "en");
    expect(rows.find(r => r.code === "01")?.parent).toBe("A");
    expect(rows.find(r => r.code === "05")?.parent).toBe("B");
    expect(rows.find(r => r.code === "0111")?.parent).toBe("011");
  });
  it.each([
    '"Code","Description"\n"01","Cultures"',
    '"Code","Description"\n"A","Agriculture"\n"0111","Sans groupe"',
    '"Code","Description"\n"A","Agriculture"\n"A","Doublon"',
    '<html>indisponible</html>',
  ])("refuse une source ISIC incomplète, désordonnée ou non tabulaire", text => expect(() => parseIsicCsvLatin(file(text), "en")).toThrow());
  it("conserve les caractères français de la source Windows-1252", () => {
    const path = file(''); writeFileSync(path, Buffer.from('"Code","Description"\n"A","Activit\xe9s d\x92imprimerie \x96 \x9cuvres"', "latin1"));
    expect(parseIsicCsvLatin(path, "fr")[0].label_fr).toBe("Activités d’imprimerie – œuvres");
  });
  it("lit le parent officiel et retire seulement le préfixe du libellé NACE", () => {
    const uri = (value: string) => ({ value });
    const path = file(JSON.stringify({ results: { bindings: [{ s: uri("http://data.europa.eu/ux2/nace2/1811"), parent: uri("http://data.europa.eu/ux2/nace2/181"), en: uri("1811 Printing of newspapers"), fr: uri("1811 Imprimerie de journaux"), de: uri("1811 Drucken von Zeitungen"), it: uri("1811 Stampa di giornali") }] } }));
    expect(parseOfficialNace2(path)[0]).toMatchObject({ scheme: "NACE_2.0", code: "1811", parent: "181", label_fr: "Imprimerie de journaux" });
  });
});

describe("Construction sans faux exact", () => {
  const rows = [row("NOGA_2008", "1811"), row("NACE_2.0", "1811"), row("NOGA_2025", "1811"), row("NACE_2.1", "1811"), row("ISIC_4", "1811")];
  it("n'invente aucun lien ISIC ni entre révisions portant le même code", () => {
    const links = buildClassificationLinks(rows, new Map());
    expect(links).toHaveLength(2);
    expect(links.every(l => l.source_id === "ofs-methodologie")).toBe(true);
  });
  it("conserve closeMatch, même si les chiffres sont identiques", () => {
    const links = buildClassificationLinks(rows, new Map([["1811", ["1811"]]]));
    expect(links.find(l => l.source_scheme === "NACE_2.1")?.relation).toBe("closeMatch");
    const legacy = linksToLegacyCrossWalks(links);
    expect(legacy.every(w => [w.noga_2008,w.noga_2025,w.nace_2_0,w.nace_2_1,w.isic_4].filter(Boolean).length === 2)).toBe(true);
  });
  it("utilise le parent OFS des genres suisses avec une relation plus large", () => {
    const links = buildClassificationLinks([...rows, row("NOGA_2025", "181101", "subclass", "1811")], new Map());
    expect(links.find(l => l.source_code === "181101")).toMatchObject({ target_code: "1811", relation: "broadMatch", source_id: "ofs-noga2025" });
  });
  it("refuse les liens officiels vers des codes absents", () => expect(() => buildClassificationLinks(rows, new Map([["1811", ["9999"]]]))).toThrow(/absent/));
  it("refuse les codes dupliqués", () => expect(() => buildClassificationLinks([...rows,rows[0]], new Map())).toThrow(/dupliqués/));
  it("refuse une relation Eurostat dont la nature est absente", () => {
    const path = file(JSON.stringify({ results: { bindings: [{ source: {type:"uri",value:"http://data.europa.eu/ux2/nace2/1811"}, target:{type:"uri",value:"https://unstats.un.org/classifications/ISIC/rev4/1811"} }] } }));
    expect(() => parseNaceIsicLinks(path)).toThrow(/non reconnue/);
  });
});
