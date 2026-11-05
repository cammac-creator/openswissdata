/** Lecture des fichiers de l'OFDF, sur des fichiers fictifs, dont le piège des libellés mal protégés. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeKey, DouaneAggregator, readZipInto } from "../../etl/douane/aggregate.js";
import { checkHeader, DouaneFormatError, readLine } from "../../etl/douane/parse.js";
import { DUTIES_HEADER, dutiesLine, TRADE_HEADER, tradeLine, writeZip } from "./douane-fixtures.js";

const dir = mkdtempSync(join(tmpdir(), "osd-douane-parse-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Les formes de libellé vues dans la vraie source, plus une qu'elle n'a pas encore. */
const LABELS = {
  simple: "Bêtes fictives",
  protege: '"Bêtes fictives; sauvages; vivantes"',
  echappe: '"Carpes \\"Fictivus spp.; Exemplus spp.\\", vivantes; autres"',
  guillemet_seul: '"Bêtes; 5" de long"',
  non_protege: "Bêtes fictives; sans guillemets; TEMOIN",
  beaucoup: `"${Array.from({ length: 35 }, (_, i) => `partie ${i}`).join("; ")}"`,
};

describe("le piège : un point-virgule dans le libellé du tarif", () => {
  it.each(Object.entries(LABELS))("recettes, libellé %s : les champs restent justes", (_nom, label) => {
    const r = readLine("duties", dutiesLine({ label, duties: "720.0", value: "100125.0", kg: "3120.0", country: "XA" }));
    expect(r).toMatchObject({ dutiesChf: 720, valueChf: 100125, kg: 3120, country: "XA", tn8: "99010001", year: 2025 });
  });
  it.each(Object.entries(LABELS))("commerce, libellé %s : les champs restent justes", (_nom, label) => {
    const r = readLine("exports", tradeLine("E", { label, value: "100125.0", kg: "3120.0", country: "XA" }));
    expect(r).toMatchObject({ valueChf: 100125, kg: 3120, country: "XA", tn8: "99010001", conjunctural: true });
  });
  it("signale le débordement sans jamais rendre le libellé", () => {
    const r = readLine("duties", dutiesLine({ label: LABELS.protege }));
    expect(r.labelOverflow).toBe(true);
    expect(JSON.stringify(r)).not.toContain("Bêtes");
    expect(readLine("duties", dutiesLine({ label: LABELS.simple })).labelOverflow).toBe(false);
  });

  it("le total retombe sur le repère ; la lecture naïve, par position, en est très loin", async () => {
    // Une ligne droite à 100 francs de droits, puis des lignes dont le libellé pousse une grande valeur
    // sur la colonne des droits, comme le vrai fichier (environ neuf fois le bon total).
    const lines = [
      dutiesLine({ duties: "100.0", value: "1000.0", tariff: "9901.0001", country: "XA" }),
      dutiesLine({ duties: "20.0", value: "90000.0", tariff: "9901.0002", country: "XA", label: '"Fictif; autre"' }),
      dutiesLine({ duties: "30.0", value: "80000.0", tariff: "9901.0003", country: "XA", label: '"Fictif; \\"autre\\"; encore"' }),
    ];
    const path = join(dir, "piege.zip");
    await writeZip(path, [{ name: "ZE.csv", text: `${DUTIES_HEADER}\n${lines.join("\n")}\n` }]);
    const aggregator = new DouaneAggregator();
    const ledger = await readZipInto("duties", path, aggregator);
    expect(ledger.by_year["2025"].duties_chf).toBe(150);
    expect(ledger.lines_label_overflow).toBe(2);

    const column = DUTIES_HEADER.split(";").indexOf("Recettes_douanieres_CHF");
    const naive = lines.reduce((sum, line) => sum + (Number(line.split(";")[column]) || 0), 0);
    expect(naive).toBeGreaterThan(150 * 5);
  });
});

