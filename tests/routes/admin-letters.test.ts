import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createApp } from "../../src/index.js";
import { createAdminLettersRoute } from "../../src/routes/admin-letters.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SECRET = "test-secret-1234567890";

const VALID_BODY = {
  to: "boite-fictive@test.admin.ch",
  subject: "Demande de données",
  body: "Texte de la lettre.",
  purpose: "Clarification de réutilisation",
};

/** Routeur nu, sans le reste de l'application — déterministe via `now`/`rng`. */
function buildApp(overrides: { now?: () => number; rng?: () => number } = {}) {
  const app = new Hono();
  app.route("/", createAdminLettersRoute(overrides));
  return app;
}

/** Insère directement une ligne pour tester GET/cancel/processed sans passer par POST. */
function insertLetter(overrides: Record<string, unknown> = {}): string {
  const db = getDb();
  const now = Date.now();
  const id = (overrides.id as string) ?? `id-${Math.random().toString(36).slice(2)}`;
  const row = {
    id,
    kind: "letter",
    parent_id: null,
    to_address: "boite-fictive@admin.ch",
    subject: "sujet",
    body: "corps secret",
    purpose: "motif",
    status: "queued",
    scheduled_at: now + 1000,
    reply_at: null,
    reply_kind: null,
    reply_processed_at: null,
    created_at: now,
    ...overrides,
    id,
  };
  db.prepare(
    `INSERT INTO institutional_letters
      (id, kind, parent_id, to_address, cc, subject, body, purpose, status, scheduled_at,
       lease_until, attempts, resend_id, sent_at, reply_at, reply_from, reply_subject,
       reply_extract, reply_kind, reply_processed_at, created_at)
     VALUES
      (@id, @kind, @parent_id, @to_address, NULL, @subject, @body, @purpose, @status, @scheduled_at,
       NULL, 0, NULL, NULL, @reply_at, NULL, NULL,
       NULL, @reply_kind, @reply_processed_at, @created_at)`,
  ).run(row);
  return id;
}

