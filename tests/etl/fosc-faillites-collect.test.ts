import { describe, expect, it } from "vitest";
import { createPoliteClient } from "../../etl/fosc/client.js";
import { runFoscCollection, type CollectOptions } from "../../etl/fosc/collect.js";
import type { CommuneResolver, PostalResolver } from "../../etl/fosc/communes.js";
import { memoryStore } from "../../etl/fosc/store.js";
import { MAX_RETENTION_DAYS, STATE_SCHEMA, type FoscState } from "../../etl/fosc/state.js";
import type { TotalsDocument } from "../../etl/fosc/totals.js";
import { avisId, FAKE_TERMS_SHA256, type FakeAvis } from "../helpers/fosc-portal.js";
import { combinedPortal, IDE, type InsolvencyAvis } from "../helpers/fosc-insolvency-portal.js";

// Toutes les données sont inventées (dépôt public). Passage du 21.10.2026 à 10 h (heure suisse).
const NOW = new Date("2026-10-21T08:00:00Z");
const DAY = "2026-10-20";
const insId = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const POSTAL: Record<string, { bfs: number; canton: string }> = { "1000": { bfs: 5586, canton: "VD" }, "8001": { bfs: 261, canton: "ZH" }, "1204": { bfs: 6621, canton: "GE" } };
const resolvePostal: PostalResolver = (zip) => (zip ? POSTAL[zip] ?? null : null);
const communes: CommuneResolver = () => null;
const ROW_KEYS = ["canton", "delete_on", "event_type", "ide", "legal_form", "municipality_bfs_id", "publication_date", "publication_id", "verified_on"];

/** Une faillite de SA, un concordat de SA et un appel aux créanciers de liquidation d'une Sàrl. */
function companyAvis(date = DAY): InsolvencyAvis[] {
  return [
    { id: insId(1), subRubric: "KK02", date, cantons: ["VD"], companies: [{ uid: IDE.sa1, legalForm: "0106", zip: "1000", town: "Lausanne", canton: "VD" }],
      dates: { resolutionDate: "2026-10-15", entryDeadline: "2026-11-20" } },
    { id: insId(2), subRubric: "NA02", date, cantons: ["ZH"], companies: [{ uid: IDE.sa2, legalForm: "0106", zip: "8001", town: "Zürich", canton: "ZH" }],
      dates: { moratoriumDateFrom: "2026-10-14", entryDeadline: "2027-04-14" } },
    { id: insId(3), subRubric: "LS02", date, cantons: ["GE"], companies: [{ uid: IDE.sarl, legalForm: "0107", zip: "1204", town: "Genève", canton: "GE" }],
      dates: { entryDeadline: "2026-11-30" }, officeUid: IDE.revision },
  ];
}

function setup(ins: InsolvencyAvis[], hr: FakeAvis[] = [], maxRequests = 500) {
  const portal = combinedPortal(ins, hr);
  const client = createPoliteClient({ fetchImpl: portal.fetchImpl, sleepImpl: async () => {}, delayMs: 0, maxRequests });
  return {
    portal,
    opts: (store: ReturnType<typeof memoryStore>, now = NOW, extra: Partial<CollectOptions> = {}): CollectOptions => ({
      store, client, resolveCommune: communes, resolvePostal, now, days: [DAY], termsSha256: FAKE_TERMS_SHA256, ...extra,
    }),
  };
}

const stateOf = (store: ReturnType<typeof memoryStore>) => store.state as FoscState;
const detailCalls = (calls: string[]) => calls.filter((c) => c.endsWith("/xml")).length;

