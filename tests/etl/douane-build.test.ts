/** Document réduit et contrôles avant écriture, sur des chiffres fictifs. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { DouaneAggregator, readZipInto, type FileLedger, type YearLedger } from "../../etl/douane/aggregate.js";
import {
  benchmarkGaps,
  buildMeta,
  checkDocument,
  CONJUNCTURAL_BENCHMARKS,
  DUTY_BENCHMARKS,
  DUTY_RATIO_MAX,
  journalSummary,
  parseConcordance,
  readMetaFromGzip,
  verifyDocument,
  writeDocument,
  type ControlOptions,
  type DouaneMeta,
} from "../../etl/douane/build.js";
import type { DouaneFileKind } from "../../etl/douane/sources.js";
import { DUTIES_HEADER, dutiesLine, TRADE_HEADER, tradeLine, UPDATED, writeZip } from "./douane-fixtures.js";

const dir = mkdtempSync(join(tmpdir(), "osd-douane-build-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const NOW = Date.parse("2026-11-05T12:00:00Z");

/** Un jeu fictif complet : 2024 et 2025 closes, 2026 provisoire sur 9 mois, repères et planchers à sa mesure. */
function year(lines: number, value: number, extra: Partial<YearLedger> = {}): YearLedger {
  return { lines, value_chf: value, kg: 10, months: 12, provisional: false, ...extra };
}
function ledgers(): Record<DouaneFileKind, FileLedger> {
  const base = { lines: 300, lines_label_overflow: 10, lines_blank_value: 0, lines_blank_kg: 0, updated_at: [UPDATED] };
  return {
    duties: {
      ...base,
      by_year: {
        "2024": year(100, 1000, { duties_chf: 500 }),
        "2025": year(100, 2000, { duties_chf: 600 }),
        "2026": year(100, 1500, { duties_chf: 400, months: 9, provisional: true }),
      },
    },
    imports: {
      ...base,
      by_year: {
        "2024": year(100, 1000, { conjunctural_value_chf: 800 }),
        "2025": year(100, 2000, { conjunctural_value_chf: 1000 }),
        "2026": year(100, 1500, { conjunctural_value_chf: 900, months: 9, provisional: true }),
      },
    },
    exports: {
      ...base,
      by_year: {
        "2024": year(100, 3000, { conjunctural_value_chf: 2800 }),
        "2025": year(100, 4000, { conjunctural_value_chf: 3000 }),
        "2026": year(100, 3500, { conjunctural_value_chf: 2900, months: 9, provisional: true }),
      },
    },
  };
}
const dates = (): Record<DouaneFileKind, string[]> => ({ duties: [UPDATED], imports: [UPDATED], exports: [UPDATED] });
function metaFrom(all = ledgers()): DouaneMeta {
  return buildMeta({
    aggregator: new DouaneAggregator(),
    ledgers: all,
    sources: [{ id: "bazg.x", kind: "duties", url: "https://exemple.invalid", dataset_url: "https://exemple.invalid", licence: "terms_by_ask", sha256: "a", bytes: 1, etag: null, last_modified: null, updated_at: UPDATED }],
    concordance: [["990101", "99010001", "2012-01-01", null]],
    collectedAt: "2026-11-05T12:00:00.000Z",
  });
}
const options = (extra: Partial<ControlOptions> = {}): ControlOptions => ({
  now: NOW,
  previous: null,
  acceptAnomaly: false,
  floors: { minLines: { duties: 300, imports: 300, exports: 300 }, firstYears: { duties: 2024, imports: 2024, exports: 2024 }, minConcordanceRows: 1 },
  benchmarks: { conjunctural: { "2025": { imports: 1000, exports: 3000 } }, duties: { "2025": 600 }, dutyYearMin: 100, dutyYearMax: 1000 },
  ...extra,
});
const stops = (mutate: (all: Record<DouaneFileKind, FileLedger>) => void, reason: RegExp, opts: Partial<ControlOptions> = {}) => {
  const all = ledgers();
  mutate(all);
  expect(() => checkDocument(metaFrom(all), dates(), options(opts))).toThrow(reason);
};

