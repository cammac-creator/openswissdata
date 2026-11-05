/**
 * `/api/v1/tariff/:code/at` et `/api/v1/tariff/changes` : vraies réponses sur archives fictives
 * (`createApp().request`), lues comme en production depuis un R2 simulé, empreintes comprises.
 * Aucune donnée réelle : tous les numéros, textes et taux sont inventés.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import archiver from "archiver";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("../../src/lib/r2.js", () => ({ getObjectBuffer: download }));

import { createApp } from "../../src/index.js";
import { _resetApiRateLimit } from "../../src/lib/api-rate-limit.js";
import { closeDb, getDb } from "../../src/lib/db.js";
import { _resetTariffHistoryForTest, getTariffHistory, refreshTariffHistory, startTariffHistoryRefresh, TARIFF_HISTORY_MAX_VERSIONS } from "../../src/lib/tariff-history.js";
import { _resetDataLoaderCache } from "../../src/mcp/data-loader.js";
import { _resetFreshnessForTest } from "../../src/mcp/r2-refresh.js";
import { DISCLAIMERS } from "../../src/mcp/tools/tariff-lookup.js";

const HEADER = "hs8,hs6,chapter,heading,designation_fr,designation_de,designation_it,designation_en,unit_stat,duty_mfn_value,duty_mfn_unit,duty_mfn_currency,preferential_regimes,restrictions_codes,customs_relief_codes,valid_from,duty_rates_count,source_url";

interface FakeLine { hs8: string; value?: string; unit?: string; currency?: string; regimes?: string; relief?: string; count?: string; designation?: string }

function csvQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function csvLine(l: FakeLine): string {
  const value = l.value ?? "10";
  const unit = l.unit ?? (value === "" ? "" : "par 100 kg brut");
  const currency = l.currency ?? (value === "" ? "" : "CHF");
  return [l.hs8, l.hs8.slice(0, 6), l.hs8.slice(0, 2), l.hs8.slice(0, 4), csvQuote(l.designation ?? "Marchandise fictive"), "Fiktive Ware", "Merce fittizia", "Fictitious goods", unit, value, unit, currency, csvQuote(l.regimes ?? "{}"), csvQuote("[]"), csvQuote(l.relief ?? "[]"), "2012-01-01", l.count ?? "3", `https://xtares.admin.ch/tares/control/searchSimpleTarifNumber?number=${l.hs8}`].join(",");
}

/** 6 000 lignes de remplissage (plancher de contrôle) plus les lignes du scénario. */
function archiveCsv(lines: FakeLine[]): string {
  const named = new Set(lines.map((l) => l.hs8));
  const filler = Array.from({ length: 6_000 }, (_, i) => String(90_000_000 + i)).filter((hs8) => !named.has(hs8)).map((hs8) => csvLine({ hs8 }));
  return [HEADER, ...filler, ...lines.map(csvLine)].join("\n");
}

function zip(files: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip");
    const parts: Buffer[] = [];
    archive.on("data", (b: Buffer) => parts.push(b));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(parts)));
    for (const [name, content] of Object.entries(files)) archive.append(content, { name });
    void archive.finalize();
  });
}

const objects = new Map<string, Buffer>();
let released = 0;

/** Pose une version fictive : objet dans le R2 simulé, ligne dans `versions`. */
async function publish(version: string, lines: FakeLine[], opts: { schema?: number; checkedAt?: string; corruptAfterRecord?: boolean; rawCsv?: string } = {}) {
  const csv = opts.rawCsv ?? archiveCsv(lines);
  const rows = csv.trim().split("\n").length - 1;
  const date = version.slice(0, 10).replace(/\./g, "-");
  const quality = { schema_version: opts.schema ?? 2, rows, checked_at: opts.checkedAt ?? `${date}T08:00:00.000Z` };
  const bytes = await zip({ "tares.csv": csv, "quality.json": JSON.stringify(quality) });
  const key = `tares/${version}/tares.zip`;
  released += 1;
  getDb().prepare("INSERT INTO versions(dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES('tares',?,?,?,?,?)").run(version, key, createHash("sha256").update(bytes).digest("hex"), bytes.length, released);
  objects.set(key, opts.corruptAfterRecord ? Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from([bytes[bytes.length - 1] ^ 0xff])]) : bytes);
}