describe("forme de chaque ligne : tout écart arrête la collecte", () => {
  const refused = (fn: () => unknown) => expect(fn).toThrow(DouaneFormatError);
  it("une colonne ajoutée, retirée ou renommée", () => {
    expect(() => checkHeader("duties", DUTIES_HEADER)).not.toThrow();
    expect(() => checkHeader("imports", TRADE_HEADER)).not.toThrow();
    refused(() => checkHeader("duties", `${DUTIES_HEADER};Nouvelle`));
    refused(() => checkHeader("duties", TRADE_HEADER));
    refused(() => checkHeader("exports", TRADE_HEADER.replace("Valeur_CHF", "Wert_CHF")));
  });
  it("un point-virgule AILLEURS que dans le libellé décale la lecture : refus, pas un total faux", () => {
    refused(() => readLine("duties", dutiesLine({ countryText: "Pays; fictif" })));
    refused(() => readLine("imports", tradeLine("I", { countryText: "Pays; fictif" })));
  });
  it.each([
    ["année", { year: 1 }],
    ["année trop ancienne pour la clé", { year: 1979 }],
    ["mois", { month: 13 }],
    ["tarif sans point", { tariff: "99010001" }],
    ["tarif trop court", { tariff: "9901.01" }],
    ["pays en minuscules", { country: "xa" }],
    ["pays vide", { country: "" }],
    ["état inconnu", { status: "brouillon" }],
    ["date illisible", { updatedAt: "hier" }],
    ["droits négatifs", { duties: "-5.0" }],
    ["droits en texte", { duties: "TEMOIN" }],
    ["droits à décimales", { duties: "1.5" }],
    ["valeur négative", { value: "-1.0" }],
    ["poids en texte", { kg: "abc" }],
  ])("recettes : %s", (_nom, fields) => {
    refused(() => readLine("duties", dutiesLine(fields)));
  });
  it("une ligne trop courte", () => {
    refused(() => readLine("duties", "2025;1;x"));
    refused(() => readLine("exports", "E;2025;1"));
  });
  it("commerce : mauvais sens, découpe du tarif incohérente, drapeau inconnu", () => {
    refused(() => readLine("imports", tradeLine("E")));
    refused(() => readLine("exports", tradeLine("I")));
    refused(() => readLine("imports", tradeLine("I").replace(";9901.00;9901;99;", ";9902.00;9901;99;")));
    refused(() => readLine("imports", tradeLine("I", { conjunctural: "Peut-être" })));
    refused(() => readLine("imports", tradeLine("I").replace(";Oui;oui;", ";Oui;non;")));
  });
  it("une valeur vide reste vide, jamais zéro ; une notation scientifique se lit", () => {
    const blank = readLine("imports", tradeLine("I", { value: "", kg: "" }));
    expect(blank.valueChf).toBeNull();
    expect(blank.kg).toBeNull();
    expect(readLine("imports", tradeLine("I", { value: "1.5E7" })).valueChf).toBe(15_000_000);
    expect(readLine("duties", dutiesLine({ duties: "0.0" })).dutiesChf).toBe(0);
  });
});

describe("lecture de l'archive en flux", () => {
  const read = async (name: string, members: { name: string; text: string }[], kind: "duties" | "imports" = "duties") => {
    const path = join(dir, name);
    await writeZip(path, members);
    return readZipInto(kind, path, new DouaneAggregator());
  };
  it("une archive à plusieurs fichiers, un chemin dans un nom, un membre sans en-tête", async () => {
    const good = `${DUTIES_HEADER}\n${dutiesLine()}\n`;
    await expect(read("deux.zip", [{ name: "a.csv", text: good }, { name: "b.csv", text: good }])).rejects.toThrow(DouaneFormatError);
    await expect(read("chemin.zip", [{ name: "x/a.csv", text: good }])).rejects.toThrow(DouaneFormatError);
    await expect(read("autre.zip", [{ name: "a.exe", text: good }])).rejects.toThrow(DouaneFormatError);
    await expect(read("entete.zip", [{ name: "a.csv", text: `${dutiesLine()}\n` }])).rejects.toThrow(DouaneFormatError);
    await expect(read("vide.zip", [{ name: "a.csv", text: "" }])).rejects.toThrow(DouaneFormatError);
  });
  it("un fichier qui n'est pas un ZIP", async () => {
    const { writeFileSync } = await import("node:fs");
    const path = join(dir, "faux.zip");
    writeFileSync(path, "<html>TEMOIN</html>");
    await expect(readZipInto("duties", path, new DouaneAggregator())).rejects.toThrow(DouaneFormatError);
  });
  it("une ligne vide au milieu arrête ; la dernière ligne sans fin de ligne est lue", async () => {
    await expect(read("trou.zip", [{ name: "a.csv", text: `${DUTIES_HEADER}\n${dutiesLine()}\n\n${dutiesLine()}\n` }])).rejects.toThrow(DouaneFormatError);
    const ledger = await read("fin.zip", [{ name: "a.csv", text: `${DUTIES_HEADER}\n${dutiesLine()}\n${dutiesLine()}` }]);
    expect(ledger.lines).toBe(2);
  });
  it("le grand livre compte les mois, l'état provisoire et chaque date de mise à jour", async () => {
    const text = [DUTIES_HEADER, dutiesLine({ year: 2026, month: 1, status: "prov" }), dutiesLine({ year: 2026, month: 2, status: "prov" }), dutiesLine({ year: 2025, month: 2, updatedAt: "2026-10-14T12:24:31.816+02:00" })].join("\n");
    const ledger = await read("mois.zip", [{ name: "a.csv", text }]);
    expect(ledger.by_year["2026"]).toMatchObject({ months: 2, provisional: true, lines: 2 });
    expect(ledger.by_year["2025"]).toMatchObject({ months: 1, provisional: false });
    expect(ledger.updated_at).toHaveLength(2);
  });
});

