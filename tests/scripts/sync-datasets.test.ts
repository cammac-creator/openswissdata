/**
 * Tests de `scripts/sync-datasets.ts` (tâche osd.jeux, piste G1 du plan
 * `2026-10-07-moteur-jeux-ouverts.md`) : collecteur générique des jeux ouverts APPROUVÉS
 * (`docs/data-status/datasets-approved.json`).
 *
 * Aucun appel réseau : `fetchImpl` est toujours une maquette pure (jamais `fetch` global), et le
 * mode `--fixture-dir`/`fixtureDir` lit un CSV local par jeu. Fixtures générées EN TEST, jamais
 * le vrai fichier grison ni un nombre de lignes figé d'une collecte réelle.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildOutputRow,
  selectEntriesForRun,
  syncDatasets,
  validateRegistryEntry,
  type DatasetApprovalEntry,
} from "../../scripts/sync-datasets.js";

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "osd-sync-datasets-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function baseEntry(overrides: Partial<DatasetApprovalEntry> = {}): DatasetApprovalEntry {
  return {
    id: "demo-jeu",
    title: "Jeu de démonstration",
    ckan_uuid: "11111111-1111-1111-1111-111111111111",
    publisher: "Canton de test",
    licence: "terms_open",
    attribution: "",
    resource_url: "https://data.example.ch/demo.csv",
    expected_header: ["jahr", "bfs_nummer", "name", "betrag"],
    keys: { jahr: "year", bfs_nummer: "commune_bfs" },
    columns: ["jahr", "bfs_nummer", "name", "betrag"],
    approved_on: "2026-10-07",
    checked_by: "intégrateur",
    notes: "jeu fictif pour les tests",
    ...overrides,
  };
}

// --------------------------------------------------------------------------------------------
// validateRegistryEntry
// --------------------------------------------------------------------------------------------
describe("validateRegistryEntry", () => {
  it("entrée complète : aucune erreur", () => {
    expect(validateRegistryEntry(baseEntry())).toEqual([]);
  });

  it("sans expected_header : rejetée", () => {
    const errs = validateRegistryEntry(baseEntry({ expected_header: [] }));
    expect(errs.some((e) => /expected_header/.test(e))).toBe(true);
  });

  it("sans columns : rejetée", () => {
    const errs = validateRegistryEntry(baseEntry({ columns: [] }));
    expect(errs.some((e) => /columns/.test(e))).toBe(true);
  });

  it("id non conforme au gabarit (slug) : rejetée", () => {
    const errs = validateRegistryEntry(baseEntry({ id: "Demo Jeu!" }));
    expect(errs.some((e) => /id/.test(e))).toBe(true);
  });

  it("columns hors de expected_header : rejetée", () => {
    const errs = validateRegistryEntry(baseEntry({ columns: ["jahr", "inconnue"] }));
    expect(errs.length).toBeGreaterThan(0);
  });

  it("clé de jointure hors de columns : rejetée", () => {
    const errs = validateRegistryEntry(baseEntry({ columns: ["name", "betrag"] }));
    expect(errs.length).toBeGreaterThan(0);
  });

  it("clé de jointure non reconnue (hors des cinq) : rejetée", () => {
    const errs = validateRegistryEntry(baseEntry({ keys: { jahr: "siecle" as never } }));
    expect(errs.length).toBeGreaterThan(0);
  });

  it("deux colonnes mappées sur la même clé canonique : rejetée", () => {
    const errs = validateRegistryEntry(
      baseEntry({ expected_header: ["jahr", "annee", "bfs_nummer", "name", "betrag"], columns: ["jahr", "annee", "bfs_nummer", "name", "betrag"], keys: { jahr: "year", annee: "year", bfs_nummer: "commune_bfs" } }),
    );
    expect(errs.length).toBeGreaterThan(0);
  });

  it("licence terms_by sans attribution : rejetée", () => {
    const errs = validateRegistryEntry(baseEntry({ licence: "terms_by", attribution: "" }));
    expect(errs.some((e) => /attribution/.test(e))).toBe(true);
  });

  it("licence terms_by avec attribution : acceptée", () => {
    expect(validateRegistryEntry(baseEntry({ licence: "terms_by", attribution: "Canton de test" }))).toEqual([]);
  });

  it("resource_url sur bfs.admin.ch : rejetée (aucune donnée OFS)", () => {
    const errs = validateRegistryEntry(baseEntry({ resource_url: "https://www.bfs.admin.ch/asset/fr/demo.csv" }));
    expect(errs.length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------------------------
// selectEntriesForRun : plafond de jeux par passage
// --------------------------------------------------------------------------------------------
describe("selectEntriesForRun", () => {
  it("sous le plafond : tous traités", () => {
    const entries = [baseEntry({ id: "a" }), baseEntry({ id: "b" })];
    const { toProcess, skipped } = selectEntriesForRun(entries, 50);
    expect(toProcess.map((e) => e.id)).toEqual(["a", "b"]);
    expect(skipped).toEqual([]);
  });

  it("au-delà du plafond : les premiers traités, le reste ignoré", () => {
    const entries = Array.from({ length: 5 }, (_, i) => baseEntry({ id: `jeu-${i}` }));
    const { toProcess, skipped } = selectEntriesForRun(entries, 3);
    expect(toProcess.map((e) => e.id)).toEqual(["jeu-0", "jeu-1", "jeu-2"]);
    expect(skipped.map((e) => e.id)).toEqual(["jeu-3", "jeu-4"]);
  });
});

// --------------------------------------------------------------------------------------------
// buildOutputRow : normalisation des clés, colonnes gardées
// --------------------------------------------------------------------------------------------
describe("buildOutputRow", () => {
  const entry = baseEntry();

  it("renomme les colonnes-clés, garde les autres telles quelles", () => {
    const row = buildOutputRow(entry, { jahr: "2024", bfs_nummer: "0230", name: "Exemple", betrag: "12.5" }, 2);
    expect(row).toEqual({ year: "2024", commune_bfs: "230", name: "Exemple", betrag: "12.5" });
  });

  it("valeur de clé invalide : erreur explicite avec le numéro de ligne", () => {
    expect(() => buildOutputRow(entry, { jahr: "pas une année", bfs_nummer: "230", name: "x", betrag: "1" }, 7)).toThrow(/ligne 7/);
  });
});

// --------------------------------------------------------------------------------------------
// syncDatasets : chemin complet (fixtures, sans réseau)
// --------------------------------------------------------------------------------------------
function writeRegistry(dir: string, entries: DatasetApprovalEntry[]): string {
  const path = join(dir, "datasets-approved.json");
  writeFileSync(path, JSON.stringify({ version: 1, datasets: entries }, null, 2), "utf8");
  return path;
}

function writeFixture(dir: string, id: string, content: string): void {
  writeFileSync(join(dir, `${id}.csv`), content, "utf8");
}

const HEADER = "jahr,bfs_nummer,name,betrag";

function csvRows(n: number, overrides: Record<number, string> = {}): string {
  const rows = Array.from({ length: n }, (_, i) => overrides[i] ?? `2024,${1000 + i},Commune ${i},${i * 10}`);
  return [HEADER, ...rows].join("\n") + "\n";
}

describe("syncDatasets : un jeu valide (mode fixture)", () => {
  it("écrit le csv.gz et l'index.json, édition = date du jour", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry();
    writeRegistry(regDir, [entry]);
    writeFixture(fixDir, entry.id, csvRows(30));

    const result = await syncDatasets({
      registryPath: join(regDir, "datasets-approved.json"),
      outDir,
      fixtureDir: fixDir,
      now: () => new Date("2026-10-07T12:00:00Z").getTime(),
    });

    expect(result.anyFailed).toBe(false);
    expect(result.succeeded).toEqual(["demo-jeu"]);
    expect(existsSync(join(outDir, "demo-jeu.csv.gz"))).toBe(true);

    const csv = gunzipSync(readFileSync(join(outDir, "demo-jeu.csv.gz"))).toString("utf8");
    expect(csv.split("\n").filter(Boolean)).toHaveLength(31); // en-tête + 30 lignes
    expect(csv.split("\n")[0]).toBe("year,commune_bfs,name,betrag");

    const index = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
    expect(index.datasets).toHaveLength(1);
    expect(index.datasets[0]).toMatchObject({ id: "demo-jeu", rows: 30, edition: "2026-10-07", keys: ["commune_bfs", "year"] });
  });

  it("by_commune_bfs précalculé dans index.json (relecture adverse du 07.10.2026) : les profils n'ouvrent plus le .csv.gz", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry();
    writeRegistry(regDir, [entry]);
    // Trois lignes pour la commune 1000, une pour 1001 : compte précalculé attendu {1000: 3, 1001: 1}.
    const csv = [HEADER, "2024,1000,a,1", "2024,1000,b,2", "2023,1000,c,3", "2024,1001,d,4"].join("\n") + "\n";
    writeFixture(fixDir, entry.id, csv);

    await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fixtureDir: fixDir, now: () => 0 });

    const index = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
    expect(index.datasets[0].by_commune_bfs).toEqual({ "1000": 3, "1001": 1 });
    expect(index.datasets[0].by_canton).toBeUndefined(); // ce jeu n'a pas de clé canton
  });

  it("by_canton précalculé pour un jeu à clé canton", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry({
      id: "jeu-canton-demo",
      expected_header: ["jahr", "kanton", "name", "betrag"],
      columns: ["jahr", "kanton", "name", "betrag"],
      keys: { jahr: "year", kanton: "canton" },
    });
    writeRegistry(regDir, [entry]);
    writeFixture(fixDir, entry.id, "jahr,kanton,name,betrag\n2024,GR,a,1\n2024,GR,b,2\n2024,ZH,c,3\n");

    await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fixtureDir: fixDir, now: () => 0 });

    const index = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
    expect(index.datasets[0].by_canton).toEqual({ GR: 2, ZH: 1 });
    expect(index.datasets[0].by_commune_bfs).toBeUndefined();
  });

  it("second passage, contenu identique : fichier inchangé, édition conservée", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry();
    writeRegistry(regDir, [entry]);
    writeFixture(fixDir, entry.id, csvRows(10));

    const opts = {
      registryPath: join(regDir, "datasets-approved.json"),
      outDir,
      fixtureDir: fixDir,
    };
    await syncDatasets({ ...opts, now: () => new Date("2026-10-07T12:00:00Z").getTime() });
    const second = await syncDatasets({ ...opts, now: () => new Date("2026-11-04T12:00:00Z").getTime() });

    expect(second.unchanged).toEqual(["demo-jeu"]);
    const index = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
    expect(index.datasets[0].edition).toBe("2026-10-07"); // jamais la date du second passage
  });

  it("gzip déterministe : deux écritures du même contenu donnent les mêmes octets", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir1 = tmpDir();
    const outDir2 = tmpDir();
    const entry = baseEntry();
    writeRegistry(regDir, [entry]);
    writeFixture(fixDir, entry.id, csvRows(12));

    const registryPath = join(regDir, "datasets-approved.json");
    await syncDatasets({ registryPath, outDir: outDir1, fixtureDir: fixDir, now: () => 0 });
    await syncDatasets({ registryPath, outDir: outDir2, fixtureDir: fixDir, now: () => 0 });

    const a = readFileSync(join(outDir1, "demo-jeu.csv.gz"));
    const b = readFileSync(join(outDir2, "demo-jeu.csv.gz"));
    expect(a.equals(b)).toBe(true);
  });
});

describe("syncDatasets : en-tête différent", () => {
  it("échoue CE jeu seulement, fichier précédent intact", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const good = baseEntry({ id: "jeu-bon" });
    const bad = baseEntry({ id: "jeu-mauvais" });
    writeRegistry(regDir, [good, bad]);
    writeFixture(fixDir, good.id, csvRows(5));
    writeFixture(fixDir, bad.id, "jahr,bfs_nummer,autre_nom,betrag\n2024,1000,x,1\n");

    const result = await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fixtureDir: fixDir, now: () => 0 });

    expect(result.anyFailed).toBe(true);
    expect(result.succeeded).toEqual(["jeu-bon"]);
    expect(result.failed.map((f) => f.id)).toEqual(["jeu-mauvais"]);
    expect(result.failed[0].error).toMatch(/en-tête/i);
    expect(existsSync(join(outDir, "jeu-mauvais.csv.gz"))).toBe(false);
  });
});

describe("syncDatasets : colonne de personne détectée", () => {
  it("échoue CE jeu seulement", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry({ id: "jeu-personne", expected_header: ["jahr", "bfs_nummer", "name", "betrag", "vorname"], columns: ["jahr", "bfs_nummer", "name", "betrag"] });
    writeRegistry(regDir, [entry]);
    writeFixture(fixDir, entry.id, "jahr,bfs_nummer,name,betrag,vorname\n2024,1000,x,1,Jean\n");

    const result = await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fixtureDir: fixDir, now: () => 0 });

    expect(result.anyFailed).toBe(true);
    expect(result.failed.map((f) => f.id)).toEqual(["jeu-personne"]);
    expect(result.failed[0].error).toMatch(/personne/i);
  });
});

describe("syncDatasets : encodage inattendu (U+FFFD)", () => {
  it("refuse un fichier dont le décodage UTF-8 produit un caractère de remplacement", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry();
    writeRegistry(regDir, [entry]);
    // Octet 0xFF seul : invalide en UTF-8, décodé en U+FFFD par `Buffer#toString("utf8")`.
    const invalid = Buffer.concat([Buffer.from(HEADER + "\n2024,1000,", "utf8"), Buffer.from([0xff]), Buffer.from(",1\n", "utf8")]);
    writeFileSync(join(fixDir, `${entry.id}.csv`), invalid);

    const result = await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fixtureDir: fixDir, now: () => 0 });

    expect(result.anyFailed).toBe(true);
    expect(result.failed[0].error).toMatch(/FFFD|encodage/i);
    expect(existsSync(join(outDir, `${entry.id}.csv.gz`))).toBe(false);
  });
});

describe("syncDatasets : fichier sans ligne de données", () => {
  it("refuse un export réduit à l'en-tête : rien n'est publié (relecture du 07.10.2026)", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry();
    writeRegistry(regDir, [entry]);
    writeFixture(fixDir, entry.id, HEADER + "\n");

    const result = await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fixtureDir: fixDir, now: () => 0 });

    expect(result.anyFailed).toBe(true);
    expect(result.failed[0].error).toMatch(/Aucune ligne/);
    expect(existsSync(join(outDir, `${entry.id}.csv.gz`))).toBe(false);
  });
});

describe("syncDatasets : trim cohérent des noms de colonnes entre en-tête et lignes", () => {
  it("colonne non-clé dont le nom porte un espace parasite dans l'en-tête réel : valeur quand même lue (relecture du 07.10.2026)", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry();
    writeRegistry(regDir, [entry]);
    // En-tête réel avec un espace parasite autour de "name" (colonne NON-clé) : `expected_header`
    // du registre reste "name" (sans espace), comparé après `splitHeaderColumns` (qui trime) — la
    // vérification d'en-tête passe. Avant la relecture du 07.10.2026, `csv-parse` en mode
    // `columns: true` utilisait la ligne d'en-tête BRUTE comme clés de ligne (" name " avec
    // espaces) : `buildOutputRow` cherchait `sourceRow["name"]` (sans espace, depuis
    // `entry.columns`) et ne le trouvait jamais → valeur silencieusement vidée ("").
    const csvWithSpaces = "jahr,bfs_nummer, name ,betrag\n2024,1000,Exemple,42\n";
    writeFixture(fixDir, entry.id, csvWithSpaces);

    const result = await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fixtureDir: fixDir, now: () => 0 });

    expect(result.anyFailed).toBe(false);
    expect(result.succeeded).toEqual(["demo-jeu"]);
    const csv = gunzipSync(readFileSync(join(outDir, "demo-jeu.csv.gz"))).toString("utf8");
    const lines = csv.split("\n").filter(Boolean);
    expect(lines[1]).toBe("2024,1000,Exemple,42"); // "name" porte bien "Exemple", jamais vide
  });
});

describe("syncDatasets : baisse de lignes", () => {
  it("baisse de plus de 20 % : échec, fichier précédent intact", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry();
    writeRegistry(regDir, [entry]);

    writeFixture(fixDir, entry.id, csvRows(100));
    const first = await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fixtureDir: fixDir, now: () => 1 });
    expect(first.succeeded).toEqual(["demo-jeu"]);

    writeFixture(fixDir, entry.id, csvRows(50)); // -50 % : au-delà des 20 % tolérés
    const second = await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fixtureDir: fixDir, now: () => 2 });

    expect(second.anyFailed).toBe(true);
    expect(second.failed[0].error).toMatch(/baisse/i);
    const csv = gunzipSync(readFileSync(join(outDir, "demo-jeu.csv.gz"))).toString("utf8");
    expect(csv.split("\n").filter(Boolean)).toHaveLength(101); // toujours les 100 lignes d'origine
  });

  it("baisse de moins de 20 % : acceptée", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry();
    writeRegistry(regDir, [entry]);

    writeFixture(fixDir, entry.id, csvRows(100));
    await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fixtureDir: fixDir, now: () => 1 });

    writeFixture(fixDir, entry.id, csvRows(85)); // -15 %
    const second = await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fixtureDir: fixDir, now: () => 2 });
    expect(second.anyFailed).toBe(false);
    expect(second.succeeded).toEqual(["demo-jeu"]);
  });
});

describe("syncDatasets : entrée de registre invalide", () => {
  it("rejetée au chargement, échoue CE jeu seulement, les autres continuent", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const good = baseEntry({ id: "jeu-bon" });
    const malformed = { ...baseEntry({ id: "jeu-casse" }), columns: [] };
    writeRegistry(regDir, [good, malformed as DatasetApprovalEntry]);
    writeFixture(fixDir, good.id, csvRows(5));

    const result = await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fixtureDir: fixDir, now: () => 0 });
    expect(result.anyFailed).toBe(true);
    expect(result.succeeded).toEqual(["jeu-bon"]);
    expect(result.failed.map((f) => f.id)).toEqual(["jeu-casse"]);
  });
});

describe("syncDatasets : retrait d'un jeu sorti du registre", () => {
  it("un jeu disparu du registre est retiré d'index.json ET son .csv.gz effacé au passage suivant", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entryA = baseEntry({ id: "jeu-a" });
    const entryB = baseEntry({ id: "jeu-b" });
    writeRegistry(regDir, [entryA, entryB]);
    writeFixture(fixDir, entryA.id, csvRows(5));
    writeFixture(fixDir, entryB.id, csvRows(5));

    const registryPath = join(regDir, "datasets-approved.json");
    const first = await syncDatasets({ registryPath, outDir, fixtureDir: fixDir, now: () => 0 });
    expect(first.succeeded.sort()).toEqual(["jeu-a", "jeu-b"]);
    expect(existsSync(join(outDir, "jeu-a.csv.gz"))).toBe(true);
    expect(existsSync(join(outDir, "jeu-b.csv.gz"))).toBe(true);

    // jeu-b sort du registre (ex. remplacé par un autre jeu lors d'un lot d'approbations).
    writeRegistry(regDir, [entryA]);
    const second = await syncDatasets({ registryPath, outDir, fixtureDir: fixDir, now: () => 1 });

    expect(second.removed).toEqual(["jeu-b"]);
    expect(second.anyFailed).toBe(false);
    expect(existsSync(join(outDir, "jeu-b.csv.gz"))).toBe(false); // .csv.gz effacé
    expect(existsSync(join(outDir, "jeu-a.csv.gz"))).toBe(true); // jeu-a intact

    const index = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
    expect(index.datasets.map((d: { id: string }) => d.id)).toEqual(["jeu-a"]); // jeu-b retiré de l'index
  });

  it("un jeu seulement skipped par le plafond (toujours approuvé) n'est jamais retiré", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entryA = baseEntry({ id: "jeu-a" });
    const entryB = baseEntry({ id: "jeu-b" });
    writeRegistry(regDir, [entryA, entryB]);
    writeFixture(fixDir, entryA.id, csvRows(5));
    writeFixture(fixDir, entryB.id, csvRows(5));
    const registryPath = join(regDir, "datasets-approved.json");

    // Premier passage : les deux jeux collectés normalement.
    await syncDatasets({ registryPath, outDir, fixtureDir: fixDir, now: () => 0 });
    expect(existsSync(join(outDir, "jeu-b.csv.gz"))).toBe(true);

    // Second passage : plafond à 1 jeu par passage, jeu-b seulement "skipped" (toujours approuvé
    // au registre) — jamais retiré, même absent de `toProcess` cette fois.
    const second = await syncDatasets({ registryPath, outDir, fixtureDir: fixDir, now: () => 1, maxDatasetsPerRun: 1 });
    expect(second.skipped).toEqual(["jeu-b"]);
    expect(second.removed).toEqual([]);
    expect(existsSync(join(outDir, "jeu-b.csv.gz"))).toBe(true); // jamais effacé
    const index = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
    expect(index.datasets.map((d: { id: string }) => d.id).sort()).toEqual(["jeu-a", "jeu-b"]);
  });

  it("un jeu en échec de validation (toujours au registre, mais malformé) n'est jamais retiré", async () => {
    const regDir = tmpDir();
    const fixDir = tmpDir();
    const outDir = tmpDir();
    const entryA = baseEntry({ id: "jeu-a" });
    writeRegistry(regDir, [entryA]);
    writeFixture(fixDir, entryA.id, csvRows(5));
    const registryPath = join(regDir, "datasets-approved.json");

    await syncDatasets({ registryPath, outDir, fixtureDir: fixDir, now: () => 0 });
    expect(existsSync(join(outDir, "jeu-a.csv.gz"))).toBe(true);

    // jeu-a reste au registre mais devient malformé (ex. erreur de frappe dans columns).
    const broken = { ...entryA, columns: [] } as DatasetApprovalEntry;
    writeRegistry(regDir, [broken]);
    const second = await syncDatasets({ registryPath, outDir, fixtureDir: fixDir, now: () => 1 });

    expect(second.failed.map((f) => f.id)).toEqual(["jeu-a"]);
    expect(second.removed).toEqual([]);
    expect(existsSync(join(outDir, "jeu-a.csv.gz"))).toBe(true); // fichier précédent intact
    const index = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
    expect(index.datasets.map((d: { id: string }) => d.id)).toEqual(["jeu-a"]); // toujours dans l'index
  });
});

describe("syncDatasets : téléchargement réel (fetchImpl injecté)", () => {
  function fakeResponse(body: string, opts: { contentLength?: string; ok?: boolean; status?: number } = {}): Response {
    const bytes = new TextEncoder().encode(body);
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      headers: { get: (name: string) => (name.toLowerCase() === "content-length" ? (opts.contentLength ?? String(bytes.length)) : null) },
      arrayBuffer: async () => bytes.buffer,
      body: null,
    } as unknown as Response;
  }

  it("téléchargement réussi, sans fixture", async () => {
    const regDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry();
    writeRegistry(regDir, [entry]);
    const csv = csvRows(5);
    const fetchImpl = (async () => fakeResponse(csv)) as unknown as typeof fetch;

    const result = await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fetchImpl, now: () => 0 });
    expect(result.succeeded).toEqual(["demo-jeu"]);
  });

  it("Content-Length au-delà de 20 Mo déclaré : échec sans télécharger le corps", async () => {
    const regDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry();
    writeRegistry(regDir, [entry]);
    const fetchImpl = (async () => fakeResponse(csvRows(5), { contentLength: String(25_000_000) })) as unknown as typeof fetch;

    const result = await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fetchImpl, now: () => 0 });
    expect(result.anyFailed).toBe(true);
    expect(result.failed[0].error).toMatch(/volumineu/i);
  });

  it("HTTP non ok : échec explicite", async () => {
    const regDir = tmpDir();
    const outDir = tmpDir();
    const entry = baseEntry();
    writeRegistry(regDir, [entry]);
    const fetchImpl = (async () => fakeResponse("", { ok: false, status: 503 })) as unknown as typeof fetch;

    const result = await syncDatasets({ registryPath: join(regDir, "datasets-approved.json"), outDir, fetchImpl, now: () => 0 });
    expect(result.anyFailed).toBe(true);
    expect(result.failed[0].error).toMatch(/503/);
  });
});
