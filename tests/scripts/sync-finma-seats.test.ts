/**
 * Tests de `scripts/sync-finma-seats.ts` (tâche osd.donnees, tâche B4 du plan
 * `2026-10-06-prospection-et-api.md`) : siège exact des établissements FINMA par IDE
 * (combinaison FINMA × registre du commerce).
 *
 * Correction du 07.10.2026 (relecture de Claude-Alain, commit distinct) : TOUTES les catégories
 * d'autorisation FINMA entrent dans la requête LINDAS, `entity_type` n'est JAMAIS un filtre —
 * l'ancienne exclusion préalable de `asset_manager_individual` reposait sur une erreur (1 519
 * des 1 585 lignes de cette catégorie sont des AG/SA/GmbH/Sàrl, pas des personnes physiques).
 * SEULE porte contre une personne physique : la liste blanche des formes juridiques de
 * personnes morales (`ADDRESS_AND_PURPOSE_FORM_CODES`), appliquée APRÈS la réponse LINDAS.
 *
 * Aucun appel réseau : le mode `--fixture` lit un fichier JSON au format SPARQL (comme les
 * réponses réelles de LINDAS, voir `src/mcp/company/lindas.ts`) ; les tests du chemin réseau
 * injectent `fetchImpl` (maquette pure, jamais `fetch` global) et `sleep` (jamais un vrai délai).
 * IDE fictifs à chiffre de contrôle valide (algorithme de `src/mcp/company/uid.ts`), aucune
 * personne physique dans aucune fixture.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LINDAS_ENDPOINT } from "../../src/mcp/company/lindas.js";
import {
  candidateUids,
  parseArgs,
  syncFinmaSeats,
  toCsv,
  type FinmaSeatRow,
} from "../../scripts/sync-finma-seats.js";

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "osd-sync-finma-seats-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// IDE fictifs, chiffre de contrôle valide — jamais de personne physique : toutes des sociétés
// anonymes ou Sàrl, réelles ou fictives, quelle que soit leur catégorie d'autorisation FINMA.
const UID_SA_1 = "CHE-200.000.001"; // bank, forme LINDAS 0106 (SA), Winterthur (230)
const UID_SA_2 = "CHE-200.000.018"; // bank, forme LINDAS 0106 (SA, via suffixe d'URI), Genève (6621)
const UID_PORTFOLIO_MANAGER_SARL = "CHE-200.000.053"; // asset_manager_individual (Portfolio manager), forme LINDAS 0107 (Sàrl) : une personne MORALE malgré sa catégorie FINMA — doit être RETENU (correction du 07.10.2026)
const UID_SOLE_PROP = "CHE-200.000.030"; // bank, forme LINDAS 0101 (entreprise individuelle) : hors liste blanche, exclu quelle que soit sa catégorie FINMA
const UID_NOT_IN_LINDAS = "CHE-200.000.047"; // absent de la réponse LINDAS
const UID_SARL_AMBIGUOUS = "CHE-200.000.024"; // deux communes différentes selon les lignes : ambiguë
const UID_INVALID = "CHE-999.999.999"; // chiffre de contrôle invalide

function registryCsv(rows: Array<{ entity_type: string; uid: string }>): string {
  const header = "entity_type,name,uid,lei,licence_type,licence_type_de,licence_type_fr,licence_type_it,licence_date,status,canton,city,address,source_list,source_url,is_warning_listed";
  const lines = rows.map((r) => [r.entity_type, "Fictif", r.uid, "", "Bank", "", "", "", "", "", "", "", "", "finma-uid-csv", "https://www.finma.ch/", "false"].join(","));
  return [header, ...lines].join("\n") + "\n";
}

function writeRegistry(dir: string, rows: Array<{ entity_type: string; uid: string }>): string {
  const path = join(dir, "finma_registry.csv");
  writeFileSync(path, registryCsv(rows), "utf8");
  return path;
}

interface FixtureBinding { uidValue: string; legalFormCode?: string; legalForm?: string; municipalityId?: string }

function sparqlFixture(bindings: FixtureBinding[]): { results: { bindings: Record<string, { value: string }>[] } } {
  return {
    results: {
      bindings: bindings.map((b) => {
        const row: Record<string, { value: string }> = { uidValue: { value: b.uidValue } };
        if (b.legalFormCode !== undefined) row.legalFormCode = { value: b.legalFormCode };
        if (b.legalForm !== undefined) row.legalForm = { value: b.legalForm };
        if (b.municipalityId !== undefined) row.municipalityId = { value: b.municipalityId };
        return row;
      }),
    },
  };
}

function writeFixture(dir: string, bindings: FixtureBinding[]): string {
  const path = join(dir, "lindas-fixture.json");
  writeFileSync(path, JSON.stringify(sparqlFixture(bindings)), "utf8");
  return path;
}

// Forme compacte "CHE"+9 chiffres attendue dans les VALUES SPARQL (voir `ingest-zefix.ts`).
function compact(uid: string): string {
  return `CHE${uid.replace(/[^0-9]/g, "")}`;
}

/** Chiffre de contrôle modulo 11 (même algorithme que `src/mcp/company/uid.ts`) ; `null` si le
 *  contrôle calculé est 10 (IDE invalide pour cette base de huit chiffres). */
