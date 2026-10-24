/**
 * Corrections après la relecture du 24.10.2026 (lot FOSC faillites, concordats, liquidations,
 * appels aux créanciers).
 *
 * 1. Le seuil du « jour en échec » est calculé SÉPARÉMENT pour HR (exactement comme dans
 *    b5dc6fc) et pour les nouvelles rubriques : des détails sains d'une famille ne diluent jamais
 *    les échecs de l'autre. Les nombres sont choisis pour que le calcul commun de 35d0262 donne
 *    le résultat inverse.
 * 2. Un retour à la version précédente (b5dc6fc) ne bloque jamais la purge : l'état écrit par la
 *    nouvelle version est relu par une COPIE DATÉE du contrôle et de la purge de b5dc6fc
 *    (ci-dessous, recopiés mot pour mot de `etl/fosc/state.ts` à la révision b5dc6fc ; la CI fait un
 *    checkout de profondeur 1, `git show` n'y est pas possible). Et l'état que b5dc6fc réécrirait
 *    après un retour arrière est relu par la nouvelle version sans erreur.
 *
 * Données entièrement inventées (dépôt public).
 */
import { describe, expect, it } from "vitest";
import { createPoliteClient } from "../../etl/fosc/client.js";
import { runFoscCollection, type CollectOptions } from "../../etl/fosc/collect.js";
import type { CommuneResolver, PostalResolver } from "../../etl/fosc/communes.js";
import { memoryStore } from "../../etl/fosc/store.js";
import type { FoscState } from "../../etl/fosc/state.js";
import type { TotalsDocument } from "../../etl/fosc/totals.js";
import { avisId, avisXml, FAKE_TERMS_SHA256, type FakeAvis } from "../helpers/fosc-portal.js";
import { combinedPortal, IDE, type InsolvencyAvis } from "../helpers/fosc-insolvency-portal.js";

// ------------------------------------------------------------------------------------------
// Copie datée de b5dc6fc (etl/fosc/state.ts et legal-forms.ts, 23.10.2026), sans modification
// de la logique ; seuls les types sont réduits à ce qui sert ici.
// ------------------------------------------------------------------------------------------
namespace B5dc6fc {
  export const STATE_SCHEMA = "openswissdata.fosc-hr-state";
  export const STATE_SCHEMA_VERSION = 1;
  export const SOLE_PROPRIETORSHIP = "0101";
  interface Tally { event_type: string; canton: string; legal_form: string; count: number }
  interface FoscEventRow { publication_id: string; ide: string; event_type: string; publication_date: string; delete_on: string; verified_on: string; legal_form: string }
  interface FoscState { schema: string; schema_version: number; collection_started_on: string | null; events: FoscEventRow[]; days: { date: string; tallies: Tally[] }[]; months: { month: string; tallies: Tally[]; days_collected: string[] }[] }

  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MONTH_RE = /^\d{4}-\d{2}$/;
  const IDE_RE = /^CHE-\d{3}\.\d{3}\.\d{3}$/;

  export class FoscStateError extends Error {
    constructor(reason: string) {
      super(`État FOSC illisible (${reason}) : passage arrêté, l'état n'est jamais recréé à vide`);
      this.name = "FoscStateError";
    }
  }

  const isTally = (t: unknown): t is Tally => {
    const x = t as Tally;
    return !!x && typeof x.event_type === "string" && typeof x.canton === "string" && typeof x.legal_form === "string"
      && Number.isInteger(x.count) && x.count > 0;
  };

  /** Contrôle strict d'un état relu : une forme inattendue arrête le passage. */
  export function validateState(value: unknown): FoscState {
    const s = value as FoscState;
    if (!s || typeof s !== "object") throw new FoscStateError("pas un objet");
    if (s.schema !== STATE_SCHEMA || s.schema_version !== STATE_SCHEMA_VERSION) throw new FoscStateError("schéma inattendu");
    if (s.collection_started_on !== null && !DAY_RE.test(String(s.collection_started_on))) throw new FoscStateError("date de début");
    if (!Array.isArray(s.events) || !Array.isArray(s.days) || !Array.isArray(s.months)) throw new FoscStateError("tableaux absents");
    const allowedRowKeys = new Set(["publication_id", "ide", "event_type", "publication_date", "municipality_bfs_id", "canton", "legal_form", "delete_on", "verified_on"]);
    for (const e of s.events) {
      if (!e || typeof e !== "object") throw new FoscStateError("ligne");
      for (const k of Object.keys(e)) if (!allowedRowKeys.has(k)) throw new FoscStateError("champ de ligne non autorisé");
      if (!IDE_RE.test(e.ide) || !DAY_RE.test(e.publication_date) || !DAY_RE.test(e.delete_on) || !DAY_RE.test(e.verified_on)) {
        throw new FoscStateError("ligne mal formée");
      }
      if (e.legal_form === SOLE_PROPRIETORSHIP) throw new FoscStateError("entreprise individuelle en ligne");
    }
    for (const d of s.days) {
      if (!d || !DAY_RE.test(d.date) || !Array.isArray(d.tallies) || !d.tallies.every(isTally)) throw new FoscStateError("jour mal formé");
    }
    for (const m of s.months) {
      if (!m || !MONTH_RE.test(m.month) || !Array.isArray(m.tallies) || !m.tallies.every(isTally) || !Array.isArray(m.days_collected)) {
        throw new FoscStateError("mois mal formé");
      }
    }
    return s;
  }