describe("routes des lettres institutionnelles (/api/admin/letters)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-letters-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.ADMIN_SECRET = SECRET;
    getDb(); // ouvre la base fictive, migrations comprises
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.ADMIN_SECRET;
  });

  describe("montage réel sous /api/admin/letters (src/index.ts)", () => {
    it("répond 401 sans secret sur le chemin monté en production", async () => {
      const app = createApp();
      const res = await app.request("/api/admin/letters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(401);
    });

    it("dépose une lettre via le chemin monté réel", async () => {
      const app = createApp();
      const res = await app.request("/api/admin/letters", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify(VALID_BODY),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.id).toBe("string");
      expect(typeof body.scheduled_at).toBe("number");
    });
  });

  describe("401 sans secret ou avec un mauvais secret — les quatre routes", () => {
    const cases: Array<[string, string]> = [
      ["POST", "/"],
      ["GET", "/"],
      ["POST", "/some-id/cancel"],
      ["POST", "/some-id/processed"],
    ];
    for (const [method, path] of cases) {
      it(`${method} ${path} — sans en-tête`, async () => {
        const app = buildApp();
        const res = await app.request(path, { method });
        expect(res.status).toBe(401);
      });
      it(`${method} ${path} — mauvais secret`, async () => {
        const app = buildApp();
        const res = await app.request(path, { method, headers: { "x-admin-secret": "wrong-secret-value" } });
        expect(res.status).toBe(401);
      });
    }
  });

  describe("POST / — dépôt d'une lettre", () => {
    it("dépose une lettre valide, planifiée dans le futur, et l'enregistre queued", async () => {
      const now = Date.parse("2026-06-10T09:00:00+02:00"); // mercredi, heure d'été, jour ouvrable
      const app = buildApp({ now: () => now, rng: () => 0 });
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify(VALID_BODY),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.id).toBe("string");
      expect(body.id.length).toBeGreaterThan(10);
      expect(body.scheduled_at).toBeGreaterThan(now);

      const row = getDb().prepare("SELECT * FROM institutional_letters WHERE id=?").get(body.id) as Record<string, unknown>;
      expect(row.status).toBe("queued");
      expect(row.kind).toBe("letter");
      expect(row.parent_id).toBeNull();
      expect(row.to_address).toBe(VALID_BODY.to);
      expect(row.subject).toBe(VALID_BODY.subject);
      expect(row.body).toBe(VALID_BODY.body);
      expect(row.purpose).toBe(VALID_BODY.purpose);
      expect(row.cc).toBeNull();
      expect(row.attempts).toBe(0);
      expect(row.scheduled_at).toBe(body.scheduled_at);
    });

    it("refuse un destinataire hors domaine autorisé (400)", async () => {
      const app = buildApp();
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ ...VALID_BODY, to: "boite-fictive@example.com" }),
      });
      expect(res.status).toBe(400);
    });

    it("refuse un domaine imité (admin.ch.example.com, xadmin.ch)", async () => {
      const app = buildApp();
      for (const to of ["boite-fictive@admin.ch.example.com", "boite-fictive@xadmin.ch"]) {
        const res = await app.request("/", {
          method: "POST",
          headers: { "content-type": "application/json", "x-admin-secret": SECRET },
          body: JSON.stringify({ ...VALID_BODY, to }),
        });
        expect(res.status).toBe(400);
      }
    });

    it("refuse un cc hors domaine autorisé (400), même règle que `to`", async () => {
      const app = buildApp();
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ ...VALID_BODY, cc: "boite-fictive@evil.com" }),
      });
      expect(res.status).toBe(400);
    });

    it("accepte un cc facultatif valide", async () => {
      const now = Date.parse("2026-06-10T09:00:00+02:00");
      const app = buildApp({ now: () => now, rng: () => 0 });
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ ...VALID_BODY, cc: "boite-fictive@finma.ch" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const row = getDb().prepare("SELECT cc FROM institutional_letters WHERE id=?").get(body.id) as { cc: string };
      expect(row.cc).toBe("boite-fictive@finma.ch");
    });

    it("refuse un corps incomplet (champ manquant)", async () => {
      const app = buildApp();
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ to: VALID_BODY.to }),
      });
      expect(res.status).toBe(400);
    });

    it("refuse un champ supplémentaire (schéma strict)", async () => {
      const app = buildApp();
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ ...VALID_BODY, extra: "nope" }),
      });
      expect(res.status).toBe(400);
    });

    it("refuse un objet trop long (> 200) et un objet avec un caractère de contrôle", async () => {
      const app = buildApp();
      const tooLong = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ ...VALID_BODY, subject: "x".repeat(201) }),
      });
      expect(tooLong.status).toBe(400);

      const injected = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ ...VALID_BODY, subject: "Objet\nBcc: x@evil.com" }),
      });
      expect(injected.status).toBe(400);
    });

    it("refuse un objet trop court (< 15 caractères, correction finale du 06.10)", async () => {
      const app = buildApp();
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ ...VALID_BODY, subject: "Trop court" }), // 10 caractères
      });
      expect(res.status).toBe(400);
    });

    it("refuse un JSON invalide", async () => {
      const app = buildApp();
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: "{ pas du json",
      });
      expect(res.status).toBe(400);
    });

    it("deux dépôts successifs ne reçoivent jamais le même créneau", async () => {
      const now = Date.parse("2026-06-10T09:00:00+02:00");
      const app = buildApp({ now: () => now, rng: () => 0 });
      const r1 = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify(VALID_BODY),
      });
      const r2 = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify(VALID_BODY),
      });
      const b1 = await r1.json();
      const b2 = await r2.json();
      expect(b1.scheduled_at).not.toBe(b2.scheduled_at);
    });
  });

  describe("GET / — liste sans `body`", () => {
    it("ne renvoie jamais le corps de la lettre", async () => {
      insertLetter({ id: "l1" });
      const app = buildApp();
      const res = await app.request("/", { headers: { "x-admin-secret": SECRET } });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.letters.length).toBeGreaterThan(0);
      for (const letter of body.letters) expect(letter.body).toBeUndefined();
    });

    it("trie par scheduled_at croissant", async () => {
      const t0 = Date.now();
      insertLetter({ id: "later", scheduled_at: t0 + 5000 });
      insertLetter({ id: "earlier", scheduled_at: t0 + 1000 });
      const app = buildApp();
      const res = await app.request("/", { headers: { "x-admin-secret": SECRET } });
      const body = await res.json();
      const ids = body.letters.map((l: { id: string }) => l.id);
      expect(ids.indexOf("earlier")).toBeLessThan(ids.indexOf("later"));
    });

    it("filtre par status", async () => {
      insertLetter({ id: "q1", status: "queued" });
      insertLetter({ id: "c1", status: "cancelled" });
      const app = buildApp();
      const res = await app.request("/?status=cancelled", { headers: { "x-admin-secret": SECRET } });
      const body = await res.json();
      expect(body.letters.map((l: { id: string }) => l.id)).toEqual(["c1"]);
    });

    it("filtre replied=1 et unprocessed=1", async () => {
      const t0 = Date.now();
      insertLetter({ id: "no-reply", status: "sent" });
      insertLetter({ id: "replied-human", status: "sent", reply_at: t0, reply_kind: "human" });
      insertLetter({ id: "replied-processed", status: "sent", reply_at: t0, reply_kind: "human", reply_processed_at: t0 });

      const app = buildApp();
      const repliedRes = await app.request("/?replied=1", { headers: { "x-admin-secret": SECRET } });
      const repliedBody = await repliedRes.json();
      expect(new Set(repliedBody.letters.map((l: { id: string }) => l.id))).toEqual(
        new Set(["replied-human", "replied-processed"]),
      );

      const unprocessedRes = await app.request("/?replied=1&unprocessed=1", { headers: { "x-admin-secret": SECRET } });
      const unprocessedBody = await unprocessedRes.json();
      expect(unprocessedBody.letters.map((l: { id: string }) => l.id)).toEqual(["replied-human"]);
    });

    it("replied=1&unprocessed=1 renvoie aussi une lettre `unverified` (aucun filtre sur reply_kind)", async () => {
      const t0 = Date.now();
      insertLetter({ id: "replied-unverified", status: "sent", reply_at: t0, reply_kind: "unverified" });
      const app = buildApp();
      const res = await app.request("/?replied=1&unprocessed=1", { headers: { "x-admin-secret": SECRET } });
      const body = await res.json();
      expect(body.letters.map((l: { id: string }) => l.id)).toEqual(["replied-unverified"]);
    });

    it("rejette un paramètre de requête invalide", async () => {
      insertLetter({ id: "z1" });
      const app = buildApp();
      const res = await app.request("/?status=bogus", { headers: { "x-admin-secret": SECRET } });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /:id/cancel", () => {
    it("annule une lettre encore queued", async () => {
      const id = insertLetter({ status: "queued" });
      const app = buildApp();
      const res = await app.request(`/${id}/cancel`, { method: "POST", headers: { "x-admin-secret": SECRET } });
      expect(res.status).toBe(200);
      const row = getDb().prepare("SELECT status FROM institutional_letters WHERE id=?").get(id) as { status: string };
      expect(row.status).toBe("cancelled");
    });

    it("404 sur un identifiant inconnu", async () => {
      const app = buildApp();
      const res = await app.request("/does-not-exist/cancel", { method: "POST", headers: { "x-admin-secret": SECRET } });
      expect(res.status).toBe(404);
    });

    it("409 si la lettre n'est plus queued, sans y toucher", async () => {
      const id = insertLetter({ status: "sent" });
      const app = buildApp();
      const res = await app.request(`/${id}/cancel`, { method: "POST", headers: { "x-admin-secret": SECRET } });
      expect(res.status).toBe(409);
      const row = getDb().prepare("SELECT status FROM institutional_letters WHERE id=?").get(id) as { status: string };
      expect(row.status).toBe("sent");
    });
  });

  describe("POST /:id/processed", () => {
    it("409 si aucune réponse n'est rattachée", async () => {
      const id = insertLetter({ status: "sent", reply_at: null });
      const app = buildApp();
      const res = await app.request(`/${id}/processed`, { method: "POST", headers: { "x-admin-secret": SECRET } });
      expect(res.status).toBe(409);
    });

    it("pose reply_processed_at quand une réponse est rattachée", async () => {
      const t0 = Date.now();
      const id = insertLetter({ status: "sent", reply_at: t0, reply_kind: "human" });
      const app = buildApp({ now: () => t0 + 1000 });
      const res = await app.request(`/${id}/processed`, { method: "POST", headers: { "x-admin-secret": SECRET } });
      expect(res.status).toBe(200);
      const row = getDb().prepare("SELECT reply_processed_at FROM institutional_letters WHERE id=?").get(id) as {
        reply_processed_at: number;
      };
      expect(row.reply_processed_at).toBe(t0 + 1000);
    });

    it("rejeu idempotent : déjà traitée, la date d'origine n'est pas réécrite", async () => {
      const t0 = Date.now();
      const id = insertLetter({
        status: "sent",
        reply_at: t0,
        reply_kind: "human",
        reply_processed_at: t0 + 500,
      });
      const app = buildApp({ now: () => t0 + 99_999 });
      const res = await app.request(`/${id}/processed`, { method: "POST", headers: { "x-admin-secret": SECRET } });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.reply_processed_at).toBe(t0 + 500);
      const row = getDb().prepare("SELECT reply_processed_at FROM institutional_letters WHERE id=?").get(id) as {
        reply_processed_at: number;
      };
      expect(row.reply_processed_at).toBe(t0 + 500);
    });

    it("404 sur un identifiant inconnu", async () => {
      const app = buildApp();
      const res = await app.request("/does-not-exist/processed", { method: "POST", headers: { "x-admin-secret": SECRET } });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /:id/reply (correction finale du 06.10.2026, item 4 : marquage manuel)", () => {
    it("marque human, calcule le domaine du destinataire, arrête la relance, et réinitialise reply_processed_at", async () => {
      const id = insertLetter({
        status: "sent",
        to_address: "sanctions@seco.admin.ch",
        reply_kind: "auto",
        reply_processed_at: Date.now(),
      });
      const t0 = Date.now() + 1000;
      const app = buildApp({ now: () => t0 });
      const res = await app.request(`/${id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ kind: "human" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, reply_kind: "human" });
      const row = getDb().prepare("SELECT reply_kind, reply_at, reply_from, reply_subject, reply_processed_at FROM institutional_letters WHERE id=?").get(id) as Record<string, unknown>;
      expect(row.reply_kind).toBe("human");
      expect(row.reply_at).toBe(t0);
      expect(row.reply_from).toBe("seco.admin.ch");
      expect(row.reply_subject).toBe("marqué manuellement");
      expect(row.reply_processed_at).toBeNull(); // auto→human : à revoir, même marqué à la main.
    });

    it("accepte aussi une lettre `failed` (envoi incertain, mais une vraie réponse a pu arriver)", async () => {
      const id = insertLetter({ status: "failed", to_address: "x@bj.admin.ch" });
      const app = buildApp();
      const res = await app.request(`/${id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ kind: "human" }),
      });
      expect(res.status).toBe(200);
    });

    it("déjà `human` : 200 sans rien changer (ne jamais écraser une vraie réponse par le texte générique)", async () => {
      const id = insertLetter({ status: "sent", reply_kind: "human", reply_at: 12345, reply_processed_at: 12345 });
      getDb().prepare("UPDATE institutional_letters SET reply_subject='Vraie réponse de l’autorité', reply_from='seco.admin.ch' WHERE id=?").run(id);
      const app = buildApp({ now: () => 999_999 });
      const res = await app.request(`/${id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ kind: "human" }),
      });
      expect(res.status).toBe(200);
      const row = getDb().prepare("SELECT reply_at, reply_subject, reply_processed_at FROM institutional_letters WHERE id=?").get(id) as Record<string, unknown>;
      expect(row.reply_at).toBe(12345);
      expect(row.reply_subject).toBe("Vraie réponse de l’autorité");
      expect(row.reply_processed_at).toBe(12345);
    });

    it("déjà `unverified` (correction finale 2, item 6) : passe à human SANS écraser reply_subject/reply_at/reply_from, et réinitialise reply_processed_at", async () => {
      const id = insertLetter({ status: "sent", reply_kind: "unverified", reply_at: 777, reply_processed_at: 777 });
      getDb().prepare("UPDATE institutional_letters SET reply_subject='Re: déjà rattachée', reply_from='seco.admin.ch' WHERE id=?").run(id);
      const app = buildApp();
      const res = await app.request(`/${id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ kind: "human" }),
      });
      expect(res.status).toBe(200);
      const row = getDb().prepare("SELECT reply_kind, reply_at, reply_subject, reply_from, reply_processed_at FROM institutional_letters WHERE id=?").get(id) as Record<string, unknown>;
      expect(row.reply_kind).toBe("human");
      expect(row.reply_at).toBe(777); // jamais écrasé
      expect(row.reply_subject).toBe("Re: déjà rattachée"); // jamais écrasé
      expect(row.reply_from).toBe("seco.admin.ch"); // jamais écrasé
      expect(row.reply_processed_at).toBeNull(); // remis à NULL malgré tout
    });

    it("appelé sur l'identifiant d'une RELANCE : écrit sur la lettre D'ORIGINE, jamais sur la relance", async () => {
      const parentId = insertLetter({ status: "sent", to_address: "sanctions@seco.admin.ch" });
      const reminderId = insertLetter({ kind: "reminder", parent_id: parentId, status: "sent", subject: "Relance : sujet" });
      const t0 = Date.now() + 2000;
      const app = buildApp({ now: () => t0 });
      const res = await app.request(`/${reminderId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ kind: "human" }),
      });
      expect(res.status).toBe(200);
      const parent = getDb().prepare("SELECT reply_kind, reply_at, reply_from FROM institutional_letters WHERE id=?").get(parentId) as Record<string, unknown>;
      expect(parent.reply_kind).toBe("human");
      expect(parent.reply_at).toBe(t0);
      expect(parent.reply_from).toBe("seco.admin.ch");
      const reminder = getDb().prepare("SELECT reply_kind FROM institutional_letters WHERE id=?").get(reminderId) as Record<string, unknown>;
      expect(reminder.reply_kind).toBeNull(); // la relance elle-même reste inchangée
    });

    it("409 sur une lettre encore `queued` (jamais tentée) ; 404 sur un identifiant inconnu", async () => {
      const id = insertLetter({ status: "queued" });
      const app = buildApp();
      const res = await app.request(`/${id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ kind: "human" }),
      });
      expect(res.status).toBe(409);

      const res404 = await app.request("/does-not-exist/reply", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ kind: "human" }),
      });
      expect(res404.status).toBe(404);
    });

    it("refuse un corps invalide (kind absent, ou différent de human)", async () => {
      const id = insertLetter({ status: "sent" });
      const app = buildApp();
      const bad1 = await app.request(`/${id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({}),
      });
      expect(bad1.status).toBe(400);
      const bad2 = await app.request(`/${id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ kind: "auto" }),
      });
      expect(bad2.status).toBe(400);
    });

    it("401 sans le secret d'administration", async () => {
      const id = insertLetter({ status: "sent" });
      const app = buildApp();
      const res = await app.request(`/${id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "human" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST/GET /pause (correction finale du 06.10.2026, item 4)", () => {
    it("inactive par défaut ; se pose et se lit", async () => {
      const app = buildApp();
      const initial = await app.request("/pause", { headers: { "x-admin-secret": SECRET } });
      expect(await initial.json()).toMatchObject({ paused: false });

      const t0 = 1_700_000_000_000;
      const appAt = buildApp({ now: () => t0 });
      const set = await appAt.request("/pause", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ paused: true }),
      });
      expect(set.status).toBe(200);
      expect(await set.json()).toEqual({ ok: true, paused: true });

      const get = await app.request("/pause", { headers: { "x-admin-secret": SECRET } });
      expect(await get.json()).toEqual({ paused: true, updated_at: t0 });
    });

    it("401 sans le secret ; 400 sur un corps invalide", async () => {
      const app = buildApp();
      const noAuth = await app.request("/pause", { headers: { "content-type": "application/json" } });
      expect(noAuth.status).toBe(401);
      const badBody = await app.request("/pause", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": SECRET },
        body: JSON.stringify({ paused: "oui" }),
      });
      expect(badBody.status).toBe(400);
    });
  });
});