function checkDigit(d8: string): number | null {
  const POIDS = [5, 4, 3, 2, 7, 6, 5, 4];
  const somme = POIDS.reduce((total, poids, i) => total + poids * Number(d8[i]), 0);
  const reste = 11 - (somme % 11);
  const controle = reste === 11 ? 0 : reste;
  return controle === 10 ? null : controle;
}

/** `n` distincts génèrent `n` IDE fictifs distincts, chiffre de contrôle toujours valide (écart
 *  de 1000 entre deux `n`, largement supérieur au nombre d'essais de repli ci-dessous : aucune
 *  collision possible). Utilisé seulement pour dépasser le plafond de requêtes dans un test. */
function validUid(n: number): string {
  let base = 400000000 + n * 1000;
  for (let attempt = 0; attempt < 20; attempt++) {
    const d8 = String(base % 1000000000).padStart(8, "0").slice(0, 8);
    const c = checkDigit(d8);
    if (c !== null) return `CHE-${d8.slice(0, 3)}.${d8.slice(3, 6)}.${d8.slice(6, 8)}${c}`;
    base += 1;
  }
  throw new Error("aucun IDE valide trouvé");
}

const EDITION = "2026-10-07";

describe("candidateUids : TOUTES les lignes du registre sont candidates (entity_type n'est jamais un filtre)", () => {
  it("exclut seulement les IDE invalides et vides ; une ligne asset_manager_individual reste candidate", () => {
    const rows = [
      { entity_type: "bank", uid: UID_SA_1 },
      { entity_type: "asset_manager_individual", uid: UID_PORTFOLIO_MANAGER_SARL },
      { entity_type: "bank", uid: UID_INVALID },
      { entity_type: "bank", uid: "" },
    ];
    const { compactToCanonical, excludedInvalid } = candidateUids(rows);
    expect(compactToCanonical.size).toBe(2); // SA_1 ET le Portfolio manager : jamais exclu par sa catégorie
    expect(compactToCanonical.get(compact(UID_PORTFOLIO_MANAGER_SARL))).toBe(UID_PORTFOLIO_MANAGER_SARL);
    expect(excludedInvalid).toBe(2); // IDE invalide + IDE vide, seules exclusions avant requête
  });

  it("un même IDE répété (plusieurs autorisations) n'est compté qu'une fois", () => {
    const rows = [
      { entity_type: "bank", uid: UID_SA_1 },
      { entity_type: "insurance", uid: UID_SA_1 },
    ];
    const { compactToCanonical } = candidateUids(rows);
    expect(compactToCanonical.size).toBe(1);
  });
});

describe("toCsv", () => {
  it("en-tête stable uid,municipality_bfs_id", () => {
    const rows: FinmaSeatRow[] = [{ uid: UID_SA_1, municipality_bfs_id: "230" }];
    expect(toCsv(rows).split("\n")[0].trim()).toBe("uid,municipality_bfs_id");
  });
});

describe("parseArgs", () => {
  it("sans argument : rien", () => {
    expect(parseArgs([])).toEqual({});
  });
  it("--fixture <chemin> et --edition <date>", () => {
    expect(parseArgs(["--fixture", "/tmp/x.json", "--edition", "2026-10-07"])).toEqual({ fixturePath: "/tmp/x.json", edition: "2026-10-07" });
  });
  it("--fixture sans valeur : erreur explicite", () => {
    expect(() => parseArgs(["--fixture"])).toThrow(/--fixture/);
  });
});

