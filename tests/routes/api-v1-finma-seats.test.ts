/**
 * `/api/v1/communes/:bfs_id` — siège exact FINMA par IDE (tâche osd.donnees, tâche B4), chemin de
 * PRODUCTION réel (aucun mock de `communeProfile`, comme `tests/routes/api-v1.test.ts`).
 *
 * Fichier NEUF (point 3 de la relecture de Claude-Alain du 07.10.2026) : `tests/routes/api-v1.test.ts`
 * est déjà présent sur `origin/main` et ne peut pas être modifié pour y ajouter ce cas — ce
 * fichier vérifie seulement la FORME des trois champs de siège sur la vraie route HTTP, sans
 * jamais fixer de valeur exacte (la collecte mensuelle change le fichier combiné).
 *
 * Même méthode que `tests/routes/api-v1.test.ts` : `createApp().request(path, init)`, base
 * SQLite jetable pour `trackApiRequest`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { _resetApiRateLimit } from "../../src/lib/api-rate-limit.js";

function get(path: string, ip: string) {
  return createApp().request(path, { headers: { "x-real-ip": ip } });
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "osd-api-v1-finma-seats-"));
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

describe("GET /api/v1/communes/:bfs_id — siège exact FINMA (chemin de production réel)", () => {
  it("commune 230 (Winterthur) : les trois champs de siège sont des nombres, source et édition exposées", async () => {
    const res = await get("/api/v1/communes/230", "203.0.113.60");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.finma.entities_with_seat_in_commune).toBe("number");
    expect(typeof body.finma.distinct_entities_with_seat_in_commune).toBe("number");
    expect(typeof body.finma.national_seats_known).toBe("number");
    expect(typeof body.finma.seat_matching).toBe("string");
    expect(body.sources.map((s: { id: string }) => s.id)).toContain("ofrc.zefix_lindas");
    expect(typeof body.editions.finma_seats).toBe("string");
  });

  it("commune 261 (Zürich) : même forme, sans fixer de valeur exacte", async () => {
    const res = await get("/api/v1/communes/261", "203.0.113.61");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.finma.entities_with_seat_in_commune).toBe("number");
    expect(typeof body.finma.distinct_entities_with_seat_in_commune).toBe("number");
    expect(typeof body.finma.national_seats_known).toBe("number");
  });
});