describe("faillites, concordats, liquidations : lignes des sociétés", () => {
  it("une faillite de SA, un concordat et un appel aux créanciers de liquidation sont écrits avec les seuls champs permis", async () => {
    const store = memoryStore();
    const { opts } = setup(companyAvis());
    const report = await runFoscCollection(opts(store));
    expect(report.exit_code).toBe(0);
    const rows = stateOf(store).events;
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual([...ROW_KEYS, "dates"].sort());
    expect(rows.find((r) => r.event_type === "KK02")).toEqual({
      publication_id: insId(1), ide: IDE.sa1, event_type: "KK02", publication_date: DAY, municipality_bfs_id: 5586, canton: "VD",
      legal_form: "0106", delete_on: "2026-11-19", verified_on: "2026-10-21", dates: { resolutionDate: "2026-10-15", entryDeadline: "2026-11-20" },
    });
    expect(rows.find((r) => r.event_type === "NA02")).toMatchObject({ ide: IDE.sa2, canton: "ZH", municipality_bfs_id: 261, legal_form: "0106",
      dates: { moratoriumDateFrom: "2026-10-14", entryDeadline: "2027-04-14" } });
    expect(rows.find((r) => r.event_type === "LS02")).toMatchObject({ ide: IDE.sarl, canton: "GE", municipality_bfs_id: 6621, legal_form: "0107",
      dates: { entryDeadline: "2026-11-30" } });
    expect(report.insolvency.outcomes.row).toBe(3);
    expect(report.insolvency.with_dates).toBe(3);
    expect(report.days[0]).toMatchObject({ listed: 3, stored_rows: 3, totals_only: 0, persons: 0, details_read: 3 });
    expect(stateOf(store).days[0].rubrics).toEqual(["HR", "KK", "NA", "LS", "SR"]);
  });

  it("une date invalide ou hors de la liste fermée de la sous-rubrique n'est jamais gardée ; la ligne reste", async () => {
    const store = memoryStore();
    const { opts } = setup([{ id: insId(4), subRubric: "KK03", date: DAY, cantons: ["VD"], companies: [{ uid: IDE.sa1, legalForm: "0106" }],
      dates: { resolutionDate: "2026-02-30", cessationDate: "2026-10-16", entryDeadline: "2026-11-05", hearingDate: "2026-12-01" } }]);
    await runFoscCollection(opts(store));
    expect(stateOf(store).events[0].dates).toEqual({ cessationDate: "2026-10-16", entryDeadline: "2026-11-05" });
  });

  it("une sous-rubrique à plusieurs sociétés (fusion) n'entre que dans les totaux", async () => {
    const store = memoryStore();
    const { opts } = setup([{ id: insId(5), subRubric: "SR01", date: DAY, cantons: ["VD"],
      companies: [{ uid: IDE.sa1, legalForm: "0106", pathIndex: 0 }, { uid: IDE.sa2, legalForm: "0106", pathIndex: 1 }], dates: { entryDeadline: "2026-12-20" } }]);
    const report = await runFoscCollection(opts(store));
    expect(stateOf(store).events).toHaveLength(0);
    expect(report.insolvency.outcomes.multiple_parties).toBe(1);
    expect(stateOf(store).days[0].tallies).toEqual([{ event_type: "SR01", canton: "VD", legal_form: "0106", count: 1 }]);
  });

  it("une réduction de capital (une seule société) peut être une ligne", async () => {
    const store = memoryStore();
    const { opts } = setup([{ id: insId(6), subRubric: "SR05", date: DAY, cantons: ["VD"], companies: [{ uid: IDE.sa1, legalForm: "0106" }],
      dates: { resolutionDate: "2026-10-01", entryDeadline: "2026-11-19" } }]);
    await runFoscCollection(opts(store));
    expect(stateOf(store).events).toEqual([expect.objectContaining({ event_type: "SR05", ide: IDE.sa1, dates: { resolutionDate: "2026-10-01", entryDeadline: "2026-11-19" } })]);
  });

  it("un « autre avis » (KK10) est compté sans que son détail soit lu", async () => {
    const store = memoryStore();
    const { opts, portal } = setup([{ id: insId(7), subRubric: "KK10", date: DAY, cantons: ["BE"], companies: [{ uid: IDE.sa1, legalForm: "0106" }] }]);
    const report = await runFoscCollection(opts(store));
    expect(detailCalls(portal.calls)).toBe(0);
    expect(stateOf(store).events).toHaveLength(0);
    expect(report.insolvency.general_notices).toBe(1);
    expect(stateOf(store).days[0].tallies).toEqual([{ event_type: "KK10", canton: "BE", legal_form: "inconnue", count: 1 }]);
  });

  it("les avis HR et les nouvelles rubriques d'un même jour sont lus ensemble", async () => {
    const store = memoryStore();
    const hr: FakeAvis[] = [{ id: avisId(1), subRubric: "HR01", date: DAY, canton: "VD", after: { uid: IDE.other, legalForm: "0106", seat: "Lausanne" } }];
    const { opts, portal } = setup(companyAvis(), hr);
    const report = await runFoscCollection({ ...opts(store), resolveCommune: (seat) => (seat === "Lausanne" ? { bfs: 5586, canton: "VD" } : null) });
    expect(portal.calls.filter((c) => c.includes("/publications?"))).toHaveLength(1);
    const list = new URL(portal.calls.find((c) => c.includes("/publications?"))!);
    expect(list.searchParams.getAll("rubrics")).toEqual(["HR", "KK", "NA", "LS", "SR"]);
    expect(stateOf(store).events.map((e) => e.event_type).sort()).toEqual(["HR01", "KK02", "LS02", "NA02"]);
    expect(stateOf(store).events.find((e) => e.event_type === "HR01")).not.toHaveProperty("dates");
    expect(report.days[0].by_subrubric).toEqual({ HR01: 1, KK02: 1, NA02: 1, LS02: 1 });
  });
});

