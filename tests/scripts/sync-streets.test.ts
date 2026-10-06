/**
 * Tests de `scripts/sync-streets.ts` (tâche osd.localites, tâche B1 du plan
 * `2026-10-06-prospection-et-api.md`), SUR LE MODÈLE EXACT de
 * `tests/scripts/sync-localities.test.ts`.
 *
 * Aucun appel réseau : les ZIP sont construits en mémoire (`archiver`), le mode `--fixture` /
 * `fixturePath` évite tout appel au catalogue STAC, et les tests du chemin réseau injectent
 * `fetchImpl` (maquette pure, jamais `fetch` global). Les lignes réelles utilisées ci-dessous
 * (General-Guisan-Strasse à Winterthur 230, Genève 6621) sont des copies littérales du fichier
 * officiel `amtliches-strassenverzeichnis_ch_2056.csv` du 06.10.2026, jamais inventées.
 */
import { afterEach, describe, expect, it } from "vitest";
import archiver from "archiver";
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SWISSTOPO_STREETS_ASSET_NAME, SWISSTOPO_STREETS_STAC_ITEMS_URL } from "../../etl/streets/sources.js";
import {
  type StreetRow,
  dedupeRows,
  extractCsvFromZip,
  filterRealOfficial,
  parseArgs,
  parseOfficialCsv,
  parseZipLabel,
  partitionLiechtenstein,
  reduceRows,
  sortRows,
  syncStreets,
  toCsv,
  validateEncoding,
  validateRows,
} from "../../scripts/sync-streets.js";

/** Construit un ZIP en mémoire ; même motif que `tests/scripts/sync-localities.test.ts`. */
function makeZip(files: Record<string, string | Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 1 } });
    const chunks: Buffer[] = [];
    archive.on("data", (d: Buffer) => chunks.push(d));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    for (const [name, content] of Object.entries(files)) archive.append(content, { name });
    void archive.finalize();
  });
}

const EXPECTED_HEADER =
  "STR_ESID;STN_LABEL;ZIP_LABEL;COM_FOSNR;COM_NAME;COM_CANTON;STR_TYPE;STR_STATUS;STR_OFFICIAL;STR_MODIFIED;STR_EASTING;STR_NORTHING;STR_PARENT;STR_CHILDREN";

// Lignes réelles, copiées telles quelles du fichier officiel du 06.10.2026.
const S_GUISAN_WINTERTHUR =
  "10057390;General-Guisan-Strasse;8400 Winterthur;230;Winterthur;ZH;Street;real;true;30.03.2026;2697526.682;1262046.543;;";
const S_GENEVE =
  "10263077;Rue Lina-STERN;1227 Les Acacias;6621;Genève;GE;Street;real;true;13.03.2025;2499360.491;1116488.511;;";
const S_GENEVE_PLANNED =
  "10263075;Chemin Elisabeth-De-STOUTZ;1208 Genève;6621;Genève;GE;Street;planned;true;01.04.2025;2502271.153;1117639.972;;";
const S_MULTI_ZIP_LAUSANNE =
  "10200001;Avenue de la Gare;1000 Lausanne 25, 1003 Lausanne;5586;Lausanne;VD;Street;real;true;01.01.2020;0;0;;";
const S_DUPLICATE_A =
  "10184313;Avenue du Tir-Fédéral;1022 Chavannes-près-Renens;5627;Chavannes-près-Renens;VD;Street;real;true;29.07.2024;0;0;;";
const S_DUPLICATE_B =
  "10257255;Avenue du Tir-Fédéral;1022 Chavannes-près-Renens;5627;Chavannes-près-Renens;VD;Street;real;true;22.05.2026;0;0;;";
const S_VADUZ = "19999999;Städtle;9490 Vaduz;7001;Vaduz;;Street;real;true;01.01.2020;0;0;;";
const S_NOT_OFFICIAL = "10000002;Rue Fictive;1000 Lausanne;5586;Lausanne;VD;Street;real;false;01.01.2020;0;0;;";

