/**
 * Tests de `scripts/sync-bfe-pv.ts` (tâche osd.donnees, tâche B5 du plan
 * `2026-10-06-prospection-et-api.md`) : rétribution unique OFEN pour les installations
 * photovoltaïques, par canton et année.
 *
 * Aucun appel réseau : le mode `--fixture` lit un fichier CSV local ; les tests du chemin
 * réseau injectent `fetchImpl` (maquette pure, jamais `fetch` global). Fixtures générées EN
 * TEST (26 cantons), jamais le vrai fichier OFEN ni une valeur ou un nombre de lignes figé
 * d'une collecte réelle.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BFE_PV_CSV_URL } from "../../etl/bfe/sources.js";
import {
  parseArgs,
  parseOfficialCsv,
  reduceRows,
  sortRows,
  syncBfePv,
  toCsv,
  validateRows,
  type BfePvRow,
} from "../../scripts/sync-bfe-pv.js";

const HEADER =
  "Jahr,Kanton,Anzahl_Anlagen,Installierte_Leistung_kW,Verguetung_CHF,Anzahl_Anlagen_pro_100000_Einwohner,Installierte_Leistung_kW_pro_100000_Einwohner";

const CANTONS = [
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW",
  "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH",
];

/** Un jeu de lignes fictives complet (26 cantons) pour une année, valeurs simples et
 *  distinctes par canton (jamais les vraies valeurs OFEN). `overrides` remplace la ligne d'un
 *  canton donné par un texte brut (pour injecter "NA" ou une valeur invalide). */
function fixtureRows(year: string, overrides: Record<string, string> = {}): string[] {
  return CANTONS.map((canton, i) => overrides[canton] ?? `${year},${canton},${i + 1},${(i + 1) * 10}.5,${(i + 1) * 1000},${i},${i * 10}`);
}

function fixtureCsv(years: string[], overridesByCanton: Record<string, string> = {}, opts: { bom?: boolean } = {}): string {
  const bom = opts.bom === false ? "" : "﻿";
  const lines = years.flatMap((year) => fixtureRows(year, overridesByCanton));
  return bom + [HEADER, ...lines].join("\n") + "\n";
}

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "osd-sync-bfe-pv-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeFixtureFile(dir: string, content: string): string {
  const path = join(dir, "bfe-pv-fixture.csv");
  writeFileSync(path, content, "utf8");
  return path;
}

const EDITION = "2026-10-07";

describe("parseArgs", () => {
  it("sans argument : rien", () => {
    expect(parseArgs([])).toEqual({});
  });
  it("--fixture <chemin> et --edition <date>", () => {
    expect(parseArgs(["--fixture", "/tmp/x.csv", "--edition", "2026-10-07"])).toEqual({ fixturePath: "/tmp/x.csv", edition: "2026-10-07" });
  });
  it("--fixture sans valeur : erreur explicite", () => {
    expect(() => parseArgs(["--fixture"])).toThrow(/--fixture/);
  });
});

describe("parseOfficialCsv : en-tête EXACT, BOM et \\r tolérés", () => {
  it("BOM présent : en-tête reconnu, lignes parsées", () => {
    const csv = fixtureCsv(["2020"]);
    const rows = parseOfficialCsv(Buffer.from(csv, "utf8"));
    expect(rows).toHaveLength(26);
    expect(rows[0]["Jahr"]).toBe("2020");
  });
  it("sans BOM : en-tête reconnu quand même", () => {
    const csv = fixtureCsv(["2020"], {}, { bom: false });
    const rows = parseOfficialCsv(Buffer.from(csv, "utf8"));
    expect(rows).toHaveLength(26);
  });
  it("fin de ligne CRLF : `\\r` retiré avant comparaison de l'en-tête", () => {
    const csv = fixtureCsv(["2020"]).replace(/\n/g, "\r\n");
    const rows = parseOfficialCsv(Buffer.from(csv, "utf8"));
    expect(rows).toHaveLength(26);
  });
  it("en-tête modifié (fichier OFEN changé de forme) : erreur explicite", () => {
    const csv = "Year,Canton,Count\n2020,ZH,1\n";
    expect(() => parseOfficialCsv(Buffer.from(csv, "utf8"))).toThrow(/en-tête/i);
  });
});

