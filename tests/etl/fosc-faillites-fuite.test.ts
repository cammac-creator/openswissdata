import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Objets « R2 » simulés : tout ce que le passage réel enverrait au bucket privé est gardé ici.
const r2Objects = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../../src/lib/r2.js", () => ({
  getObjectBuffer: async (key: string) => {
    const b = r2Objects.get(key);
    if (!b) throw Object.assign(new Error("absent"), { name: "NoSuchKey" });
    return b;
  },
  putObjectBytes: async (key: string, bytes: Buffer) => { r2Objects.set(key, Buffer.from(bytes)); },
}));

import { createPoliteClient } from "../../etl/fosc/client.js";
import { formatReport, runFoscCollection, type CollectReport } from "../../etl/fosc/collect.js";
import type { PostalResolver } from "../../etl/fosc/communes.js";
import { fileStore, memoryStore, r2Store, R2_STATE_KEY, R2_TOTALS_KEY, type FoscStore } from "../../etl/fosc/store.js";
import type { FoscState } from "../../etl/fosc/state.js";
import { parseInsolvencyDetail } from "../../etl/fosc/insolvency.js";
import { INSOLVENCY_BY_CODE } from "../../etl/fosc/subrubrics.js";
import { FAKE_TERMS_SHA256, WITNESSES } from "../helpers/fosc-portal.js";
import { combinedPortal, IDE, ideForms, INSOLVENCY_WITNESSES, insolvencyXml, PERSON, type InsolvencyAvis } from "../helpers/fosc-insolvency-portal.js";

// Toutes les données sont inventées (dépôt public). Passage du 21.10.2026 à 10 h (heure suisse).
const NOW = new Date("2026-10-21T08:00:00Z");
const DAY = "2026-10-20";
const insId = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const resolvePostal: PostalResolver = (zip) => (zip === "1000" ? { bfs: 5586, canton: "VD" } : null);

/**
 * Avis qui ne doivent JAMAIS donner de ligne : faillite d'une personne physique, succession
 * répudiée, entreprise individuelle, société sans forme juridique portant un IDE, avis mixte
 * société + personne. Plus une ligne permise (Sàrl en liquidation) dont l'avis porte un leurre :
 * un autre IDE dans `meta/registrationOffice/uid`, le liquidateur dans le texte libre.
 */
const AVIS: InsolvencyAvis[] = [
  { id: insId(1), subRubric: "KK02", date: DAY, cantons: ["VD"], persons: [{}], addition: "none",
    dates: { resolutionDate: "2026-10-15", entryDeadline: "2026-11-20" } },
  { id: insId(2), subRubric: "KK02", date: DAY, cantons: ["VD"], persons: [{ death: PERSON.death }], addition: "refusedLegacy",
    dates: { resolutionDate: "2026-10-14", entryDeadline: "2026-11-21" } },
  { id: insId(3), subRubric: "KK01", date: DAY, cantons: ["VD"], companies: [{ uid: IDE.soleProp, legalForm: "0101" }], dates: { resolutionDate: "2026-10-13" } },
  { id: insId(4), subRubric: "KK01", date: DAY, cantons: ["VD"], companies: [{ uid: IDE.other, legalForm: null }], dates: { resolutionDate: "2026-10-12" } },
  { id: insId(5), subRubric: "NA03", date: DAY, cantons: ["VD"], companies: [{ uid: IDE.unknown, legalForm: "0106" }], persons: [{}],
    dates: { creditorHearingDate: "2026-11-02", entryDeadline: "2026-11-25" } },
  { id: insId(6), subRubric: "NA02", date: DAY, cantons: ["VD"], persons: [{}], dates: { moratoriumDateFrom: "2026-10-10", entryDeadline: "2027-02-10" } },
  { id: insId(7), subRubric: "LS02", date: DAY, cantons: ["VD"], companies: [{ uid: IDE.sarl, legalForm: "0107" }], officeUid: IDE.revision,
    dates: { entryDeadline: "2026-11-30" } },
];
/** IDE qui ne doivent jamais sortir (la Sàrl en liquidation, elle, est permise). */
const FORBIDDEN_IDE = [IDE.soleProp, IDE.other, IDE.unknown, IDE.revision];
const FORBIDDEN = [...INSOLVENCY_WITNESSES, ...WITNESSES, ...FORBIDDEN_IDE.flatMap(ideForms), "Lausanne", "Rue du Temoin"];

const leaks = (text: string): string[] => FORBIDDEN.filter((w) => text.includes(w));

/** Un passage complet, avec capture de tout ce qui part vers la console. */
async function run(store: FoscStore): Promise<{ report: CollectReport; journal: string }> {
  const portal = combinedPortal(AVIS);
  const client = createPoliteClient({ fetchImpl: portal.fetchImpl, sleepImpl: async () => {}, delayMs: 0, maxRequests: 500 });
  const printed: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { printed.push(args.map(String).join(" ")); }));
  try {
    const report = await runFoscCollection({
      store, client, resolveCommune: () => null, resolvePostal, now: NOW, days: [DAY], termsSha256: FAKE_TERMS_SHA256, mode: "test",
    });
    return { report, journal: [...printed, formatReport(report)].join("\n") };
  } finally {
    for (const s of spies) s.mockRestore();
  }
}