const REAL_LINES = [S_GUISAN_WINTERTHUR, S_GENEVE, S_GENEVE_PLANNED, S_MULTI_ZIP_LAUSANNE, S_DUPLICATE_A, S_DUPLICATE_B];

function csvText(lines: string[], header = EXPECTED_HEADER): string {
  // Fichier officiel : BOM, pas de guillemets, séparateur `;` (identique à sync-localities, sans CRLF ici pour varier la fixture).
  return "﻿" + [header, ...lines].join("\n") + "\n";
}

const CSV_ENTRY = "amtliches-strassenverzeichnis_ch_2056.csv";
const EDITION = "2026-10-06"; // édition réelle du fichier, relevée le 06.10.2026 (plan)

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "osd-sync-streets-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("extractCsvFromZip", () => {
  it("retrouve le CSV par son nom de fichier seul", async () => {
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR, S_GENEVE]) });
    const buf = await extractCsvFromZip(zip, SWISSTOPO_STREETS_ASSET_NAME.replace(".zip", ""));
    expect(buf.toString("utf8")).toContain("General-Guisan-Strasse");
  });

  it("fichier absent du ZIP : rejet explicite", async () => {
    const zip = await makeZip({ "autre.csv": "x" });
    await expect(extractCsvFromZip(zip, CSV_ENTRY)).rejects.toThrow(/absent du ZIP/);
  });
});

describe("parseOfficialCsv", () => {
  it("BOM reconnu, lignes lues", () => {
    const rows = parseOfficialCsv(Buffer.from(csvText([S_GUISAN_WINTERTHUR]), "utf8"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ STN_LABEL: "General-Guisan-Strasse", ZIP_LABEL: "8400 Winterthur", COM_FOSNR: "230", COM_CANTON: "ZH" });
  });

  it("en-tête modifié (colonne renommée) : échec visible", () => {
    const header = EXPECTED_HEADER.replace("COM_CANTON", "Kanton");
    const buf = Buffer.from(csvText([S_GUISAN_WINTERTHUR], header), "utf8");
    expect(() => parseOfficialCsv(buf)).toThrow(/en-tête/i);
  });

  it("en-tête avec colonnes dans un autre ordre : échec visible", () => {
    const header = "STN_LABEL;STR_ESID;ZIP_LABEL;COM_FOSNR;COM_NAME;COM_CANTON;STR_TYPE;STR_STATUS;STR_OFFICIAL;STR_MODIFIED;STR_EASTING;STR_NORTHING;STR_PARENT;STR_CHILDREN";
    const buf = Buffer.from(csvText([S_GUISAN_WINTERTHUR], header), "utf8");
    expect(() => parseOfficialCsv(buf)).toThrow(/en-tête/i);
  });

  it("accents conservés tels quels (Genève, pas Geneve)", () => {
    const rows = parseOfficialCsv(Buffer.from(csvText([S_GENEVE]), "utf8"));
    expect(rows[0].COM_NAME).toBe("Genève");
    expect(rows[0].COM_NAME).not.toBe("Geneve");
  });
});

describe("validateEncoding", () => {
  it("accepte un fichier réel qui contient une rue de Genève (6621)", () => {
    const buf = Buffer.from(csvText([S_GUISAN_WINTERTHUR, S_GENEVE]), "utf8");
    const rows = parseOfficialCsv(buf);
    expect(() => validateEncoding(buf, rows)).not.toThrow();
  });

  it("caractère de remplacement U+FFFD dans le texte : échec, même si Genève 6621 est présente", () => {
    const corrompu = csvText([S_GUISAN_WINTERTHUR, S_GENEVE]).replace("General-Guisan-Strasse", "General-Gu�san-Strasse");
    const buf = Buffer.from(corrompu, "utf8");
    const rows = parseOfficialCsv(buf);
    expect(() => validateEncoding(buf, rows)).toThrow(/U\+FFFD|encodage/i);
  });

  it("aucune rue de Genève 6621 : échec (canari d'encodage)", () => {
    const buf = Buffer.from(csvText([S_GUISAN_WINTERTHUR]), "utf8"); // pas de Genève ici
    const rows = parseOfficialCsv(buf);
    expect(() => validateEncoding(buf, rows)).toThrow(/genève|6621|encodage/i);
  });

  it("Genève altérée (accent perdu, \"Geneve\") sous le même numéro OFS : échec", () => {
    const altere = csvText([S_GUISAN_WINTERTHUR, S_GENEVE.replace("Genève", "Geneve")]);
    const buf = Buffer.from(altere, "utf8");
    const rows = parseOfficialCsv(buf);
    expect(() => validateEncoding(buf, rows)).toThrow(/genève|6621|encodage/i);
  });
});

