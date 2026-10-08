import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createAdminLettersRoute } from "../../src/routes/admin-letters.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Demandes de licence aux distributeurs officiels (plan du 08.10.2026) : le serveur, pas seulement le
// script, empêche une seconde demande au même éditeur (motif `demande-licence:<organisation>` déjà
// déposé depuis moins de 120 jours) et plafonne les nouvelles demandes à 3 éditeurs par 7 jours.
// Les autres motifs (lettres écrites à la main) ne sont pas concernés.

const SECRET = "test-secret-1234567890";
const DAY = 86_400_000;
const T0 = Date.parse("2026-06-10T09:00:00+02:00"); // mercredi, jour ouvrable

function letterBody(purpose: string, to = "boite-fictive@lustat.ch") {
  return {
    to,
    subject: "Demande de licence ouverte sur opendata.swiss (éditeur fictif)",
    body: "Texte de la lettre.",
    purpose,
  };
}

function buildApp(now: () => number) {
  const app = new Hono();
  app.route("/", createAdminLettersRoute({ now, rng: () => 0 }));
  return app;
}

async function post(app: Hono, body: unknown) {
  return app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": SECRET },
    body: JSON.stringify(body),
  });
}

function setStatus(id: string, status: string) {
  getDb().prepare("UPDATE institutional_letters SET status = ? WHERE id = ?").run(status, id);
}

describe("POST / — demandes de licence (`demande-licence:`)", () => {
  let tmp: string;
  let now = T0;
  const clock = () => now;

  beforeEach(() => {
    now = T0;
    tmp = mkdtempSync(join(tmpdir(), "osd-demandes-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.ADMIN_SECRET = SECRET;
    getDb();
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.ADMIN_SECRET;
  });

  it("accepte un destinataire cantonal vérifié (lustat.ch)", async () => {
    const res = await post(buildApp(clock), letterBody("demande-licence:lustat"));
    expect(res.status).toBe(200);
  });

  it("refuse une seconde demande au même éditeur dans les 120 jours (409 duplicate_purpose), sans rien insérer", async () => {
    const app = buildApp(clock);
    expect((await post(app, letterBody("demande-licence:lustat"))).status).toBe(200);
    now = T0 + 119 * DAY;
    const res = await post(app, letterBody("demande-licence:lustat"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "duplicate_purpose" });
    const count = getDb().prepare("SELECT COUNT(*) AS n FROM institutional_letters").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("accepte de nouveau la même demande après 120 jours", async () => {
    const app = buildApp(clock);
    expect((await post(app, letterBody("demande-licence:lustat"))).status).toBe(200);
    now = T0 + 121 * DAY;
    expect((await post(app, letterBody("demande-licence:lustat"))).status).toBe(200);
  });

  it("une demande annulée ne bloque pas ; une demande en échec (issue inconnue) bloque", async () => {
    const app = buildApp(clock);
    const first = await (await post(app, letterBody("demande-licence:lustat"))).json();
    setStatus(first.id, "cancelled");
    const second = await post(app, letterBody("demande-licence:lustat"));
    expect(second.status).toBe(200);
    setStatus((await second.json()).id, "failed");
    expect((await post(app, letterBody("demande-licence:lustat"))).status).toBe(409);
  });

  it("deux éditeurs différents ne se bloquent pas", async () => {
    const app = buildApp(clock);
    expect((await post(app, letterBody("demande-licence:lustat"))).status).toBe(200);
    expect((await post(app, letterBody("demande-licence:statistisches-amt-kanton-zuerich", "boite-fictive@statistik.zh.ch"))).status).toBe(200);
  });

  it("plafond : au plus 3 nouvelles demandes de licence par 7 jours glissants (429 weekly_cap_reached)", async () => {
    const app = buildApp(clock);
    for (const org of ["a", "b", "c"]) {
      expect((await post(app, letterBody(`demande-licence:${org}`))).status).toBe(200);
    }
    const fourth = await post(app, letterBody("demande-licence:d"));
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: "weekly_cap_reached" });
    now = T0 + 7 * DAY + 1;
    expect((await post(app, letterBody("demande-licence:d"))).status).toBe(200);
  });

  it("une demande annulée ne compte pas dans le plafond hebdomadaire", async () => {
    const app = buildApp(clock);
    const ids: string[] = [];
    for (const org of ["a", "b", "c"]) ids.push((await (await post(app, letterBody(`demande-licence:${org}`))).json()).id);
    setStatus(ids[0], "cancelled");
    expect((await post(app, letterBody("demande-licence:d"))).status).toBe(200);
  });

  it("les autres motifs ne sont concernés ni par le doublon ni par le plafond", async () => {
    const app = buildApp(clock);
    for (const org of ["a", "b", "c"]) await post(app, letterBody(`demande-licence:${org}`));
    for (let i = 0; i < 2; i++) {
      expect((await post(app, letterBody("Clarification de réutilisation", "boite-fictive@admin.ch"))).status).toBe(200);
    }
  });

  it("la casse ne contourne ni le doublon ni le plafond", async () => {
    const app = buildApp(clock);
    expect((await post(app, letterBody("demande-licence:a"))).status).toBe(200);
    expect((await post(app, letterBody("Demande-Licence:A"))).status).toBe(409);
    for (const org of ["b", "c"]) await post(app, letterBody(`demande-licence:${org}`));
    expect((await post(app, letterBody("DEMANDE-LICENCE:x"))).status).toBe(429);
  });
});
