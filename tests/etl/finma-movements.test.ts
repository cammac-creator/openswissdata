// Mouvements mensuels FINMA (lot V1 de la vitrine « Mouvements FINMA »).
// Données entièrement inventées : noms « témoin », IDE en CHE-900.*, adresses en alerte.exemple.
// Ce fichier prouve : 1) liste d'alerte en totaux seulement, ajouts par date FINMA, retraits
// par adresse exacte et jamais par le nom ; 2) registre par catégorie, sans aucun nom ;
// 3) le trou du 24.08 au 25.09.2026 n'est compté dans aucun mois ; 4) une comparaison
// anormale est exclue et signalée ; 5) un mois figé survit à la fenêtre et n'est jamais recalculé.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import archiver from "archiver";
vi.mock("../../src/lib/r2.js", () => ({ getObjectBuffer: vi.fn(async () => { throw new Error("aucun accès R2 dans ce test"); }) }));
import {
  buildMovements, compareRegistry, MOVEMENT_RULES, MovementsInheritanceError,
  type MovementsBlock, type MovementsSnapshot,
} from "../../etl/finma/movements.js";
import { readPublishedSnapshots } from "../../etl/finma/history.js";
import { buildBundle as buildProductionBundle } from "../../etl/finma/bundle.js";
import { withTestSignature } from "../helpers/signature.js";
import type { FinmaEntity, FinmaWarning } from "../../etl/finma/types.js";

const buildBundle = withTestSignature(buildProductionBundle);

const uid = (i: number) => `CHE-900.000.${String(i).padStart(3, "0")}`;
const bank = (i: number, extra: Partial<FinmaEntity> = {}): FinmaEntity => ({
  entity_type: "bank", name: `Banque témoin ${i}`, uid: uid(i), licence_type: "Bank", city: "Ville témoin",
  source_list: "finma-uid-csv", source_url: "https://registre.exemple/", ...extra,
});
const manager = (i: number, extra: Partial<FinmaEntity> = {}): FinmaEntity => bank(i, {
  entity_type: "asset_manager_individual", name: `Gestion témoin ${i}`, licence_type: "Portfolio manager", ...extra,
});
/** 40 banques et 20 gestionnaires : seuil d'anomalie = max(30, 1 % de 60) = 30 lignes par jour. */
const base = (): FinmaEntity[] => [...Array.from({ length: 40 }, (_, i) => bank(i + 1)), ...Array.from({ length: 20 }, (_, i) => manager(i + 41))];
const alert = (i: number, date: string, extra: Partial<FinmaWarning> = {}): FinmaWarning => ({
  name: `Entité témoin ${i}`, date_added: date, source_url: `https://alerte.exemple/fiche-${i}/`,
  source_list: "finma-warnings", warning_type: "unauthorized_provider", ...extra,
});
const snap = (version: string, entities: FinmaEntity[], warnings?: FinmaWarning[], quality?: unknown): MovementsSnapshot =>
  ({ version, entities, warnings, quality });
/** Le mois demandé, présent une seule fois (un mois figé recalculé en double doit échouer). */
const month = (block: MovementsBlock, m: string) => {
  const found = block.months.filter(x => x.month === m);
  if (found.length !== 1) throw new Error(`mois ${m} présent ${found.length} fois`);
  return found[0];
};
/** Aucun nom, aucun IDE, aucune adresse de page dans un bloc publié. */
const expectNoIdentity = (value: unknown) => {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/témoin|CHE-\d|alerte\.exemple|registre\.exemple|https?:\/\//);
};