describe("partitionLiechtenstein", () => {
  it("exclut uniquement les communes du Liechtenstein (BFS 7001-7011, canton vide)", () => {
    const rows = parseOfficialCsv(Buffer.from(csvText([S_GUISAN_WINTERTHUR, S_VADUZ]), "utf8"));
    const { rows: kept, excluded } = partitionLiechtenstein(rows);
    expect(excluded).toBe(1);
    expect(kept).toHaveLength(1);
    expect(kept[0].STN_LABEL).toBe("General-Guisan-Strasse");
  });

  it("une ligne à canton vide HORS de 7001-7011 n'est jamais exclue silencieusement", () => {
    const rows = parseOfficialCsv(Buffer.from(csvText([S_GUISAN_WINTERTHUR]), "utf8"));
    const faux = rows.map((r) => ({ ...r, COM_CANTON: "", COM_FOSNR: "999999" }));
    const { rows: kept, excluded } = partitionLiechtenstein(faux);
    expect(excluded).toBe(0);
    expect(kept).toHaveLength(1);
  });
});

describe("filterRealOfficial", () => {
  it("écarte les tronçons planifiés (STR_STATUS=planned) et non officiels (STR_OFFICIAL=false)", () => {
    const rows = parseOfficialCsv(Buffer.from(csvText([S_GUISAN_WINTERTHUR, S_GENEVE_PLANNED, S_NOT_OFFICIAL]), "utf8"));
    const kept = filterRealOfficial(rows);
    expect(kept).toHaveLength(1);
    expect(kept[0].STN_LABEL).toBe("General-Guisan-Strasse");
  });
});

describe("parseZipLabel", () => {
  it("couple simple (\"8400 Winterthur\")", () => {
    expect(parseZipLabel("8400 Winterthur")).toEqual({ postalCode: "8400", locality: "Winterthur" });
  });
  it("localité à plusieurs mots avec suffixe cantonal (\"9053 Teufen AR\")", () => {
    expect(parseZipLabel("9053 Teufen AR")).toEqual({ postalCode: "9053", locality: "Teufen AR" });
  });
  it("liste de couples séparés par ', ' : seul le premier est retenu", () => {
    expect(parseZipLabel("1000 Lausanne 25, 1003 Lausanne")).toEqual({ postalCode: "1000", locality: "Lausanne 25" });
  });
});

describe("validateRows", () => {
  const valid = () => filterRealOfficial(parseOfficialCsv(Buffer.from(csvText([S_GUISAN_WINTERTHUR, S_GENEVE]), "utf8")));

  it("accepte un jeu de lignes réelles valides (minRows abaissé pour le test)", () => {
    expect(() => validateRows(valid(), 1)).not.toThrow();
  });
  it("moins de minRows lignes : échec", () => {
    expect(() => validateRows(valid(), 1000)).toThrow(/lignes/i);
  });
  it("nom de rue vide : échec", () => {
    const rows = valid();
    rows[0].STN_LABEL = "";
    expect(() => validateRows(rows, 1)).toThrow(/rue/i);
  });
  it("NPA non conforme (pas 4 chiffres) : échec", () => {
    const rows = valid();
    rows[0].ZIP_LABEL = "840 Winterthur";
    expect(() => validateRows(rows, 1)).toThrow(/NPA/i);
  });
  it("numéro OFS non entier : échec", () => {
    const rows = valid();
    rows[0].COM_FOSNR = "23O"; // lettre O au lieu du chiffre 0
    expect(() => validateRows(rows, 1)).toThrow(/OFS/i);
  });
  it("canton hors des 26 abréviations (et non vide) : échec", () => {
    const rows = valid();
    rows[0].COM_CANTON = "XX";
    expect(() => validateRows(rows, 1)).toThrow(/canton/i);
  });
});

