// Limite de pagination du catalogue (19.11.2026) : depuis la mi-octobre, opendata.swiss refuse
// toute page `package_search` dont `start` atteint 10 000 (HTTP 429, « Pagination limit exceeded
// to protect cluster memory »), quel que soit le rythme des appels. Quatre passages sur cinq sont
// restés à zéro page lue (19.10, 26.10, 09.11, 16.11). Ces tests fixent la lecture de la fin du
// catalogue par tranche de dates (`fq=metadata_created:[borne TO *]`), sans jamais demander un
// rang refusé, sur un catalogue simulé qui applique la même limite.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CKAN_MAX_START,
  CKAN_WHOLE_CATALOGUE,
  type CkanPackage,
  type CkanSearchResult,
  fetchCkanPageWithRetry,
  prospectSources,
  resolveCkanWindow,
  solrDateFloor,
} from "../../scripts/prospect-sources.js";

const noOp = async (): Promise<void> => {};

/** Catalogue simulé : `total` jeux triés par date de création, plusieurs par seconde (un pas de
 *  400 ms), avec des microsecondes comme CKAN. Applique la limite réelle : `start >= 10000` → 429. */
function catalogueProfond(total: number, opts: { sansDate?: boolean } = {}) {
  const base = Date.UTC(2020, 0, 1);
  const creeLe = (i: number) => base + i * 400;
  const jeux: CkanPackage[] = Array.from({ length: total }, (_, i) => ({
    id: `id-${i}`,
    name: `jeu-${i}`,
    ...(opts.sansDate ? {} : { metadata_created: `${new Date(creeLe(i)).toISOString().slice(0, -1)}456` }),
  }));
  const appels: Array<{ start: number; rows: number; fq: string | null }> = [];
  const servis: string[][] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("package_search")) throw new Error(`appel réseau inattendu dans un test : ${url}`);
    const start = Number(url.searchParams.get("start"));
    const rows = Number(url.searchParams.get("rows"));
    const fq = url.searchParams.get("fq");
    appels.push({ start, rows, fq });
    if (url.searchParams.get("sort") !== "metadata_created asc") throw new Error("tri inattendu");
    if (start >= 10_000) return new Response("Pagination limit exceeded to protect cluster memory", { status: 429 });
    let debut = 0;
    if (fq !== null) {
      const m = /^metadata_created:\[(\S+) TO \*\]$/.exec(fq);
      if (!m) throw new Error(`filtre inattendu : ${fq}`);
      const borne = Date.parse(m[1]!);
      if (Number.isNaN(borne)) throw new Error(`borne illisible : ${m[1]}`);
      debut = jeux.findIndex((_, i) => creeLe(i) >= borne);
      if (debut < 0) debut = total;
    }
    const page = jeux.slice(debut + start, debut + start + rows);
    if (rows > 0) servis.push(page.map((p) => p.id));
    const result: CkanSearchResult = { count: total - debut, results: page };
    return new Response(JSON.stringify({ success: true, result }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const lirePage = (start: number, rows: number, fq: string | null) =>
    fetchCkanPageWithRetry(fetchImpl, "essai", start, rows, 1000, 0, noOp, fq);
  return { fetchImpl, appels, servis, lirePage };
}

const rangs = (debut: number, n: number) => Array.from({ length: n }, (_, i) => `id-${debut + i}`);

describe("solrDateFloor — borne de date acceptée par le catalogue", () => {
  it("arrondit à la seconde inférieure et ajoute Z", () => {
    expect(solrDateFloor("2026-03-27T02:42:14.617903")).toBe("2026-03-27T02:42:14Z");
    expect(solrDateFloor("2026-03-27T02:42:14")).toBe("2026-03-27T02:42:14Z");
  });
  it("refuse une valeur absente ou illisible", () => {
    expect(solrDateFloor(undefined)).toBeNull();
    expect(solrDateFloor(null)).toBeNull();
    expect(solrDateFloor("hier")).toBeNull();
  });
});

describe("resolveCkanWindow — tranche de dates pour un rang au-delà de la limite", () => {
  it("garde le catalogue entier tant que le rang est sous la limite", async () => {
    const { lirePage, appels } = catalogueProfond(12_000);
    expect(await resolveCkanWindow(lirePage, CKAN_WHOLE_CATALOGUE, CKAN_MAX_START - 100)).toEqual(CKAN_WHOLE_CATALOGUE);
    expect(appels).toHaveLength(0);
  });

  it("rend une tranche dont le rang relatif désigne exactement les mêmes jeux", async () => {
    const { lirePage, appels } = catalogueProfond(12_000);
    const tranche = await resolveCkanWindow(lirePage, CKAN_WHOLE_CATALOGUE, 11_500);
    expect(tranche).not.toBeNull();
    expect(tranche!.fq).toMatch(/^metadata_created:\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z TO \*\]$/);
    const page = await lirePage(11_500 - tranche!.offset, 5, tranche!.fq);
    expect(page!.results.map((p) => p.id)).toEqual(rangs(11_500, 5));
    expect(appels.every((a) => a.start < CKAN_MAX_START)).toBe(true);
  });

  it("enchaîne plusieurs tranches quand le catalogue dépasse deux fois la limite", async () => {
    const { lirePage, appels } = catalogueProfond(25_000);
    const tranche = await resolveCkanWindow(lirePage, CKAN_WHOLE_CATALOGUE, 23_000);
    const page = await lirePage(23_000 - tranche!.offset, 5, tranche!.fq);
    expect(page!.results.map((p) => p.id)).toEqual(rangs(23_000, 5));
    expect(appels.every((a) => a.start < CKAN_MAX_START)).toBe(true);
  });

  it("repart d'une tranche déjà connue sans la recalculer", async () => {
    const { lirePage, appels } = catalogueProfond(12_000);
    const tranche = await resolveCkanWindow(lirePage, CKAN_WHOLE_CATALOGUE, 10_000);
    const avant = appels.length;
    expect(await resolveCkanWindow(lirePage, tranche!, 11_900)).toEqual(tranche);
    expect(appels).toHaveLength(avant);
  });

  it("rend null, sans boucler, si le jeu repère n'a pas de date de création", async () => {
    const { lirePage, appels } = catalogueProfond(12_000, { sansDate: true });
    expect(await resolveCkanWindow(lirePage, CKAN_WHOLE_CATALOGUE, 11_000)).toBeNull();
    expect(appels).toHaveLength(1);
  });
});

