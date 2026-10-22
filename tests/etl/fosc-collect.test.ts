import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPoliteClient } from "../../etl/fosc/client.js";
import { evenSample, parseCliArgs, runFoscCollection, type CollectOptions } from "../../etl/fosc/collect.js";
import type { CommuneResolver } from "../../etl/fosc/communes.js";
import { memoryStore, r2Store } from "../../etl/fosc/store.js";
import { MAX_RETENTION_DAYS, type FoscState } from "../../etl/fosc/state.js";
import type { TotalsDocument } from "../../etl/fosc/totals.js";
import { avisId, FAKE_TERMS_SHA256, fakePortal, IDE, WITNESSES, type FakeAvis } from "../helpers/fosc-portal.js";

// Toutes les données sont inventées (dépôt public). Le 21.10.2026 à 10 h (heure suisse).
const NOW = new Date("2026-10-21T08:00:00Z");
const DAY = "2026-10-20";
const COMMUNES: Record<string, { bfs: number; canton: string }> = { Lausanne: { bfs: 5586, canton: "VD" }, "Genève": { bfs: 6621, canton: "GE" }, "Zürich": { bfs: 261, canton: "ZH" } };
const communes: CommuneResolver = (seat) => (seat ? COMMUNES[seat] ?? null : null);

function baseAvis(): FakeAvis[] {
  return [
    // Sociétés de la liste blanche : une ligne chacune.
    { id: avisId(1), subRubric: "HR01", date: DAY, canton: "VD", after: { uid: IDE.sa1, legalForm: "0106", seat: "Lausanne" }, revisionUid: IDE.revision },
    { id: avisId(2), subRubric: "HR02", date: DAY, canton: "GE", after: { uid: IDE.sarl, legalForm: "0107", seat: "Genève" }, before: { uid: IDE.sarl, legalForm: "0107", seat: "Genève" } },
    { id: avisId(3), subRubric: "HR03", date: DAY, canton: "ZH", before: { uid: IDE.sa2, legalForm: "0106", seat: "Zürich" } },
    // Entreprise individuelle : totaux seulement.
    { id: avisId(4), subRubric: "HR01", date: DAY, canton: "VD", after: { uid: IDE.soleProp, legalForm: "0101", seat: "Lausanne" } },
    // Société en nom collectif : totaux seulement (liste blanche fermée).
    { id: avisId(5), subRubric: "HR02", date: DAY, canton: "VD", after: { uid: IDE.snc, legalForm: "0103", seat: "Lausanne" }, before: { uid: IDE.snc, legalForm: "0103", seat: "Lausanne" } },
    // Transformation d'une entreprise individuelle en Sàrl : l'état avant n'est pas autorisé.
    { id: avisId(6), subRubric: "HR02", date: DAY, canton: "ZH", after: { uid: IDE.other, legalForm: "0107", seat: "Zürich" }, before: { uid: IDE.other, legalForm: "0101", seat: "Zürich" } },
    // Siège non rapproché : ligne gardée, commune nulle.
    { id: avisId(7), subRubric: "HR01", date: DAY, canton: "ZH", after: { uid: IDE.unknown, legalForm: "0107", seat: "Commune Fictive" } },
    // Avis d'essai : écarté de tout.
    { id: avisId(8), subRubric: "HR01", date: DAY, canton: "VD", testImport: true, after: { uid: IDE.sa1, legalForm: "0106", seat: "Lausanne" } },
  ];
}

function setup(avis: FakeAvis[], extra: Partial<CollectOptions> = {}, maxRequests = 500) {
  const portal = fakePortal(avis);
  const client = createPoliteClient({ fetchImpl: portal.fetchImpl, sleepImpl: async () => {}, delayMs: 0, maxRequests });
  return { portal, client, opts: (store: ReturnType<typeof memoryStore>, now = NOW): CollectOptions => ({
    store, client, resolveCommune: communes, now, days: [DAY], termsSha256: FAKE_TERMS_SHA256, ...extra,
  }) };
}

const stateOf = (store: ReturnType<typeof memoryStore>) => store.state as FoscState;
const detailCalls = (calls: string[]) => calls.filter((c) => c.endsWith("/xml")).length;

