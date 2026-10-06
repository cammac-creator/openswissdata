/**
 * Tests de `scripts/sync-localities.ts` (tâche osd.localites, tâche 1 ; relecture finale du
 * 06.10.2026, points 4/6/7).
 *
 * Aucun appel réseau : les ZIP sont construits en mémoire (`archiver`, même motif que
 * `tests/mcp/r2-refresh.test.ts`), le mode `--fixture` / `fixturePath` évite tout appel au
 * catalogue STAC, et les quelques tests du chemin réseau injectent `fetchImpl` (maquette pure,
 * jamais `fetch` global). Les lignes de localités réelles utilisées ci-dessous (Winterthur
 * 8400, Kemptthal 8310, Genève 1201/1202/1204, Vaduz 9490) sont des copies littérales du
 * fichier officiel `AMTOVZ_CSV_WGS84.csv` téléchargé le 06.10.2026 (empreinte SHA-256
 * commençant par 39249c4a469101ff), jamais inventées. `L_GENEVE_1204` est ajoutée à TOUTE
 * fixture passée à `syncLocalities()` (contrairement aux tests unitaires de fonctions pures
 * ci-dessous) : le contrôle d'encodage (point 6) l'exige désormais sur chaque collecte.
 */
import { afterEach, describe, expect, it } from "vitest";
import archiver from "archiver";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SWISSTOPO_LOCALITIES_ASSET_NAME, SWISSTOPO_LOCALITIES_STAC_ITEMS_URL } from "../../etl/localities/sources.js";
import {
  type LocalityRow,
  extractCsvFromZip,
  parseArgs,
  parseOfficialCsv,
  partitionLiechtenstein,
  reduceRows,
  sortRows,
  syncLocalities,
  toCsv,
  validateEncoding,
  validateRows,
} from "../../scripts/sync-localities.js";

/** Construit un ZIP en mémoire ; même motif que `tests/mcp/r2-refresh.test.ts`. */
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

const BOM = "﻿";
const EXPECTED_HEADER =
  "Ortschaftsname;PLZ4;Zusatzziffer;ZIP_ID;Gemeindename;BFS-Nr;Kantonskürzel;Adressenanteil;E;N;Sprache;Validity";

// Lignes réelles, copiées telles quelles du fichier officiel du 06.10.2026.
const L_WINTERTHUR = "Winterthur;8400;00;4690;Winterthur;230;ZH;100 %;8.725998786330608;47.50075033840072;de;2008-07-01";
const L_KEMPTTHAL_LINDAU = "Kemptthal;8310;00;4649;Lindau;176;ZH;80.124 %;8.70369948898488;47.44945404675467;de;2008-07-01";
const L_KEMPTTHAL_WINTERTHUR = "Kemptthal;8310;00;4649;Winterthur;230;ZH;19.876 %;8.712147432268727;47.46167577483002;de;2008-07-01";
const L_GRAFSTAL = "Grafstal;8310;01;8834;Lindau;176;ZH;100 %;8.699506124400182;47.44373390693183;de;2008-07-01";
const L_GENEVE_1201 = "Genève;1201;00;367;Genève;6621;GE;100 %;6.143913585005156;46.209796675319325;fr;2008-07-01";
const L_GENEVE_1202 = "Genève;1202;00;368;Genève;6621;GE;99.2 %;6.136809927924694;46.21638160383738;fr;2008-07-01";
const L_GENEVE_1202_PREGNY = "Genève;1202;00;368;Pregny-Chambésy;6634;GE;0.8 %;6.134273744574574;46.23242070242084;fr;2008-07-01";
const L_GENEVE_1204 = "Genève;1204;00;370;Genève;6621;GE;100 %;6.146544876041146;46.20213455236521;fr;2008-07-01";
const L_VADUZ = "Vaduz;9490;00;5393;Vaduz;7001;;100 %;9.517532561031839;47.14313943072252;de;2008-07-01";

const REAL_LINES = [
  L_WINTERTHUR,
  L_KEMPTTHAL_LINDAU,
  L_KEMPTTHAL_WINTERTHUR,
  L_GRAFSTAL,
  L_GENEVE_1201,
  L_GENEVE_1202,
  L_GENEVE_1202_PREGNY,
  L_GENEVE_1204, // contrôle d'encodage (point 6) : exigée dans toute collecte de bout en bout
  L_VADUZ,
];