describe("Mouvements FINMA : liste d'alerte (exigence 1)", () => {
  it("ne publie que des totaux : ajouts par date FINMA, retraits par adresse exacte, jamais par le nom", () => {
    const start = [alert(1, "2026-09-20"), alert(2, "2026-09-21"), alert(3, "2026-09-22"), alert(4, "2026-09-23")];
    const s1 = snap("2026.10.01", base(), start);
    // 02.10 : la fiche 2 est retirée, les fiches 5 et 6 sont ajoutées.
    const day2 = [start[0], start[2], start[3], alert(5, "2026-10-01"), alert(6, "2026-10-02")];
    const s2 = snap("2026.10.02", base(), day2);
    // 03.10 : homonyme de la fiche 3 sous une autre adresse (nouvelle entrée, pas la même) ;
    // la fiche 4 change d'adresse en gardant sa date ; une adresse en double ne compte qu'une fois.
    const day3 = [start[0], start[0], start[2], alert(5, "2026-10-01"), alert(6, "2026-10-02"),
      alert(30, "2026-10-02", { name: "Entité témoin 3" }), alert(40, "2026-09-23", { name: "Entité témoin 4" })];
    const block = buildMovements([s1, s2], snap("2026.10.03", base(), day3));

    const october = month(block, "2026-10");
    expect(october.warnings).toMatchObject({
      appeared: 4, removed: 2, removed_possible_url_change: 1, appeared_late: 1,
      added_dated_in_month: 3, added_as_of: "2026.10.03", comparisons: 2,
    });
    expect(block.months.map(m => m.month)).toEqual(["2026-10"]);
    expect(block.warnings_without_date_added).toBe(0);
    expectNoIdentity(block);
  });

  it("compte à part les entrées sans date d'ajout et ne les range dans aucun mois", () => {
    const s1 = snap("2026.10.01", base(), [alert(1, "2026-09-20")]);
    const block = buildMovements([s1], snap("2026.10.02", base(), [alert(1, "2026-09-20"), alert(2, "", { date_added: undefined })]));
    expect(block.warnings_without_date_added).toBe(1);
    expect(month(block, "2026-10").warnings).toMatchObject({ appeared: 1, added_dated_in_month: 0 });
  });
});

describe("Mouvements FINMA : registre par catégorie (exigence 2)", () => {
  it("compte apparitions, disparitions, changements de type, de nom et de localité, sans aucun nom", () => {
    const after = base()
      .filter(e => e.uid !== uid(45))
      .map(e => e.uid === uid(1) ? { ...e, entity_type: "securities_firm" as const, licence_type: "Securities firm" }
        : e.uid === uid(2) ? { ...e, name: "Banque témoin 2 renommée" }
          : e.uid === uid(3) ? { ...e, city: "Autre ville témoin" } : e);
    after.push(bank(100));
    const block = buildMovements([snap("2026.10.01", base())], snap("2026.10.02", after));
    const registry = month(block, "2026-10").registry;
    expect(registry.totals).toEqual({ added: 1, removed: 1, licence_changed: 1, name_changed: 1, city_changed: 1, status_changed: 0, address_changed: 0 });
    expect(registry.by_category.bank).toMatchObject({ added: 1, name_changed: 1, city_changed: 1, removed: 0 });
    expect(registry.by_category.securities_firm).toMatchObject({ licence_changed: 1, added: 0 });
    expect(registry.by_category.asset_manager_individual).toMatchObject({ removed: 1 });
    expect(registry.reclassified_by_collection).toBe(0);
    expectNoIdentity(block);
  });

  it("neutralise un reclassement de notre collecte (même libellé FINMA, autre catégorie), avec ou sans IDE", () => {
    const fintech = (i: number, type: FinmaEntity["entity_type"], withUid = true): FinmaEntity =>
      bank(i, { entity_type: type, name: `Fintech témoin ${i}`, licence_type: "Fintech licence", uid: withUid ? uid(i) : undefined });
    const before = [...base(), fintech(201, "other"), fintech(202, "other"), fintech(203, "other", false)];
    const after = [...base(), fintech(201, "fintech"), fintech(202, "fintech"), fintech(203, "fintech", false)];
    const registry = compareRegistry(before, after);
    expect(registry.reclassified_by_collection).toBe(3);
    expect(Object.values(registry.totals).every(n => n === 0)).toBe(true);
    expect(registry.by_category).toEqual({});
  });

  it("laisse brut un appariement ambigu (plusieurs apparitions et disparitions de la même identité)", () => {
    const before = [...base(), bank(300, { licence_type: "Bank A" }), bank(300, { entity_type: "securities_firm", licence_type: "Firm A" })];
    const after = [...base(), bank(300, { licence_type: "Bank B" }), bank(300, { entity_type: "securities_firm", licence_type: "Firm B" })];
    const registry = compareRegistry(before, after);
    expect(registry.totals).toMatchObject({ added: 2, removed: 2, licence_changed: 0 });
    expect(registry.reclassified_by_collection).toBe(0);
  });

  it("ne compte ni l'enrichissement GLEIF ni le retrait des guillemets, comme le changelog", () => {
    const before = [...base(), bank(400, { name: 'Banque "témoin" 400' })];
    const after = [...base(), bank(400, { name: "Banque témoin 400", address: "Rue témoin 1, 1000 Ville", address_source_url: "https://api.gleif.org/api/v1/lei-records/X" })];
    expect(Object.values(compareRegistry(before, after).totals).every(n => n === 0)).toBe(true);
  });
});