  export function addDays(day: string, n: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /** Une ligne doit partir au passage du jour `today` si elle ne peut pas exister demain. */
  export function isDeletionDue(deleteOnDay: string, today: string): boolean {
    return deleteOnDay <= addDays(today, 1);
  }

  /** Règle (a) : sans réseau, au début de chaque passage, avant toute lecture du portail. */
  export function purgeExpired(state: FoscState, today: string): number {
    const before = state.events.length;
    state.events = state.events.filter((e) => !isDeletionDue(e.delete_on, today));
    return before - state.events.length;
  }

  /**
   * Règle (b) : `publishedIds` = identifiants de la liste PUBLISHED du jour, relue en entier.
   * Les lignes absentes partent ; les autres sont marquées revérifiées aujourd'hui.
   */
  export function applyVerification(state: FoscState, day: string, publishedIds: ReadonlySet<string>, today: string): number {
    let removed = 0;
    state.events = state.events.filter((e) => {
      if (e.publication_date !== day) return true;
      if (!publishedIds.has(e.publication_id)) { removed++; return false; }
      e.verified_on = today;
      return true;
    });
    return removed;
  }
}

// ------------------------------------------------------------------------------------------

const insId = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const POSTAL: Record<string, { bfs: number; canton: string }> = { "1000": { bfs: 5586, canton: "VD" }, "8001": { bfs: 261, canton: "ZH" }, "1204": { bfs: 6621, canton: "GE" } };
const resolvePostal: PostalResolver = (zip) => (zip ? POSTAL[zip] ?? null : null);
const resolveCommune: CommuneResolver = (seat) => (seat === "Lausanne" ? { bfs: 5586, canton: "VD" } : null);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const stateOf = (store: ReturnType<typeof memoryStore>) => store.state as FoscState;

function setup(ins: InsolvencyAvis[], hr: FakeAvis[]) {
  const portal = combinedPortal(ins, hr);
  const client = createPoliteClient({ fetchImpl: portal.fetchImpl, sleepImpl: async () => {}, delayMs: 0, maxRequests: 2000 });
  const opts = (store: ReturnType<typeof memoryStore>, now: Date, days: string[]): CollectOptions => ({
    store, client, resolveCommune, resolvePostal, now, days, termsSha256: FAKE_TERMS_SHA256,
  });
  return { portal, opts };
}

const hrAvis = (n: number, date: string, from = 0): FakeAvis[] => Array.from({ length: n }, (_, i) => ({
  id: avisId(1000 + from + i), subRubric: "HR01", date, canton: "VD", after: { uid: IDE.sa1, legalForm: "0106", seat: "Lausanne" },
}));
const kkAvis = (n: number, date: string, from = 0, broken = 0): InsolvencyAvis[] => Array.from({ length: n }, (_, i) => ({
  id: insId(1000 + from + i), subRubric: "KK02", date, cantons: ["VD"], companies: [{ uid: IDE.sa2, legalForm: "0106" }],
  ...(i < broken ? { broken: true as const } : {}),
}));
/** Rend illisibles les détails HR donnés (document tronqué). */
function breakHr(portal: ReturnType<typeof combinedPortal>, avis: FakeAvis[]): void {
  for (const a of avis) portal.rawDetail.set(a.id, avisXml(a).replace("</content>", ""));
}

describe("relecture 1 : seuil du jour en échec, HR et nouvelles rubriques séparés", () => {
  const DAY = "2026-10-20";
  const NOW = new Date("2026-10-21T08:00:00Z");

  it("HR seul en échec (3 sur 250, 1,2 %) avec 100 avis KK sains : le jour échoue (le calcul commun, 0,86 %, le laissait passer)", async () => {
    const hr = hrAvis(250, DAY);
    const store = memoryStore();
    const { portal, opts } = setup(kkAvis(100, DAY), hr);
    breakHr(portal, hr.slice(0, 3));
    const report = await runFoscCollection(opts(store, NOW, [DAY]));
    expect(report.days[0]).toMatchObject({ status: "failed", details_read: 250, detail_failed: 3, insolvency_details_read: 100, insolvency_detail_failed: 0 });
    expect(report.exit_code).toBe(1);
    expect(stateOf(store).days).toHaveLength(0);
    expect(stateOf(store).events).toHaveLength(0);
  });

  it("nouvelles rubriques seules en échec (3 sur 250) avec 100 avis HR sains : le jour échoue", async () => {
    const store = memoryStore();
    const { opts } = setup(kkAvis(250, DAY, 0, 3), hrAvis(100, DAY));
    const report = await runFoscCollection(opts(store, NOW, [DAY]));
    expect(report.days[0]).toMatchObject({ status: "failed", details_read: 100, detail_failed: 0, insolvency_details_read: 250, insolvency_detail_failed: 3 });
    expect(report.exit_code).toBe(1);
    expect(stateOf(store).days).toHaveLength(0);
    expect(stateOf(store).events).toHaveLength(0);
  });

  it("deux échecs de chaque côté (sous le seuil de 3 dans chaque famille) : le jour est enregistré (le calcul commun, 4 échecs, le faisait échouer)", async () => {
    const hr = hrAvis(10, DAY);
    const store = memoryStore();
    const { portal, opts } = setup(kkAvis(10, DAY, 0, 2), hr);
    breakHr(portal, hr.slice(0, 2));
    const report = await runFoscCollection(opts(store, NOW, [DAY]));
    expect(report.days[0]).toMatchObject({ status: "computed", detail_failed: 2, insolvency_detail_failed: 2 });
    expect(report.exit_code).toBe(0);
    expect(stateOf(store).days).toHaveLength(1);
    expect(stateOf(store).days[0].detail_failed).toBe(4); // l'enregistrement du jour compte tous les détails en échec
    expect(stateOf(store).events).toHaveLength(16); // 8 HR et 8 KK lisibles
  });
});

describe("relecture 2 : un retour à b5dc6fc ne bloque jamais la purge", () => {
  /**
   * État le plus riche que la nouvelle version écrit : septembre figé (HR et KK), un jour
   * d'octobre avec des lignes HR, KK, NA et LS, des personnes et une succession dans les totaux.
   */
  async function richState() {
    const sept = "2026-09-29";
    const oct = "2026-10-20";
    const ins: InsolvencyAvis[] = [
      { id: insId(1), subRubric: "KK02", date: sept, cantons: ["VD"], companies: [{ uid: IDE.sa2, legalForm: "0106" }] },
      { id: insId(2), subRubric: "KK02", date: oct, cantons: ["VD"], companies: [{ uid: IDE.sa2, legalForm: "0106" }] },
      { id: insId(3), subRubric: "NA02", date: oct, cantons: ["ZH"], companies: [{ uid: IDE.other, legalForm: "0106", zip: "8001", town: "Zürich", canton: "ZH" }] },
      { id: insId(4), subRubric: "LS02", date: oct, cantons: ["GE"], companies: [{ uid: IDE.sarl, legalForm: "0107", zip: "1204", town: "Genève", canton: "GE" }] },
      { id: insId(5), subRubric: "KK02", date: oct, cantons: ["VD"], persons: [{}] },
      { id: insId(6), subRubric: "KK02", date: oct, cantons: ["VD"], persons: [{}], addition: "refusedLegacy" },
    ];
    const hr: FakeAvis[] = [...hrAvis(1, sept, 0), ...hrAvis(2, oct, 10)];
    const store = memoryStore();
    const { opts } = setup(ins, hr);
    await runFoscCollection(opts(store, new Date("2026-09-30T08:00:00Z"), [sept]));
    await runFoscCollection(opts(store, new Date("2026-10-21T08:00:00Z"), [oct])); // fige septembre
    const s = stateOf(store);
    // L'état est bien « riche » : sans cela le test ne prouverait rien.
    expect(s.schema_version).toBe(1);
    expect(s.months.map((m) => [m.month, m.days_collected_by_rubric])).toEqual([["2026-09", { HR: [sept], KK: [sept], LS: [sept], NA: [sept], SR: [sept] }]]);
    expect(s.events.map((e) => e.event_type).sort()).toEqual(["HR01", "HR01", "HR01", "KK02", "KK02", "LS02", "NA02"]);
    expect(s.days[0]).toMatchObject({ date: oct, persons: 2, estates: 1, rubrics: ["HR", "KK", "NA", "LS", "SR"] });
    expect(s.days[0].tallies.map((t) => t.legal_form)).toEqual(expect.arrayContaining(["personne", "succession"]));
    return { s: clone(s), sept, oct };
  }

  it("le contrôle de b5dc6fc accepte l'état écrit par la nouvelle version", async () => {
    const { s } = await richState();
    expect(() => B5dc6fc.validateState(clone(s))).not.toThrow();
    // Pour mémoire, l'état de 35d0262 (version 2, champ `dates` sur les lignes) était refusé :
    expect(() => B5dc6fc.validateState({ ...clone(s), schema_version: 2 })).toThrow(/schéma inattendu/);
    const withDates = clone(s);
    (withDates.events[0] as unknown as Record<string, unknown>).dates = { resolutionDate: "2026-10-15" };
    expect(() => B5dc6fc.validateState(withDates)).toThrow(/champ de ligne non autorisé/);
  });

  it("la purge de b5dc6fc à J+29 efface toutes les lignes, HR et nouvelles rubriques, puis l'état reste lisible", async () => {
    const { s } = await richState();
    const old = B5dc6fc.validateState(clone(s));
    expect(B5dc6fc.purgeExpired(old, "2026-11-18")).toBe(7); // 20.10 + 29 jours
    expect(old.events).toHaveLength(0);
    expect(() => B5dc6fc.validateState(clone(old))).not.toThrow();
  });

  it("la revérification de b5dc6fc, qui ne liste que HR, retire au premier passage toutes les lignes des nouvelles rubriques", async () => {
    const { s, sept, oct } = await richState();
    const old = B5dc6fc.validateState(clone(s));
    const hrIds = (day: string) => new Set(s.events.filter((e) => e.publication_date === day && e.event_type.startsWith("HR")).map((e) => e.publication_id));
    const removed = B5dc6fc.applyVerification(old, sept, hrIds(sept), "2026-10-22") + B5dc6fc.applyVerification(old, oct, hrIds(oct), "2026-10-22");
    expect(removed).toBe(4);
    expect(old.events.map((e) => e.event_type)).toEqual(["HR01", "HR01", "HR01"]);
    expect(() => B5dc6fc.validateState(clone(old))).not.toThrow();
  });

  it("sens inverse : l'état que b5dc6fc réécrit après un retour arrière est relu par la nouvelle version, purgé et recalculé", async () => {
    const { s, sept, oct } = await richState();
    // Ce que b5dc6fc laisserait : plus aucune ligne des nouvelles rubriques, un jour recalculé sans
    // les champs ajoutés (mais encore des totaux KK dans un jour ancien), un mois figé sans
    // `days_collected_by_rubric`.
    const old = B5dc6fc.validateState(clone(s));
    old.events = old.events.filter((e) => e.event_type.startsWith("HR"));
    const rewritten = clone(old) as unknown as FoscState;
    for (const d of rewritten.days) {
      const loose = d as unknown as Record<string, unknown>;
      delete loose.rubrics; delete loose.persons; delete loose.estates;
    }
    for (const m of rewritten.months) delete (m as unknown as Record<string, unknown>).days_collected_by_rubric;
    expect(rewritten.days[0].tallies.some((t) => t.event_type === "KK02")).toBe(true);

    const store = memoryStore(rewritten);
    const later = new Date("2026-10-22T08:00:00Z");
    const ins: InsolvencyAvis[] = [{ id: insId(2), subRubric: "KK02", date: oct, cantons: ["VD"], companies: [{ uid: IDE.sa2, legalForm: "0106" }] }];
    const { opts } = setup(ins, hrAvis(2, oct, 10));
    const report = await runFoscCollection(opts(store, later, [oct]));
    expect(report.exit_code).toBe(0);
    expect(report.days[0].status).toBe("computed"); // jour sans « rubrics » : recalculé avec toutes les rubriques
    const after = stateOf(store);
    expect(after.days.find((d) => d.date === oct)!.rubrics).toEqual(["HR", "KK", "NA", "LS", "SR"]);
    expect(after.events.map((e) => e.event_type).sort()).toEqual(["HR01", "HR01", "KK02"]); // la ligne de septembre est revérifiée hors liste : partie
    expect(after.months[0].days_collected_by_rubric).toEqual({ HR: [sept] }); // couverture sous-estimée, jamais surestimée
    expect(report.purge.unpublished).toBe(1);
    const totals = store.totals as TotalsDocument;
    expect(totals.months.find((m) => m.month === "2026-09")!.days_collected_by_rubric).toEqual({ HR: 1 });
    expect(() => B5dc6fc.validateState(clone(after))).not.toThrow();
  });
});