function csvText(lines: string[], header = EXPECTED_HEADER): string {
  return BOM + [header, ...lines].join("\r\n") + "\r\n";
}

const CSV_ENTRY = "AMTOVZ_CSV_WGS84/AMTOVZ_CSV_WGS84.csv";
const EDITION = "2026-10-01"; // édition réelle du fichier du 06.10.2026, d'après le STAC

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "osd-sync-localities-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("extractCsvFromZip", () => {
  it("retrouve le CSV par son nom de fichier seul, quel que soit le dossier du ZIP", async () => {
    const zip = await makeZip({ [CSV_ENTRY]: csvText([L_WINTERTHUR]) });
    const buf = await extractCsvFromZip(zip, "AMTOVZ_CSV_WGS84.csv");
    expect(buf.toString("utf8")).toContain("Winterthur");
  });

  it("fichier absent du ZIP : rejet explicite", async () => {
    const zip = await makeZip({ "autre.csv": "x" });
    await expect(extractCsvFromZip(zip, "AMTOVZ_CSV_WGS84.csv")).rejects.toThrow(/absent du ZIP/);
  });
});

describe("parseOfficialCsv", () => {
  it("BOM et CRLF réels : en-tête reconnu, lignes lues", () => {
    const rows = parseOfficialCsv(Buffer.from(csvText([L_WINTERTHUR]), "utf8"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Ortschaftsname: "Winterthur", PLZ4: "8400", "BFS-Nr": "230", "Kantonskürzel": "ZH" });
  });

  it("en-tête modifié (colonne renommée) : échec visible, jamais interprété comme des données", () => {
    const header = EXPECTED_HEADER.replace("Kantonskürzel", "Kanton");
    const buf = Buffer.from(csvText([L_WINTERTHUR], header), "utf8");
    expect(() => parseOfficialCsv(buf)).toThrow(/en-tête/i);
  });

  it("en-tête avec colonnes dans un autre ordre : échec visible", () => {
    const header = "PLZ4;Ortschaftsname;Zusatzziffer;ZIP_ID;Gemeindename;BFS-Nr;Kantonskürzel;Adressenanteil;E;N;Sprache;Validity";
    const buf = Buffer.from(csvText([L_WINTERTHUR], header), "utf8");
    expect(() => parseOfficialCsv(buf)).toThrow(/en-tête/i);
  });

  it("accents conservés tels quels (Genève, pas Geneve)", () => {
    const rows = parseOfficialCsv(Buffer.from(csvText([L_GENEVE_1201]), "utf8"));
    expect(rows[0].Ortschaftsname).toBe("Genève");
    expect(rows[0].Ortschaftsname).not.toBe("Geneve");
  });
});

describe("validateEncoding (relecture finale du 06.10.2026, point 6)", () => {
  it("accepte un fichier réel qui contient la ligne Genève du NPA 1204", () => {
    const buf = Buffer.from(csvText([L_WINTERTHUR, L_GENEVE_1204]), "utf8");
    const rows = parseOfficialCsv(buf);
    expect(() => validateEncoding(buf, rows)).not.toThrow();
  });

  it("caractère de remplacement U+FFFD dans le texte : échec, même si la ligne Genève 1204 est présente", () => {
    const corrompu = csvText([L_WINTERTHUR, L_GENEVE_1204]).replace("Winterthur;8400", "Winterth�r;8400");
    const buf = Buffer.from(corrompu, "utf8");
    const rows = parseOfficialCsv(buf);
    expect(() => validateEncoding(buf, rows)).toThrow(/U\+FFFD|encodage/i);
  });

  it("ligne Genève du NPA 1204 absente : échec (canari d'encodage), même sans U+FFFD visible", () => {
    const buf = Buffer.from(csvText([L_WINTERTHUR]), "utf8"); // pas de 1204 ici
    const rows = parseOfficialCsv(buf);
    expect(() => validateEncoding(buf, rows)).toThrow(/genève|1204|encodage/i);
  });

  it("ligne Genève du NPA 1204 altérée (accent perdu, \"Geneve\") : échec", () => {
    const altere = csvText([L_WINTERTHUR, L_GENEVE_1204.replace("Genève", "Geneve")]);
    const buf = Buffer.from(altere, "utf8");
    const rows = parseOfficialCsv(buf);
    expect(() => validateEncoding(buf, rows)).toThrow(/genève|1204|encodage/i);
  });
});