describe("prospectSources — fenêtre tournante au-delà du 10 000e jeu", () => {
  const dossiers: string[] = [];
  afterEach(() => { for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true }); });

  async function passage(total: number, nowMs: number, opts: { sansDate?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "prospect-profondeur-"));
    dossiers.push(dir);
    const catalogue = catalogueProfond(total, opts);
    const { report } = await prospectSources({
      fetchImpl: catalogue.fetchImpl,
      sleepImpl: noOp,
      maxPages: 2,
      pageSize: 100,
      outJsonPath: join(dir, "prospection.json"),
      outMdPath: join(dir, "prospection.md"),
      outStatePath: join(dir, "prospection-state.json"),
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => nowMs,
    });
    return { report, ...catalogue };
  }

  // Semaine ISO 50 de 2026, 120 pages, pas de 2 : page de départ (50 × 2) mod 120 = 100, soit le
  // rang 10 000, exactement le premier rang refusé.
  const SEMAINE_50 = Date.UTC(2026, 11, 9);

  it("lit les deux pages visées, dans l'ordre, sans jamais demander un rang refusé", async () => {
    const { report, appels, servis } = await passage(12_000, SEMAINE_50);
    expect(report.run.start_page).toBe(100);
    expect(report.run.partial).toBe(false);
    expect(report.run.stopped_reason).toBe("ok");
    expect(report.run.pages_read).toBe(2);
    expect(report.run.datasets_read).toBe(200);
    expect(servis.filter((p) => p.length === 100)).toEqual([rangs(10_000, 100), rangs(10_100, 100)]);
    expect(appels.every((a) => a.start < CKAN_MAX_START)).toBe(true);
  });

  it("revient au catalogue entier quand la rotation boucle sur le début", async () => {
    // 10 050 jeux, 101 pages ; semaine 50 : page de départ (50 × 2) mod 101 = 100, puis page 0.
    const { report, servis, appels } = await passage(10_050, SEMAINE_50);
    expect(report.run.start_page).toBe(100);
    expect(report.run.partial).toBe(false);
    expect(servis.filter((p) => p.length >= 50)).toEqual([rangs(10_000, 50), rangs(0, 100)]);
    expect(appels.at(-1)).toEqual({ start: 0, rows: 100, fq: null });
  });

  it("s'arrête en passage partiel si la tranche ne peut pas être établie", async () => {
    const { report } = await passage(12_000, SEMAINE_50, { sansDate: true });
    expect(report.run.partial).toBe(true);
    expect(report.run.stopped_reason).toBe("page_failed");
    expect(report.run.pages_read).toBe(0);
  });
});
