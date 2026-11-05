/**
 * `/api/v1/sanctions` : organisations et bateaux seulement. `createApp().request` (voir
 * `tests/routes/api-v1.test.ts`), liste posée en mémoire depuis le fichier fictif, jamais de R2.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSanctionsDocument } from "../../etl/sanctions/build.js";
import { parseSesamXml } from "../../etl/sanctions/parse.js";
import { createApp } from "../../src/index.js";
import { _resetApiRateLimit } from "../../src/lib/api-rate-limit.js";
import { closeDb, getDb } from "../../src/lib/db.js";
import { _setSanctionsForTest, SANCTIONS_OFFICIAL_SEARCH_URL } from "../../src/lib/sanctions.js";

const xml = readFileSync(new URL("../../etl/sanctions/fixtures/sesam-sample.xml", import.meta.url), "utf8");
const doc = buildSanctionsDocument(parseSesamXml(xml), { sha256: "a".repeat(64), bytes: xml.length, collectedAt: "2026-11-04T12:00:00.000Z" });
const NOW = Date.parse("2026-11-05T09:00:00Z");

const get = (path: string) => createApp().request(path, { headers: { "x-real-ip": "192.0.2.77" } });
const search = (params: Record<string, string>) => get(`/api/v1/sanctions/search?${new URLSearchParams(params)}`);

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "osd-api-sanctions-"));
  vi.stubEnv("DATABASE_PATH", join(tmp, "test.sqlite"));
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "fictif");
  getDb();
  _resetApiRateLimit();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  _setSanctionsForTest(doc);
});
afterEach(() => {
  _setSanctionsForTest(null);
  vi.useRealTimers();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("GET /api/v1/sanctions", () => {
  it("date, empreinte, nombre d'entrées par catégorie, preuve et renvoi à la recherche officielle", async () => {
    const res = await get("/api/v1/sanctions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("current");
    expect(body.list).toMatchObject({ date: "2026-11-04", sha256: "a".repeat(64) });
    expect(body.entries).toEqual({ organisations: 2, vessels: 1 });
    expect(body.exclusion_proof.natural_persons_served).toBe(0);
    expect(body.exclusion_proof.excluded.natural_persons).toBe(2);
    expect(body.official_search_url).toBe(SANCTIONS_OFFICIAL_SEARCH_URL);
    expect(body.notice.coverage).toMatch(/Natural persons are not covered/);
    expect(body.sources[0].id).toBe("seco.sesam_sanctions");
    expect(JSON.stringify(body)).not.toMatch(/screening|compliance/i);
  });
  it("sans liste chargée : 503 propre, avec le renvoi officiel", async () => {
    _setSanctionsForTest(null);
    const res = await get("/api/v1/sanctions");
    expect(res.status).toBe(503);
    expect((await res.json()).official_search_url).toBe(SANCTIONS_OFFICIAL_SEARCH_URL);
  });
  it("trop ancienne : dite périmée", async () => {
    vi.setSystemTime(Date.parse("2026-11-20T09:00:00Z"));
    expect((await (await get("/api/v1/sanctions")).json()).status).toBe("out_of_date");
  });
});

describe("la fraîcheur se lit sur le dernier relevé, jamais sur la date du fichier", () => {
  // Fichier du SECO inchangé depuis trente jours, relevé la veille.
  const unchanged = { ...doc, list_date: "2026-10-06", collected_at: "2026-11-04T20:40:00.000Z" };
  // Fichier daté de la veille, mais plus aucun relevé réussi depuis dix jours.
  const noRecentRead = { ...doc, list_date: "2026-11-04", collected_at: "2026-10-26T08:40:00.000Z" };

  it("fichier ancien, relevé récent : à jour, et les deux dates sont servies", async () => {
    _setSanctionsForTest(unchanged);
    const meta = await (await get("/api/v1/sanctions")).json();
    expect(meta.status).toBe("current");
    expect(meta.list).toMatchObject({ date: "2026-10-06", collected_at: "2026-11-04T20:40:00.000Z" });
    const res = await search({ name: "Old Acme" });
    expect(res.status).toBe(200);
    expect((await res.json()).list).toMatchObject({ date: "2026-10-06", collected_at: "2026-11-04T20:40:00.000Z" });
  });
  it("fichier récent, aucun relevé depuis dix jours : périmée, et la recherche ne répond pas", async () => {
    _setSanctionsForTest(noRecentRead);
    expect((await (await get("/api/v1/sanctions")).json()).status).toBe("out_of_date");
    const res = await search({ name: "Old Acme" });
    expect(res.status).toBe(503);
    expect((await res.json()).collected_at).toBe("2026-10-26T08:40:00.000Z");
  });
});

describe("GET /api/v1/sanctions/search", () => {
  it.each([[{}], [{ name: "A", imo: "1234567" }], [{ imo: "12" }], [{ name: "x".repeat(301) }]])("demande invalide %j : 400", async (params) => {
    expect((await search(params as Record<string, string>)).status).toBe(400);
  });
  it("nom exact d'une organisation : le résultat, sans cache, et par quel nom il a été trouvé", async () => {
    const res = await search({ name: "Old Acme" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.match).toBe("exact");
    expect(body.result_count).toBe(1);
    expect(body.results[0]).toMatchObject({ id: "200", kind: "organisation", matched_on: "former" });
    expect(body.list.date).toBe("2026-11-04");
  });
  it("rapprochement exact : la casse compte, un nom partiel ne répond pas", async () => {
    expect((await (await search({ name: "old acme" })).json()).result_count).toBe(0);
    expect((await (await search({ name: "Acme" })).json()).result_count).toBe(0);
  });
  it("numéro IMO : le bateau", async () => {
    const body = await (await search({ imo: "1234567" })).json();
    expect(body.results[0]).toMatchObject({ id: "400", kind: "vessel", matched_on: "imo" });
  });
  it("le nom d'une personne ne répond jamais, et la réponse vide dit ce qu'elle ne couvre pas", async () => {
    for (const name of ["Pavel Temoinov", "Temoinov Pavel", "Pavel Temoinov Trading", "Haji Temoinov Hawala"]) {
      const body = await (await search({ name })).json();
      expect(body.result_count).toBe(0);
      expect(body.notice.coverage).toMatch(/Natural persons are not covered/);
      expect(body.notice.no_match).toMatch(/does not mean/);
      expect(body.official_search_url).toBe(SANCTIONS_OFFICIAL_SEARCH_URL);
    }
  });
  it("le même nom sur un bateau répond avec le genre « vessel »", async () => {
    const body = await (await search({ name: "Alias Personne Temoin" })).json();
    expect(body.results.map((r: { kind: string }) => r.kind)).toEqual(["vessel"]);
  });
  it("une entrée radiée ne répond pas", async () => {
    expect((await (await search({ name: "TEMOIN-ORGANISATION-RADIEE" })).json()).result_count).toBe(0);
    expect((await (await search({ imo: "7654321" })).json()).result_count).toBe(0);
  });
  it("liste périmée : 503, ni résultat ni absence de résultat", async () => {
    vi.setSystemTime(Date.parse("2026-11-20T09:00:00Z"));
    const res = await search({ name: "Old Acme" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("sanctions_list_out_of_date");
    expect(body.results).toBeUndefined();
  });
  it("la demande n'entre pas dans les mesures : seul le chemin est gardé", async () => {
    await search({ name: "Nom Confidentiel" });
    await vi.waitFor(() => undefined);
    const rows = getDb().prepare("SELECT name FROM events WHERE kind='api_request'").all() as { name: string }[];
    for (const row of rows) expect(row.name).not.toContain("Confidentiel");
  });
  it.each(["POST", "PUT", "DELETE", "PATCH"])("%s : jamais 2xx", async (method) => {
    const res = await createApp().request("/api/v1/sanctions/search?name=x", { method, headers: { "x-real-ip": "192.0.2.78" } });
    expect(res.status < 200 || res.status >= 300).toBe(true);
  });
});