describe("partitionLiechtenstein", () => {
  it("exclut uniquement les communes du Liechtenstein (BFS 7001-7011, canton vide), jamais une autre ligne à canton vide", () => {
    const rows = parseOfficialCsv(Buffer.from(csvText([L_WINTERTHUR, L_VADUZ]), "utf8"));
    const { rows: kept, excluded } = partitionLiechtenstein(rows);
    expect(excluded).toBe(1);
    expect(kept).toHaveLength(1);
    expect(kept[0].Ortschaftsname).toBe("Winterthur");
  });

  it("une ligne à canton vide HORS de 7001-7011 n'est jamais exclue silencieusement (laissée pour validateRows)", () => {
    const rows = parseOfficialCsv(Buffer.from(csvText([L_WINTERTHUR]), "utf8"));
    const faux = rows.map((r) => ({ ...r, "Kantonskürzel": "" , "BFS-Nr": "999999" }));
    const { rows: kept, excluded } = partitionLiechtenstein(faux);
    expect(excluded).toBe(0);
    expect(kept).toHaveLength(1);
  });
});

describe("validateRows", () => {
  const valid = () => parseOfficialCsv(Buffer.from(csvText(REAL_LINES.filter((l) => l !== L_VADUZ)), "utf8"));

  it("accepte un jeu de lignes réelles valides (minRows abaissé pour le test)", () => {
    expect(() => validateRows(valid(), 1)).not.toThrow();
  });

  it("moins de minRows lignes : échec", () => {
    expect(() => validateRows(valid(), 1000)).toThrow(/lignes/i);
  });

  it("NPA non conforme (pas 4 chiffres) : échec, ligne citée", () => {
    const rows = valid();
    rows[0].PLZ4 = "840";
    expect(() => validateRows(rows, 1)).toThrow(/NPA/i);
  });

  it("numéro OFS non entier : échec", () => {
    const rows = valid();
    rows[0]["BFS-Nr"] = "23O"; // lettre O au lieu du chiffre 0
    expect(() => validateRows(rows, 1)).toThrow(/OFS/i);
  });

  it("canton hors des 26 abréviations (et non vide) : échec", () => {
    const rows = valid();
    rows[0]["Kantonskürzel"] = "XX";
    expect(() => validateRows(rows, 1)).toThrow(/canton/i);
  });

  it("canton vide hors Liechtenstein (déjà écarté par partitionLiechtenstein) : échec si on lui soumet quand même la ligne", () => {
    const rows = valid();
    rows[0]["Kantonskürzel"] = "";
    expect(() => validateRows(rows, 1)).toThrow(/canton/i);
  });
});

describe("reduceRows / sortRows / toCsv", () => {
  it("colonnes réduites : ni ZIP_ID, ni Adressenanteil, ni coordonnées, ni Validity", () => {
    const raw = parseOfficialCsv(Buffer.from(csvText([L_WINTERTHUR]), "utf8"));
    const reduced = reduceRows(raw);
    expect(Object.keys(reduced[0]).sort()).toEqual(
      ["canton", "language", "locality", "municipality", "municipality_bfs_id", "postal_code", "postal_code_suffix"].sort(),
    );
    expect(reduced[0]).toEqual({
      postal_code: "8400",
      postal_code_suffix: "00",
      locality: "Winterthur",
      municipality: "Winterthur",
      municipality_bfs_id: "230",
      canton: "ZH",
      language: "de",
    });
  });

  it("tri par NPA puis suffixe puis localité : Kemptthal 8310 00 garde ses deux communes, dans un ordre déterministe", () => {
    const raw = parseOfficialCsv(
      Buffer.from(csvText([L_KEMPTTHAL_WINTERTHUR, L_KEMPTTHAL_LINDAU, L_GRAFSTAL, L_WINTERTHUR]), "utf8"),
    );
    const sorted = sortRows(reduceRows(raw));
    const codes = sorted.map((r) => `${r.postal_code}-${r.postal_code_suffix}-${r.municipality}`);
    // 8310-00 (deux communes, Lindau et Winterthur), puis 8310-01 (Grafstal), puis 8400-00.
    expect(codes).toEqual(["8310-00-Lindau", "8310-00-Winterthur", "8310-01-Lindau", "8400-00-Winterthur"]);
  });

  it("le tri reste stable d'un appel à l'autre (déterminisme, indépendant de l'ordre d'entrée)", () => {
    const raw = parseOfficialCsv(Buffer.from(csvText([L_KEMPTTHAL_LINDAU, L_KEMPTTHAL_WINTERTHUR]), "utf8"));
    const a = sortRows(reduceRows(raw)).map((r) => r.municipality);
    const rawReversed = parseOfficialCsv(Buffer.from(csvText([L_KEMPTTHAL_WINTERTHUR, L_KEMPTTHAL_LINDAU]), "utf8"));
    const b = sortRows(reduceRows(rawReversed)).map((r) => r.municipality);
    expect(a).toEqual(b);
  });

  it("toCsv produit un en-tête réduit stable et des accents conservés", () => {
    const raw = parseOfficialCsv(Buffer.from(csvText([L_GENEVE_1201]), "utf8"));
    const csv = toCsv(sortRows(reduceRows(raw)));
    expect(csv.split("\n")[0].trim()).toBe(
      "postal_code,postal_code_suffix,locality,municipality,municipality_bfs_id,canton,language",
    );
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
    expect(parseArgs(["--edition", "2026-10-01"])).toEqual({ edition: "2026-10-01" });
  });
  it("--fixture et --edition ensemble", () => {
    expect(parseArgs(["--fixture", "/tmp/x.zip", "--edition", "2026-10-01"])).toEqual({
      fixturePath: "/tmp/x.zip",
      edition: "2026-10-01",
    });
  });
  it("--edition sans valeur : erreur explicite", () => {
    expect(() => parseArgs(["--edition"])).toThrow(/--edition/);
  });
});