describe("syncFinmaSeats (mode fixture, aucun réseau)", () => {
  it("un IDE « Portfolio manager » (asset_manager_individual) dont la forme LINDAS est une Sàrl (personne morale) est RETENU — correction du 07.10.2026", async () => {
    const dir = tmpDir();
    const registryPath = writeRegistry(dir, [{ entity_type: "asset_manager_individual", uid: UID_PORTFOLIO_MANAGER_SARL }]);
    const fixturePath = writeFixture(dir, [{ uidValue: compact(UID_PORTFOLIO_MANAGER_SARL), legalFormCode: "0107", municipalityId: "230" }]);
    const outputPath = join(dir, "finma_seats.csv");
    const result = await syncFinmaSeats({ registryPath, fixturePath, edition: EDITION, outputPath, minRows: 1 });
    expect(result.queriedUids).toBe(1); // jamais exclu avant requête, quelle que soit sa catégorie FINMA
    expect(result.rowCount).toBe(1);
    expect(readFileSync(outputPath, "utf8")).toContain(`${UID_PORTFOLIO_MANAGER_SARL},230`);
  });

  it("un IDE dont la forme LINDAS est hors liste blanche (0101, entreprise individuelle) reste exclu, quelle que soit sa catégorie FINMA d'origine", async () => {
    const dir = tmpDir();
    const registryPath = writeRegistry(dir, [{ entity_type: "bank", uid: UID_SOLE_PROP }]);
    const fixturePath = writeFixture(dir, [{ uidValue: compact(UID_SOLE_PROP), legalFormCode: "0101", municipalityId: "230" }]);
    const outputPath = join(dir, "finma_seats.csv");
    const result = await syncFinmaSeats({ registryPath, fixturePath, edition: EDITION, outputPath, minRows: 0 });
    expect(result.rowCount).toBe(0);
    expect(result.excludedLegalForm).toBe(1);
  });

  it("garde les sièges de personnes morales trouvés (toutes catégories FINMA confondues), exclut le reste, trié par IDE", async () => {
    const dir = tmpDir();
    const registryPath = writeRegistry(dir, [
      { entity_type: "bank", uid: UID_SA_2 },
      { entity_type: "bank", uid: UID_SA_1 },
      { entity_type: "asset_manager_individual", uid: UID_PORTFOLIO_MANAGER_SARL },
      { entity_type: "bank", uid: UID_SOLE_PROP },
      { entity_type: "bank", uid: UID_NOT_IN_LINDAS },
      { entity_type: "bank", uid: UID_SARL_AMBIGUOUS },
    ]);
    const fixturePath = writeFixture(dir, [
      { uidValue: compact(UID_SA_1), legalFormCode: "0106", municipalityId: "230" },
      { uidValue: compact(UID_SA_2), legalForm: "https://ld.admin.ch/ech/97/legalforms/0106", municipalityId: "6621" },
      { uidValue: compact(UID_PORTFOLIO_MANAGER_SARL), legalFormCode: "0107", municipalityId: "230" }, // Sàrl malgré sa catégorie FINMA : retenu
      { uidValue: compact(UID_SOLE_PROP), legalFormCode: "0101", municipalityId: "230" }, // hors liste blanche
      // UID_NOT_IN_LINDAS : aucune ligne dans la fixture (absent de LINDAS).
      { uidValue: compact(UID_SARL_AMBIGUOUS), legalFormCode: "0107", municipalityId: "230" },
      { uidValue: compact(UID_SARL_AMBIGUOUS), legalFormCode: "0107", municipalityId: "5586" }, // deux communes : ambiguë
    ]);
    const outputPath = join(dir, "finma_seats.csv");
    const result = await syncFinmaSeats({ registryPath, fixturePath, edition: EDITION, outputPath, minRows: 1 });

    expect(result.queriedUids).toBe(6); // TOUTES les lignes du registre, entity_type jamais un filtre
    expect(result.rowCount).toBe(3); // SA_1, SA_2, PORTFOLIO_MANAGER_SARL
    expect(result.excludedLegalForm).toBe(1); // SOLE_PROP
    expect(result.notFoundOrIncomplete).toBe(1); // NOT_IN_LINDAS
    expect(result.ambiguous).toBe(1); // SARL_AMBIGUOUS
    const csv = readFileSync(outputPath, "utf8");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("uid,municipality_bfs_id");
    expect(lines.slice(1)).toEqual([
      `${UID_SA_1},230`,
      `${UID_SA_2},6621`,
      `${UID_PORTFOLIO_MANAGER_SARL},230`,
    ]); // trié par IDE (CHE-200.000.001 < CHE-200.000.018 < CHE-200.000.053)
  });

  it("--edition absent en mode fixture : erreur explicite, aucune écriture", async () => {
    const dir = tmpDir();
    const registryPath = writeRegistry(dir, [{ entity_type: "bank", uid: UID_SA_1 }]);
    const fixturePath = writeFixture(dir, [{ uidValue: compact(UID_SA_1), legalFormCode: "0106", municipalityId: "230" }]);
    const outputPath = join(dir, "finma_seats.csv");
    await expect(syncFinmaSeats({ registryPath, fixturePath, outputPath, minRows: 1 })).rejects.toThrow(/--edition/);
    expect(existsSync(outputPath)).toBe(false);
  });

  it("IDE sans aucune ligne LINDAS : compté comme non trouvé, jamais une exception", async () => {
    const dir = tmpDir();
    const registryPath = writeRegistry(dir, [{ entity_type: "bank", uid: UID_NOT_IN_LINDAS }]);
    const fixturePath = writeFixture(dir, []);
    const outputPath = join(dir, "finma_seats.csv");
    const result = await syncFinmaSeats({ registryPath, fixturePath, edition: EDITION, outputPath, minRows: 0 });
    expect(result.rowCount).toBe(0);
    expect(result.notFoundOrIncomplete).toBe(1);
  });

  it("deux communes différentes pour le même IDE : ambiguë, jamais devinée", async () => {
    const dir = tmpDir();
    const registryPath = writeRegistry(dir, [{ entity_type: "bank", uid: UID_SARL_AMBIGUOUS }]);
    const fixturePath = writeFixture(dir, [
      { uidValue: compact(UID_SARL_AMBIGUOUS), legalFormCode: "0107", municipalityId: "230" },
      { uidValue: compact(UID_SARL_AMBIGUOUS), legalFormCode: "0107", municipalityId: "5586" },
    ]);
    const outputPath = join(dir, "finma_seats.csv");
    const result = await syncFinmaSeats({ registryPath, fixturePath, edition: EDITION, outputPath, minRows: 0 });
    expect(result.rowCount).toBe(0);
    expect(result.ambiguous).toBe(1);
  });

  it("deux formes juridiques différentes pour le même IDE : ambiguë", async () => {
    const dir = tmpDir();
    const registryPath = writeRegistry(dir, [{ entity_type: "bank", uid: UID_SA_1 }]);
    const fixturePath = writeFixture(dir, [
      { uidValue: compact(UID_SA_1), legalFormCode: "0106", municipalityId: "230" },
      { uidValue: compact(UID_SA_1), legalFormCode: "0107", municipalityId: "230" },
    ]);
    const outputPath = join(dir, "finma_seats.csv");
    const result = await syncFinmaSeats({ registryPath, fixturePath, edition: EDITION, outputPath, minRows: 0 });
    expect(result.rowCount).toBe(0);
    expect(result.ambiguous).toBe(1);
  });

  it("moins de minRows lignes retenues : échec, fichier précédent intact", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "finma_seats.csv");
    writeFileSync(outputPath, "uid,municipality_bfs_id\nCHE-100.000.000,1\n", "utf8");
    const registryPath = writeRegistry(dir, [{ entity_type: "bank", uid: UID_SA_1 }]);
    const fixturePath = writeFixture(dir, [{ uidValue: compact(UID_SA_1), legalFormCode: "0106", municipalityId: "230" }]);
    const before = readFileSync(outputPath, "utf8");
    await expect(syncFinmaSeats({ registryPath, fixturePath, edition: EDITION, outputPath, minRows: 5 })).rejects.toThrow(/lignes|seuil/i);
    expect(readFileSync(outputPath, "utf8")).toBe(before);
  });

  it("baisse de plus de maxDropRatio par rapport au fichier précédent : échec, fichier précédent intact", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "finma_seats.csv");
    const previousLines = Array.from({ length: 100 }, (_, i) => `CHE-100.000.0${String(i).padStart(2, "0")},${100 + i}`);
    const previousCsv = ["uid,municipality_bfs_id", ...previousLines].join("\n") + "\n";
    writeFileSync(outputPath, previousCsv, "utf8");
    // Un seul IDE retenu : baisse énorme (> 5 %).
    const registryPath = writeRegistry(dir, [{ entity_type: "bank", uid: UID_SA_1 }]);
    const fixturePath = writeFixture(dir, [{ uidValue: compact(UID_SA_1), legalFormCode: "0106", municipalityId: "230" }]);
    await expect(syncFinmaSeats({ registryPath, fixturePath, edition: EDITION, outputPath, minRows: 1 })).rejects.toThrow(/baisse/i);
    expect(readFileSync(outputPath, "utf8")).toBe(previousCsv);
  });

  it("finma_seats.meta.json : { edition, source, rows }, source = LINDAS_ENDPOINT", async () => {
    const dir = tmpDir();
    const registryPath = writeRegistry(dir, [{ entity_type: "bank", uid: UID_SA_1 }]);
    const fixturePath = writeFixture(dir, [{ uidValue: compact(UID_SA_1), legalFormCode: "0106", municipalityId: "230" }]);
    const outputPath = join(dir, "finma_seats.csv");
    const result = await syncFinmaSeats({ registryPath, fixturePath, edition: EDITION, outputPath, minRows: 1 });
    const meta = JSON.parse(readFileSync(result.metaPath, "utf8"));
    expect(meta).toEqual({ edition: EDITION, source: LINDAS_ENDPOINT, rows: 1 });
  });

  it("même contenu reconduit : changed=false, fichier non réécrit", async () => {
    const dir = tmpDir();
    const registryPath = writeRegistry(dir, [{ entity_type: "bank", uid: UID_SA_1 }]);
    const fixturePath = writeFixture(dir, [{ uidValue: compact(UID_SA_1), legalFormCode: "0106", municipalityId: "230" }]);
    const outputPath = join(dir, "finma_seats.csv");
    const first = await syncFinmaSeats({ registryPath, fixturePath, edition: EDITION, outputPath, minRows: 1 });
    expect(first.changed).toBe(true);
    const second = await syncFinmaSeats({ registryPath, fixturePath, edition: EDITION, outputPath, minRows: 1 });
    expect(second.changed).toBe(false);
  });
});