describe("contrôles avant écriture", () => {
  it("le jeu de référence passe", () => {
    expect(() => checkDocument(metaFrom(), dates(), options())).not.toThrow();
  });
  it("les repères officiels sont écrits, et leur bande refuse la lecture naïve", () => {
    expect(CONJUNCTURAL_BENCHMARKS["2025"]).toEqual({ imports: 232_700_000_000, exports: 287_000_000_000 });
    expect(DUTY_BENCHMARKS).toEqual({ "2024": 738_000_000, "2025": 778_000_000 });
    // Rapport mesuré le 05.11.2026 pour une lecture par position : plus de 8.
    expect(DUTY_RATIO_MAX).toBeLessThan(2);
  });
  it("le piège : des droits neuf fois trop hauts arrêtent la collecte, même si tout le reste est juste", () => {
    stops((all) => { all.duties.by_year["2025"].duties_chf = 5400; }, /droits/);
  });
  it("l'écart mesuré avec le Compte d'État passe, pas un écart de 25 %", () => {
    const opts = { benchmarks: { conjunctural: {}, duties: { "2025": 600 }, dutyYearMin: 100, dutyYearMax: 1000 } };
    const all = ledgers();
    all.duties.by_year["2025"].duties_chf = 640;
    expect(() => checkDocument(metaFrom(all), dates(), options(opts))).not.toThrow();
    stops((a) => { a.duties.by_year["2025"].duties_chf = 750; }, /Compte d'État/, opts);
    stops((a) => { a.duties.by_year["2025"].duties_chf = 500; }, /Compte d'État/, opts);
  });
  it("une année close sans repère reste bornée", () => {
    stops((all) => { all.duties.by_year["2024"].duties_chf = 5000; }, /invraisemblables/);
    stops((all) => { all.duties.by_year["2024"].duties_chf = 5; }, /invraisemblables/);
  });
  it("les totaux du commerce loin du communiqué", () => {
    stops((all) => { all.imports.by_year["2025"].conjunctural_value_chf = 1100; }, /importations loin/);
    stops((all) => { all.exports.by_year["2025"].conjunctural_value_chf = 2800; }, /exportations loin/);
  });
  it("les deux fichiers d'importation qui divergent", () => {
    stops((all) => { all.duties.by_year["2024"].value_chf = 1200; }, /entre les deux fichiers/);
    stops((all) => { delete all.imports.by_year["2024"]; all.imports.by_year["2023"] = year(100, 1); }, /absente du commerce|année manquante/);
  });
  it("le repère dont l'année manque", () => {
    stops(() => undefined, /année du repère absente/, { benchmarks: { conjunctural: { "2019": { imports: 1, exports: 1 } }, duties: {}, dutyYearMin: 100, dutyYearMax: 1000 } });
  });
  it("le volume, les valeurs vides et la couverture", () => {
    stops((all) => { all.exports.lines = 10; }, /trop peu de lignes/);
    stops((all) => { all.imports.lines_blank_value = 1; }, /valeurs vides/);
    stops((all) => { delete all.exports.by_year["2024"]; all.exports.by_year["2025"] = year(100, 4000, { conjunctural_value_chf: 3000 }); }, /historique incomplet/);
    stops((all) => { all.imports.by_year["2021"] = year(1, 1); }, /année manquante/);
    stops((all) => { all.imports.by_year["2024"].months = 11; }, /année close incomplète/);
    stops((all) => { all.imports.by_year["2024"].provisional = true; }, /encore provisoire/);
    stops((all) => { all.exports.by_year["2027"] = year(1, 1); delete all.exports.by_year["2026"]; }, /futur/);
  });
  it("l'avant-dernière année peut rester provisoire après janvier, mais doit être complète", () => {
    const all = ledgers();
    all.duties.by_year["2025"].provisional = true;
    all.imports.by_year["2025"].provisional = true;
    all.exports.by_year["2025"].provisional = true;
    expect(() => checkDocument(metaFrom(all), dates(), options())).not.toThrow();
    all.imports.by_year["2025"].months = 11;
    expect(() => checkDocument(metaFrom(all), dates(), options())).toThrow(/année close incomplète/);
  });
  it("une dernière année trop ancienne", () => {
    expect(() => checkDocument(metaFrom(), dates(), options({ now: Date.parse("2028-11-05T12:00:00Z") }))).toThrow(/dernière année trop ancienne/);
  });
  it("la concordance trop courte", () => {
    const all = metaFrom();
    all.concordance_cpa6 = [];
    expect(() => checkDocument(all, dates(), options())).toThrow(/concordance/);
  });
  it("la date de la source : plusieurs valeurs, futur, figée", () => {
    expect(() => checkDocument(metaFrom(), { ...dates(), duties: [UPDATED, "2026-10-14T00:00:00.000+02:00"] }, options())).toThrow(/plusieurs dates/);
    expect(() => checkDocument(metaFrom(), { ...dates(), imports: [] }, options())).toThrow(/plusieurs dates/);
    expect(() => checkDocument(metaFrom(), dates(), options({ now: Date.parse("2026-10-01T00:00:00Z") }))).toThrow(/futur/);
    const late = Date.parse("2026-12-30T12:00:00Z");
    expect(() => checkDocument(metaFrom(), dates(), options({ now: late }))).toThrow(/trop longtemps/);
    expect(() => checkDocument(metaFrom(), dates(), options({ now: late, acceptAnomaly: true }))).not.toThrow();
  });
  describe("contre la version précédente", () => {
    const previous = (mutate: (all: Record<DouaneFileKind, FileLedger>) => void = () => undefined): DouaneMeta => {
      const all = ledgers();
      mutate(all);
      return metaFrom(all);
    };
    it("une version identique passe, l'année provisoire peut bouger", () => {
      expect(() => checkDocument(metaFrom(), dates(), options({ previous: previous() }))).not.toThrow();
      const moved = previous((all) => { all.imports.by_year["2026"].value_chf = 1; });
      expect(() => checkDocument(metaFrom(), dates(), options({ previous: moved }))).not.toThrow();
    });
    it("une année close qui bouge de plus de 1 %, en valeur ou en droits", () => {
      const moved = previous((all) => { all.imports.by_year["2024"].value_chf = 1100; });
      expect(() => checkDocument(metaFrom(), dates(), options({ previous: moved }))).toThrow(/année close qui bouge/);
      const duties = previous((all) => { all.duties.by_year["2024"].duties_chf = 550; });
      expect(() => checkDocument(metaFrom(), dates(), options({ previous: duties }))).toThrow(/année close qui bouge/);
    });
    it("une baisse de lignes, une date qui recule, une année disparue ; l'adoption après examen", () => {
      const more = previous((all) => { all.duties.lines = 1000; });
      expect(() => checkDocument(metaFrom(), dates(), options({ previous: more }))).toThrow(/baisse inhabituelle/);
      expect(() => checkDocument(metaFrom(), dates(), options({ previous: more, acceptAnomaly: true }))).not.toThrow();
      const newer = previous();
      newer.sources[0].updated_at = "2026-11-01T00:00:00.000+02:00";
      expect(() => checkDocument(metaFrom(), dates(), options({ previous: newer }))).toThrow(/recule/);
      const older = previous((all) => { all.imports.by_year["2010"] = year(1, 1); });
      expect(() => checkDocument(metaFrom(), dates(), options({ previous: older }))).toThrow(/année disparue/);
    });
  });
});

describe("le journal public", () => {
  const run = { mode: "simulation", document: { raw_bytes: 1, gzip_bytes: 1 }, secondsByStep: { lecture: 1 }, secondsTotal: 1, maxRssMb: 1 };
  /** Des montants reconnaissables, dans chaque colonne de chaque fichier et de chaque année. */
  function witnesses(): DouaneMeta {
    const all = ledgers();
    let next = 7_100_000_001;
    for (const kind of ["duties", "imports", "exports"] as const) {
      for (const entry of Object.values(all[kind].by_year)) {
        entry.value_chf = next++;
        entry.kg = next++;
        if (kind === "duties") entry.duties_chf = next++;
        else entry.conjunctural_value_chf = next++;
      }
    }
    return metaFrom(all);
  }
  it("aucune valeur, aucun poids, aucuns droits, sur aucune année ni aucun fichier", () => {
    const text = JSON.stringify(journalSummary(witnesses(), run));
    expect(text).not.toMatch(/71000000\d\d/);
    expect(text).not.toMatch(/value_chf|duties_chf|"kg"/);
  });
  it("les années ne portent que les lignes, les mois et l'état", () => {
    const summary = journalSummary(metaFrom(), run) as { last_years: Record<string, Record<string, unknown>[]> };
    expect(summary.last_years.duties).toHaveLength(3);
    for (const rows of Object.values(summary.last_years)) {
      for (const row of rows) expect(Object.keys(row).sort()).toEqual(["lines", "months", "provisional", "year"]);
    }
  });
  it("les totaux n'y sont que des écarts au repère, en pour cent", () => {
    const all = ledgers();
    all.imports.by_year["2025"].conjunctural_value_chf = Math.round(232_700_000_000 * 1.0006);
    all.exports.by_year["2025"].conjunctural_value_chf = Math.round(287_000_000_000 * 0.9994);
    all.duties.by_year["2025"].duties_chf = Math.round(778_000_000 * 1.0607);
    all.duties.by_year["2024"].duties_chf = 738_000_000;
    expect(benchmarkGaps(metaFrom(all))).toEqual({ imports_2025: 0.06, exports_2025: -0.06, duties_2024: 0, duties_2025: 6.07 });
  });
  it("le recoupement entre les deux fichiers aussi", () => {
    const all = ledgers();
    all.duties.by_year["2024"].value_chf = 1010;
    const summary = journalSummary(metaFrom(all), run) as { cross_file_max_gap_percent: number };
    expect(summary.cross_file_max_gap_percent).toBeCloseTo(1, 5);
  });
});

describe("concordance CPA et tarif", () => {
  const header = "cpa6;tn8;validfrom;validto;update";
  it("garde les dates, sans heure ; une fin en 9999 veut dire « en vigueur »", () => {
    const { rows, updatedAt } = parseConcordance(`${header}\n990101;9901.0001;2012-01-01T00:00:00.000+01:00;9999-12-31T23:59:59.000+01:00;2026-10-13\n990102;9901.0002;2012-01-01T00:00:00.000+01:00;2016-12-31T23:59:59.000+01:00;2026-10-13\n`);
    expect(rows).toEqual([["990101", "99010001", "2012-01-01", null], ["990102", "99010002", "2012-01-01", "2016-12-31"]]);
    expect(updatedAt).toBe("2026-10-13");
  });
  it("refuse une colonne ou une ligne hors de la forme attendue", () => {
    expect(() => parseConcordance("cpa;tn8\n")).toThrow(/colonnes/);
    expect(() => parseConcordance(`${header}\nTEMOIN;9901.0001;x;y;z\n`)).toThrow(/illisible/);
  });
});

/** Toute la chaîne, de vrais ZIP au document relu. */
async function chain(name: string) {
  const zips = {
    duties: join(dir, `${name}-ze.zip`),
    imports: join(dir, `${name}-imp.zip`),
    exports: join(dir, `${name}-exp.zip`),
  };
  await writeZip(zips.duties, [{ name: "ZE.csv", text: [DUTIES_HEADER,
    dutiesLine({ duties: "100.0", value: "1000.0", label: '"Fictif; \\"TEMOIN-a\\"; encore"' }),
    dutiesLine({ duties: "0.0", value: "500.0", month: 2 }),
    dutiesLine({ year: 2026, duties: "7.0", value: "70.0", status: "prov" }),
  ].join("\n") }]);
  await writeZip(zips.imports, [{ name: "IMP.csv", text: [TRADE_HEADER,
    tradeLine("I", { value: "1000.0", kg: "10.0", label: '"Fictif; TEMOIN-b"' }),
    tradeLine("I", { value: "500.0", kg: "", month: 2 }),
    tradeLine("I", { year: 2026, value: "70.0", kg: "1.0", status: "prov" }),
    tradeLine("I", { year: 1988, tariff: "0101.1011", value: "9.0", kg: "9.0", country: "XC" }),
    tradeLine("I", { tariff: "9971.0800", value: "4000.0", kg: "1.0", conjunctural: "Non", country: "XD" }),
  ].join("\n") }]);
  await writeZip(zips.exports, [{ name: "EXP.csv", text: [TRADE_HEADER,
    tradeLine("E", { value: "30.0", kg: "3.0", country: "XB" }),
  ].join("\n") }]);
  const aggregator = new DouaneAggregator();
  const all = {} as Record<DouaneFileKind, FileLedger>;
  for (const kind of ["duties", "imports", "exports"] as const) all[kind] = await readZipInto(kind, zips[kind], aggregator);
  const meta = buildMeta({
    aggregator,
    ledgers: all,
    sources: [],
    concordance: [["990101", "99010001", "2012-01-01", null]],
    collectedAt: "2026-11-05T12:00:00.000Z",
  });
  const path = join(dir, `${name}.txt.gz`);
  const sizes = await writeDocument(meta, aggregator, path);
  return { meta, path, sizes };
}

describe("le document écrit", () => {
  it("une ligne d'en-tête, puis des lignes triées ; vide veut dire absent, 0 veut dire zéro", async () => {
    const { path, meta, sizes } = await chain("doc");
    const text = gunzipSync(readFileSync(path)).toString("utf8");
    const [head, ...rows] = text.trimEnd().split("\n");
    expect(JSON.parse(head)).toEqual(meta);
    expect(rows).toEqual([
      "01011011;XC;1988;9;9;;;",
      "99010001;XA;2025;1500;10;100;;",
      "99010001;XA;2026;70;1;7;;",
      "99010001;XB;2025;;;;30;3",
      "99710800;XD;2025;4000;1;;;",
    ]);
    expect(meta.row_count).toBe(5);
    expect(sizes.raw_bytes).toBe(Buffer.byteLength(text));
    expect(sizes.gzip_bytes).toBe(readFileSync(path).length);
    expect(meta.non_conjunctural.imports).toEqual({ "99710800": [2025] });
    expect(meta.notice).toContain("terms_by_ask");
    expect(meta.notice).toContain("48 heures");
  });
  it("la relecture passe sur le document intact, et les totaux conjoncturels s'y retrouvent", async () => {
    const { path, meta } = await chain("ok");
    await expect(verifyDocument(path, meta)).resolves.toBeUndefined();
    expect(meta.ledgers.imports.by_year["2025"].conjunctural_value_chf).toBe(1500);
    expect(meta.ledgers.imports.by_year["2025"].value_chf).toBe(5500);
  });
  it.each([
    ["un montant changé", (t: string) => t.replace(";1500;10;100;", ";1501;10;100;"), /total du document/],
    ["une ligne ajoutée", (t: string) => `${t}99990001;XA;2025;1;1;1;1;1\n`, /nombre de lignes|total du document/],
    ["une ligne retirée", (t: string) => t.replace("99010001;XB;2025;;;;30;3\n", ""), /nombre de lignes/],
    ["un texte glissé dans une ligne", (t: string) => t.replace("99010001;XB;2025;;;;30;3", "99010001;XB;2025;;;;30;TEMOIN"), /forme attendue/],
    ["un désordre", (t: string) => t.replace("01011011;XC;1988;9;9;;;\n", "").replace(/\n$/, "\n01011011;XC;1988;9;9;;;\n"), /mal trié/],
    ["un document coupé", (t: string) => t.slice(0, -3), /tronqué/],
    ["un en-tête changé", (t: string) => t.replace('"row_count":5', '"row_count":6'), /en-tête/],
  ])("la relecture refuse %s", async (_nom, tamper, reason) => {
    const { path, meta } = await chain(`abime-${_nom.replace(/\W/g, "")}`);
    writeFileSync(path, gzipSync(tamper(gunzipSync(readFileSync(path)).toString("utf8"))));
    await expect(verifyDocument(path, meta)).rejects.toThrow(reason);
  });
  it("la version précédente se relit depuis son en-tête ; un objet illisible rend null", async () => {
    const { path, meta } = await chain("prec");
    expect(await readMetaFromGzip(readFileSync(path))).toEqual(meta);
    expect(await readMetaFromGzip(Buffer.from("pas du gzip"))).toBeNull();
    expect(await readMetaFromGzip(gzipSync('{"schema":"autre"}\n'))).toBeNull();
    expect(await readMetaFromGzip(gzipSync("sans fin de ligne"))).toBeNull();
  });
});