describe("syncLocalities (bout en bout, ZIP en mémoire, aucun réseau)", () => {
  it("mode fixture : aucun appel à fetchImpl", async () => {
    const dir = tmpDir();
    const zip = await makeZip({ [CSV_ENTRY]: csvText(REAL_LINES.filter((l) => l !== L_VADUZ)) });
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);
    let appele = false;
    const fetchImpl = (async () => {
      appele = true;
      throw new Error("ne doit jamais être appelé en mode fixture");
    }) as typeof fetch;

    const outputPath = join(dir, "localities.csv");
    const result = await syncLocalities({ fixturePath: zipPath, edition: EDITION, outputPath, fetchImpl, minRows: 1 });
    expect(appele).toBe(false);
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.excludedLiechtenstein).toBe(0);
    expect(result.changed).toBe(true);
    expect(result.edition).toBe(EDITION);
    const written = readFileSync(outputPath, "utf8");
    expect(written).toContain("Genève");
    expect(written).toContain("Winterthur");
  });

  it("--edition absent en mode fixture : erreur explicite, aucune écriture", async () => {
    const dir = tmpDir();
    const zip = await makeZip({ [CSV_ENTRY]: csvText([L_WINTERTHUR, L_GENEVE_1204]) });
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);
    const outputPath = join(dir, "localities.csv");
    await expect(syncLocalities({ fixturePath: zipPath, outputPath, minRows: 1 })).rejects.toThrow(/--edition/);
  });

  it("--edition mal formée en mode fixture : erreur explicite", async () => {
    const dir = tmpDir();
    const zip = await makeZip({ [CSV_ENTRY]: csvText([L_WINTERTHUR, L_GENEVE_1204]) });
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);
    const outputPath = join(dir, "localities.csv");
    await expect(syncLocalities({ fixturePath: zipPath, edition: "01.10.2026", outputPath, minRows: 1 })).rejects.toThrow(/--edition/);
  });

  it("exclut les communes du Liechtenstein du fichier écrit, et compte l'exclusion", async () => {
    const dir = tmpDir();
    const zip = await makeZip({ [CSV_ENTRY]: csvText(REAL_LINES) }); // inclut Vaduz
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);
    const outputPath = join(dir, "localities.csv");
    const result = await syncLocalities({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(result.excludedLiechtenstein).toBe(1);
    const written = readFileSync(outputPath, "utf8");
    expect(written).not.toContain("Vaduz");
  });

  it("fichier précédent absent (premier run) : aucun contrôle de baisse, écrit même avec peu de lignes", async () => {
    const dir = tmpDir();
    const zip = await makeZip({ [CSV_ENTRY]: csvText([L_WINTERTHUR, L_GENEVE_1204]) });
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);
    const outputPath = join(dir, "localities.csv");
    const result = await syncLocalities({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(result.previousRowCount).toBeNull();
    expect(result.rowCount).toBe(2); // Winterthur + Genève 1204
  });

  it("baisse de plus de 2% par rapport au fichier précédent : échec, fichier précédent INCHANGÉ", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "localities.csv");
    // Fichier précédent : 100 lignes de données (motif minimal, en-tête réduit).
    const header = "postal_code,postal_code_suffix,locality,municipality,municipality_bfs_id,canton,language";
    const previousLines = Array.from({ length: 100 }, (_, i) => `800${i % 10},00,Loc${i},Mun${i},${100 + i},ZH,de`);
    const previousContent = [header, ...previousLines].join("\n") + "\n";
    writeFileSync(outputPath, previousContent, "utf8");

    // Nouveau fichier : 90 lignes synthétiques + Genève 1204 (contrôle d'encodage) = 91,
    // toujours une baisse de 9 %, largement > 2 %.
    const zip = await makeZip({
      [CSV_ENTRY]: csvText([
        ...Array.from({ length: 90 }, (_, i) => `Loc${i};8001;00;${100 + i};Mun${i};${100 + i};ZH;100 %;0;0;de;2008-07-01`),
        L_GENEVE_1204,
      ]),
    });
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);

    await expect(syncLocalities({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 })).rejects.toThrow(/baisse/i);
    expect(readFileSync(outputPath, "utf8")).toBe(previousContent); // jamais touché
  });

  it("baisse de moins de 2% : accepté, fichier remplacé", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "localities.csv");
    const header = "postal_code,postal_code_suffix,locality,municipality,municipality_bfs_id,canton,language";
    const previousLines = Array.from({ length: 100 }, (_, i) => `800${i % 10},00,Loc${i},Mun${i},${100 + i},ZH,de`);
    writeFileSync(outputPath, [header, ...previousLines].join("\n") + "\n", "utf8");

    // 98 lignes synthétiques + Genève 1204 = 99 : baisse de 1 %, sous le seuil de 2 %.
    const zip = await makeZip({
      [CSV_ENTRY]: csvText([
        ...Array.from({ length: 98 }, (_, i) => `Loc${i};8001;00;${100 + i};Mun${i};${100 + i};ZH;100 %;0;0;de;2008-07-01`),
        L_GENEVE_1204,
      ]),
    });
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);

    const result = await syncLocalities({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(result.rowCount).toBe(99);
    expect(result.changed).toBe(true);
  });

  it("contrôle en échec (en-tête modifié) : le fichier précédent reste intact, octet pour octet", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "localities.csv");
    const header = "postal_code,postal_code_suffix,locality,municipality,municipality_bfs_id,canton,language";
    const previousContent = [header, "8400,00,Winterthur,Winterthur,230,ZH,de"].join("\n") + "\n";
    writeFileSync(outputPath, previousContent, "utf8");

    const badHeader = EXPECTED_HEADER.replace("PLZ4", "PLZ");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([L_WINTERTHUR], badHeader) });
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);

    await expect(syncLocalities({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 })).rejects.toThrow(/en-tête/i);
    expect(readFileSync(outputPath, "utf8")).toBe(previousContent);
  });

  it("ligne Genève du NPA 1204 absente : échec avant toute écriture (contrôle d'encodage, point 6)", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "localities.csv");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([L_WINTERTHUR]) }); // pas de 1204
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);

    await expect(syncLocalities({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 })).rejects.toThrow(/genève|1204|encodage/i);
    expect(existsSync(outputPath)).toBe(false); // jamais écrit
  });

  it("même contenu reconduit (aucun changement) : changed=false, même édition", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "localities.csv");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([L_WINTERTHUR, L_GENEVE_1204]) });
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);

    const first = await syncLocalities({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(first.changed).toBe(true);
    const second = await syncLocalities({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(second.changed).toBe(false);
    expect(second.rowCount).toBe(first.rowCount);
  });

  it("même CSV mais ÉDITION différente : changed=true (le fichier de métadonnées a changé)", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "localities.csv");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([L_WINTERTHUR, L_GENEVE_1204]) });
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);

    const first = await syncLocalities({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(first.changed).toBe(true);
    const second = await syncLocalities({ fixturePath: zipPath, edition: "2026-11-03", outputPath, minRows: 1 });
    expect(second.changed).toBe(true); // CSV identique, mais l'édition a changé
    expect(second.rowCount).toBe(first.rowCount);
  });
});

