/**
 * `GET /api/v1/datasets` et `GET /api/v1/datasets/:id` (tâche osd.jeux, piste G2 du plan
 * `2026-10-07-moteur-jeux-ouverts.md`).
 *
 * Fichier NEUF, à côté de `tests/routes/api-v1-cantons.test.ts` (même méthode :
 * `createApp().request(path, init)`, base SQLite jetable, chemin de PRODUCTION réel — le jeu de
 * démonstration `gr-finances-communes` est le vrai fichier produit par `npm run sync:datasets`,
 * jamais une fixture injectée pour les tests de route). Les cas d'attribution `terms_by` sont
 * couverts à part, sur des fonctions pures, par `tests/lib/dataset-query.test.ts` : le jeu réel
 * de ce dépôt est `terms_open`, donc cette forme ne peut pas être exercée ici sans écrire dans
 * `src/mcp/data` (interdit).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { _resetApiRateLimit } from "../../src/lib/api-rate-limit.js";
import { getDataset, getDatasetsIndex } from "../../src/mcp/data-loader.js";

function get(path: string, ip: string) {
  return createApp().request(path, { headers: { "x-real-ip": ip } });
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "osd-api-v1-datasets-"));
  vi.stubEnv("DATABASE_PATH", join(tmp, "test.sqlite"));
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "fictif");
  getDb();
  _resetApiRateLimit();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const DEMO_ID = "gr-finances-communes";

describe("GET /api/v1/datasets", () => {
  it("catalogue : au moins le jeu de démonstration, forme correcte, cache public", async () => {
    const res = await get("/api/v1/datasets", "198.51.100.10");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.json();
    expect(Array.isArray(body.datasets)).toBe(true);
    const demo = body.datasets.find((d: { id: string }) => d.id === DEMO_ID);
    expect(demo).toBeDefined();
    expect(demo).toMatchObject({ id: DEMO_ID, publisher: "Canton des Grisons", licence: "terms_open", attribution: null });
    expect(typeof demo.title).toBe("string");
    expect(typeof demo.source).toBe("string");
    expect(demo.edition).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(demo.rows).toBeGreaterThan(0);
    expect(demo.keys).toEqual(expect.arrayContaining(["commune_bfs", "year"]));
    const loaded = getDatasetsIndex();
    expect(body.datasets).toHaveLength(loaded?.datasets.length ?? 0);
  });
});

describe("GET /api/v1/datasets/:id", () => {
  it("id inconnu : 404", async () => {
    const res = await get("/api/v1/datasets/id-inconnu-du-tout", "198.51.100.11");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "dataset_not_found" });
  });

  it("sans filtre : toutes les lignes jusqu'à la limite par défaut (100), total = lignes du jeu", async () => {
    const res = await get(`/api/v1/datasets/${DEMO_ID}`, "198.51.100.12");
    expect(res.status).toBe(200);
    const body = await res.json();
    const loaded = getDataset(DEMO_ID);
    expect(body.total).toBe(loaded?.rows.length);
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
    expect(body.data).toHaveLength(100);
    expect(body.licence).toBe("terms_open");
    expect(body.attribution).toBeNull();
    expect(typeof body.source).toBe("string");
  });

  it("filtre par commune_bfs : seulement les lignes de cette commune", async () => {
    const loaded = getDataset(DEMO_ID);
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const someBfsId = loaded.rows[0].commune_bfs;
    const expectedCount = loaded.rows.filter((r) => r.commune_bfs === someBfsId).length;

    const res = await get(`/api/v1/datasets/${DEMO_ID}?commune_bfs=${someBfsId}&limit=1000`, "198.51.100.13");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(expectedCount);
    expect(body.data.every((r: { commune_bfs: string }) => r.commune_bfs === someBfsId)).toBe(true);
  });

  it("deux filtres combinés (commune_bfs + year)", async () => {
    const loaded = getDataset(DEMO_ID);
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const target = loaded.rows[0];
    const expectedCount = loaded.rows.filter((r) => r.commune_bfs === target.commune_bfs && r.year === target.year).length;

    const res = await get(`/api/v1/datasets/${DEMO_ID}?commune_bfs=${target.commune_bfs}&year=${target.year}&limit=1000`, "198.51.100.14");
    const body = await res.json();
    expect(body.total).toBe(expectedCount);
    expect(body.data.length).toBe(expectedCount);
  });

  it("pagination : limit et offset", async () => {
    const res1 = await get(`/api/v1/datasets/${DEMO_ID}?limit=5&offset=0`, "198.51.100.15");
    const res2 = await get(`/api/v1/datasets/${DEMO_ID}?limit=5&offset=5`, "198.51.100.15");
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.data).toHaveLength(5);
    expect(body2.data).toHaveLength(5);
    expect(body1.data).not.toEqual(body2.data);
  });

  it("limit au-delà de 1000 : 400", async () => {
    const res = await get(`/api/v1/datasets/${DEMO_ID}?limit=1001`, "198.51.100.16");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_limit" });
  });

  it("offset négatif : 400", async () => {
    const res = await get(`/api/v1/datasets/${DEMO_ID}?offset=-1`, "198.51.100.17");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_offset" });
  });

  it("clé de filtre inconnue de CE jeu (canton, que ce jeu n'a pas) : 400, jamais un filtre ignoré", async () => {
    const res = await get(`/api/v1/datasets/${DEMO_ID}?canton=ZH`, "198.51.100.18");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_filter_key:canton" });
  });

  it("valeur de filtre invalide pour sa clé : 400", async () => {
    const res = await get(`/api/v1/datasets/${DEMO_ID}?year=pas-une-annee`, "198.51.100.19");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_filter_value:year" });
  });
});

describe("GET /api/v1/datasets et /api/v1/datasets/:id : limite partagée avec les autres routes « données »", () => {
  it("600 requêtes sur /datasets consomment le même plafond que /localities (601e : 429)", async () => {
    let last!: Response;
    for (let i = 0; i < 600; i++) last = await get("/api/v1/datasets", "198.51.100.20");
    expect(last.status).toBe(200);
    const blocked = await get(`/api/v1/datasets/${DEMO_ID}`, "198.51.100.20");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    const blockedLocalities = await get("/api/v1/localities?postal_code=8400", "198.51.100.20");
    expect(blockedLocalities.status).toBe(429); // même compteur (DATA_LIMIT)
  }, 20_000);
});
