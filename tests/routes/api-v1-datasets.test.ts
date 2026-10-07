/**
 * `GET /api/v1/datasets`, `GET /api/v1/datasets/:id` et le champ `dataset_sources` de
 * `GET /api/v1/sources` (tâche osd.jeux, piste G2 du plan `2026-10-07-moteur-jeux-ouverts.md`).
 *
 * Relecture adverse du 07.10.2026 (avant le lot de 36 jeux) : les cas DÉTAILLÉS (filtres,
 * pagination, 404, attribution `terms_by`) passent sur un dossier de jeux TEMPORAIRE, fabriqué en
 * test et injecté par `_setDatasetsDirForTest()` (`src/mcp/data-loader.ts`) — la VRAIE route Hono
 * (`createApp().request(...)`, aucune dépendance Hono mockée), mais jamais le vrai dossier
 * `src/mcp/data/datasets` : le catalogue réel change de forme à chaque lot d'approbations, et
 * dépendre de son contenu exact (un id, une clé précise, une licence) aurait rendu ces tests
 * fragiles sans rien prouver de plus. Un seul bloc « production réelle », à la fin, vérifie la
 * FORME de la route sur le vrai dépôt, sans fixer aucun id.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { vi } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { _resetApiRateLimit } from "../../src/lib/api-rate-limit.js";
import { _resetDataLoaderCache, _setDatasetsDirForTest, getDatasetsIndex, type DatasetIndexEntry } from "../../src/mcp/data-loader.js";

function get(path: string, ip: string) {
  return createApp().request(path, { headers: { "x-real-ip": ip } });
}

// --------------------------------------------------------------------------------------------
// Deux jeux fabriqués : l'un à clés commune_bfs/year (terms_open, comme le cas le plus courant),
// l'autre à clé canton ET licence terms_by (pour exercer l'attribution, impossible à couvrir au
// niveau route avec le seul jeu réel de ce dépôt, qui est terms_open).
// --------------------------------------------------------------------------------------------
const COMMUNE_DATASET: DatasetIndexEntry = {
  id: "jeu-test-communes",
  title: "Jeu de test (communes)",
  publisher: "Éditeur de test",
  licence: "terms_open",
  attribution: "",
  resource_url: "https://example.ch/communes.csv",
  columns: ["year", "commune_bfs", "name", "betrag"],
  keys: ["commune_bfs", "year"],
  rows: 4,
  edition: "2026-10-07",
};
const COMMUNE_CSV = [
  "year,commune_bfs,name,betrag",
  "2024,230,Alpha,10",
  "2024,230,Beta,20",
  "2023,230,Gamma,30",
  "2024,999,Delta,40",
].join("\n") + "\n";

const CANTON_DATASET: DatasetIndexEntry = {
  id: "jeu-test-attribution",
  title: "Jeu de test (attribution terms_by)",
  publisher: "Office de test",
  licence: "terms_by",
  attribution: "Office de test, données sous licence terms_by",
  resource_url: "https://example.ch/canton.csv",
  columns: ["year", "canton", "valeur"],
  keys: ["canton", "year"],
  rows: 2,
  edition: "2026-10-06",
};
const CANTON_CSV = ["year,canton,valeur", "2024,GR,1", "2024,ZH,2"].join("\n") + "\n";

let tmp: string;
let datasetsDir: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "osd-api-v1-datasets-"));
  vi.stubEnv("DATABASE_PATH", join(tmp, "test.sqlite"));
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "fictif");
  getDb();
  _resetApiRateLimit();

  datasetsDir = mkdtempSync(join(tmpdir(), "osd-datasets-fixture-"));
  writeFileSync(join(datasetsDir, "index.json"), JSON.stringify({ datasets: [COMMUNE_DATASET, CANTON_DATASET] }, null, 2));
  writeFileSync(join(datasetsDir, `${COMMUNE_DATASET.id}.csv.gz`), gzipSync(Buffer.from(COMMUNE_CSV, "utf8")));
  writeFileSync(join(datasetsDir, `${CANTON_DATASET.id}.csv.gz`), gzipSync(Buffer.from(CANTON_CSV, "utf8")));
  _setDatasetsDirForTest(datasetsDir);
  _resetDataLoaderCache();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
  _setDatasetsDirForTest(null);
  _resetDataLoaderCache();
  rmSync(datasetsDir, { recursive: true, force: true });
});

describe("GET /api/v1/datasets", () => {
  it("catalogue : les deux jeux fabriqués, forme correcte, cache public", async () => {
    const res = await get("/api/v1/datasets", "198.51.100.10");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.json();
    expect(body.datasets).toHaveLength(2);

    const commune = body.datasets.find((d: { id: string }) => d.id === COMMUNE_DATASET.id);
    expect(commune).toMatchObject({ id: COMMUNE_DATASET.id, publisher: "Éditeur de test", licence: "terms_open", attribution: null, rows: 4 });
    expect(commune.filters).toEqual(expect.arrayContaining(["commune_bfs", "year"]));

    const canton = body.datasets.find((d: { id: string }) => d.id === CANTON_DATASET.id);
    expect(canton).toMatchObject({ id: CANTON_DATASET.id, licence: "terms_by", attribution: "Office de test, données sous licence terms_by" });
    expect(canton.filters).toEqual(expect.arrayContaining(["canton"]));
  });
});

describe("GET /api/v1/datasets/:id", () => {
  it("id inconnu : 404", async () => {
    const res = await get("/api/v1/datasets/id-inconnu-du-tout", "198.51.100.11");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "dataset_not_found" });
  });

  it("sans filtre : toutes les lignes, total = lignes du jeu, filters exposés", async () => {
    const res = await get(`/api/v1/datasets/${COMMUNE_DATASET.id}`, "198.51.100.12");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(4);
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
    expect(body.data).toHaveLength(4);
    expect(body.licence).toBe("terms_open");
    expect(body.attribution).toBeNull();
    expect(body.filters).toEqual(expect.arrayContaining(["commune_bfs", "year"]));
  });

  it("licence terms_by : attribution présente dans la réponse", async () => {
    const res = await get(`/api/v1/datasets/${CANTON_DATASET.id}`, "198.51.100.121");
    const body = await res.json();
    expect(body.licence).toBe("terms_by");
    expect(body.attribution).toBe("Office de test, données sous licence terms_by");
  });

  it("filtre par commune_bfs : seulement les lignes de cette commune", async () => {
    const res = await get(`/api/v1/datasets/${COMMUNE_DATASET.id}?commune_bfs=230`, "198.51.100.13");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.data.every((r: { commune_bfs: string }) => r.commune_bfs === "230")).toBe(true);
  });

  it("deux filtres combinés (commune_bfs + year)", async () => {
    const res = await get(`/api/v1/datasets/${COMMUNE_DATASET.id}?commune_bfs=230&year=2024`, "198.51.100.14");
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.data.map((r: { name: string }) => r.name).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("pagination : limit et offset", async () => {
    const res1 = await get(`/api/v1/datasets/${COMMUNE_DATASET.id}?limit=2&offset=0`, "198.51.100.15");
    const res2 = await get(`/api/v1/datasets/${COMMUNE_DATASET.id}?limit=2&offset=2`, "198.51.100.15");
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.data).toHaveLength(2);
    expect(body2.data).toHaveLength(2);
    expect(body1.data).not.toEqual(body2.data);
    expect(body1.total).toBe(4);
  });

  it("offset au-delà de la fin : page vide, total inchangé", async () => {
    const res = await get(`/api/v1/datasets/${COMMUNE_DATASET.id}?offset=100`, "198.51.100.151");
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(4);
  });

  it("limit au-delà de 1000 : 400", async () => {
    const res = await get(`/api/v1/datasets/${COMMUNE_DATASET.id}?limit=1001`, "198.51.100.16");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_limit" });
  });

  it("offset négatif : 400", async () => {
    const res = await get(`/api/v1/datasets/${COMMUNE_DATASET.id}?offset=-1`, "198.51.100.17");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_offset" });
  });

  it("clé de filtre inconnue de CE jeu (canton, que ce jeu n'a pas) : 400, jamais un filtre ignoré", async () => {
    const res = await get(`/api/v1/datasets/${COMMUNE_DATASET.id}?canton=ZH`, "198.51.100.18");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_filter_key:canton" });
  });

  it("valeur de filtre invalide pour sa clé : 400", async () => {
    const res = await get(`/api/v1/datasets/${COMMUNE_DATASET.id}?year=pas-une-annee`, "198.51.100.19");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_filter_value:year" });
  });
});

describe("GET /api/v1/sources : dataset_sources dérivé du catalogue des jeux", () => {
  it("une entrée par jeu, jamais fusionnée dans `sources` (qui reste PUBLIC_SOURCES)", async () => {
    const res = await get("/api/v1/sources", "198.51.100.22");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.dataset_sources)).toBe(true);
    const byId = Object.fromEntries(body.dataset_sources.map((s: { id: string }) => [s.id, s]));
    expect(byId[COMMUNE_DATASET.id]).toMatchObject({ institution: "Éditeur de test", url: COMMUNE_DATASET.resource_url, licence: "terms_open" });
    expect(byId[CANTON_DATASET.id]).toMatchObject({ institution: "Office de test", licence: "terms_by" });
  });
});

describe("GET /api/v1/datasets et /api/v1/datasets/:id : limite partagée avec les autres routes « données »", () => {
  it("600 requêtes sur /datasets consomment le même plafond que /localities (601e : 429)", async () => {
    let last!: Response;
    for (let i = 0; i < 600; i++) last = await get("/api/v1/datasets", "198.51.100.20");
    expect(last.status).toBe(200);
    const blocked = await get(`/api/v1/datasets/${COMMUNE_DATASET.id}`, "198.51.100.20");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    const blockedLocalities = await get("/api/v1/localities?postal_code=8400", "198.51.100.20");
    expect(blockedLocalities.status).toBe(429); // même compteur (DATA_LIMIT)
  }, 20_000);
});

describe("GET /api/v1/datasets : production réelle (chemin de production, forme seulement)", () => {
  it("catalogue réel, jamais un id ou un compteur figés (le lot approuvé change de forme)", async () => {
    _setDatasetsDirForTest(null);
    _resetDataLoaderCache();
    const res = await get("/api/v1/datasets", "198.51.100.23");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.datasets)).toBe(true);
    const realIndex = getDatasetsIndex();
    expect(body.datasets).toHaveLength(realIndex?.datasets.length ?? 0);
    for (const d of body.datasets) {
      expect(typeof d.id).toBe("string");
      expect(Array.isArray(d.filters)).toBe(true);
      expect(d.rows).toBeGreaterThan(0);
    }
    if (body.datasets.length > 0) {
      // Appel réel de détail sur le premier jeu du catalogue, quel qu'il soit — forme seulement.
      const first = body.datasets[0];
      const detail = await get(`/api/v1/datasets/${first.id}`, "198.51.100.24");
      expect(detail.status).toBe(200);
      const detailBody = await detail.json();
      expect(detailBody.total).toBe(first.rows);
      expect(Array.isArray(detailBody.data)).toBe(true);
    }
  });
});