describe("localities.meta.json (relecture finale du 06.10.2026, point 4)", () => {
  it("écrit { edition, source, rows } à côté du CSV, par défaut", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "localities.csv");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([L_WINTERTHUR, L_GENEVE_1204]) });
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);

    const result = await syncLocalities({ fixturePath: zipPath, edition: EDITION, outputPath, minRows: 1 });
    expect(result.metaPath).toBe(join(dir, "localities.meta.json"));
    const meta = JSON.parse(readFileSync(result.metaPath, "utf8"));
    expect(meta).toEqual({ edition: EDITION, source: SWISSTOPO_LOCALITIES_STAC_ITEMS_URL, rows: result.rowCount });
  });

  it("chemin personnalisé (`metaPath`) respecté", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "localities.csv");
    const metaPath = join(dir, "sous-dossier", "meta-personnalise.json");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([L_WINTERTHUR, L_GENEVE_1204]) });
    const zipPath = join(dir, "ovz.zip");
    writeFileSync(zipPath, zip);

    const result = await syncLocalities({ fixturePath: zipPath, edition: EDITION, outputPath, metaPath, minRows: 1 });
    expect(result.metaPath).toBe(metaPath);
    expect(JSON.parse(readFileSync(metaPath, "utf8")).edition).toBe(EDITION);
  });
});