describe("faillites : garde-fous", () => {
  it("une sous-rubrique inconnue (schéma non relu) arrête la collecte : code 1, aucun jour enregistré", async () => {
    const store = memoryStore();
    const { opts, portal } = setup([...companyAvis(), { id: insId(8), subRubric: "KK13", date: DAY, cantons: ["VD"], companies: [{ uid: IDE.sa1, legalForm: "0106" }] }]);
    const report = await runFoscCollection(opts(store));
    expect(report.stopped).toBe("schema");
    expect(report.exit_code).toBe(1);
    expect(report.days[0].status).toBe("schema_unknown");
    expect(detailCalls(portal.calls)).toBe(0);
    expect(stateOf(store).days).toHaveLength(0);
    expect(stateOf(store).events).toHaveLength(0);
  });

  it("une sous-rubrique inconnue un jour suivant : les jours déjà calculés du passage ne sont pas enregistrés non plus", async () => {
    const store = memoryStore();
    const later = "2026-10-21";
    const { opts } = setup([...companyAvis(), { id: insId(9), subRubric: "NA13", date: later, cantons: ["VD"], persons: [{}] }]);
    const report = await runFoscCollection({ ...opts(store), now: new Date("2026-10-22T08:00:00Z"), days: [DAY, later] });
    expect(report.stopped).toBe("schema");
    expect(stateOf(store).days).toHaveLength(0);
    expect(stateOf(store).events).toHaveLength(0);
  });

  it("une version de schéma ou un espace de noms inconnus : l'avis va dans les totaux, le jour est enregistré, l'alerte part (code 1)", async () => {
    const avis = companyAvis();
    avis[0].schemaVersion = "1.27";
    avis[1].namespace = "https://shab.ch/shab/NA99-export";
    const store = memoryStore();
    const { opts } = setup(avis);
    const report = await runFoscCollection(opts(store));
    expect(report.exit_code).toBe(1); // jamais une panne silencieuse : plus aucune ligne sans alerte
    expect(report.stopped).toBeNull(); // pas un arrêt : HR et les autres avis continuent
    expect(report.insolvency.outcomes.unknown_schema).toBe(2);
    expect(report.days[0].detail_failed).toBe(0);
    expect(report.days[0].status).toBe("computed");
    expect(stateOf(store).days).toHaveLength(1);
    expect(stateOf(store).events.map((e) => e.event_type)).toEqual(["LS02"]);
    expect(stateOf(store).days[0].tallies).toEqual(expect.arrayContaining([
      { event_type: "KK02", canton: "VD", legal_form: "inconnue", count: 1 },
      { event_type: "NA02", canton: "ZH", legal_form: "inconnue", count: 1 },
    ]));
  });

  it("trop d'avis sans aucune partie reconnue (chemin changé) arrêtent la collecte", async () => {
    const avis: InsolvencyAvis[] = Array.from({ length: 60 }, (_, i) => ({ id: insId(100 + i), subRubric: "KK02", date: DAY, cantons: ["VD"],
      ...(i < 10 ? {} : { companies: [{ uid: IDE.sa1, legalForm: "0106" }] }) }));
    const store = memoryStore();
    const { opts } = setup(avis);
    const report = await runFoscCollection(opts(store));
    expect(report.insolvency.outcomes.no_party).toBe(10);
    expect(report.stopped).toBe("schema");
    expect(report.exit_code).toBe(1);
    expect(stateOf(store).days).toHaveLength(0);
  });

  it("forme absente : jamais déduite de l'intitulé (LS01 sans forme), totaux seulement", async () => {
    const store = memoryStore();
    const { opts } = setup([
      { id: insId(10), subRubric: "LS01", date: DAY, cantons: ["VD"], companies: [{ uid: IDE.sa1, legalForm: null }] },
      { id: insId(11), subRubric: "LS01", date: DAY, cantons: ["VD"], companies: [{ uid: IDE.sa2, legalForm: "0107" }] },
    ]);
    const report = await runFoscCollection(opts(store));
    expect(stateOf(store).events).toHaveLength(0);
    expect(report.insolvency.outcomes.no_legal_form).toBe(1);
    expect(report.insolvency.outcomes.ambiguous).toBe(1); // forme lue contraire à l'intitulé
  });

  it("une société sans IDE, « noUID » vrai, deux adresses ou une SNC : jamais une ligne avec un IDE douteux", async () => {
    const store = memoryStore();
    const { opts } = setup([
      { id: insId(12), subRubric: "KK01", date: DAY, cantons: ["VD"], companies: [{ uid: null, legalForm: "0106" }] },
      { id: insId(13), subRubric: "KK01", date: DAY, cantons: ["VD"], companies: [{ uid: IDE.sa1, legalForm: "0106", noUID: "true" }] },
      { id: insId(14), subRubric: "KK01", date: DAY, cantons: ["VD"], companies: [{ uid: IDE.snc, legalForm: "0103" }] },
      { id: insId(15), subRubric: "KK01", date: DAY, cantons: ["VD"], companies: [{ uid: IDE.sa2, legalForm: "0106", addresses: 2 }] },
    ]);
    const report = await runFoscCollection(opts(store));
    expect(report.insolvency.outcomes).toMatchObject({ no_uid: 2, other_form: 1, row: 1 });
    expect(stateOf(store).events).toEqual([expect.objectContaining({ ide: IDE.sa2, municipality_bfs_id: null, canton: "VD" })]);
    expect(report.insolvency.commune_unresolved).toBe(1);
  });

  it("un avis listé dans deux cantons : le canton de la liste n'est pas retenu", async () => {
    const store = memoryStore();
    const { opts } = setup([{ id: insId(16), subRubric: "KK02", date: DAY, cantons: ["VD", "GE"], persons: [{}] }]);
    await runFoscCollection(opts(store));
    expect(stateOf(store).days[0].tallies).toEqual([{ event_type: "KK02", canton: "inconnu", legal_form: "personne", count: 1 }]);
  });

  it("le plafond de requêtes coupe le calcul d'un jour : rien n'en est enregistré (code 0, reprise au passage suivant)", async () => {
    const store = memoryStore();
    const { opts } = setup(companyAvis(), [], 3); // CG + liste, puis plus assez pour les trois détails
    const report = await runFoscCollection(opts(store));
    expect(report.stopped).toBe("budget");
    expect(report.days[0].status).toBe("skipped_budget");
    expect(report.exit_code).toBe(0);
    expect(stateOf(store).days).toHaveLength(0);
    expect(stateOf(store).events).toHaveLength(0);
  });

  it("des détails illisibles (au moins 3 et plus de 1 % des détails du jour, HR compris) : jour en échec, code 1, rien d'enregistré", async () => {
    const broken: InsolvencyAvis[] = [4, 5, 6].map((n) => ({ id: insId(30 + n), subRubric: "KK02", date: DAY, cantons: ["VD"], broken: true as const,
      companies: [{ uid: IDE.sa1, legalForm: "0106" }] }));
    const hr: FakeAvis[] = [{ id: avisId(2), subRubric: "HR01", date: DAY, canton: "VD", after: { uid: IDE.other, legalForm: "0106", seat: "Lausanne" } }];
    const store = memoryStore();
    const { opts } = setup([...companyAvis(), ...broken], hr);
    const report = await runFoscCollection({ ...opts(store), resolveCommune: (seat) => (seat === "Lausanne" ? { bfs: 5586, canton: "VD" } : null) });
    expect(report.days[0]).toMatchObject({ status: "failed", detail_failed: 3 });
    expect(report.exit_code).toBe(1);
    expect(stateOf(store).days).toHaveLength(0);
    expect(stateOf(store).events).toHaveLength(0); // ni les sociétés, ni la ligne HR du même jour
  });

  it("les conditions générales gardent la main : un PDF changé, aucune liste n'est lue", async () => {
    const store = memoryStore();
    const { opts, portal } = setup(companyAvis());
    const report = await runFoscCollection({ ...opts(store), termsSha256: "0".repeat(64) });
    expect(report.terms).toBe("terms_changed");
    expect(report.exit_code).toBe(1);
    expect(portal.calls.filter((c) => c.includes("/publications"))).toHaveLength(0);
  });
});