describe("agrégats", () => {
  it("additionne par année, tarif et pays, et garde l'absence distincte de zéro", () => {
    const aggregator = new DouaneAggregator();
    aggregator.add("duties", readLine("duties", dutiesLine({ duties: "10.0" })));
    aggregator.add("duties", readLine("duties", dutiesLine({ duties: "5.0", month: 2 })));
    aggregator.add("imports", readLine("imports", tradeLine("I", { value: "100.0", kg: "" })));
    aggregator.add("exports", readLine("exports", tradeLine("E", { value: "7.0", kg: "0.0", country: "XB" })));
    expect(aggregator.rows).toBe(2);
    const [first, second] = aggregator.sortedKeys();
    expect(decodeKey(first)).toEqual({ tn8: "99010001", country: "XA", year: 2025 });
    expect(decodeKey(second)).toEqual({ tn8: "99010001", country: "XB", year: 2025 });
    expect(aggregator.valuesOf(first)).toEqual([100, Number.NaN, 15, Number.NaN, Number.NaN]);
    expect(aggregator.valuesOf(second)).toEqual([Number.NaN, Number.NaN, Number.NaN, 7, 0]);
  });
  it("trie par tarif, pays, année, avec un zéro en tête de tarif", () => {
    const aggregator = new DouaneAggregator();
    for (const fields of [{ tariff: "9901.0001", year: 1988 }, { tariff: "0101.1011", year: 2026 }, { tariff: "0101.1011", year: 2025 }]) {
      aggregator.add("imports", readLine("imports", tradeLine("I", fields)));
    }
    expect([...aggregator.sortedKeys()].map(decodeKey).map((k) => `${k.tn8} ${k.year}`)).toEqual(["01011011 2025", "01011011 2026", "99010001 1988"]);
  });
  it("note les tarifs hors du total conjoncturel, par sens et par année", () => {
    const aggregator = new DouaneAggregator();
    aggregator.add("imports", readLine("imports", tradeLine("I", { conjunctural: "Non", year: 2024 })));
    aggregator.add("imports", readLine("imports", tradeLine("I", { conjunctural: "Non", year: 2025 })));
    aggregator.add("exports", readLine("exports", tradeLine("E", { conjunctural: "Oui" })));
    expect([...(aggregator.nonConjunctural.imports.get("99010001") ?? [])]).toEqual([2024, 2025]);
    expect(aggregator.nonConjunctural.exports.size).toBe(0);
  });
  it("s'étend au-delà de sa première capacité sans rien perdre", () => {
    const aggregator = new DouaneAggregator();
    const rows = (1 << 20) + 10;
    const record = readLine("exports", tradeLine("E", { value: "3.0" }));
    for (let i = 0; i < rows; i++) {
      aggregator.add("exports", { ...record, tn8: String(10_000_000 + i) });
    }
    expect(aggregator.rows).toBe(rows);
    const keys = aggregator.sortedKeys();
    expect(aggregator.valuesOf(keys[keys.length - 1])[3]).toBe(3);
  });
});