describe("syncLocalities (mode réseau, fetchImpl injecté — aucun fetch global touché)", () => {
  function stacResponse(datetime: string, href = "https://example.test/ovz.zip"): Response {
    const body = {
      features: [
        {
          properties: { datetime },
          assets: { [SWISSTOPO_LOCALITIES_ASSET_NAME]: { href } },
        },
      ],
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }

  it("édition dérivée de la propriété STAC `datetime` (tronquée au jour)", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "localities.csv");
    const zip = await makeZip({ [CSV_ENTRY]: csvText([L_WINTERTHUR, L_GENEVE_1204]) });

    const fetchImpl = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href === SWISSTOPO_LOCALITIES_STAC_ITEMS_URL) return stacResponse("2026-11-03T05:12:00Z");
      return new Response(zip, { status: 200 });
    }) as typeof fetch;

    const result = await syncLocalities({ outputPath, minRows: 1, fetchImpl });
    expect(result.edition).toBe("2026-11-03");
  });

  it("Content-Length déclaré au-delà de 20 Mo : échec avant de lire le corps", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "localities.csv");
    const fetchImpl = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href === SWISSTOPO_LOCALITIES_STAC_ITEMS_URL) return stacResponse("2026-10-01T00:00:00Z");
      return new Response(new Uint8Array(10), { status: 200, headers: { "content-length": "25000000" } });
    }) as typeof fetch;

    await expect(syncLocalities({ outputPath, minRows: 1, fetchImpl })).rejects.toThrow(/volumineux/i);
  });

  it("ZIP réellement reçu de plus de 20 Mo (sans dépendre du Content-Length déclaré) : échec", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "localities.csv");
    const enorme = new Uint8Array(20_000_001);
    const fetchImpl = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href === SWISSTOPO_LOCALITIES_STAC_ITEMS_URL) return stacResponse("2026-10-01T00:00:00Z");
      return new Response(enorme, { status: 200 });
    }) as typeof fetch;

    await expect(syncLocalities({ outputPath, minRows: 1, fetchImpl })).rejects.toThrow(/volumineux/i);
  });

  it("date d'édition STAC absente : échec explicite", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "localities.csv");
    const fetchImpl = (async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href === SWISSTOPO_LOCALITIES_STAC_ITEMS_URL) {
        return new Response(JSON.stringify({ features: [{ properties: {}, assets: { [SWISSTOPO_LOCALITIES_ASSET_NAME]: { href: "https://example.test/ovz.zip" } } }] }), { status: 200 });
      }
      return new Response(new Uint8Array(10), { status: 200 });
    }) as typeof fetch;

    await expect(syncLocalities({ outputPath, minRows: 1, fetchImpl })).rejects.toThrow(/édition|datetime/i);
  });
});

// Type guard : la fonction `reduceRows` doit rendre des `LocalityRow` typés, pas des `Record<string,string>` bruts.
describe("typage", () => {
  it("reduceRows rend des LocalityRow", () => {
    const raw = parseOfficialCsv(Buffer.from(csvText([L_WINTERTHUR]), "utf8"));
    const rows: LocalityRow[] = reduceRows(raw);
    expect(rows[0].postal_code).toBe("8400");
  });
});