describe("Mouvements FINMA : le trou du 24.08 au 25.09.2026 (exigence 3)", () => {
  it("ne compte la comparaison 24.08 → 25.09 dans aucun mois et la publie à part, avec ses dates", () => {
    const july = [alert(1, "2026-07-10"), alert(2, "2026-07-11")];
    const s0 = snap("2026.08.23", base(), july);
    const s1 = snap("2026.08.24", [...base(), bank(101)], [...july, alert(3, "2026-08-24")]);
    // Pendant le trou : deux banques arrivent, un gestionnaire part, trois entrées d'alerte apparaissent et une part.
    const s2 = snap("2026.09.25", [...base().filter(e => e.uid !== uid(41)), bank(101), bank(102), bank(103)],
      [july[1], alert(3, "2026-08-24"), alert(4, "2026-08-26"), alert(5, "2026-09-10"), alert(6, "2026-09-24")]);
    const s3 = snap("2026.09.26", [...base().filter(e => e.uid !== uid(41)), bank(101, { name: "Banque témoin 101 renommée" }), bank(102), bank(103)],
      [july[1], alert(3, "2026-08-24"), alert(4, "2026-08-26"), alert(5, "2026-09-10"), alert(6, "2026-09-24"), alert(7, "2026-09-25")]);
    const block = buildMovements([s0, s1, s2], s3);

    const august = month(block, "2026-08"), september = month(block, "2026-09");
    expect(august.registry.totals).toMatchObject({ added: 1, removed: 0 });
    expect(august).toMatchObject({ first_observed: "2026-08-24", last_observed: "2026-08-24", status: "frozen", frozen_in_version: "2026.09.26", partial: true });
    expect(august.registry.days_covered).toBe(1);
    expect(august.warnings).toMatchObject({ appeared: 1, removed: 0, added_dated_in_month: 1 });
    expect(september.registry.totals).toMatchObject({ added: 0, removed: 0, name_changed: 1 });
    expect(september).toMatchObject({ first_observed: "2026-09-26", status: "open" });
    // Les entrées vues pour la première fois à la reprise ne comptent dans aucun mois.
    expect(september.warnings).toMatchObject({ appeared: 1, removed: 0, added_dated_in_month: 1 });

    expect(block.resumptions).toHaveLength(1);
    const [resumption] = block.resumptions;
    expect(resumption).toMatchObject({ from: "2026.08.24", to: "2026.09.25", days: 32, registry_anomaly: null, warnings_anomaly: null });
    expect(resumption.registry.totals).toMatchObject({ added: 2, removed: 1 });
    expect(resumption.warnings).toMatchObject({ appeared: 3, removed: 1, appeared_by_finma_month: { "2026-08": 1, "2026-09": 2 }, appeared_undated: 0 });
    expect(resumption.days).toBeGreaterThan(MOVEMENT_RULES.gap_days);
    expectNoIdentity(block);
  });
});