describe("validateRows", () => {
  it("26 cantons, une année, valeurs valides : ne lève rien", () => {
    const rows = parseOfficialCsv(Buffer.from(fixtureCsv(["2020"]), "utf8"));
    expect(() => validateRows(rows, 1)).not.toThrow();
  });

  it("valeur officielle \"NA\" (donnée non disponible) : acceptée telle quelle", () => {
    const rows = parseOfficialCsv(Buffer.from(fixtureCsv(["2020"], { GE: "2020,GE,NA,NA,NA,NA,NA" }), "utf8"));
    expect(() => validateRows(rows, 1)).not.toThrow();
    expect(rows.find((r) => r["Kanton"] === "GE")?.["Anzahl_Anlagen"]).toBe("NA");
  });

  it("année non numérique : erreur explicite", () => {
    const rows = parseOfficialCsv(Buffer.from(fixtureCsv(["2020"], { ZH: "abcd,ZH,1,1,1,1,1" }), "utf8"));
    expect(() => validateRows(rows, 1)).toThrow(/Année invalide/);
  });

  it("canton hors des 26 (ex. \"CH\" national) : erreur explicite", () => {
    const rows = parseOfficialCsv(Buffer.from(fixtureCsv(["2020"], { ZH: "2020,CH,1,1,1,1,1" }), "utf8"));
    expect(() => validateRows(rows, 1)).toThrow(/Canton invalide/);
  });

  it("nombre invalide (texte, négatif) : erreur explicite", () => {
    const rows = parseOfficialCsv(Buffer.from(fixtureCsv(["2020"], { ZH: "2020,ZH,abc,1,1,1,1" }), "utf8"));
    expect(() => validateRows(rows, 1)).toThrow(/Nombre invalide/);
  });

  it("un canton manquant (25 sur 26) : erreur explicite, jamais servi comme complet", () => {
    const rows = parseOfficialCsv(Buffer.from(fixtureCsv(["2020"]), "utf8")).filter((r) => r["Kanton"] !== "ZH");
    expect(() => validateRows(rows, 1)).toThrow(/Cantons manquants/);
  });

  it("deux années : une complète (26 cantons), une incomplète (25) — erreur explicite même si le total de lignes reste élevé", () => {
    const complete = parseOfficialCsv(Buffer.from(fixtureCsv(["2020"]), "utf8"));
    const incomplete = parseOfficialCsv(Buffer.from(fixtureCsv(["2021"]), "utf8")).filter((r) => r["Kanton"] !== "ZH");
    // Un contrôle sur l'ENSEMBLE du fichier seulement passerait (ZH présent via 2020) : c'est
    // exactement le cas qu'un contrôle par année seule détecte.
    expect(() => validateRows([...complete, ...incomplete], 1)).toThrow(/Cantons manquants pour l'année 2021/);
  });

  it("doublon (Jahr, Kanton) : erreur explicite", () => {
    const rows = parseOfficialCsv(Buffer.from(fixtureCsv(["2020"]), "utf8"));
    expect(() => validateRows([...rows, rows[0]], 1)).toThrow(/Doublon/);
  });

  it("moins de minRows lignes : erreur explicite", () => {
    const rows = parseOfficialCsv(Buffer.from(fixtureCsv(["2020"]), "utf8"));
    expect(() => validateRows(rows, 1000)).toThrow(/lignes|seuil/i);
  });
});

describe("reduceRows et sortRows", () => {
  it("colonnes renommées en anglais, valeurs recopiées telles quelles (y compris \"NA\")", () => {
    const rows = parseOfficialCsv(Buffer.from(fixtureCsv(["2020"], { GE: "2020,GE,NA,NA,NA,NA,NA" }), "utf8"));
    const reduced = reduceRows(rows);
    const ge = reduced.find((r) => r.canton === "GE");
    expect(ge).toEqual({
      year: "2020", canton: "GE", installations_count: "NA", installed_capacity_kw: "NA",
      remuneration_chf: "NA", installations_per_100000_inhabitants: "NA", installed_capacity_kw_per_100000_inhabitants: "NA",
    });
  });

  it("triées par année puis canton", () => {
    const rows = parseOfficialCsv(Buffer.from(fixtureCsv(["2021", "2020"]), "utf8"));
    const sorted = sortRows(reduceRows(rows));
    expect(sorted[0].year).toBe("2020");
    expect(sorted.at(-1)?.year).toBe("2021");
    const years2020 = sorted.filter((r) => r.year === "2020").map((r) => r.canton);
    expect(years2020).toEqual([...years2020].sort());
  });
});

describe("toCsv", () => {
  it("en-tête anglais stable", () => {
    const rows: BfePvRow[] = [{
      year: "2020", canton: "ZH", installations_count: "1", installed_capacity_kw: "1",
      remuneration_chf: "1", installations_per_100000_inhabitants: "1", installed_capacity_kw_per_100000_inhabitants: "1",
    }];
    expect(toCsv(rows).split("\n")[0].trim()).toBe(
      "year,canton,installations_count,installed_capacity_kw,remuneration_chf,installations_per_100000_inhabitants,installed_capacity_kw_per_100000_inhabitants",
    );
  });
});

describe("syncBfePv (mode fixture, aucun réseau)", () => {
  it("écrit le CSV (colonnes anglaises) et le fichier meta {edition, source, rows}", async () => {
    const dir = tmpDir();
    const fixturePath = writeFixtureFile(dir, fixtureCsv(["2020"]));
    const outputPath = join(dir, "bfe_pv.csv");
    const result = await syncBfePv({ fixturePath, edition: EDITION, outputPath, minRows: 1 });
    expect(result.rowCount).toBe(26);
    expect(result.cantonsSeen).toBe(26);
    expect(result.changed).toBe(true);
    const csv = readFileSync(outputPath, "utf8");
    expect(csv.split("\n")[0]).toContain("installations_per_100000_inhabitants");
    const meta = JSON.parse(readFileSync(result.metaPath, "utf8"));
    expect(meta).toEqual({ edition: EDITION, source: BFE_PV_CSV_URL, rows: 26 });
  });

  it("--edition absent en mode fixture : erreur explicite, aucune écriture", async () => {
    const dir = tmpDir();
    const fixturePath = writeFixtureFile(dir, fixtureCsv(["2020"]));
    const outputPath = join(dir, "bfe_pv.csv");
    await expect(syncBfePv({ fixturePath, outputPath, minRows: 1 })).rejects.toThrow(/--edition/);
    expect(existsSync(outputPath)).toBe(false);
  });

  it("moins de minRows lignes : échec, fichier précédent intact", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "bfe_pv.csv");
    writeFileSync(outputPath, "year,canton,installations_count,installed_capacity_kw,remuneration_chf,installations_per_100000_inhabitants,installed_capacity_kw_per_100000_inhabitants\n2019,ZH,1,1,1,1,1\n", "utf8");
    const before = readFileSync(outputPath, "utf8");
    const fixturePath = writeFixtureFile(dir, fixtureCsv(["2020"]));
    await expect(syncBfePv({ fixturePath, edition: EDITION, outputPath, minRows: 1000 })).rejects.toThrow(/lignes|seuil/i);
    expect(readFileSync(outputPath, "utf8")).toBe(before);
  });

  it("baisse de plus de maxDropRatio par rapport au fichier précédent : échec, fichier précédent intact", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "bfe_pv.csv");
    const previousLines = Array.from({ length: 300 }, (_, i) => `19${String(i).padStart(2, "0")},ZH,1,1,1,1,1`);
    const previousCsv = ["year,canton,installations_count,installed_capacity_kw,remuneration_chf,installations_per_100000_inhabitants,installed_capacity_kw_per_100000_inhabitants", ...previousLines].join("\n") + "\n";
    writeFileSync(outputPath, previousCsv, "utf8");
    const fixturePath = writeFixtureFile(dir, fixtureCsv(["2020"])); // seulement 26 lignes : grosse baisse
    await expect(syncBfePv({ fixturePath, edition: EDITION, outputPath, minRows: 1 })).rejects.toThrow(/baisse/i);
    expect(readFileSync(outputPath, "utf8")).toBe(previousCsv);
  });

  it("même contenu reconduit : changed=false, fichier non réécrit", async () => {
    const dir = tmpDir();
    const fixturePath = writeFixtureFile(dir, fixtureCsv(["2020"]));
    const outputPath = join(dir, "bfe_pv.csv");
    const first = await syncBfePv({ fixturePath, edition: EDITION, outputPath, minRows: 1 });
    expect(first.changed).toBe(true);
    const second = await syncBfePv({ fixturePath, edition: EDITION, outputPath, minRows: 1 });
    expect(second.changed).toBe(false);
  });

  it("deux ratios OFEN volontairement incohérents avec le compte d'installations : recopiés tels quels, jamais recalculés", async () => {
    const dir = tmpDir();
    // 2 installations mais un ratio "pro 100 000 Einwohner" de 99999 : incohérent en apparence,
    // mais c'est un FAIT publié par l'OFEN (dénominateur = population, pas le compte lui-même) —
    // le script ne doit jamais le corriger ni le recalculer.
    const fixturePath = writeFixtureFile(dir, fixtureCsv(["2020"], { ZH: "2020,ZH,2,2.5,2500,99999,88888" }));
    const outputPath = join(dir, "bfe_pv.csv");
    await syncBfePv({ fixturePath, edition: EDITION, outputPath, minRows: 1 });
    const csv = readFileSync(outputPath, "utf8");
    const zhLine = csv.split("\n").find((l) => l.startsWith("2020,ZH,"));
    expect(zhLine).toBe("2020,ZH,2,2.5,2500,99999,88888");
  });
});