const NOW = Date.parse("2026-11-05T09:00:00Z");
const get = (path: string) => createApp().request(path, { headers: { "x-real-ip": "192.0.2.88" } });
const CODE = "07099991";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "osd-api-tariff-"));
  vi.stubEnv("DATABASE_PATH", join(tmp, "test.sqlite"));
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "fictif");
  vi.stubEnv("R2_ACCOUNT_ID", "fictif");
  vi.stubEnv("R2_BUCKET", "fictif");
  getDb().prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES('tares','TARES','tares',0,'fictif',?)").run(1);
  _resetApiRateLimit();
  _resetTariffHistoryForTest();
  _resetFreshnessForTest();
  _resetDataLoaderCache();
  objects.clear();
  released = 0;
  download.mockReset();
  download.mockImplementation(async (key: string) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("clé inconnue du R2 simulé");
    return bytes;
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  _resetTariffHistoryForTest();
  _resetFreshnessForTest();
  _resetDataLoaderCache();
  vi.useRealTimers();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

/** Trois versions : 28.09 et 05.10 identiques sur CODE, puis un trou jusqu'au 19.10 où le taux change. */
async function threeVersions() {
  await publish("2026.09.28", [{ hs8: CODE, value: "4", regimes: '{"eu":3,"ldg_100006":"free"}' }, { hs8: "01012911", value: "" }]);
  await publish("2026.10.05", [{ hs8: CODE, value: "4", regimes: '{"eu":3,"ldg_100006":"free"}' }, { hs8: "01012911", value: "" }]);
  await publish("2026.10.19", [{ hs8: CODE, value: "2", regimes: '{"eu":3,"ldg_100006":"free"}' }, { hs8: "01012911", value: "" }]);
  await refreshTariffHistory();
}

describe("GET /api/v1/tariff/:code/at", () => {
  it("répond avec la version la plus récente non postérieure, sa date, la suivante et les avis", async () => {
    await threeVersions();
    const res = await get(`/api/v1/tariff/${CODE}/at?date=2026-10-01`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("x-ratelimit-limit")).toBe("600");
    const body = await res.json();
    expect(body.hs8).toBe(CODE);
    expect(body.date).toBe("2026-10-01");
    expect(body.archive).toMatchObject({ version: "2026.09.28", date: "2026-09-28", days_after_archive: 3, next_archive: { version: "2026.10.05", date: "2026-10-05", line_changed: false }, later_changes: null });
    expect(body.gap).toBeNull();
    expect(body.line.duty_mfn).toEqual({ value: 4, unit: "par 100 kg brut", currency: "CHF" });
    expect(body.line.preferential_regimes).toEqual({ eu: 3, ldg_100006: "free" });
    expect(body.line.designations.en).toBe("Fictitious goods");
    expect(body.disclaimer).toBe(DISCLAIMERS.en);
    expect(body.coverage).toMatchObject({ first_archive: { version: "2026.09.28" }, last_archive: { version: "2026.10.19" }, archives_served: 3 });
    expect(body.sources.map((s: { id: string }) => s.id)).toContain("tares.tariff_8_digit");
    expect(body.sources.length).toBeGreaterThanOrEqual(7);
  });

  it("le jour même de la collecte, la version de ce jour ; numéro accepté avec des points", async () => {
    await threeVersions();
    const body = await (await get("/api/v1/tariff/0709.9991/at?date=2026-10-19")).json();
    expect(body.archive.version).toBe("2026.10.19");
    expect(body.hs8).toBe(CODE);
    expect(body.line.duty_mfn.value).toBe(2);
    expect(body.archive.next_archive).toBeNull();
    expect(body.archive.later_changes).toContain("unknown");
  });

  it("une date avant la première archive répond « pas d'archive », jamais une valeur", async () => {
    await threeVersions();
    const res = await get(`/api/v1/tariff/${CODE}/at?date=2026-09-27`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("no_archive_for_date");
    expect(body.date).toBe("2026-09-27");
    expect(body.coverage.first_archive).toEqual({ version: "2026.09.28", date: "2026-09-28" });
    expect(body.line).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("par 100 kg");
    expect(body.disclaimer).toBe(DISCLAIMERS.en);
  });

  it("un trou entre deux versions est dit, et la réponse donne la version utilisée", async () => {
    await threeVersions();
    const body = await (await get(`/api/v1/tariff/${CODE}/at?date=2026-10-12`)).json();
    expect(body.archive.version).toBe("2026.10.05");
    expect(body.archive.days_after_archive).toBe(7);
    expect(body.archive.next_archive).toEqual({ version: "2026.10.19", date: "2026-10-19", line_changed: true });
    expect(body.gap).toMatchObject({ days_without_archive: 14, unavailable_versions: [] });
    expect(body.gap.note).toContain("not known");
    expect(body.line.duty_mfn.value).toBe(4);
  });

  it("une date après la dernière archive, même future, garde la dernière version et le dit", async () => {
    await threeVersions();
    const body = await (await get(`/api/v1/tariff/${CODE}/at?date=2027-03-01`)).json();
    expect(body.archive.version).toBe("2026.10.19");
    expect(body.archive.next_archive).toBeNull();
    expect(body.archive.later_changes).toContain("unknown");
    expect(body.gap.days_without_archive).toBe(133);
  });

  it("un numéro absent de la version utilisée répond 404 sans repli sur une autre version", async () => {
    await publish("2026.09.28", [{ hs8: CODE }]);
    await publish("2026.10.05", [{ hs8: CODE }, { hs8: "12345678", value: "9" }]);
    await refreshTariffHistory();
    const absent = await get("/api/v1/tariff/12345678/at?date=2026-09-30");
    expect(absent.status).toBe(404);
    const body = await absent.json();
    expect(body.error).toBe("tariff_line_not_found");
    expect(body.archive.version).toBe("2026.09.28");
    expect(body.line).toBeUndefined();
    expect((await get("/api/v1/tariff/12345678/at?date=2026-10-05")).status).toBe(200);
    expect((await (await get("/api/v1/tariff/00000000/at?date=2026-10-05")).json()).error).toBe("tariff_line_not_found");
  });

  it("paramètres invalides : 400, sans téléchargement", async () => {
    await threeVersions();
    const calls = download.mock.calls.length;
    for (const [path, error] of [
      [`/api/v1/tariff/${CODE}/at`, "invalid_date"],
      [`/api/v1/tariff/${CODE}/at?date=`, "invalid_date"],
      [`/api/v1/tariff/${CODE}/at?date=2026-02-30`, "invalid_date"],
      [`/api/v1/tariff/${CODE}/at?date=2026-13-01`, "invalid_date"],
      [`/api/v1/tariff/${CODE}/at?date=01.10.2026`, "invalid_date"],
      ["/api/v1/tariff/0709/at?date=2026-10-01", "invalid_tariff_number"],
      ["/api/v1/tariff/abcdefgh/at?date=2026-10-01", "invalid_tariff_number"],
      [`/api/v1/tariff/${"1".repeat(21)}/at?date=2026-10-01`, "invalid_tariff_number"],
    ] as const) {
      const res = await get(path);
      expect(res.status, path).toBe(400);
      expect((await res.json()).error, path).toBe(error);
    }
    expect(download.mock.calls.length).toBe(calls);
  });

  it("absence de résumé : droit nul, jamais zéro ni « free »", async () => {
    await threeVersions();
    const body = await (await get("/api/v1/tariff/01012911/at?date=2026-10-01")).json();
    expect(body.line.duty_mfn).toEqual({ value: null, unit: null, currency: null });
    expect(body.line.preferential_regimes).toEqual({});
    expect(body.notice.summary).toContain("never means duty-free");
    expect(body.notice.what_this_is).toContain("not a statement of the law");
  });

  it("un pourcentage reste un pourcentage : valeur et unité telles qu'archivées, sans CHF", async () => {
    await publish("2026.09.28", [{ hs8: CODE, value: "5", unit: "%", currency: "" }]);
    await refreshTariffHistory();
    const body = await (await get(`/api/v1/tariff/${CODE}/at?date=2026-10-01`)).json();
    expect(body.line.duty_mfn).toEqual({ value: 5, unit: "%", currency: null });
  });
});

describe("archives refusées : jamais servies", () => {
  it("un pourcentage étiqueté CHF écarte toute l'archive, et le trou est dit", async () => {
    await publish("2026.09.28", [{ hs8: CODE, value: "4" }]);
    await publish("2026.10.05", [{ hs8: CODE, value: "5", unit: "%", currency: "CHF" }]);
    await refreshTariffHistory();
    const body = await (await get(`/api/v1/tariff/${CODE}/at?date=2026-10-06`)).json();
    expect(body.archive.version).toBe("2026.09.28");
    expect(body.line.duty_mfn.value).toBe(4);
    expect(body.gap.unavailable_versions).toEqual([{ version: "2026.10.05", date: "2026-10-05" }]);
  });

  it("une empreinte qui ne correspond plus (cas réel de 2026.05.03) écarte la version et ne se relit pas", async () => {
    await publish("2026.09.28", [{ hs8: CODE, value: "4" }]);
    await publish("2026.10.05", [{ hs8: CODE, value: "99" }], { corruptAfterRecord: true });
    await publish("2026.10.12", [{ hs8: CODE, value: "6" }]);
    await refreshTariffHistory();
    const body = await (await get(`/api/v1/tariff/${CODE}/at?date=2026-10-06`)).json();
    expect(body.archive.version).toBe("2026.09.28");
    expect(body.gap.unavailable_versions).toEqual([{ version: "2026.10.05", date: "2026-10-05" }]);
    expect(body.line.duty_mfn.value).toBe(4);
    const calls = download.mock.calls.length;
    await refreshTariffHistory();
    expect(download.mock.calls.length).toBe(calls);
  });

  it("une archive d'ancien format après la coupure, une date de collecte différente ou trop peu de lignes : écartées", async () => {
    await publish("2026.09.28", [{ hs8: CODE, value: "4" }]);
    await publish("2026.10.05", [{ hs8: CODE, value: "90" }], { schema: 1 });
    await publish("2026.10.12", [{ hs8: CODE, value: "91" }], { checkedAt: "2026-10-11T23:00:00.000Z" });
    await publish("2026.10.19", [], { rawCsv: [HEADER, csvLine({ hs8: CODE, value: "92" })].join("\n") });
    await refreshTariffHistory();
    const body = await (await get(`/api/v1/tariff/${CODE}/at?date=2026-10-30`)).json();
    expect(body.archive.version).toBe("2026.09.28");
    expect(body.line.duty_mfn.value).toBe(4);
    expect(body.gap.unavailable_versions.map((v: { version: string }) => v.version)).toEqual(["2026.10.05", "2026.10.12", "2026.10.19"]);
    expect(body.coverage.archives_served).toBe(1);
  });

  it("les archives d'avant le format 2 ne sont même pas téléchargées", async () => {
    await publish("2026.08.24", [{ hs8: CODE, value: "6" }], { schema: 1 });
    await publish("2026.09.25", [{ hs8: CODE, value: "5" }]);
    await refreshTariffHistory();
    expect(download.mock.calls.map(([key]) => key)).toEqual(["tares/2026.09.25/tares.zip"]);
    const res = await get(`/api/v1/tariff/${CODE}/at?date=2026-08-30`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no_archive_for_date");
  });

  it("une panne de lecture se retente au passage suivant, une version chargée ne se retélécharge pas", async () => {
    await publish("2026.09.28", [{ hs8: CODE, value: "4" }]);
    await publish("2026.10.05", [{ hs8: CODE, value: "5" }]);
    const bytes = objects.get("tares/2026.09.28/tares.zip");
    let failures = 1;
    download.mockImplementation(async (key: string) => {
      if (key === "tares/2026.09.28/tares.zip" && failures-- > 0) throw new Error("secret-fournisseur");
      return key === "tares/2026.09.28/tares.zip" ? bytes : objects.get(key);
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await refreshTariffHistory();
    expect(errors.mock.calls.flat().join(" ")).not.toContain("secret-fournisseur");
    errors.mockRestore();
    expect((await (await get(`/api/v1/tariff/${CODE}/at?date=2026-10-06`)).json()).archive.version).toBe("2026.10.05");
    // Une archive existe mais n'a pas pu être lue : « pas d'archive servie », et elle est nommée.
    const before = await get(`/api/v1/tariff/${CODE}/at?date=2026-09-30`);
    expect(before.status).toBe(404);
    expect((await before.json()).unavailable_versions).toEqual([{ version: "2026.09.28", date: "2026-09-28" }]);

    download.mockClear();
    await refreshTariffHistory();
    expect(download.mock.calls.map(([key]) => key)).toEqual(["tares/2026.09.28/tares.zip"]);
    const after = await (await get(`/api/v1/tariff/${CODE}/at?date=2026-09-30`)).json();
    expect(after.archive.version).toBe("2026.09.28");
    expect(after.gap).toBeNull();
  });
});

describe("GET /api/v1/tariff/changes", () => {
  async function changesScenario() {
    await publish("2026.09.28", [
      { hs8: "10000001", value: "4", regimes: '{"eu":3,"jp":"free"}' },
      { hs8: "10000002", value: "7" },
      { hs8: "10000003", value: "1", count: "3" },
      { hs8: "10000004", value: "8", regimes: '{"jp":"free","eu":2}' },
      { hs8: "10000006", value: "" },
    ]);
    await publish("2026.10.05", [
      { hs8: "10000001", value: "2", regimes: '{"eu":3,"jp":"free"}' },
      { hs8: "10000003", value: "1", count: "4" },
      // Mêmes préférences dans un autre ordre : pas un changement.
      { hs8: "10000004", value: "8", regimes: '{"eu":2,"jp":"free"}' },
      { hs8: "10000005", value: "3" },
      { hs8: "10000006", value: "" },
    ]);
    await refreshTariffHistory();
  }

  it("lignes apparues, disparues, taux modifiés, autres champs ; triées, mêmes garanties", async () => {
    await changesScenario();
    const res = await get("/api/v1/tariff/changes?from=2026-09-30&to=2026-10-05");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from).toEqual({ requested_date: "2026-09-30", version: "2026.09.28", date: "2026-09-28" });
    expect(body.to).toEqual({ requested_date: "2026-10-05", version: "2026.10.05", date: "2026-10-05" });
    expect(body.same_version).toBe(false);
    expect(body.compared_on).toBe("line_summary");
    expect(body.totals).toEqual({ added: 1, removed: 1, rates_changed: 1, other_fields_changed: 1 });
    expect(body.total).toBe(4);
    expect(body.changes.map((c: { hs8: string }) => c.hs8)).toEqual(["10000001", "10000002", "10000003", "10000005"]);
    const [rate, removed, other, added] = body.changes;
    expect(rate).toMatchObject({ kind: "rates_changed", changed_fields: ["duty_mfn_value"], before: { duty_mfn: { value: 4 } }, after: { duty_mfn: { value: 2 } } });
    expect(removed).toMatchObject({ kind: "removed", after: null, before: { duty_mfn: { value: 7 } } });
    expect(other).toMatchObject({ kind: "other_fields_changed", changed_fields: ["duty_rates_count"], before: { duty_rates_count: 3 }, after: { duty_rates_count: 4 } });
    expect(added).toMatchObject({ kind: "added", before: null, after: { duty_mfn: { value: 3 } } });
    expect(body.disclaimer).toBe(DISCLAIMERS.en);
    expect(body.notice.comparison).toContain("no listed change does not mean that nothing changed");
    expect(body.sources.length).toBeGreaterThanOrEqual(7);
    expect(body.gaps).toEqual([]);
  });

  it("pagination bornée, sur les mêmes totaux", async () => {
    await changesScenario();
    const page = await (await get("/api/v1/tariff/changes?from=2026-09-28&to=2026-10-05&limit=2&offset=1")).json();
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(1);
    expect(page.total).toBe(4);
    expect(page.changes.map((c: { hs8: string }) => c.hs8)).toEqual(["10000002", "10000003"]);
    for (const [query, error] of [["limit=0", "invalid_limit"], ["limit=1001", "invalid_limit"], ["limit=abc", "invalid_limit"], ["offset=-1", "invalid_offset"]] as const) {
      const res = await get(`/api/v1/tariff/changes?from=2026-09-28&to=2026-10-05&${query}`);
      expect(res.status, query).toBe(400);
      expect((await res.json()).error, query).toBe(error);
    }
  });

  it("deux dates sur la même version : aucun changement, et il le dit", async () => {
    await changesScenario();
    const body = await (await get("/api/v1/tariff/changes?from=2026-09-29&to=2026-10-02")).json();
    expect(body.same_version).toBe(true);
    expect(body.total).toBe(0);
    expect(body.changes).toEqual([]);
  });

  it("dates invalides, plage inversée, début avant la première archive", async () => {
    await changesScenario();
    for (const [query, status, error] of [
      ["from=2026-10-01", 400, "invalid_date"],
      ["to=2026-10-01", 400, "invalid_date"],
      ["from=2026-02-30&to=2026-10-01", 400, "invalid_date"],
      ["from=2026-10-05&to=2026-10-01", 400, "invalid_range"],
      ["from=2026-09-01&to=2026-10-01", 404, "no_archive_for_date"],
    ] as const) {
      const res = await get(`/api/v1/tariff/changes?${query}`);
      expect(res.status, query).toBe(status);
      expect((await res.json()).error, query).toBe(error);
    }
  });

  it("la fin après la dernière archive garde la dernière version ; les trous de la période sont listés", async () => {
    await threeVersions();
    const body = await (await get("/api/v1/tariff/changes?from=2026-09-28&to=2026-12-01")).json();
    expect(body.to.version).toBe("2026.10.19");
    expect(body.gaps.map((g: { after: { version: string }; days_without_archive: number }) => [g.after.version, g.days_without_archive])).toEqual([["2026.10.05", 14], ["2026.10.19", 43]]);
    expect(body.totals.rates_changed).toBe(1);
  });
});

describe("lecture seule et disponibilité", () => {
  it("tant que le chargement n'est pas fini : 503 sans réponse partielle ni mise en cache", async () => {
    await publish("2026.09.28", [{ hs8: CODE }]);
    for (const path of [`/api/v1/tariff/${CODE}/at?date=2026-10-01`, "/api/v1/tariff/changes?from=2026-09-28&to=2026-10-01"]) {
      const res = await get(path);
      expect(res.status, path).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body.error).toBe("tariff_history_unavailable");
      expect(body.disclaimer).toBe(DISCLAIMERS.en);
    }
    expect(download).not.toHaveBeenCalled();
  });

  it("une requête ne télécharge rien et n'écrit ni version ni jeu ; les écritures n'existent pas", async () => {
    await threeVersions();
    const db = getDb();
    const count = () => db.prepare("SELECT (SELECT count(*) FROM versions) + (SELECT count(*) FROM datasets) + (SELECT count(*) FROM dataset_snapshots) AS n").get();
    const before = count();
    const calls = download.mock.calls.length;
    for (const path of [`/api/v1/tariff/${CODE}/at?date=2026-10-01`, "/api/v1/tariff/changes?from=2026-09-28&to=2026-10-19"]) {
      expect((await get(path)).status).toBe(200);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = await createApp().request(path, { method, headers: { "x-real-ip": "192.0.2.88" } });
        expect(res.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
        expect(res.status, `${method} ${path}`).toBeLessThan(500);
      }
    }
    expect(download.mock.calls.length).toBe(calls);
    expect(count()).toEqual(before);
  });

  it("la mesure ne garde que le type de route, jamais le texte libre de l'appelant, même sur un 404", async () => {
    await threeVersions();
    const paths = [
      "/api/v1/tariff/texte-libre-appelant/at?date=2026-10-01",
      `/api/v1/tariff/${CODE}/at?date=2026-10-01`,
      `/api/v1/tariff/${CODE}/at/`,
      `/api/v1/tariff/${CODE}`,
      `/api/v1/tariff/${CODE}/`,
      `/api/v1/tariff/${CODE}/texte-libre-appelant`,
      "/api/v1/tariff/changes?from=2026-09-28&to=2026-10-19",
    ];
    for (const path of paths) await get(path);
    await new Promise((resolve) => setImmediate(resolve));
    const names = (getDb().prepare("SELECT name FROM events WHERE kind='api_request'").all() as { name: string }[]).map((row) => row.name);
    expect(names).toHaveLength(paths.length);
    expect(names.filter((name) => name === "/api/v1/tariff/:code")).toHaveLength(paths.length - 1);
    expect(names).toContain("/api/v1/tariff/changes");
    expect(names.join(" ")).not.toContain("texte-libre-appelant");
    expect(names.join(" ")).not.toContain(CODE);
  });

  it("partage le plafond réseau des autres routes de données", async () => {
    await threeVersions();
    const first = await get(`/api/v1/tariff/${CODE}/at?date=2026-10-01`);
    const second = await get("/api/v1/tariff/changes?from=2026-09-28&to=2026-10-19");
    expect(Number(second.headers.get("x-ratelimit-remaining"))).toBe(Number(first.headers.get("x-ratelimit-remaining")) - 1);
  });

  it("aucun prix ni promesse de conformité dans les réponses ; pas de nom d'objet R2", async () => {
    await threeVersions();
    for (const path of [`/api/v1/tariff/${CODE}/at?date=2026-10-01`, "/api/v1/tariff/changes?from=2026-09-28&to=2026-10-19"]) {
      const body = await (await get(path)).json();
      const text = JSON.stringify(body.notice) + JSON.stringify(body.archive ?? "") + JSON.stringify(body.gap ?? "");
      expect(text).not.toMatch(/\bofficial\b|\bprice\b|\bpurchase|\bbuy\b|complian|conformit|certif/i);
      expect(JSON.stringify(body)).not.toMatch(/tares\.zip|r2_key/);
    }
  });

  it("le démarrage enchaîne après la version courante, jamais en même temps qu'elle", async () => {
    await publish("2026.09.28", [{ hs8: CODE }]);
    getDb().prepare("UPDATE datasets SET current_version='2026.09.28' WHERE id='tares'").run();
    vi.useRealTimers();
    const key = "tares/2026.09.28/tares.zip";
    const bytes = objects.get(key);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    download.mockImplementationOnce(async () => { await gate; return bytes; });
    startTariffHistoryRefresh();
    startTariffHistoryRefresh();
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(download).toHaveBeenCalledOnce();
    expect(getTariffHistory()).toBeNull();
    release();
    await vi.waitFor(() => expect(getTariffHistory()).not.toBeNull());
    expect(download).toHaveBeenCalledTimes(2);
    expect(download.mock.calls.map(([called]) => called)).toEqual([key, key]);
  });
});

describe("fenêtre de versions gardées", () => {
  const nthVersion = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10).replace(/-/g, ".");
  const isoOf = (version: string) => version.replace(/\./g, "-");

  it("garde les 26 plus récentes, ne télécharge pas les autres, et l'oublie au fil des publications", { timeout: 60_000 }, async () => {
    expect(TARIFF_HISTORY_MAX_VERSIONS).toBe(26);
    const total = TARIFF_HISTORY_MAX_VERSIONS + 2;
    for (let n = 0; n < total; n += 1) await publish(nthVersion(n), [{ hs8: CODE, value: "4" }]);
    await refreshTariffHistory();

    const keys = download.mock.calls.map(([key]) => key as string);
    expect(keys).toHaveLength(TARIFF_HISTORY_MAX_VERSIONS);
    expect(keys[0]).toBe(`tares/${nthVersion(total - 1)}/tares.zip`);
    expect(keys).not.toContain(`tares/${nthVersion(0)}/tares.zip`);
    expect(keys).not.toContain(`tares/${nthVersion(1)}/tares.zip`);
    const body = await (await get(`/api/v1/tariff/${CODE}/at?date=${isoOf(nthVersion(2))}`)).json();
    expect(body.archive.version).toBe(nthVersion(2));
    expect(body.coverage).toMatchObject({ first_archive: { version: nthVersion(2) }, archives_served: TARIFF_HISTORY_MAX_VERSIONS });
    expect(body.notice.older_archives).toContain("only the most recent versions are kept");
    expect((await get(`/api/v1/tariff/${CODE}/at?date=${isoOf(nthVersion(1))}`)).status).toBe(404);

    // Une publication de plus : un seul téléchargement, la plus ancienne sort, les lignes identiques restent identiques.
    download.mockClear();
    const next = nthVersion(total);
    await publish(next, [{ hs8: CODE, value: "9" }]);
    await refreshTariffHistory();
    expect(download.mock.calls.map(([key]) => key)).toEqual([`tares/${next}/tares.zip`]);
    expect((await get(`/api/v1/tariff/${CODE}/at?date=${isoOf(nthVersion(2))}`)).status).toBe(404);
    const after = await (await get(`/api/v1/tariff/${CODE}/at?date=${isoOf(next)}`)).json();
    expect(after.coverage).toMatchObject({ first_archive: { version: nthVersion(3) }, archives_served: TARIFF_HISTORY_MAX_VERSIONS });
    const same = await (await get(`/api/v1/tariff/changes?from=${isoOf(nthVersion(3))}&to=${isoOf(nthVersion(total - 1))}`)).json();
    expect(same.total).toBe(0);
    const moved = await (await get(`/api/v1/tariff/changes?from=${isoOf(nthVersion(3))}&to=${isoOf(next)}`)).json();
    expect(moved.total).toBe(1);
    expect(moved.changes[0]).toMatchObject({ hs8: CODE, kind: "rates_changed", before: { duty_mfn: { value: 4 } }, after: { duty_mfn: { value: 9 } } });
    // Après l'oubli, une ligne déjà vue réutilise toujours le même objet : pas de faux changement.
    const last = nthVersion(total + 1);
    await publish(last, [{ hs8: CODE, value: "9" }]);
    await refreshTariffHistory();
    expect((await (await get(`/api/v1/tariff/changes?from=${isoOf(next)}&to=${isoOf(last)}`)).json()).total).toBe(0);
  });
});

describe("description publique", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("openapi.json décrit les deux routes, sans prix ni promesse", () => {
    const spec = JSON.parse(read("web/public/openapi.json")) as { paths: Record<string, { get: { summary: string; description: string; responses: Record<string, unknown> } }> };
    for (const path of ["/api/v1/tariff/{code}/at", "/api/v1/tariff/changes"]) {
      const route = spec.paths[path]?.get;
      expect(route, path).toBeDefined();
      expect(Object.keys(route.responses)).toEqual(expect.arrayContaining(["200", "400", "404", "429", "503"]));
      const text = `${route.summary} ${route.description}`;
      expect(text).toContain("Unofficial copy");
      expect(text).not.toMatch(/\bofficial\b|\bCHF\b|\bprice\b|\bpurchase|complian|conformit|certif|irreplicable|only source/i);
    }
  });

  it("llms.txt décrit les deux routes, sans prix, et garde la ligne des outils d'historique fermés", () => {
    const llms = read("web/public/llms.txt");
    const lines = llms.split("\n").filter((line) => line.includes("/api/v1/tariff/"));
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).not.toMatch(/\bofficial\b|\bCHF\b|\bprice\b|\bpurchase|complian|conformit|certif/i);
    expect(llms).toContain("All ten endpoints");
    expect(llms).toContain("belong to the Pro plan, which is closed to new subscribers");
  });
});