describe("Mouvements FINMA : jours anormaux (exigence 4)", () => {
  it("exclut du mois une comparaison anormale, liste par liste, et la signale", () => {
    const start = Array.from({ length: 10 }, (_, i) => alert(i + 1, "2026-09-01"));
    const s1 = snap("2026.10.01", base(), start);
    // 02.10 : 35 lignes du registre disparaissent (seuil 30) ; la liste d'alerte, elle, est normale.
    const s2 = snap("2026.10.02", base().slice(35), [...start, alert(11, "2026-10-01")]);
    // 03.10 : registre normal (une banque) ; 40 entrées d'alerte apparaissent d'un coup (seuil 30).
    const burst = Array.from({ length: 40 }, (_, i) => alert(100 + i, "2026-10-02"));
    const block = buildMovements([s1, s2], snap("2026.10.03", [...base().slice(35), bank(500)], [...start, alert(11, "2026-10-01"), ...burst]));

    const october = month(block, "2026-10");
    expect(october.registry.totals).toMatchObject({ added: 1, removed: 0 });
    expect(october.registry.comparisons).toBe(1);
    expect(october.warnings).toMatchObject({ appeared: 1, comparisons: 1, added_dated_in_month: 1 });
    expect(october.excluded).toEqual([
      expect.objectContaining({ from: "2026.10.01", to: "2026.10.02", list: "registry", movements: 35, limit: 30 }),
      expect.objectContaining({ from: "2026.10.02", to: "2026.10.03", list: "warnings", movements: 40, limit: 30 }),
    ]);
    expect(october.excluded.every(e => e.reason.length > 0)).toBe(true);
    expect(october.partial).toBe(true);
    expectNoIdentity(block);
  });

  it("garde une journée ordinaire sous le seuil (les volumes réels mesurés restent sous 30)", () => {
    const after = [...base().slice(15), ...Array.from({ length: 14 }, (_, i) => bank(600 + i))];
    const block = buildMovements([snap("2026.10.01", base())], snap("2026.10.02", after));
    expect(month(block, "2026-10").excluded).toEqual([]);
    expect(month(block, "2026-10").registry.totals).toMatchObject({ added: 14, removed: 15 });
  });
});

describe("Mouvements FINMA : mois figés (exigence 5)", () => {
  it("fige un mois à la première collecte datée du 3 du mois suivant, pas avant", () => {
    const snaps = [snap("2026.10.30", base()), snap("2026.10.31", [...base(), bank(700)])];
    const before3 = buildMovements(snaps, snap("2026.11.02", [...base(), bank(700)]));
    expect(month(before3, "2026-10")).toMatchObject({ status: "open", frozen_in_version: null });
    const on3 = buildMovements([...snaps, snap("2026.11.02", [...base(), bank(700)])], snap("2026.11.03", [...base(), bank(700)]));
    expect(month(on3, "2026-10")).toMatchObject({ status: "frozen", frozen_in_version: "2026.11.03" });
    expect(month(on3, "2026-10").registry.totals.added).toBe(1);
    expect(month(on3, "2026-11")).toMatchObject({ status: "open" });
  });

  it("recopie tels quels les mois figés et les reprises hérités, même sortis de la fenêtre", () => {
    // Bloc d'une collecte de fin septembre : août figé, reprise 24.08 → 25.09.
    const old = buildMovements(
      [snap("2026.08.23", base()), snap("2026.08.24", [...base(), bank(101)])],
      snap("2026.09.25", [...base(), bank(101), bank(102)]),
    );
    expect(month(old, "2026-08").status).toBe("frozen");
    expect(old.resumptions).toHaveLength(1);
    // Mi-octobre : la fenêtre ne contient plus ni août ni la reprise ; le bloc hérité est dans la version publiée la plus récente.
    const latest = snap("2026.10.14", [...base(), bank(101), bank(102)], undefined, { history: { movements: old } });
    const block = buildMovements([snap("2026.10.13", [...base(), bank(101), bank(102)]), latest], snap("2026.10.15", [...base(), bank(101), bank(102), bank(103)]));
    expect(month(block, "2026-08")).toEqual(month(old, "2026-08"));
    expect(block.resumptions).toEqual(old.resumptions);
    expect(month(block, "2026-10").registry.totals.added).toBe(1);
    expect(block.first_observed).toBe("2026-08-24");
  });

  it("garde la valeur figée même quand un recalcul donnerait autre chose", () => {
    const window = [snap("2026.10.30", base()), snap("2026.10.31", [...base(), bank(700)])];
    const frozen = buildMovements(window, snap("2026.11.03", [...base(), bank(700)]));
    const altered = structuredClone(frozen);
    month(altered, "2026-10").registry.totals.added = 99;
    const latest = snap("2026.11.03", [...base(), bank(700)], undefined, { history: { movements: altered } });
    const block = buildMovements([...window, latest], snap("2026.11.04", [...base(), bank(700)]));
    expect(month(block, "2026-10").registry.totals.added).toBe(99);
    expect(month(block, "2026-10").frozen_in_version).toBe("2026.11.03");
  });

  it("refuse un bloc hérité illisible au lieu de repartir de zéro", () => {
    const bad = snap("2026.10.14", base(), undefined, { history: { movements: { schema_version: 1, months: "illisible", resumptions: [] } } });
    expect(() => buildMovements([bad], snap("2026.10.15", base()))).toThrow(MovementsInheritanceError);
    const future = snap("2026.10.14", base(), undefined, { history: { movements: { schema_version: 2, months: [], resumptions: [] } } });
    expect(() => buildMovements([future], snap("2026.10.15", base()))).toThrow(/version de schéma 2/);
  });

  it("amorce le bloc quand aucune version publiée n'en porte", () => {
    const block = buildMovements([snap("2026.10.14", base(), undefined, { history: { gaps: [] } })], snap("2026.10.15", [...base(), bank(800)]));
    expect(block).toMatchObject({ schema_version: 1, computed_in_version: "2026.10.15", resumptions: [] });
    expect(month(block, "2026-10").registry.totals.added).toBe(1);
  });
});