describe("collecte FOSC : ce qui est stocké", () => {
  it("ne stocke jamais de texte libre, de nom ni d'adresse, ni l'IDE de l'organe de révision", async () => {
    const store = memoryStore();
    const { opts } = setup(baseAvis());
    const report = await runFoscCollection(opts(store));
    expect(report.exit_code).toBe(0);
    const serialized = JSON.stringify(store.state) + JSON.stringify(store.totals);
    for (const w of WITNESSES) expect(serialized).not.toContain(w);
    expect(serialized).not.toContain(IDE.revision);
    expect(serialized).not.toContain("Lausanne");
    for (const row of stateOf(store).events) {
      expect(Object.keys(row).sort()).toEqual(["canton", "event_type", "expires_on", "ide", "legal_form", "municipality_bfs_id", "publication_date", "publication_id", "verified_on"]);
    }
  });

  it("une entreprise individuelle n'est jamais une ligne, mais elle est comptée", async () => {
    const store = memoryStore();
    const { opts } = setup(baseAvis());
    const report = await runFoscCollection(opts(store));
    const s = stateOf(store);
    expect(JSON.stringify(s.events)).not.toContain(IDE.soleProp);
    expect(JSON.stringify(store.state)).not.toContain(IDE.soleProp);
    expect(s.events.map((e) => e.ide).sort()).toEqual([IDE.sa1, IDE.sa2, IDE.unknown, IDE.sarl].sort());
    expect(s.events.find((e) => e.ide === IDE.snc)).toBeUndefined();
    expect(s.events.find((e) => e.ide === IDE.other)).toBeUndefined();
    const day = s.days.find((d) => d.date === DAY)!;
    expect(day.tallies).toContainEqual({ event_type: "HR01", canton: "VD", legal_form: "0101", count: 1 });
    expect(day.sole_proprietorships).toBe(2); // l'entreprise individuelle et la transformation
    expect(report.days[0]).toMatchObject({ listed: 8, stored_rows: 4, totals_only: 3, test_imports: 1, details_read: 8 });
    expect(report.missing.commune_unresolved).toBe(1);
    expect(s.events.find((e) => e.ide === IDE.unknown)!.municipality_bfs_id).toBeNull();
    expect(s.events.find((e) => e.ide === IDE.sa1)!.municipality_bfs_id).toBe(5586);
  });
});

describe("collecte FOSC : canton du siège", () => {
  it("un transfert de siège publié par l'office d'un autre canton est compté dans le canton du nouveau siège", async () => {
    const store = memoryStore();
    const { opts } = setup([{ id: avisId(20), subRubric: "HR02", date: DAY, canton: "ZH", after: { uid: IDE.sa1, legalForm: "0106", seat: "Genève" }, before: { uid: IDE.sa1, legalForm: "0106", seat: "Zürich" } }]);
    await runFoscCollection(opts(store));
    expect(stateOf(store).events[0]).toMatchObject({ canton: "GE", municipality_bfs_id: 6621 });
    expect(stateOf(store).days[0].tallies).toEqual([{ event_type: "HR02", canton: "GE", legal_form: "0106", count: 1 }]);
  });
});

describe("collecte FOSC : totaux", () => {
  it("donne des totaux exacts par type, canton et forme, entreprises individuelles comprises", async () => {
    const store = memoryStore();
    const { opts } = setup(baseAvis());
    await runFoscCollection(opts(store));
    const totals = store.totals as TotalsDocument;
    const month = totals.months.find((m) => m.month === "2026-10")!;
    expect(month.total).toBe(7); // 8 avis listés moins l'avis d'essai
    expect(month.by_event_type).toEqual({ HR01: 3, HR02: 3, HR03: 1 });
    expect(month.by_canton).toEqual({ GE: 1, VD: 3, ZH: 3 });
    expect(month.by_legal_form).toEqual({ "0101": 1, "0103": 1, "0106": 2, "0107": 3 });
    expect(month.days_collected).toBe(1);
    expect(totals.not_official_notice.fr).toContain("Ceci n'est pas une publication officielle");
    expect(totals.source.terms_url).toBe("https://shab.ch/static/agb_fr.pdf");
    expect(totals.source_quality_notice.fr).toContain("API");
    expect(totals.publication.status).toBe("not_published");
    expect(JSON.stringify(totals)).not.toMatch(/CHE-\d/);
  });
});

describe("collecte FOSC : idempotence", () => {
  it("rejouer le même jour ne double rien et ne relit aucun détail", async () => {
    const store = memoryStore();
    const { opts, portal } = setup(baseAvis());
    await runFoscCollection(opts(store));
    const first = JSON.parse(JSON.stringify(stateOf(store)));
    const detailsBefore = detailCalls(portal.calls);
    const report = await runFoscCollection(opts(store));
    expect(report.days[0].status).toBe("unchanged");
    expect(detailCalls(portal.calls)).toBe(detailsBefore);
    const second = stateOf(store);
    expect(second.days).toEqual(first.days);
    expect(second.events).toEqual(first.events);
  });

  it("un jour qui change est recalculé en entier : l'entreprise individuelle déjà comptée ne l'est pas deux fois", async () => {
    const avis = baseAvis();
    const store = memoryStore();
    const { opts, portal } = setup(avis);
    await runFoscCollection(opts(store));
    avis.push({ id: avisId(9), subRubric: "HR03", date: DAY, canton: "VD", before: { uid: IDE.soleProp, legalForm: "0101", seat: "Lausanne" } });
    const detailsBefore = detailCalls(portal.calls);
    const report = await runFoscCollection(opts(store));
    expect(report.days[0].status).toBe("computed");
    // Seuls les avis sans ligne de société sont relus (4 hors liste blanche + essai + nouvel avis).
    expect(detailCalls(portal.calls) - detailsBefore).toBe(5);
    const day = stateOf(store).days.find((d) => d.date === DAY)!;
    const soleProps = day.tallies.filter((t) => t.legal_form === "0101").reduce((s, t) => s + t.count, 0);
    expect(soleProps).toBe(2); // une inscription et une radiation, chacune une fois
    expect(day.listed).toBe(9);
    expect(stateOf(store).events).toHaveLength(4);
  });
});