describe("faillites : une personne, une succession ou une entreprise individuelle n'est jamais écrite", () => {
  const saved = { ...process.env };
  beforeAll(() => {
    // Identifiants R2 fictifs : le stockage est simulé (aucune requête réseau).
    Object.assign(process.env, { R2_ACCOUNT_ID: "compte-fictif", R2_ACCESS_KEY_ID: "cle-fictive", R2_SECRET_ACCESS_KEY: "secret-fictif", R2_BUCKET: "seau-fictif" });
  });
  afterAll(() => {
    for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it("objets R2 simulés : ni nom, ni IDE, ni adresse, ni date de naissance ; seulement +1 dans les totaux", async () => {
    r2Objects.clear();
    const { report, journal } = await run(r2Store());
    expect(report.exit_code).toBe(0);
    expect([...r2Objects.keys()].sort()).toEqual([R2_TOTALS_KEY, R2_STATE_KEY].sort());
    const everything = [...r2Objects.values()].map((b) => b.toString("utf8")).join("\n");
    expect(leaks(everything)).toEqual([]);
    expect(leaks(journal)).toEqual([]);
    const state = JSON.parse(r2Objects.get(R2_STATE_KEY)!.toString("utf8")) as FoscState;
    // Une seule ligne : la Sàrl en liquidation.
    expect(state.events.map((e) => [e.event_type, e.ide])).toEqual([["LS02", IDE.sarl]]);
    expect(state.events[0]).not.toHaveProperty("dates"); // aucune date de procédure gardée
    const tallies = state.days[0].tallies;
    expect(tallies).toEqual(expect.arrayContaining([
      { event_type: "KK02", canton: "VD", legal_form: "personne", count: 1 },
      { event_type: "KK02", canton: "VD", legal_form: "succession", count: 1 },
      { event_type: "KK01", canton: "VD", legal_form: "0101", count: 1 },
      { event_type: "KK01", canton: "VD", legal_form: "inconnue", count: 1 },
      { event_type: "NA03", canton: "VD", legal_form: "personne", count: 1 },
      { event_type: "NA02", canton: "VD", legal_form: "personne", count: 1 },
      { event_type: "LS02", canton: "VD", legal_form: "0107", count: 1 },
    ]));
    expect(tallies.reduce((s, t) => s + t.count, 0)).toBe(AVIS.length);
    expect(report.insolvency.outcomes).toMatchObject({ row: 1, person: 3, estate: 1, sole_proprietorship: 1, no_legal_form: 1 });
    expect(state.days[0]).toMatchObject({ persons: 4, estates: 1, sole_proprietorships: 1, stored_rows: 1, totals_only: 6 });
    // Les dates des personnes (naissance, décès) et leurs procédures ne sont nulle part.
    expect(everything).not.toContain(PERSON.birth);
    expect(everything).not.toContain("2026-11-20");
    expect(everything).not.toContain("2026-11-25");
    expect(everything).not.toContain("2026-11-21");
    expect(everything).not.toContain("2026-11-30");
  });

  it("fichiers de --out : seulement l'état et les totaux, sans aucune donnée de personne ni XML brut", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-fosc-faillites-"));
    try {
      const { journal } = await run(fileStore(dir));
      const files = readdirSync(dir, { recursive: true }).map(String).sort();
      expect(files).toEqual(["hr-monthly-totals-v1.json", "hr-state-v1.json"]);
      const everything = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
      expect(leaks(everything)).toEqual([]);
      expect(everything).not.toContain("<?xml");
      expect(everything).not.toContain("publication>");
      expect(leaks(journal)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mémoire (tests) : même résultat, et le journal ne porte que des nombres et des codes", async () => {
    const store = memoryStore();
    const { journal } = await run(store);
    expect(leaks(JSON.stringify(store.state) + JSON.stringify(store.totals))).toEqual([]);
    expect(leaks(journal)).toEqual([]);
    for (const line of journal.split("\n")) expect(line.startsWith("[fosc] ")).toBe(true);
    expect(journal).not.toMatch(/CHE-?\d/);
  });

  it("la lecture du détail ne rend aucun champ de personne ni de texte libre", () => {
    for (const a of AVIS) {
      const detail = parseInsolvencyDetail(insolvencyXml(a), INSOLVENCY_BY_CODE.get(a.subRubric)!);
      const text = JSON.stringify(detail);
      // En mémoire seulement, le bloc société garde son IDE, son NPA et son lieu (rapprochement de
      // la commune) ; jamais un champ de personne, un nom, une rue ni un texte libre.
      const allowedInMemory = text.replaceAll(IDE.soleProp, "").replaceAll(IDE.other, "").replaceAll(IDE.unknown, "").replaceAll("Lausanne", "");
      expect(leaks(allowedInMemory)).toEqual([]);
      expect(text).not.toContain(PERSON.birth);
      expect(text).not.toContain(IDE.revision); // IDE de l'office, jamais lu
      expect(detail.schemaKnown).toBe(true);
    }
  });
});