describe("faillites : idempotence et purge", () => {
  it("rejouer le même jour donne le même état et ne relit aucun détail", async () => {
    const avis = [...companyAvis(), { id: insId(20), subRubric: "KK02", date: DAY, cantons: ["VD"], persons: [{}], addition: "refusedLegacy" }];
    const store = memoryStore();
    const { opts, portal } = setup(avis);
    await runFoscCollection(opts(store));
    const first = JSON.parse(JSON.stringify(stateOf(store)));
    const firstTotals = JSON.parse(JSON.stringify(store.totals));
    const details = detailCalls(portal.calls);
    const report = await runFoscCollection(opts(store));
    expect(report.days[0].status).toBe("unchanged");
    expect(detailCalls(portal.calls)).toBe(details);
    expect(stateOf(store).events).toEqual(first.events);
    expect(stateOf(store).days).toEqual(first.days);
    expect({ ...(store.totals as TotalsDocument), generated_at: null }).toEqual({ ...firstTotals, generated_at: null });
  });

  it("un jour qui change est recalculé en entier : la succession n'est pas comptée deux fois", async () => {
    const avis: InsolvencyAvis[] = [...companyAvis(), { id: insId(21), subRubric: "KK02", date: DAY, cantons: ["VD"], persons: [{}], addition: "refusedLegacy" }];
    const store = memoryStore();
    const { opts } = setup(avis);
    await runFoscCollection(opts(store));
    avis.push({ id: insId(22), subRubric: "KK06", date: DAY, cantons: ["VD"], persons: [{}] });
    const report = await runFoscCollection(opts(store));
    expect(report.days[0].status).toBe("computed");
    const day = stateOf(store).days[0];
    expect(day.tallies.filter((t) => t.legal_form === "succession").reduce((s, t) => s + t.count, 0)).toBe(1);
    expect(day.tallies.filter((t) => t.legal_form === "personne").reduce((s, t) => s + t.count, 0)).toBe(1);
    expect(day).toMatchObject({ listed: 5, persons: 2, estates: 1 });
    expect(stateOf(store).events).toHaveLength(3);
  });

  it("la purge efface une ligne de faillite le jour J+30 (au passage de la veille)", async () => {
    const store = memoryStore();
    const { opts } = setup(companyAvis());
    await runFoscCollection(opts(store));
    const kk = () => stateOf(store).events.find((e) => e.event_type === "KK02");
    expect(kk()!.delete_on).toBe("2026-11-19"); // 20.10 + 30 jours
    expect(MAX_RETENTION_DAYS).toBe(30);
    // Revérification tous les trois jours jusqu'au 17.11 (J+28) : la ligne reste.
    for (const d of ["2026-10-24", "2026-10-27", "2026-10-30", "2026-11-02", "2026-11-05", "2026-11-08", "2026-11-11", "2026-11-14", "2026-11-17"]) {
      await runFoscCollection({ ...opts(store, new Date(`${d}T08:00:00Z`)), days: [] });
    }
    expect(kk()).toBeDefined();
    // Passage du 18.11 (J+29, veille de J+30) : plus aucune ligne.
    const end = await runFoscCollection({ ...opts(store, new Date("2026-11-18T08:00:00Z")), days: [] });
    expect(end.purge.expired).toBe(3);
    expect(kk()).toBeUndefined();
    expect(stateOf(store).events).toHaveLength(0);
  });

  it("l'échéance de l'avis, si elle vient avant J+30, l'emporte", async () => {
    const avis = companyAvis();
    avis[0].expirationDate = "2026-10-25";
    const store = memoryStore();
    const { opts } = setup(avis);
    await runFoscCollection(opts(store));
    expect(stateOf(store).events.find((e) => e.event_type === "KK02")!.delete_on).toBe("2026-10-25");
  });
});