describe("collecte FOSC : purge", () => {
  it("supprime une ligne à sa date de fin (expirationDate ou plancher d'un mois)", async () => {
    const avis = baseAvis();
    avis[0].expirationDate = "2026-10-25";
    const store = memoryStore();
    const { opts } = setup(avis);
    await runFoscCollection(opts(store));
    const rows = stateOf(store).events;
    expect(rows.find((e) => e.ide === IDE.sa1)!.expires_on).toBe("2026-10-25");
    expect(rows.find((e) => e.ide === IDE.sarl)!.expires_on).toBe("2026-11-19"); // 20.10 + 30 jours
    expect(MAX_RETENTION_DAYS).toBe(30);
    // Passage du 27.10 : l'avis à échéance du 25.10 est parti, les autres restent.
    const later = await runFoscCollection({ ...opts(store, new Date("2026-10-27T08:00:00Z")), days: [] });
    expect(later.purge.expired).toBe(1);
    expect(stateOf(store).events.find((e) => e.ide === IDE.sa1)).toBeUndefined();
    expect(stateOf(store).events).toHaveLength(3);
    // Passage du 20.11 : plus aucune ligne du 20.10.
    const end = await runFoscCollection({ ...opts(store, new Date("2026-11-20T08:00:00Z")), days: [] });
    expect(end.purge.expired).toBe(3);
    expect(stateOf(store).events).toHaveLength(0);
  });

  it("supprime une ligne dès que l'avis n'est plus publié, même hors de la fenêtre", async () => {
    const avis = baseAvis();
    const store = memoryStore();
    const { opts } = setup(avis);
    await runFoscCollection(opts(store));
    avis[1].state = "CANCELLED";
    const report = await runFoscCollection({ ...opts(store, new Date("2026-10-22T08:00:00Z")), days: [] });
    expect(report.verification.days_checked).toBe(1);
    expect(stateOf(store).events.find((e) => e.ide === IDE.sarl)).toBeUndefined();
    expect(stateOf(store).events).toHaveLength(3);
  });

  it("supprime une ligne qu'on n'a pas pu revérifier depuis plus de trois jours", async () => {
    const store = memoryStore();
    const { opts, portal } = setup(baseAvis());
    await runFoscCollection(opts(store));
    // Le portail refuse ensuite toute liste : la revérification échoue.
    for (let i = 0; i < 10; i++) portal.forced.push({ match: "/publications?", status: 500 });
    const failing = await runFoscCollection({ ...opts(store, new Date("2026-10-23T08:00:00Z")), days: [] });
    expect(failing.verification.days_failed).toBe(1);
    expect(stateOf(store).events).toHaveLength(4); // vérifiées le 21.10 : encore dans le délai
    const report = await runFoscCollection({ ...opts(store, new Date("2026-10-25T08:00:00Z")), days: [] });
    expect(report.purge.unverified).toBe(4);
    expect(stateOf(store).events).toHaveLength(0);
  });
});