describe("reduceRows / sortRows / dedupeRows / toCsv", () => {
  it("colonnes réduites : street, postal_code, locality, municipality_bfs_id, municipality, canton", () => {
    const raw = filterRealOfficial(parseOfficialCsv(Buffer.from(csvText([S_GUISAN_WINTERTHUR]), "utf8")));
    const reduced = reduceRows(raw);
    expect(reduced[0]).toEqual({
      street: "General-Guisan-Strasse",
      postal_code: "8400",
      locality: "Winterthur",
      municipality_bfs_id: "230",
      municipality: "Winterthur",
      canton: "ZH",
    });
  });

  it("ZIP_LABEL multi-couples : seul le premier couple apparaît dans postal_code/locality", () => {
    const raw = filterRealOfficial(parseOfficialCsv(Buffer.from(csvText([S_MULTI_ZIP_LAUSANNE]), "utf8")));
    const reduced = reduceRows(raw);
    expect(reduced[0].postal_code).toBe("1000");
    expect(reduced[0].locality).toBe("Lausanne 25");
  });

  it("dédoublonnage : deux STR_ESID pour la même rue/NPA/commune ne produisent qu'une ligne", () => {
    const raw = filterRealOfficial(parseOfficialCsv(Buffer.from(csvText([S_DUPLICATE_A, S_DUPLICATE_B]), "utf8")));
    const deduped = dedupeRows(sortRows(reduceRows(raw)));
    expect(deduped).toHaveLength(1);
    expect(deduped[0].street).toBe("Avenue du Tir-Fédéral");
  });

  it("le dédoublonnage reste stable d'un appel à l'autre (déterminisme, indépendant de l'ordre d'entrée)", () => {
    const rawA = filterRealOfficial(parseOfficialCsv(Buffer.from(csvText([S_DUPLICATE_A, S_DUPLICATE_B]), "utf8")));
    const rawB = filterRealOfficial(parseOfficialCsv(Buffer.from(csvText([S_DUPLICATE_B, S_DUPLICATE_A]), "utf8")));
    const a = dedupeRows(sortRows(reduceRows(rawA)));
    const b = dedupeRows(sortRows(reduceRows(rawB)));
    expect(a).toEqual(b);
  });

  it("tri par numéro OFS de commune puis par rue (déterministe)", () => {
    const raw = filterRealOfficial(parseOfficialCsv(Buffer.from(csvText([S_GENEVE, S_GUISAN_WINTERTHUR]), "utf8")));
    const sorted = sortRows(reduceRows(raw));
    expect(sorted.map((r) => r.municipality_bfs_id)).toEqual(["230", "6621"]);
  });

  it("toCsv produit un en-tête stable et des accents conservés", () => {
    const raw = filterRealOfficial(parseOfficialCsv(Buffer.from(csvText([S_GENEVE]), "utf8")));
    const csv = toCsv(sortRows(reduceRows(raw)));
    expect(csv.split("\n")[0].trim()).toBe("street,postal_code,locality,municipality_bfs_id,municipality,canton");
    expect(csv).toContain("Genève");
  });
});

