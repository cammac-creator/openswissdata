/**
 * API publique en lecture `/api/v1` (tâche osd.donnees, tâche B3 du plan
 * `2026-10-06-prospection-et-api.md`).
 *
 * `createApp().request(path, init)` (même méthode que `tests/routes/catalog.test.ts`) : pas de
 * serveur réel. `x-real-ip` + `RAILWAY_ENVIRONMENT_ID` simulent des réseaux distincts, comme
 * `tests/routes/checkout-limits.test.ts`. Aucune écriture, aucun appel réseau réel (le seul test
 * qui exerce `company_check` bout en bout simule `fetch`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { _resetApiRateLimit } from "../../src/lib/api-rate-limit.js";
import { getLocalities, getStreets, getFinmaVersion } from "../../src/mcp/data-loader.js";
import { nationalFinmaMatchingStats } from "../../src/lib/commune-profile.js";
import { PUBLIC_SOURCES } from "../../src/lib/public-sources.js";
import { getSource } from "../../etl/shared/sources/registry.js";

function get(path: string, ip: string, extra: Record<string, string> = {}) {
  return createApp().request(path, { headers: { "x-real-ip": ip, ...extra } });
}

// `trackApiRequest` (monté sur `/api/*` dans `createApp()`) écrit un événement dans SQLite à
// chaque requête : une base jetable, jamais celle de la copie de travail (même méthode que
// `tests/routes/catalog.test.ts`), sinon des centaines de requêtes de rate-limit créeraient
// `data/openswissdata.sqlite` dans le dépôt.
let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "osd-api-v1-"));
  vi.stubEnv("DATABASE_PATH", join(tmp, "test.sqlite"));
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "fictif");
  getDb(); // force la création dans le dossier temporaire avant la première requête
  _resetApiRateLimit();
});
afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("GET /api/v1/company/:uid", () => {
  it("IDE invalide : 400, aucun corps brut, no-store", async () => {
    const res = await get("/api/v1/company/not-a-uid", "192.0.2.10");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_uid" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("jamais l'IDE brut dans les mesures (trackApiRequest) : une entreprise individuelle désigne une personne physique", async () => {
    // Fetch simulé (jamais de réseau réel en test) : peu importe ici que LINDAS/GLEIF répondent,
    // seul le nom enregistré par la mesure est vérifié.
    vi.stubGlobal("fetch", async () => { throw new Error("réseau indisponible en test"); });
    const res = await get("/api/v1/company/CHE-103.137.179", "192.0.2.14");
    expect(res.status).toBe(200); // IDE valide : fiche servie, sources marquées indisponibles
    await new Promise((r) => setImmediate(r));
    const rows = getDb().prepare("SELECT name FROM events WHERE kind='api_request'").all() as { name: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.name).not.toContain("CHE-103.137.179");
      if (row.name.startsWith("/api/v1/company")) expect(row.name).toBe("/api/v1/company/:uid");
    }
    vi.unstubAllGlobals();
  });

  it("IDE valide, fiche réelle (LINDAS/GLEIF simulés, FINMA et répertoires embarqués) : même forme que structuredContent du MCP", async () => {
    const lindas = JSON.parse(readFileSync(new URL("../fixtures/company/lindas-axa-leben.json", import.meta.url), "utf8"));
    const gleif = JSON.parse(readFileSync(new URL("../fixtures/company/gleif-axa-leben.json", import.meta.url), "utf8"));
    vi.stubGlobal("fetch", async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      const body = href.includes("gleif.org") ? gleif : lindas;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    const res = await get("/api/v1/company/CHE-103.137.179", "192.0.2.11");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uid).toBe("CHE-103.137.179");
    expect(Object.keys(body).sort()).toEqual(
      ["uid", "generated_at", "commercial_register", "finma", "lei", "cross_checks", "address_checks", "address_checks_edition", "not_covered", "notice", "sources"].sort(),
    );
    // La fiche elle-même reste identique à `structuredContent` du MCP : chaque fait garde son
    // propre `source_id`/`source_url` ; `sources` n'est ajoutée qu'À CÔTÉ, jamais à l'intérieur.
    expect(body.commercial_register.facts[0]).toHaveProperty("source_id");
    expect(body.commercial_register.facts[0]).toHaveProperty("source_url");
    expect(body.sources).toHaveLength(5);
    expect(body.sources.map((s: { id: string }) => s.id).sort()).toEqual(
      ["ofrc.zefix_lindas", "finma.uid_csv", "gleif.lei_api", "swisstopo.localities", "swisstopo.streets"].sort(),
    );
    for (const s of body.sources) {
      expect(s).toHaveProperty("url");
      expect(s).toHaveProperty("licence");
    }
    vi.unstubAllGlobals();
  });

  it("limite 60 par heure et par réseau : la 61e requête rend 429 avec Retry-After, les 60 premières sont servies", async () => {
    let last!: Response;
    for (let i = 0; i < 61; i++) last = await get("/api/v1/company/not-a-uid", "192.0.2.12");
    expect(last.status).toBe(429);
    expect(await last.json()).toEqual({ error: "rate_limited" });
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(last.headers.get("x-ratelimit-limit")).toBe("60");
    expect(last.headers.get("x-ratelimit-remaining")).toBe("0");
    // Un autre réseau n'est pas affecté par l'épuisement du premier.
    const other = await get("/api/v1/company/not-a-uid", "192.0.2.13");
    expect(other.status).toBe(400);
  });
});

describe("GET /api/v1/localities", () => {
  it("ni postal_code ni municipality_bfs_id : 400", async () => {
    const res = await get("/api/v1/localities", "192.0.2.20");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_query" });
  });

  it("les deux paramètres à la fois : 400 (un seul attendu)", async () => {
    const res = await get("/api/v1/localities?postal_code=8400&municipality_bfs_id=230", "192.0.2.21");
    expect(res.status).toBe(400);
  });

  it("postal_code=8400 : lignes du répertoire réel, édition, source, cache public", async () => {
    const res = await get("/api/v1/localities?postal_code=8400", "192.0.2.22");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.json();
    expect(body.rows.some((r: { municipality: string }) => r.municipality === "Winterthur")).toBe(true);
    const loaded = getLocalities();
    expect(body.edition).toBe(loaded?.edition ?? null);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].id).toBe("swisstopo.localities");
    expect(body.sources[0]).toHaveProperty("url");
    expect(body.sources[0]).toHaveProperty("licence");
  });

  it("municipality_bfs_id=230 : lignes filtrées par numéro OFS de commune", async () => {
    const res = await get("/api/v1/localities?municipality_bfs_id=230", "192.0.2.23");
    const body = await res.json();
    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) expect(row.municipality_bfs_id).toBe("230");
  });

  it("NPA inconnu : 200, tableau vide (un fait, jamais une erreur)", async () => {
    const res = await get("/api/v1/localities?postal_code=0000", "192.0.2.24");
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toEqual([]);
  });
});

describe("GET /api/v1/communes/:bfs_id", () => {
  it("numéro OFS non numérique : 400", async () => {
    const res = await get("/api/v1/communes/abc", "192.0.2.30");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_bfs_id" });
  });

  it("Winterthur (230) : profil complet, cache public, sources en objets", async () => {
    const res = await get("/api/v1/communes/230", "192.0.2.31");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.json();
    expect(body.bfs_id).toBe("230");
    expect(body.name).toBe("Winterthur");
    expect(body.canton).toBe("ZH");
    expect(body.postal_codes).toContain("8400");
    expect(typeof body.streets_count).toBe("number");
    expect(body.streets_count).toBeGreaterThan(0);
    expect(body.finma.matching).toBe("exact city+canton, unique");
    expect(typeof body.finma.authorised_entities).toBe("number");
    // Rattachement national (même registre, même index) : présent sur chaque commune, pour
    // comprendre un `authorised_entities` bas (la majorité des lignes FINMA n'a aujourd'hui
    // aucun canton connu — voir le rapport de la tâche).
    expect(body.finma.national_matching).toEqual(nationalFinmaMatchingStats());
    expect(Array.isArray(body.sources)).toBe(true);
    for (const s of body.sources) {
      expect(s).toHaveProperty("id");
      expect(s).toHaveProperty("institution");
      expect(s).toHaveProperty("url");
      expect(s).toHaveProperty("licence");
    }
    const localitiesLoaded = getLocalities();
    const streetsLoaded = getStreets();
    expect(body.editions.localities).toBe(localitiesLoaded?.edition ?? null);
    expect(body.editions.streets).toBe(streetsLoaded?.edition ?? null);
    expect(body.notice.length).toBeGreaterThan(0);
  });

  it("commune inconnue des répertoires réels : 404", async () => {
    const res = await get("/api/v1/communes/9999999", "192.0.2.32");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "commune_not_found" });
  });
});

describe("GET /api/v1/sources", () => {
  it("liste toutes les sources publiques, cache public, sans jamais la référence TARES en clair", async () => {
    const res = await get("/api/v1/sources", "192.0.2.40");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.json();
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.sources.length).toBe(PUBLIC_SOURCES.length);
    const byId = Object.fromEntries(body.sources.map((s: { id: string }) => [s.id, s]));
    for (const id of ["tares.tariff_8_digit", "tares.tarifstruktur", "tares.duty_rates_01_30", "tares.duty_rates_31_63", "tares.duty_rates_64_83", "tares.duty_rates_84_97", "tares.customs_facilities"]) {
      expect(byId[id].licence).toBe("see the provenance file of the archive");
      expect(JSON.stringify(byId[id])).not.toContain("MICHAEL");
      expect(JSON.stringify(byId[id])).not.toContain("BAZG-PERMISSION");
    }
    expect(byId["finma.uid_csv"].licence).toEqual({
      reference: "PUBLIC-OFFICIAL-SOURCE-FINMA",
      authority: "FINMA (Swiss Financial Market Supervisory Authority)",
      jurisdiction: "Switzerland (re-publication of FINMA public registry)",
    });
    expect(byId["finma.uid_csv"].edition).toBe(getFinmaVersion());
    const localitiesLoaded = getLocalities();
    const streetsLoaded = getStreets();
    expect(byId["swisstopo.localities"].edition).toBe(localitiesLoaded?.edition ?? null);
    expect(byId["swisstopo.streets"].edition).toBe(streetsLoaded?.edition ?? null);
    expect(byId["swisstopo.localities"].url).toContain("data.geo.admin.ch");
  });

  it("limite partagée de 600 par heure et par réseau avec les autres routes « données » : la 601e requête rend 429", async () => {
    let last!: Response;
    for (let i = 0; i < 600; i++) last = await get("/api/v1/sources", "192.0.2.41");
    expect(last.status).toBe(200);
    const blocked = await get("/api/v1/localities?postal_code=8400", "192.0.2.41");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  }, 20_000);
});

describe("API publique en lecture seule : aucune route n'écrit", () => {
  const paths = ["/api/v1/company/CHE-103.137.179", "/api/v1/localities?postal_code=8400", "/api/v1/communes/230", "/api/v1/sources"];
  it.each(paths.flatMap((path) => ["POST", "PUT", "DELETE", "PATCH"].map((method) => [path, method] as const)))(
    "%s %s : jamais 2xx (seul GET est monté)",
    async (path, method) => {
      const res = await createApp().request(path, { method, headers: { "x-real-ip": "192.0.2.50" } });
      expect(res.status < 200 || res.status >= 300).toBe(true);
    },
  );
});

// `src/` ne peut pas importer `etl/` (voir `src/lib/public-sources.ts`) : ce test, hors de la
// frontière tsc, est le garde-fou contre un écart silencieux entre la copie locale de l'API
// publique et le registre unique des sources (même principe que
// `tests/mcp/company-sources-registry.test.ts` pour `COMPANY_SOURCES`).
describe("PUBLIC_SOURCES reste identique au registre unique des sources", () => {
  it.each(PUBLIC_SOURCES.map((s) => s.id))("%s : adresse identique au registre", (id) => {
    expect(PUBLIC_SOURCES.find((s) => s.id === id)?.url).toBe(getSource(id).url);
  });

  it.each(PUBLIC_SOURCES.filter((s) => typeof s.licence === "object").map((s) => s.id))(
    "%s : licence (hors TARES) identique au registre (référence, autorité, juridiction)",
    (id) => {
      const source = getSource(id);
      const licence = PUBLIC_SOURCES.find((s) => s.id === id)?.licence;
      expect(licence).toEqual({ reference: source.licence.reference, authority: source.licence.authority, jurisdiction: source.licence.jurisdiction });
    },
  );

  it("aucune entrée TARES ne porte la référence de permission en clair (nom de personne)", () => {
    for (const s of PUBLIC_SOURCES.filter((s) => s.id.startsWith("tares."))) {
      expect(s.licence).toBe("see the provenance file of the archive");
      expect(JSON.stringify(s)).not.toMatch(/BAZG-PERMISSION|MICHAEL/);
    }
  });
});