describe("syncBfePv (mode réseau, fetchImpl injecté — jamais de fetch global)", () => {
  it("téléchargement réussi : édition = date du jour UTC (now() injectée)", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "bfe_pv.csv");
    const csv = fixtureCsv(["2020"]);
    const fetchImpl = (async (url: string | URL) => {
      expect(String(url)).toBe(BFE_PV_CSV_URL);
      return new Response(csv, { status: 200, headers: { "content-type": "text/csv" } });
    }) as typeof fetch;
    const result = await syncBfePv({ outputPath, minRows: 1, fetchImpl, now: () => Date.parse("2026-10-07T10:00:00Z") });
    expect(result.edition).toBe("2026-10-07");
  });

  it("l'OFEN republie une fois par an : un passage mensuel sans changement de contenu garde l'ancienne édition, ne commite rien", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "bfe_pv.csv");
    const csv = fixtureCsv(["2020"]);
    const fetchImpl = (async () => new Response(csv, { status: 200 })) as typeof fetch;
    const first = await syncBfePv({ outputPath, minRows: 1, fetchImpl, now: () => Date.parse("2026-10-06T10:00:00Z") });
    expect(first.edition).toBe("2026-10-06");
    expect(first.changed).toBe(true);
    // Un mois plus tard, exactement le même contenu OFEN (republication annuelle, pas de
    // nouvelle donnée) : l'édition NE DOIT PAS avancer à la date du jour, sinon la fiche
    // changerait chaque mois sans aucune donnée nouvelle.
    const second = await syncBfePv({ outputPath, minRows: 1, fetchImpl, now: () => Date.parse("2026-11-06T10:00:00Z") });
    expect(second.changed).toBe(false);
    expect(second.edition).toBe("2026-10-06"); // édition de la PREMIÈRE collecte de ce contenu, jamais 2026-11-06
    const meta = JSON.parse(readFileSync(second.metaPath, "utf8"));
    expect(meta.edition).toBe("2026-10-06");
  });

  it("HTTP 500 : le script échoue, fichier précédent intact, aucune écriture partielle", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "bfe_pv.csv");
    writeFileSync(outputPath, "year,canton,installations_count,installed_capacity_kw,remuneration_chf,installations_per_100000_inhabitants,installed_capacity_kw_per_100000_inhabitants\n2019,ZH,1,1,1,1,1\n", "utf8");
    const before = readFileSync(outputPath, "utf8");
    const fetchImpl = (async () => new Response("erreur serveur", { status: 500 })) as typeof fetch;
    await expect(syncBfePv({ outputPath, minRows: 1, fetchImpl })).rejects.toThrow(/500/);
    expect(readFileSync(outputPath, "utf8")).toBe(before);
  });

  it("Content-Length déclaré au-delà du plafond : échec avant lecture du corps", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "bfe_pv.csv");
    const fetchImpl = (async () => new Response(fixtureCsv(["2020"]), { status: 200, headers: { "content-length": "999999999" } })) as typeof fetch;
    await expect(syncBfePv({ outputPath, minRows: 1, fetchImpl })).rejects.toThrow(/volumineux/i);
  });
});