describe("parseArgs", () => {
  it("sans argument : rien", () => {
    expect(parseArgs([])).toEqual({});
  });
  it("--fixture <chemin> : chemin lu", () => {
    expect(parseArgs(["--fixture", "/tmp/x.zip"])).toEqual({ fixturePath: "/tmp/x.zip" });
  });
  it("--fixture sans valeur : erreur explicite", () => {
    expect(() => parseArgs(["--fixture"])).toThrow(/--fixture/);
  });
  it("--edition <date> : date lue", () => {
    expect(parseArgs(["--edition", "2026-10-06"])).toEqual({ edition: "2026-10-06" });
  });
  it("--edition sans valeur : erreur explicite", () => {
    expect(() => parseArgs(["--edition"])).toThrow(/--edition/);
  });
});

describe("syncStreets (bout en bout, ZIP en mémoire, aucun réseau)", () => {
  it("mode fixture : aucun appel à fetchImpl, fichier .csv.gz écrit", async () => {
    const dir = tmpDir();
    const zip = await makeZip({ [CSV_ENTRY]: csvText(REAL_LINES) });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);
    let appele = false;
    const fetchImpl = (async () => {
      appele = true;
      throw new Error("ne doit jamais être appelé en mode fixture");
    }) as typeof fetch;

    const outputPath = join(dir, "streets.csv.gz");
    const result = await syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath, fetchImpl, minRows: 1 });
    expect(appele).toBe(false);
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.excludedLiechtenstein).toBe(0);
    expect(result.changed).toBe(true);
    expect(result.edition).toBe(EDITION);
    const writtenCsv = gunzipSync(readFileSync(outputPath)).toString("utf8");
    expect(writtenCsv).toContain("General-Guisan-Strasse");
    expect(writtenCsv).toContain("Genève");
    // Le tronçon "planned" (S_GENEVE_PLANNED) est exclu : seules S_GENEVE et S_GUISAN_WINTERTHUR
    // + l'unique ligne dédoublonnée + Lausanne restent, soit 4 lignes.
    expect(result.rowCount).toBe(4);
  });

  it("--edition absent en mode fixture : erreur explicite, aucune écriture", async () => {
    const dir = tmpDir();
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR, S_GENEVE]) });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);
    const outputPath = join(dir, "streets.csv.gz");
    await expect(syncStreets({ fixturePath: zipPath, outputPath, minRows: 1 })).rejects.toThrow(/--edition/);
    expect(existsSync(outputPath)).toBe(false);
  });

  it("--edition mal formée en mode fixture : erreur explicite", async () => {
    const dir = tmpDir();
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR, S_GENEVE]) });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);
    const outputPath = join(dir, "streets.csv.gz");
    await expect(syncStreets({ fixturePath: zipPath, edition: "06.10.2026", outputPath, minRows: 1 })).rejects.toThrow(/--edition/);
  });

  it("exclut les communes du Liechtenstein du fichier écrit, et compte l'exclusion", async () => {
    const dir = tmpDir();
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR, S_GENEVE, S_VADUZ]) });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);
    const outputPath = join(dir, "streets.csv.gz");
    const result = await syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(result.excludedLiechtenstein).toBe(1);
    const written = gunzipSync(readFileSync(outputPath)).toString("utf8");
    expect(written).not.toContain("Vaduz");
  });

  it("fichier précédent absent (premier run) : aucun contrôle de baisse, écrit même avec peu de lignes", async () => {
    const dir = tmpDir();
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR, S_GENEVE]) });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);
    const outputPath = join(dir, "streets.csv.gz");
    const result = await syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(result.previousRowCount).toBeNull();
    expect(result.rowCount).toBe(2);
  });

  it("baisse de plus de 2% par rapport au fichier précédent : échec, fichier précédent INCHANGÉ", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "streets.csv.gz");
    const header = "street,postal_code,locality,municipality_bfs_id,municipality,canton";
    const previousLines = Array.from({ length: 100 }, (_, i) => `Rue${i},800${i % 10},Loc${i},${100 + i},Mun${i},ZH`);
    const previousCsv = [header, ...previousLines].join("\n") + "\n";
    const previousGz = gzipSync(Buffer.from(previousCsv, "utf8"), { level: 9 });
    writeFileSync(outputPath, previousGz);

    // Nouveau fichier : 90 lignes synthétiques + Genève (contrôle d'encodage) = 91, baisse de 9 %.
    const zip = await makeZip({
      [CSV_ENTRY]: csvText([
        ...Array.from({ length: 90 }, (_, i) => `1${String(i).padStart(7, "0")};Rue${i};800${i % 10} Loc${i};${100 + i};Mun${i};ZH;Street;real;true;01.01.2020;0;0;;`),
        S_GENEVE,
      ]),
    });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);

    await expect(syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 })).rejects.toThrow(/baisse/i);
    expect(readFileSync(outputPath).equals(previousGz)).toBe(true); // jamais touché
  });

  it("baisse de moins de 2% : accepté, fichier remplacé", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "streets.csv.gz");
    const header = "street,postal_code,locality,municipality_bfs_id,municipality,canton";
    const previousLines = Array.from({ length: 100 }, (_, i) => `Rue${i},800${i % 10},Loc${i},${100 + i},Mun${i},ZH`);
    writeFileSync(outputPath, gzipSync(Buffer.from([header, ...previousLines].join("\n") + "\n", "utf8"), { level: 9 }));

    // 98 lignes synthétiques + Genève = 99 lignes : baisse de 1 %, sous le seuil de 2 %.
    const zip = await makeZip({
      [CSV_ENTRY]: csvText([
        ...Array.from({ length: 98 }, (_, i) => `1${String(i).padStart(7, "0")};Rue${i};800${i % 10} Loc${i};${100 + i};Mun${i};ZH;Street;real;true;01.01.2020;0;0;;`),
        S_GENEVE,
      ]),
    });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);

    const result = await syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(result.rowCount).toBe(99);
    expect(result.changed).toBe(true);
  });

  it("contrôle en échec (en-tête modifié) : le fichier précédent reste intact, octet pour octet", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "streets.csv.gz");
    const header = "street,postal_code,locality,municipality_bfs_id,municipality,canton";
    const previousGz = gzipSync(Buffer.from([header, "General-Guisan-Strasse,8400,Winterthur,230,Winterthur,ZH"].join("\n") + "\n", "utf8"), { level: 9 });
    writeFileSync(outputPath, previousGz);

    const badHeader = EXPECTED_HEADER.replace("COM_FOSNR", "BFS");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR], badHeader) });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);

    await expect(syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 })).rejects.toThrow(/en-tête/i);
    expect(readFileSync(outputPath).equals(previousGz)).toBe(true);
  });

  it("aucune rue de Genève 6621 : échec avant toute écriture (contrôle d'encodage)", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "streets.csv.gz");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR]) }); // pas de Genève
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);

    await expect(syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 })).rejects.toThrow(/genève|6621|encodage/i);
    expect(existsSync(outputPath)).toBe(false);
  });

  it("même contenu reconduit (aucun changement) : changed=false, mêmes octets gzip qu'avant", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "streets.csv.gz");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR, S_GENEVE]) });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);

    const first = await syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(first.changed).toBe(true);
    const firstBytes = readFileSync(outputPath);
    const second = await syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(second.changed).toBe(false);
    expect(second.rowCount).toBe(first.rowCount);
    expect(readFileSync(outputPath).equals(firstBytes)).toBe(true); // gzip déterministe : octets identiques
  });

  it("même CSV mais ÉDITION différente : changed=true (le fichier de métadonnées a changé)", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "streets.csv.gz");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR, S_GENEVE]) });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);

    const first = await syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(first.changed).toBe(true);
    const second = await syncStreets({ fixturePath: zipPath, edition: "2026-11-03", outputPath, minRows: 1 });
    expect(second.changed).toBe(true);
    expect(second.rowCount).toBe(first.rowCount);
  });
});