describe("collecte FOSC : garde-fous", () => {
  it("refuse de lire le portail si l'acceptation des CG date de plus de 90 jours, mais purge quand même", async () => {
    const store = memoryStore();
    const { opts, portal } = setup(baseAvis());
    await runFoscCollection(opts(store));
    const calls = portal.calls.length;
    const report = await runFoscCollection({ ...opts(store, new Date("2027-01-20T08:00:00Z")), termsAcceptedOn: "2026-10-16" });
    expect(report.terms).toBe("acceptance_expired");
    expect(report.exit_code).toBe(1);
    expect(portal.calls.length).toBe(calls); // aucune requête
    expect(stateOf(store).events).toHaveLength(0); // purge appliquée et écrite
  });

  it("s'arrête si le PDF des CG a changé", async () => {
    const store = memoryStore();
    const { opts, portal } = setup(baseAvis(), { termsSha256: "0".repeat(64) });
    const report = await runFoscCollection(opts(store));
    expect(report.terms).toBe("terms_changed");
    expect(report.exit_code).toBe(1);
    expect(portal.calls.filter((c) => c.includes("/publications")).length).toBe(0);
  });

  it("n'enregistre rien d'un jour si le plafond de requêtes coupe le calcul", async () => {
    const store = memoryStore();
    const { opts } = setup(baseAvis(), {}, 4);
    const report = await runFoscCollection(opts(store));
    expect(report.stopped).toBe("budget");
    expect(stateOf(store).days).toHaveLength(0);
    expect(stateOf(store).events).toHaveLength(0);
  });

  it("arrête le passage si trop de détails n'ont plus de forme juridique (schéma changé)", async () => {
    const avis: FakeAvis[] = Array.from({ length: 60 }, (_, i) => ({
      id: avisId(100 + i), subRubric: "HR01", date: DAY, canton: "VD",
      after: { uid: IDE.sa1, legalForm: i < 10 ? null : "0106", seat: "Lausanne" },
    }));
    const store = memoryStore();
    const { opts } = setup(avis);
    const report = await runFoscCollection(opts(store));
    expect(report.stopped).toBe("schema");
    expect(report.exit_code).toBe(1);
    expect(stateOf(store).days).toHaveLength(0);
  });

  it("refuse un état relu qui contient une entreprise individuelle ou un champ non prévu", async () => {
    const store = memoryStore();
    const { opts } = setup(baseAvis());
    await runFoscCollection(opts(store));
    const tampered = JSON.parse(JSON.stringify(store.state));
    tampered.events[0].legal_form = "0101";
    await expect(runFoscCollection(opts(memoryStore(tampered)))).rejects.toThrow(/entreprise individuelle/);
    const extra = JSON.parse(JSON.stringify(store.state));
    extra.events[0].name = WITNESSES[1];
    await expect(runFoscCollection(opts(memoryStore(extra)))).rejects.toThrow(/non autorisé/);
  });

  it("fige un mois quand tous ses jours ont quitté la fenêtre", async () => {
    const avis = baseAvis().map((a) => ({ ...a, date: "2026-10-30" }));
    const store = memoryStore();
    const { opts } = setup(avis);
    await runFoscCollection({ ...opts(store, new Date("2026-10-31T08:00:00Z")), days: ["2026-10-30"] });
    const report = await runFoscCollection({ ...opts(store, new Date("2026-11-08T08:00:00Z")), days: [] });
    expect(report.months_frozen).toBe(1);
    const s = stateOf(store);
    expect(s.days).toHaveLength(0);
    expect(s.months[0]).toMatchObject({ month: "2026-10", days_collected: ["2026-10-30"], listed: 8 });
    const totals = store.totals as TotalsDocument;
    expect(totals.months[0]).toMatchObject({ month: "2026-10", status: "frozen", total: 7 });
    expect(totals.months[0].days_missing).toEqual(["2026-10-31"]);
  });
});

describe("collecte FOSC : ligne de commande et stockage", () => {
  it("exige un choix explicite et une simulation hors du dépôt", () => {
    expect(() => parseCliArgs([], {})).toThrow(/Choisir/);
    expect(() => parseCliArgs(["--write-r2"], { FOSC_DRY_RUN: "1" })).toThrow(/Choisir/);
    expect(() => parseCliArgs([], { FOSC_DRY_RUN: "1" })).toThrow(/--out/);
    const insideRepo = fileURLToPath(new URL("../../etl/fosc", import.meta.url));
    expect(() => parseCliArgs(["--out", insideRepo], { FOSC_DRY_RUN: "1" })).toThrow(/hors du dépôt/);
    expect(() => parseCliArgs(["--write-r2", "--days", "2026-10-20"], {})).toThrow(/simulation/);
    expect(parseCliArgs(["--out", "/private/tmp/fosc-test", "--sample-details", "5"], { FOSC_DRY_RUN: "1" })).toMatchObject({ dryRun: true, sampleDetails: 5, maxRequests: 3000 });
  });

  it("le passage réel refuse de tourner sans identifiants R2, sans repli local", () => {
    const saved = { ...process.env };
    for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
    try { expect(() => r2Store()).toThrow(/refusé/); } finally { Object.assign(process.env, saved); }
  });

  it("l'échantillon de la simulation couvre tout le jour", () => {
    const ids = Array.from({ length: 100 }, (_, i) => String(i));
    expect([...evenSample(ids, 4)]).toEqual(["0", "25", "50", "75"]);
    expect(evenSample(ids, 0).size).toBe(0);
    expect(evenSample(ids.slice(0, 3), 10).size).toBe(3);
  });
});