describe("syncFinmaSeats (mode réseau, fetchImpl injecté — jamais de fetch global)", () => {
  it("découpe en lots, respecte le délai entre deux lots, jamais après le dernier", async () => {
    const dir = tmpDir();
    const registryPath = writeRegistry(dir, [
      { entity_type: "bank", uid: UID_SA_1 },
      { entity_type: "bank", uid: UID_SA_2 },
      { entity_type: "bank", uid: UID_SARL_AMBIGUOUS },
    ]);
    const outputPath = join(dir, "finma_seats.csv");
    const calls: string[][] = [];
    const sleeps: number[] = [];
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      const uids = [...body.matchAll(/"([A-Z0-9]+)"/g)].map((m) => m[1]);
      calls.push(uids);
      const uid = uids[0];
      return new Response(
        JSON.stringify(sparqlFixture([{ uidValue: uid, legalFormCode: "0106", municipalityId: "230" }])),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const sleep = async (ms: number) => { sleeps.push(ms); };

    const result = await syncFinmaSeats({ registryPath, outputPath, minRows: 0, batchSize: 2, delayMs: 2000, fetchImpl, sleep, now: () => Date.parse("2026-10-07T10:00:00Z") });
    expect(calls).toHaveLength(2); // 3 IDE, lots de 2 : 2 requêtes
    expect(sleeps).toEqual([2000]); // une seule pause, entre les deux lots (jamais après le dernier)
    expect(result.edition).toBe("2026-10-07");
    expect(result.batches).toBe(2);
  });

  it("un lot en échec (HTTP 500) : le script échoue, fichier précédent intact, aucune écriture partielle", async () => {
    const dir = tmpDir();
    const outputPath = join(dir, "finma_seats.csv");
    writeFileSync(outputPath, "uid,municipality_bfs_id\nCHE-100.000.000,1\n", "utf8");
    const before = readFileSync(outputPath, "utf8");
    const registryPath = writeRegistry(dir, [
      { entity_type: "bank", uid: UID_SA_1 },
      { entity_type: "bank", uid: UID_SA_2 },
    ]);
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      if (n === 1) return new Response(JSON.stringify(sparqlFixture([{ uidValue: compact(UID_SA_1), legalFormCode: "0106", municipalityId: "230" }])), { status: 200 });
      return new Response("erreur serveur", { status: 500 });
    }) as typeof fetch;
    const sleep = async () => {};

    await expect(syncFinmaSeats({ registryPath, outputPath, minRows: 0, batchSize: 1, fetchImpl, sleep })).rejects.toThrow(/500/);
    expect(readFileSync(outputPath, "utf8")).toBe(before);
  });

  it("plus de candidats que batchSize*maxBatches : échec explicite avant tout appel réseau", async () => {
    const dir = tmpDir();
    const rows = Array.from({ length: 30 }, (_, i) => ({ entity_type: "bank", uid: validUid(i) }));
    const registryPath = writeRegistry(dir, rows);
    const outputPath = join(dir, "finma_seats.csv");
    let appele = false;
    const fetchImpl = (async () => { appele = true; throw new Error("ne doit jamais être appelé"); }) as typeof fetch;
    await expect(syncFinmaSeats({ registryPath, outputPath, minRows: 0, batchSize: 10, maxBatches: 2, fetchImpl })).rejects.toThrow(/plafond|lots/i);
    expect(appele).toBe(false);
  });
});
