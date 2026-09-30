/**
 * Organisme de surveillance (OS, LEFin) des gestionnaires de fortune et
 * trustees, et tables de référence des OAR et des OS (option B1 du rapport
 * docs/internal/audit-global-20260925/sro-20260930/RAPPORT.md).
 *
 * Sans réseau : fixtures fictives etl/finma/fixtures/finma-{vvtr,sro,ao}-sample.xlsx
 * (générées par generate-supervision-fixtures.ts) et variantes écrites dans un
 * dossier temporaire. Le téléchargement est simulé par un faux fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import parquet from "parquetjs-lite";
import XLSX from "../../etl/shared/xlsx.js";
import { buildBundle as buildProductionBundle, type FinmaSupervisionBundleInput } from "../../etl/finma/bundle.js";
import { parseUidCsv } from "../../etl/finma/ingest.js";
import {
  assertKnownSupervisoryOrganisations,
  attachSupervisoryOrganisations,
  exactMatchKey,
  ingestFinmaSupervision,
  parseReferenceOrganisationsXlsx,
  parseSupervisedManagersXlsx,
} from "../../etl/finma/ingest-supervision.js";
import { FINMA_AO_XLSX_URL, FINMA_SRO_XLSX_URL, FINMA_VVTR_XLSX_URL } from "../../etl/finma/sources.js";
import type { FinmaEntity, FinmaSourceFileMeta } from "../../etl/finma/types.js";
import {
  AO_DATA, OS_ALPHA, OS_BETA, SRO_DATA, VVTR_DATA, aoRows, sroRows, vvtrRows, writeWorkbook,
} from "../../etl/finma/fixtures/generate-supervision-fixtures.js";
import { withTestSignature } from "../helpers/signature.js";

const buildBundle = withTestSignature(buildProductionBundle);
const FIXTURES = join(process.cwd(), "etl/finma/fixtures");
const VVTR = join(FIXTURES, "finma-vvtr-sample.xlsx");
const SRO = join(FIXTURES, "finma-sro-sample.xlsx");
const AO = join(FIXTURES, "finma-ao-sample.xlsx");
const PROVENANCE = { source_url: FINMA_VVTR_XLSX_URL, observed_on: "2026-09-30" };

// Même forme que le uid.csv officiel ; noms fictifs, un cas par règle.
const UID_CSV = [
  "Name;City;AuthorisationTypeDE;AuthorisationTypeFR;AuthorisationTypeIT;AuthorisationTypeEN;UID",
  "Exemple Gestion SA;Lausanne;Vermögensverwalter;Gestionnaire de fortune;Gestore patrimoniale;Portfolio manager;CHE-109.000.001",
  "Exemple Trust & Fiducie AG;Zürich;Vermögensverwalter;Gestionnaire de fortune;Gestore patrimoniale;Portfolio manager;CHE-109.000.002",
  "Exemple Trust & Fiducie AG;Zürich;Trustee;Trustee;Trustee;Trustee;CHE-109.000.002",
  "Exemple Doublon SA;Genève;Vermögensverwalter;Gestionnaire de fortune;Gestore patrimoniale;Portfolio manager;CHE-109.000.003",
  "Exemple Deux UID SA;Bern;Vermögensverwalter;Gestionnaire de fortune;Gestore patrimoniale;Portfolio manager;CHE-109.000.004",
  "Exemple Deux UID SA;Bern;Trustee;Trustee;Trustee;Trustee;CHE-109.000.005",
  "Exemple Type Trustee GmbH;Basel;Vermögensverwalter;Gestionnaire de fortune;Gestore patrimoniale;Portfolio manager;CHE-109.000.006",
  "Exemple Espaces SA;Lugano;Vermögensverwalter;Gestionnaire de fortune;Gestore patrimoniale;Portfolio manager;CHE-109.000.007",
  "Exemple Casse SA;Chur;Vermögensverwalter;Gestionnaire de fortune;Gestore patrimoniale;Portfolio manager;CHE-109.000.008",
  "Exemple Forme AG;Zug;Vermögensverwalter;Gestionnaire de fortune;Gestore patrimoniale;Portfolio manager;CHE-109.000.009",
  "Exemple Gestion SA;Lausanne;Bank;Banque;Banca;Bank;CHE-109.000.001",
  "Exemple OS Alpha SA;Lausanne;Aufsichtsorganisation;Organisme de surveillance;Organismo di vigilanza;Supervisory organisation;CHE-109.000.010",
].join("\n");

function meta(url: string): FinmaSourceFileMeta {
  return { url, fetched_at: "2026-09-30T04:20:00.000Z", last_modified: "Wed, 30 Sep 2026 03:27:21 GMT", sha256: "0".repeat(64), bytes: 1 };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "osd-finma-os-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });

function registry(): FinmaEntity[] {
  const path = join(dir, "uid.csv");
  writeFileSync(path, UID_CSV, "utf8");
  return parseUidCsv(path);
}
const find = (entities: FinmaEntity[], name: string, licence = "Portfolio manager") =>
  entities.find(e => e.name === name && e.licence_type === licence)!;

function supervisionInput(entities: FinmaEntity[]): FinmaSupervisionBundleInput {
  const managers = parseSupervisedManagersXlsx(VVTR);
  const sros = parseReferenceOrganisationsXlsx(SRO, "sro", { source_url: FINMA_SRO_XLSX_URL, observed_on: "2026-09-30" });
  const supervisoryOrganisations = parseReferenceOrganisationsXlsx(AO, "ao", { source_url: FINMA_AO_XLSX_URL, observed_on: "2026-09-30" });
  assertKnownSupervisoryOrganisations(managers, supervisoryOrganisations);
  const matching = attachSupervisoryOrganisations(entities, managers, PROVENANCE);
  return { sros, supervisoryOrganisations, matching, sources: { vvtr: meta(FINMA_VVTR_XLSX_URL), sro: meta(FINMA_SRO_XLSX_URL), ao: meta(FINMA_AO_XLSX_URL) } };
}

describe("lecture de vvtr.xlsx", () => {
  it("lit l'en-tête décalé, les drapeaux et le libellé complet de l'OS", () => {
    const managers = parseSupervisedManagersXlsx(VVTR);
    expect(managers).toHaveLength(VVTR_DATA.length);
    expect(managers[0]).toEqual({ name: "Exemple Gestion SA", city: "Lausanne", portfolio_manager: true, trustee: false, supervisory_organisation: OS_ALPHA });
    expect(managers[1]).toMatchObject({ portfolio_manager: true, trustee: true, supervisory_organisation: OS_BETA });
  });
});

describe("rapprochement exact de l'organisme de surveillance", () => {
  it("attribue seulement les correspondances exactes, uniques et cohérentes", () => {
    const entities = registry();
    const stats = attachSupervisoryOrganisations(entities, parseSupervisedManagersXlsx(VVTR), PROVENANCE);

    const gestion = find(entities, "Exemple Gestion SA");
    expect(gestion.supervisory_organisation).toBe(OS_ALPHA);
    expect(gestion.supervisory_organisation_source_url).toBe(FINMA_VVTR_XLSX_URL);
    expect(gestion.supervisory_organisation_observed_on).toBe("2026-09-30");
    // Deux autorisations, un seul UID : les deux lignes reçoivent l'OS.
    expect(find(entities, "Exemple Trust & Fiducie AG").supervisory_organisation).toBe(OS_BETA);
    expect(find(entities, "Exemple Trust & Fiducie AG", "Trustee").supervisory_organisation).toBe(OS_BETA);
    // Espaces multiples ou en bord : même clé.
    expect(find(entities, "Exemple Espaces SA").supervisory_organisation).toBe(OS_BETA);

    // Ambigu ou absent → vide.
    expect(find(entities, "Exemple Doublon SA").supervisory_organisation).toBeUndefined();
    expect(find(entities, "Exemple Deux UID SA").supervisory_organisation).toBeUndefined();
    expect(find(entities, "Exemple Deux UID SA", "Trustee").supervisory_organisation).toBeUndefined();
    expect(find(entities, "Exemple Type Trustee GmbH").supervisory_organisation).toBeUndefined();
    // Aucune ressemblance : casse et forme juridique différentes ne sont pas rattachées.
    expect(find(entities, "Exemple Casse SA").supervisory_organisation).toBeUndefined();
    expect(find(entities, "Exemple Forme AG").supervisory_organisation).toBeUndefined();
    // Seules les lignes Portfolio manager et Trustee sont concernées.
    expect(find(entities, "Exemple Gestion SA", "Bank").supervisory_organisation).toBeUndefined();
    expect(entities.find(e => e.entity_type === "supervisory_org")!.supervisory_organisation).toBeUndefined();

    expect(stats).toEqual({
      source_rows: 10, matched_source_rows: 3, duplicate_source_rows: 2, ambiguous_uid_source_rows: 1,
      unmatched_source_rows: 3, type_mismatch_rows: 1, registry_candidate_rows: 10, registry_rows_with_value: 4,
    });
  });

  it("n'utilise aucune normalisation au-delà de NFC et des espaces", () => {
    expect(exactMatchKey("  Exemple  Gestion   SA ")).toBe("Exemple Gestion SA");
    expect(exactMatchKey("Exemple Gérance SA")).toBe(exactMatchKey("Exemple Gérance SA"));
    expect(exactMatchKey("Exemple AG")).not.toBe(exactMatchKey("Exemple SA"));
    expect(exactMatchKey("EXEMPLE SA")).not.toBe(exactMatchKey("Exemple SA"));
  });

  it("relancé deux fois, ne garde aucune valeur d'un passage précédent", () => {
    const entities = registry();
    attachSupervisoryOrganisations(entities, parseSupervisedManagersXlsx(VVTR), PROVENANCE);
    attachSupervisoryOrganisations(entities, [], PROVENANCE);
    expect(entities.filter(e => e.supervisory_organisation)).toHaveLength(0);
  });
});

describe("tables de référence des OAR et des OS", () => {
  it("reprend raison sociale, adresse et site, jamais d'e-mail ni de téléphone", () => {
    const sros = parseReferenceOrganisationsXlsx(SRO, "sro", { source_url: FINMA_SRO_XLSX_URL, observed_on: "2026-09-30" });
    const aos = parseReferenceOrganisationsXlsx(AO, "ao", { source_url: FINMA_AO_XLSX_URL, observed_on: "2026-09-30" });
    expect(sros).toHaveLength(SRO_DATA.length);
    expect(aos).toHaveLength(AO_DATA.length);
    // Adresse telle que publiée, retours à la ligne compris.
    expect(sros[1]).toEqual({ name: "Exemple OAR Deux (OAR ED)", address: "Beispielstrasse 2\nPostfach\n8000 Zürich", website: "http://oar-deux.example.test/", source_url: FINMA_SRO_XLSX_URL, observed_on: "2026-09-30" });
    expect(aos[0]).toEqual({ name: OS_ALPHA, address: "Rue de l'Exemple 10", city: "1000 Lausanne", website: "https://os-alpha.example.test", source_url: FINMA_AO_XLSX_URL, observed_on: "2026-09-30" });
    const text = JSON.stringify([...sros, ...aos]);
    expect(text).not.toContain("@");
    expect(text).not.toMatch(/\+41/);
  });

  it("refuse un OS de vvtr.xlsx absent de ao.xlsx", () => {
    const aos = parseReferenceOrganisationsXlsx(AO, "ao", { source_url: FINMA_AO_XLSX_URL, observed_on: "2026-09-30" });
    const managers = parseSupervisedManagersXlsx(VVTR);
    expect(() => assertKnownSupervisoryOrganisations(managers, aos)).not.toThrow();
    expect(() => assertKnownSupervisoryOrganisations([...managers, { ...managers[0], supervisory_organisation: "Exemple OS Inconnu SA" }], aos))
      .toThrow(/absent\(s\) de ao\.xlsx, publication annulée/);
  });
});

describe("format inattendu : échec explicite, jamais une table vide", () => {
  const write = (rows: unknown[][], name: string) => { const path = join(dir, name); writeWorkbook(rows, "feuille", path); return path; };

  it.each([
    ["colonne renommée", () => write(vvtrRows().map((row, i) => i === 3 ? ["Name", "City", "Portfolio Manager", "Trustee", "Supervisory body", "", ""] : row), "v.xlsx"), /colonnes FINMA inattendues/],
    ["total différent du nombre de lignes", () => write(vvtrRows(VVTR_DATA, VVTR_DATA.length + 1), "v.xlsx"), /total annoncé/],
    ["ligne de total absente", () => write(vvtrRows().slice(0, -2), "v.xlsx"), /total absente/],
    ["contenu après le total", () => write([...vvtrRows(), ["Exemple Tardif SA", "Bern", "X", "", OS_ALPHA]], "v.xlsx"), /après la ligne de total/],
    ["drapeau illisible", () => write(vvtrRows([["Exemple Drapeau SA", "Bern", "oui", "", OS_ALPHA]]), "v.xlsx"), /type d'autorisation illisible/],
    ["aucun type coché", () => write(vvtrRows([["Exemple Drapeau SA", "Bern", "", "", OS_ALPHA]]), "v.xlsx"), /type d'autorisation illisible/],
    ["OS manquant", () => write(vvtrRows([["Exemple Sans OS SA", "Bern", "X", "", ""]]), "v.xlsx"), /incomplète/],
    ["table vide", () => write(vvtrRows([]), "v.xlsx"), /table vide/],
    ["page HTML au lieu d'un classeur", () => { const path = join(dir, "v.xlsx"); writeFileSync(path, "<!doctype html><title>Erreur</title>"); return path; }, /pas un classeur XLSX/],
  ])("vvtr.xlsx : %s", (_, make, error) => {
    expect(() => parseSupervisedManagersXlsx(make())).toThrow(error);
  });

  it("sro.xlsx et ao.xlsx : mêmes contrôles d'en-tête, de total et de contenu", () => {
    const opts = { source_url: FINMA_SRO_XLSX_URL, observed_on: "2026-09-30" };
    expect(() => parseReferenceOrganisationsXlsx(write(sroRows(SRO_DATA, 3), "s.xlsx"), "sro", opts)).toThrow(/total annoncé/);
    expect(() => parseReferenceOrganisationsXlsx(write(sroRows([]), "s.xlsx"), "sro", opts)).toThrow(/table vide/);
    expect(() => parseReferenceOrganisationsXlsx(write(aoRows().map((row, i) => i === 5 ? ["Name", "Street", "City", "Telephone", "", "", "E-mail", "Homepage"] : row), "a.xlsx"), "ao", opts)).toThrow(/colonnes FINMA inattendues/);
    expect(() => parseReferenceOrganisationsXlsx(write(aoRows([[OS_ALPHA, "Rue 1", "", "", null, null, "", ""]]), "a.xlsx"), "ao", opts)).toThrow(/sans localité/);
  });
});

describe("collecte : bronze daté puis lecture", () => {
  it("télécharge les trois fichiers, garde leur provenance et rapproche", async () => {
    const bytes: Record<string, Buffer> = { [FINMA_VVTR_XLSX_URL]: readFileSync(VVTR), [FINMA_SRO_XLSX_URL]: readFileSync(SRO), [FINMA_AO_XLSX_URL]: readFileSync(AO) };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(new Uint8Array(bytes[url]), { headers: { "last-modified": "Wed, 30 Sep 2026 03:27:21 GMT" } })));
    const result = await ingestFinmaSupervision({ cacheDir: dir });
    expect(result.managers).toHaveLength(VVTR_DATA.length);
    expect(result.sros).toHaveLength(SRO_DATA.length);
    expect(result.supervisoryOrganisations).toHaveLength(AO_DATA.length);
    expect(result.sources.vvtr).toMatchObject({ url: FINMA_VVTR_XLSX_URL, last_modified: "Wed, 30 Sep 2026 03:27:21 GMT" });
    expect(result.sources.vvtr.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sros[0].observed_on).toBe(new Date().toISOString().slice(0, 10));
  });

  it("un téléchargement refusé arrête la collecte", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("indisponible", { status: 503 })));
    await expect(ingestFinmaSupervision({ cacheDir: dir })).rejects.toThrow(/Source indisponible : HTTP 503/);
  });
});

describe("archive livrée", () => {
  it("porte le champ dans les quatre formats, le schéma et deux tables non vides", async () => {
    const entities = registry();
    const supervision = supervisionInput(entities);
    const result = await buildBundle({ entities, supervision }, "2026.09.30", dir);
    expect(result.supervisoryOrganisationRowCount).toBe(4);
    expect(result.referenceSroCount).toBe(2);
    expect(result.referenceSupervisoryOrganisationCount).toBe(2);

    const unzip = (name: string) => execFileSync("unzip", ["-p", result.zipPath, name], { encoding: "utf8" });
    const listing = execFileSync("unzip", ["-l", result.zipPath], { encoding: "utf8" });
    const references = ["finma_reference_sros", "finma_reference_supervisory_organisations"];
    for (const file of [...references.flatMap(f => ["csv", "json", "sql", "parquet"].map(ext => `${f}.${ext}`)), "schema_reference_sros.json", "schema_reference_supervisory_organisations.json"]) {
      expect(listing, file).toContain(file);
    }

    // CSV, JSON et SQL du registre.
    const csv = unzip("finma_registry.csv");
    expect(csv.split("\n")[0]).toContain("supervisory_organisation,supervisory_organisation_source_url,supervisory_organisation_observed_on");
    expect(csv).toContain(OS_ALPHA);
    const json = JSON.parse(unzip("finma_registry.json")) as FinmaEntity[];
    expect(json.find(e => e.name === "Exemple Gestion SA" && e.licence_type === "Portfolio manager")!.supervisory_organisation).toBe(OS_ALPHA);
    const db = new Database(":memory:");
    db.exec(unzip("finma_registry.sql"));
    expect(db.prepare("SELECT COUNT(*) AS n FROM finma_registry WHERE supervisory_organisation <> ''").get()).toEqual({ n: 4 });
    for (const f of references) db.exec(unzip(`${f}.sql`));
    expect(db.prepare("SELECT COUNT(*) AS n FROM finma_reference_sros").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT city FROM finma_reference_supervisory_organisations WHERE name = ?").get(OS_BETA)).toEqual({ city: "8000 Zürich" });
    db.close();

    // Parquet du registre.
    const parquetPath = join(dir, "registre.parquet");
    writeFileSync(parquetPath, execFileSync("unzip", ["-p", result.zipPath, "finma_registry.parquet"]));
    const reader = await parquet.ParquetReader.openFile(parquetPath);
    const cursor = reader.getCursor();
    const values: unknown[] = [];
    for (let row = await cursor.next(); row; row = await cursor.next()) values.push((row as Record<string, unknown>).supervisory_organisation);
    await reader.close();
    expect(values.filter(Boolean)).toHaveLength(4);

    // Schéma : libellé explicite, jamais présenté comme une affiliation OAR.
    const schema = JSON.parse(unzip("schema.json"));
    const property = schema.items.properties.supervisory_organisation;
    expect(property.description).toMatch(/loi sur les établissements financiers \(LEFin\)/);
    expect(property.description).toMatch(/n'est pas une affiliation à un organisme d'autorégulation/);
    expect(schema.items.properties.supervisory_organisation_observed_on.format).toBe("date");

    // Tables de référence : non vides, sans e-mail ni téléphone.
    for (const f of references) {
      const rows = JSON.parse(unzip(`${f}.json`)) as unknown[];
      expect(rows.length, f).toBeGreaterThan(0);
      for (const ext of ["csv", "json", "sql"]) {
        const text = unzip(`${f}.${ext}`);
        expect(text, `${f}.${ext}`).not.toContain("@");
        expect(text, `${f}.${ext}`).not.toMatch(/\+41/);
      }
    }

    // Provenance : sommes de contrôle, quality.json, README et classeur.
    const checksums = unzip("checksums.sha256");
    for (const f of references) expect(checksums).toContain(`${f}.csv`);
    const quality = JSON.parse(unzip("quality.json"));
    expect(quality.supervisory_organisation).toMatchObject({ registry_rows_with_value: 4, source_rows: 10, matched_source_rows: 3 });
    expect(quality.supervisory_organisation.source.url).toBe(FINMA_VVTR_XLSX_URL);
    expect(quality.reference_tables.sros.rows).toBe(2);
    expect(quality.populated_fields).not.toHaveProperty("supervisory_organisation");
    const readme = unzip("README.md");
    expect(readme).toContain("## Organisme de surveillance des gestionnaires de fortune et trustees");
    expect(readme).toContain("4 lignes renseignées sur 10 lignes « Portfolio manager » et « Trustee »");
    expect(readme).toContain("finma_reference_sros : 2 OAR reconnus");
    expect(readme).toContain("fichier FINMA daté du 2026-09-30");
    expect(readme).not.toMatch(/: 0 lignes/);
    const workbookPath = join(dir, "finma.xlsx");
    writeFileSync(workbookPath, execFileSync("unzip", ["-p", result.zipPath, "finma.xlsx"]));
    expect(XLSX.readFile(workbookPath).SheetNames).toEqual(["Registre", "Avertissements", "OAR reconnus", "Organismes de surveillance", "Lire avant utilisation"]);
  });

  it("sans collecte de supervision (fixtures), aucune table promise ni ligne vide annoncée", async () => {
    const result = await buildBundle({ entities: registry() }, "2026.09.30", dir);
    const listing = execFileSync("unzip", ["-l", result.zipPath], { encoding: "utf8" });
    expect(listing).not.toContain("finma_reference_");
    const readme = execFileSync("unzip", ["-p", result.zipPath, "README.md"], { encoding: "utf8" });
    expect(readme).not.toContain("finma_reference_");
    expect(result.referenceSroCount).toBe(0);
  });

  it("refuse une table de référence vide ou un champ promis sans aucune valeur", async () => {
    const entities = registry();
    const supervision = supervisionInput(entities);
    await expect(buildBundle({ entities, supervision: { ...supervision, sros: [] } }, "2026.09.30", dir)).rejects.toThrow(/Table de référence FINMA vide/);
    for (const e of entities) delete e.supervisory_organisation;
    await expect(buildBundle({ entities, supervision }, "2026.09.30", dir)).rejects.toThrow(/Aucun organisme de surveillance rattaché/);
  });
});

describe("schéma public du paquet", () => {
  it("packages/schemas/finma.schema.json décrit le nouveau champ", () => {
    const schema = JSON.parse(readFileSync(join(process.cwd(), "packages/schemas/finma.schema.json"), "utf8"));
    const properties = schema.items.properties;
    for (const field of ["supervisory_organisation", "supervisory_organisation_source_url", "supervisory_organisation_observed_on"]) {
      expect(properties, field).toHaveProperty(field);
    }
    expect(properties.supervisory_organisation.description).toMatch(/not a self-regulatory organisation \(SRO\) affiliation/);
  });
});