describe("streets.meta.json", () => {
  it("écrit { edition, source, rows } à côté du fichier .csv.gz, par défaut", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "streets.csv.gz");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR, S_GENEVE]) });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);

    const result = await syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(result.metaPath).toBe(join(dir, "streets.meta.json"));
    const meta = JSON.parse(readFileSync(result.metaPath, "utf8"));
    expect(meta).toEqual({ edition: EDITION, source: SWISSTOPO_STREETS_STAC_ITEMS_URL, rows: result.rowCount });
  });

  it("chemin personnalisé (`metaPath`) respecté", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "streets.csv.gz");
    const metaPath = join(dir, "sous-dossier", "meta-personnalise.json");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR, S_GENEVE]) });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);

    const result = await syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath, metaPath, minRows: 1 });
    expect(result.metaPath).toBe(metaPath);
    expect(JSON.parse(readFileSync(metaPath, "utf8")).edition).toBe(EDITION);
  });
});

describe("syncStreets (mode réseau, fetchImpl injecté — aucun fetch global touché)", () => {
  function stacResponse(datetime: string, href = "https://example.test/rues.zip"): Response {
    const body = {
      features: [
        {
          properties: { datetime },
          assets: { [SWISSTOPO_STREETS_ASSET_NAME]: { href } },
        },
      ],
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }

  it("édition dérivée de la propriété STAC `datetime` (tronquée au jour)", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "streets.csv.gz");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR, S_GENEVE]) });

    const fetchImpl = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href === SWISSTOPO_STREETS_STAC_ITEMS_URL) return stacResponse("2026-11-03T05:12:00Z");
      return new Response(zip, { status: 200 });
    }) as typeof fetch;

    const result = await syncStreets({ outputPath, minRows: 1, fetchImpl });
    expect(result.edition).toBe("2026-11-03");
  });

  it("Content-Length déclaré au-delà de 40 Mo : échec avant de lire le corps", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "streets.csv.gz");
    const fetchImpl = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href === SWISSTOPO_STREETS_STAC_ITEMS_URL) return stacResponse("2026-10-06T00:00:00Z");
      return new Response(new Uint8Array(10), { status: 200, headers: { "content-length": "45000000" } });
    }) as typeof fetch;

    await expect(syncStreets({ outputPath, minRows: 1, fetchImpl })).rejects.toThrow(/volumineux/i);
  });

  it("date d'édition STAC absente : échec explicite", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "streets.csv.gz");
    const fetchImpl = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href === SWISSTOPO_STREETS_STAC_ITEMS_URL) {
        return new Response(JSON.stringify({ features: [{ properties: {}, assets: { [SWISSTOPO_STREETS_ASSET_NAME]: { href: "https://example.test/rues.zip" } } }] }), { status: 200 });
      }
      return new Response(new Uint8Array(10), { status: 200 });
    }) as typeof fetch;

    await expect(syncStreets({ outputPath, minRows: 1, fetchImpl })).rejects.toThrow(/édition|datetime/i);
  });
});

describe("gzip déterministe (tâche B1, leçon de relecture)", () => {
  it("deux générations successives du même CSV donnent exactement les mêmes octets", async () => {
    const dir = tmpDir();
    const zip = await makeZip({ [CSV_ENTRY]: csvText([S_GUISAN_WINTERTHUR, S_GENEVE]) });
    const zipPath = join(dir, "rues.zip");
    writeFileSync(zipPath, zip);

    const out1 = join(dir, "a", "streets.csv.gz");
    const out2 = join(dir, "b", "streets.csv.gz");
    await syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath: out1, minRows: 1 });
    await syncStreets({ fixturePath: zipPath, edition: EDITION, outputPath: out2, minRows: 1 });
    expect(readFileSync(out1).equals(readFileSync(out2))).toBe(true);
  });
});

// Type guard : la fonction `reduceRows` doit rendre des `StreetRow` typés.
describe("typage", () => {
  it("reduceRows rend des StreetRow", () => {
    const raw = filterRealOfficial(parseOfficialCsv(Buffer.from(csvText([S_GUISAN_WINTERTHUR]), "utf8")));
    const rows: StreetRow[] = reduceRows(raw);
    expect(rows[0].street).toBe("General-Guisan-Strasse");
  });
});