describe("faillites : lecture de l'état de la version 1 (lot HR)", () => {
  /** État tel que l'écrivait la collecte HR du 22.10.2026 (version 1). */
  function v1State(): Record<string, unknown> {
    return {
      schema: STATE_SCHEMA, schema_version: 1, collection_started_on: "2026-09-29", updated_at: "2026-10-20T06:50:00.000Z",
      events: [{ publication_id: avisId(50), ide: IDE.other, event_type: "HR01", publication_date: DAY, municipality_bfs_id: 5586, canton: "VD",
        legal_form: "0106", delete_on: "2026-11-19", verified_on: "2026-10-20" }],
      days: [{ date: DAY, listed: 1, stored_rows: 1, totals_only: 0, sole_proprietorships: 0, test_imports: 0, detail_failed: 0,
        computed_at: "2026-10-20T06:50:00.000Z", tallies: [{ event_type: "HR01", canton: "VD", legal_form: "0106", count: 1 }] }],
      months: [{ month: "2026-09", frozen_at: "2026-10-08T06:50:00.000Z", days_collected: ["2026-09-29", "2026-09-30"], listed: 2, detail_failed: 0,
        tallies: [{ event_type: "HR02", canton: "GE", legal_form: "0107", count: 2 }] }],
    };
  }

  it("relit un état version 1, garde ses lignes HR, recalcule le jour avec les nouvelles rubriques et réécrit en version 2", async () => {
    const hr: FakeAvis[] = [{ id: avisId(50), subRubric: "HR01", date: DAY, canton: "VD", after: { uid: IDE.other, legalForm: "0106", seat: "Lausanne" } }];
    const store = memoryStore(v1State());
    const { opts, portal } = setup(companyAvis(), hr);
    const report = await runFoscCollection(opts(store));
    expect(report.exit_code).toBe(0);
    const s = stateOf(store);
    expect(s.schema_version).toBe(2);
    expect(report.days[0].status).toBe("computed"); // jour calculé avec HR seul : recalculé
    // La ligne HR est reprise de l'état, sans relire son détail ; les trois sociétés s'ajoutent.
    expect(portal.calls.filter((c) => c.endsWith(`${avisId(50)}/xml`))).toHaveLength(0);
    expect(s.events.map((e) => e.event_type).sort()).toEqual(["HR01", "KK02", "LS02", "NA02"]);
    expect(s.days[0].rubrics).toEqual(["HR", "KK", "NA", "LS", "SR"]);
    expect(s.months[0].days_collected_by_rubric).toEqual({ HR: ["2026-09-29", "2026-09-30"] });
    const totals = store.totals as TotalsDocument;
    expect(totals.schema_version).toBe(2);
    const sept = totals.months.find((m) => m.month === "2026-09")!;
    expect(sept.days_collected_by_rubric).toEqual({ HR: 2 }); // KK n'était pas encore collecté en septembre
    const oct = totals.months.find((m) => m.month === "2026-10")!;
    expect(oct.days_collected_by_rubric).toMatchObject({ HR: 1, KK: 1 });
    expect(oct.days_missing_by_rubric.KK).toEqual(["2026-10-21"]); // depuis le premier jour KK collecté
  });

  it("un jour version 1 laissé hors de la fenêtre reste compté pour HR seulement", async () => {
    const store = memoryStore(v1State());
    const { opts } = setup([]);
    await runFoscCollection({ ...opts(store), days: [] });
    expect(stateOf(store).days[0].rubrics).toEqual(["HR"]);
    const oct = (store.totals as TotalsDocument).months.find((m) => m.month === "2026-10")!;
    expect(oct.days_collected_by_rubric).toEqual({ HR: 1 });
  });

  it("refuse un état version 1 qui porterait une ligne d'une nouvelle rubrique ou des dates", async () => {
    const withDates = v1State();
    (withDates.events as Record<string, unknown>[])[0].dates = { resolutionDate: "2026-10-15" };
    const { opts } = setup([]);
    await expect(runFoscCollection(opts(memoryStore(withDates)))).rejects.toThrow(/dates de ligne/);
    const kk = v1State();
    (kk.events as Record<string, unknown>[])[0].event_type = "KK02";
    await expect(runFoscCollection(opts(memoryStore(kk)))).rejects.toThrow(/type d'événement/);
  });

  it("refuse un état version 2 qui porterait une forme hors liste blanche, un « autre avis » ou une date non prévue", async () => {
    const store = memoryStore();
    const { opts } = setup(companyAvis());
    await runFoscCollection(opts(store));
    const tamper = (f: (s: FoscState) => void) => { const t = JSON.parse(JSON.stringify(store.state)) as FoscState; f(t); return memoryStore(t); };
    await expect(runFoscCollection(opts(tamper((t) => { t.events[0].legal_form = "0103"; })))).rejects.toThrow(/forme juridique/);
    await expect(runFoscCollection(opts(tamper((t) => { t.events[0].event_type = "KK10"; })))).rejects.toThrow(/type d'événement/);
    await expect(runFoscCollection(opts(tamper((t) => { t.events[0].dates = { dateOfBirth: "1901-02-03" }; })))).rejects.toThrow(/date de ligne/);
  });
});