describe("Mouvements FINMA : archive et lecture des versions publiées", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "osd-finma-mouvements-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });

  it("ajoute history.movements à quality.json sans toucher au reste de l'historique ni au changelog", async () => {
    const movements = buildMovements([snap("2026.10.01", base())], snap("2026.10.02", [...base(), bank(900)]));
    const coverage = { available_from: "2026-10-01", available_until: "2026-10-02", snapshots: 2, gaps: [], interpretation: "Fictif." };
    const recentChanges = [{ kind: "added" as const, entity_type: "bank" as const, name: "Banque témoin 900", source_list: "finma-uid-csv" }];
    const result = await buildBundle({ entities: [...base(), bank(900)], recentChanges, historyCoverage: { ...coverage, movements } }, "2026.10.02", dir);
    const unzip = (name: string) => execFileSync("unzip", ["-p", result.zipPath, name], { encoding: "utf8" });
    const quality = JSON.parse(unzip("quality.json"));
    expect(quality.history).toEqual({ ...coverage, movements });
    expect(JSON.parse(unzip("changelog_90d.json"))).toEqual(recentChanges);
    const readme = unzip("README.md");
    expect(readme).toContain("## Mouvements mensuels");
    expect(readme).toContain("history.movements");
    expect(readme).toContain("n'est pas une sanction");

    const without = await buildBundle({ entities: base(), historyCoverage: coverage }, "2026.10.03", dir);
    expect(execFileSync("unzip", ["-p", without.zipPath, "README.md"], { encoding: "utf8" })).not.toContain("Mouvements mensuels");
  });

  it("lit la liste d'alerte et quality.json des versions publiées, absents compris", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T06:00:00Z"));
    const historique = join(dir, "bronze", "2026-10-21", "historique");
    mkdirSync(historique, { recursive: true });
    const zip = async (version: string, files: Record<string, unknown>) => {
      const archive = archiver("zip"); const chunks: Buffer[] = [];
      const done = new Promise<Buffer>((resolve, reject) => { archive.on("data", c => chunks.push(c)); archive.on("error", reject); archive.on("end", () => resolve(Buffer.concat(chunks))); });
      for (const [name, value] of Object.entries(files)) archive.append(JSON.stringify(value), { name });
      await archive.finalize();
      const bytes = await done;
      writeFileSync(join(historique, `finma-${version}.zip`), bytes);
      return { version, r2_key: `finma/${version}/finma.zip`, sha256: createHash("sha256").update(bytes).digest("hex"), size_bytes: bytes.length, released_at: 0 };
    };
    const registry = Array.from({ length: 2_000 }, (_, i) => bank(i));
    const quality = { history: { movements: { schema_version: 1 } } };
    const versions = [
      await zip("2026.09.24", { "finma_registry.json": registry }),
      await zip("2026.10.20", { "finma_registry.json": registry, "finma_warnings.json": [alert(1, "2026-10-01")], "quality.json": quality }),
    ];
    const snapshots = await readPublishedSnapshots(versions, dir);
    expect(snapshots[0]).toMatchObject({ version: "2026.09.24", warnings: undefined, quality: undefined });
    expect(snapshots[1].warnings).toHaveLength(1);
    expect(snapshots[1].quality).toEqual(quality);

    const broken = await zip("2026.10.21", { "finma_registry.json": registry, "finma_warnings.json": { pas: "une liste" } });
    await expect(readPublishedSnapshots([broken], dir)).rejects.toThrow("Liste d'alerte historique illisible");
  });
});
