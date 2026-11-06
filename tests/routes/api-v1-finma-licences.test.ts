/**
 * `/api/v1/finma/licences` : IDE et libellés de trois catégories, rien d'autre. Registre fictif
 * posé en mémoire, jamais de R2. Méthode de `tests/routes/api-v1-sanctions.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/index.js";
import { _resetApiRateLimit } from "../../src/lib/api-rate-limit.js";
import { closeDb, getDb } from "../../src/lib/db.js";
import { finmaCollectedOn, finmaLicenceRows } from "../../src/lib/finma-licences.js";
import { _resetDataLoaderCache, setFinmaRegistry, setFinmaVersion, setFinmaWarnings, type FinmaRegistryRow } from "../../src/mcp/data-loader.js";

const SECRET_NAME = "Banque Fictive du Test SA";
const SECRET_ADDRESS = "Rue Fictive 1";
const SECRET_LEI = "529900FICTIF000000X1";
const SECRET_WARNING = "Societe Fictive de la Liste";

function row(over: Partial<FinmaRegistryRow>): FinmaRegistryRow {
  return {
    entity_type: "bank",
    name: SECRET_NAME,
    uid: "CHE-111.111.111",
    lei: SECRET_LEI,
    licence_type: "Bank",
    licence_type_de: "Bank",
    licence_type_fr: "Banque",
    licence_type_it: "Banca",
    licence_date: "2020-01-01",
    status: "",
    canton: "VD",
    city: "Lausanne",
    address: SECRET_ADDRESS,
    source_list: "finma-uid-csv",
    source_url: "https://www.finma.ch/fiche-fictive",
    is_warning_listed: "true",
    ...over,
  };
}

const REGISTRY: FinmaRegistryRow[] = [
  row({ uid: "CHE-333.333.333", entity_type: "securities_firm", licence_type: "Securities firm", licence_type_de: "Wertpapierhaus", licence_type_fr: "Maison de titres", licence_type_it: "Società di intermediazione mobiliare" }),
  row({}),
  // Même IDE, autre autorisation : deux lignes.
  row({ licence_type: "Custodian bank", licence_type_de: "Depotbank", licence_type_fr: "Banque dépositaire", licence_type_it: "Banca depositaria" }),
  // Même IDE, même autorisation : une seule ligne.
  row({ city: "Vevey" }),
  row({ uid: "CHE-222.222.222", entity_type: "fintech", licence_type: "Persons under Article 1b of the Banking Act" }),
  // Catégories hors du flux.
  ...["asset_manager_individual", "asset_manager_collective", "supervisory_org", "insurance", "fund_representative", "infrastructure", "payment_institution", "insurance_intermediary", "other"].map((entity_type, i) => row({ entity_type, uid: `CHE-444.444.44${i}` })),
  // Sans IDE, ou IDE d'une autre forme : dehors.
  row({ uid: "" }),
  row({ uid: "CHE111111112" }),
  row({ uid: "CHE-111.111.112 MWST" }),
  // Sans autorisation lisible, ou statut renseigné autre qu'actif : dehors.
  row({ uid: "CHE-555.555.555", licence_type: "" }),
  row({ uid: "CHE-666.666.666", status: "withdrawn" }),
];

const get = (path = "/api/v1/finma/licences") => createApp().request(path, { headers: { "x-real-ip": "192.0.2.78" } });

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "osd-api-finma-licences-"));
  vi.stubEnv("DATABASE_PATH", join(tmp, "test.sqlite"));
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "fictif");
  getDb();
  _resetApiRateLimit();
  _resetDataLoaderCache();
});
afterEach(() => {
  _resetDataLoaderCache();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("GET /api/v1/finma/licences", () => {
  it("copie embarquée, sans version : 503, aucune ligne ni date", async () => {
    const res = await get();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.error).toBe("finma_licences_unavailable");
    expect(body.rows).toBeUndefined();
    expect(body.collected_on).toBeUndefined();
  });

  it("version sans date lisible : 503, jamais la date du jour", async () => {
    setFinmaRegistry(REGISTRY);
    setFinmaVersion("seed");
    const res = await get();
    expect(res.status).toBe(503);
    expect((await res.json()).collected_on).toBeUndefined();
  });

  it("collected_on vient de la copie servie, jamais du jour de l'appel", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-12-25T10:00:00Z"));
      setFinmaRegistry(REGISTRY);
      setFinmaVersion("2026.11.04");
      const body = await (await get()).json();
      expect(body.version).toBe("2026.11.04");
      expect(body.collected_on).toBe("2026-11-04");
    } finally {
      vi.useRealTimers();
    }
  });

  it("une ligne par IDE et par autorisation, trois catégories, six champs exactement", async () => {
    setFinmaRegistry(REGISTRY);
    setFinmaVersion("2026.11.04");
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source_url).toBe("https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/");
    expect(body.rows).toEqual([
      { uid: "CHE-111.111.111", entity_type: "bank", licence_type: "Bank", licence_type_de: "Bank", licence_type_fr: "Banque", licence_type_it: "Banca" },
      { uid: "CHE-111.111.111", entity_type: "bank", licence_type: "Custodian bank", licence_type_de: "Depotbank", licence_type_fr: "Banque dépositaire", licence_type_it: "Banca depositaria" },
      { uid: "CHE-222.222.222", entity_type: "fintech", licence_type: "Persons under Article 1b of the Banking Act", licence_type_de: "Bank", licence_type_fr: "Banque", licence_type_it: "Banca" },
      { uid: "CHE-333.333.333", entity_type: "securities_firm", licence_type: "Securities firm", licence_type_de: "Wertpapierhaus", licence_type_fr: "Maison de titres", licence_type_it: "Società di intermediazione mobiliare" },
    ]);
    expect(body.sources.map((s: { id: string }) => s.id)).toEqual(["finma.uid_csv"]);
  });

  it("aucune fuite : ni nom, ni adresse, ni LEI, ni liste d'alerte, ni fiche, dans tout le corps", async () => {
    setFinmaRegistry(REGISTRY);
    setFinmaWarnings([{ name: SECRET_WARNING } as never]);
    setFinmaVersion("2026.11.04");
    const text = await (await get()).text();
    for (const secret of [SECRET_NAME, SECRET_ADDRESS, SECRET_LEI, SECRET_WARNING, "Lausanne", "Vevey", "fiche-fictive", "is_warning_listed", "warning", "asset_manager", "supervisory", "CHE-444."]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("aucun mot de prix ni de conformité dans l'avis", async () => {
    setFinmaRegistry(REGISTRY);
    setFinmaVersion("2026.11.04");
    const body = await (await get()).json();
    expect(JSON.stringify(body.notice)).not.toMatch(/\bCHF\b|\bprice\b|\bpurchase|complian|conformit|certif/i);
  });

  it("plafond réseau des routes de données : 429 et Retry-After", async () => {
    setFinmaRegistry(REGISTRY);
    setFinmaVersion("2026.11.04");
    const ok = await get();
    expect(ok.headers.get("x-ratelimit-limit")).toBe("600");
    for (let i = 0; i < 599; i += 1) await get();
    const refused = await get();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBeTruthy();
  });
});

describe("finmaLicenceRows et finmaCollectedOn", () => {
  it("l'ordre ne dépend pas de celui du registre", () => {
    expect(finmaLicenceRows([...REGISTRY].reverse())).toEqual(finmaLicenceRows(REGISTRY));
  });

  it("ne garde que les dates de calendrier", () => {
    expect(finmaCollectedOn("2026.11.04")).toBe("2026-11-04");
    expect(finmaCollectedOn("2026.11.04-2")).toBe("2026-11-04");
    expect(finmaCollectedOn("2026.13.45")).toBeNull();
    expect(finmaCollectedOn("seed")).toBeNull();
    expect(finmaCollectedOn("")).toBeNull();
  });
});
