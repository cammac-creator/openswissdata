/**
 * `/api/v1/cantons` et `/api/v1/cantons/:abbr` (tâche osd.donnees, tâche B5 du plan
 * `2026-10-06-prospection-et-api.md`).
 *
 * Fichier NEUF, à côté de `tests/routes/api-v1.test.ts` (déjà présent sur `origin/main`, jamais
 * modifié) : même méthode (`createApp().request(path, init)`, base SQLite jetable). Chemin de
 * PRODUCTION réel (aucun mock de `cantonProfile`) : seulement la FORME des champs, jamais une
 * valeur exacte fixée (la collecte annuelle OFEN et les collectes mensuelles changent les
 * fichiers combinés).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { _resetApiRateLimit } from "../../src/lib/api-rate-limit.js";
import { SWISS_CANTON_ABBREVIATIONS } from "../../src/lib/canton-profile.js";
import { getBfePv } from "../../src/mcp/data-loader.js";

function get(path: string, ip: string) {
  return createApp().request(path, { headers: { "x-real-ip": ip } });
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "osd-api-v1-cantons-"));
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

describe("GET /api/v1/cantons", () => {
  it("les 26 abréviations, ordre alphabétique, cache public", async () => {
    const res = await get("/api/v1/cantons", "203.0.113.70");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.json();
    expect(body.cantons).toEqual([...SWISS_CANTON_ABBREVIATIONS]);
    expect(body.cantons).toHaveLength(26);
    // Liste fixe, sans donnée sourcée : `sources` reste présent (Global Constraint « réponses
    // avec sources »), mais vide — jamais une provenance inventée pour une simple énumération.
    expect(body.sources).toEqual([]);
  });
});

describe("GET /api/v1/cantons/:abbr", () => {
  it("abréviation inconnue : 400", async () => {
    const res = await get("/api/v1/cantons/XX", "203.0.113.71");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_canton" });
  });

  it("casse insensible : \"zh\" accepté comme \"ZH\"", async () => {
    const res = await get("/api/v1/cantons/zh", "203.0.113.72");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.abbreviation).toBe("ZH");
  });

  it("ZH : profil complet, cache public, sources en objets, aucune valeur exacte fixée", async () => {
    const res = await get("/api/v1/cantons/ZH", "203.0.113.73");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.json();
    expect(body.abbreviation).toBe("ZH");
    expect(typeof body.communes_count).toBe("number");
    expect(typeof body.localities_count).toBe("number");
    expect(typeof body.streets_count).toBe("number");
    expect(typeof body.finma.seat_matching).toBe("string");
    // Siège exact FINMA (tâche B4), chemin de production réel (aucun mock) : leçon de la
    // relecture du 07.10.2026 — sans ce contrôle, un câblage cassé qui renverrait `null`
    // passerait inaperçu sur la vraie route HTTP.
    expect(typeof body.finma.entities_with_seat_in_canton).toBe("number");
    expect(typeof body.finma.distinct_entities_with_seat_in_canton).toBe("number");
    expect(typeof body.editions.finma_seats).toBe("string");
    expect("finma" in body.editions).toBe(true); // version FINMA (null ou texte, jamais absente)
    expect(Array.isArray(body.sources)).toBe(true);
    for (const s of body.sources) {
      expect(s).toHaveProperty("id");
      expect(s).toHaveProperty("institution");
      expect(s).toHaveProperty("url");
      expect(s).toHaveProperty("licence");
    }
    expect(body.sources.map((s: { id: string }) => s.id)).toContain("bfe.pv_one_time_remuneration");
    expect(body.sources.map((s: { id: string }) => s.id)).toContain("ofrc.zefix_lindas");
    expect(Array.isArray(body.pv.by_year)).toBe(true);
    expect(body.pv.by_year.length).toBeGreaterThan(0);
    for (const row of body.pv.by_year) {
      expect(typeof row.year).toBe("number");
    }
    expect(typeof body.pv.ratios_note).toBe("string");
    expect(typeof body.pv.scope_note).toBe("string");
    expect(typeof body.editions.bfe_pv).toBe("string");
    expect(body.notice.length).toBeGreaterThan(0);
  });

  it("édition de la source bfe.pv_one_time_remuneration dans /api/v1/sources identique à getBfePv().edition", async () => {
    const res = await get("/api/v1/sources", "203.0.113.77");
    expect(res.status).toBe(200);
    const body = await res.json();
    const bfe = body.sources.find((s: { id: string }) => s.id === "bfe.pv_one_time_remuneration");
    expect(bfe).toBeDefined();
    expect(bfe.edition).toBe(getBfePv()?.edition ?? null);
  });

  it("limite partagée de 600 par heure et par réseau avec les autres routes « données »", async () => {
    let last!: Response;
    for (let i = 0; i < 600; i++) last = await get("/api/v1/cantons", "203.0.113.74");
    expect(last.status).toBe(200);
    const blocked = await get("/api/v1/cantons/ZH", "203.0.113.74");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.headers.get("x-ratelimit-limit")).toBe("600");
  }, 20_000);

  it("une autre route de données partage le même plafond que /cantons", async () => {
    let last!: Response;
    for (let i = 0; i < 600; i++) last = await get("/api/v1/cantons/ZH", "203.0.113.75");
    expect(last.status).toBe(200);
    const blocked = await get("/api/v1/sources", "203.0.113.75");
    expect(blocked.status).toBe(429);
  }, 20_000);
});

describe("API publique en lecture seule : /cantons n'écrit jamais", () => {
  const paths = ["/api/v1/cantons", "/api/v1/cantons/ZH"];
  it.each(paths.flatMap((path) => ["POST", "PUT", "DELETE", "PATCH"].map((method) => [path, method] as const)))(
    "%s %s : jamais 2xx (seul GET est monté)",
    async (path, method) => {
      const res = await createApp().request(path, { method, headers: { "x-real-ip": "203.0.113.76" } });
      expect(res.status < 200 || res.status >= 300).toBe(true);
    },
  );
});
