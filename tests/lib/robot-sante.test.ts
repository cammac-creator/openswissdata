import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getDb, closeDb } from "../../src/lib/db.js";
import { diagnose, runRobotSante, startRobotSante, zurichDate } from "../../src/lib/robot-sante.js";
import { createGuichetClient, type GuichetClient, type SanteBody } from "../../src/lib/guichet.js";

// Santé du programme `openswissdata` au bureau (contrat `~/bureau/docs/guichet-contrat.md`, « Dire sa
// santé ») : codes fixes, aucun texte libre, `depuis` stable tant que la panne dure, au plus une santé par
// heure pour un même état, un 429 noté au journal.

// Mercredi 10 juin 2026, 12:01 à Zurich.
const NOW = Date.UTC(2026, 5, 10, 10, 1);
const DAY = 86_400_000;

function santeFake(status: number | null = 200): GuichetClient & { bodies: SanteBody[] } {
  const bodies: SanteBody[] = [];
  return {
    bodies,
    configured: () => true,
    demande: async () => ({ ok: false, code: "refus" }),
    issue: async () => true,
    sante: async (body) => {
      bodies.push(body);
      return status;
    },
  };
}

function setCheck(name: string, checkedAt: number, details: Record<string, unknown>): void {
  getDb()
    .prepare(
      "INSERT INTO operation_checks(name,checked_at,details_json) VALUES(?,?,?) " +
        "ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json",
    )
    .run(name, checkedAt, JSON.stringify({ version: 1, checked_at: checkedAt, ...details }));
}

function letters(at: number, status: string, code: string | null = null): void {
  setCheck("letters", at, { status, code, queued: 0, sent: 0, failed: 0, total_rescheduled: 0, total_reminders_created: 0, last_run_at: at });
}

function mailWatch(at: number, status: string, code: string | null = null): void {
  setCheck("mail_watch", at, {
    status, code, http_status: null, last_success_at: status === "ok" ? at : null, last_alert_at: null,
    matched: 0, alerted: 0, pending: 0, total_alerted: 0, domains: 0, total_attached: 0, seen: [], headerFailures: {},
  });
}

function insertLetter(status: "queued" | "sent", sentAt: number | null = null): void {
  getDb()
    .prepare(
      `INSERT INTO institutional_letters
        (id, kind, parent_id, to_address, cc, subject, body, purpose, status, scheduled_at, lease_until, attempted_at,
         attempts, resend_id, sent_at, reply_at, reply_from, reply_subject, reply_extract, reply_kind, reply_processed_at, created_at)
       VALUES (?, 'letter', NULL, 'boite-fictive@admin.ch', NULL, 'Objet', 'Texte', 'motif', ?, ?, NULL, NULL, 0, NULL, ?,
         NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
    )
    .run(`id-${Math.random().toString(36).slice(2)}`, status, NOW, sentAt, NOW);
}

describe("Santé d'OpenSwissData au bureau", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-sante-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    getDb();
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    vi.restoreAllMocks();
  });

  it("tout va bien : le corps exact du contrat, rien d'autre", async () => {
    letters(NOW - 30_000, "ok");
    const guichet = santeFake();
    expect(await runRobotSante({ now: () => NOW, guichet })).toBe("sent");
    expect(guichet.bodies).toEqual([{ etat: "ok", code: "ok", n: 0 }]);
    expect(Object.keys(guichet.bodies[0]).sort()).toEqual(["code", "etat", "n"]);
  });

  it("même état : une santé par heure au plus, pas à chaque examen", async () => {
    letters(NOW, "ok");
    const guichet = santeFake();
    await runRobotSante({ now: () => NOW, guichet });
    for (const minutes of [5, 10, 30, 55]) {
      letters(NOW + minutes * 60_000, "ok");
      expect(await runRobotSante({ now: () => NOW + minutes * 60_000, guichet })).toBe("unchanged");
    }
    letters(NOW + 60 * 60_000, "ok");
    expect(await runRobotSante({ now: () => NOW + 60 * 60_000, guichet })).toBe("sent");
    expect(guichet.bodies.length).toBe(2);
  });

  it("panne de la file des lettres : code fixe, `depuis` = le jour où elle a commencé, stable le lendemain, puis ok", async () => {
    const guichet = santeFake();
    letters(NOW, "error", "unexpected_error");
    await runRobotSante({ now: () => NOW, guichet });
    expect(guichet.bodies.at(-1)).toEqual({ etat: "panne", code: "autre", depuis: "2026-06-10", n: 0 });
    expect(Object.keys(guichet.bodies.at(-1) as object).sort()).toEqual(["code", "depuis", "etat", "n"]);

    letters(NOW + DAY, "error", "unexpected_error");
    expect(await runRobotSante({ now: () => NOW + DAY, guichet })).toBe("sent"); // signe de vie de l'heure
    expect(guichet.bodies.at(-1)).toMatchObject({ etat: "panne", depuis: "2026-06-10" });

    letters(NOW + DAY + 5 * 60_000, "ok");
    expect(await runRobotSante({ now: () => NOW + DAY + 5 * 60_000, guichet })).toBe("sent"); // changement : tout de suite
    expect(guichet.bodies.at(-1)).toEqual({ etat: "ok", code: "ok", n: 0 });

    letters(NOW + 2 * DAY, "error", "unexpected_error");
    await runRobotSante({ now: () => NOW + 2 * DAY, guichet });
    expect(guichet.bodies.at(-1)).toMatchObject({ etat: "panne", depuis: "2026-06-12" }); // nouvelle panne, nouveau jour
  });

  it("clé d'envoi absente avec une lettre en file : `cle_refusee`, n = lettres qui attendent", () => {
    insertLetter("queued");
    letters(NOW, "not_configured", "no_api_key");
    mailWatch(NOW, "ok");
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "panne", code: "cle_refusee", n: 1 });
  });

  it("la pause des lettres n'est pas une panne", () => {
    insertLetter("queued");
    letters(NOW, "paused", "paused");
    mailWatch(NOW, "ok");
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "ok" });
  });

  it("expéditeur muet depuis plus de 15 minutes : panne", () => {
    letters(NOW - 16 * 60_000, "ok");
    expect(diagnose(getDb(), NOW)).toMatchObject({ etat: "panne", code: "autre" });
  });

  it("guichet muet ou en erreur deux fois de suite pendant qu'une lettre attend : `service_injoignable` ; jeton refusé : `cle_refusee`", () => {
    letters(NOW, "ok");
    mailWatch(NOW, "ok");
    setCheck("letters_guichet", NOW, { code: "http_500", last_at: NOW, consecutive: 2 });
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "ok" }); // aucune lettre n'attend : rien à dire
    insertLetter("queued");
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "panne", code: "service_injoignable", n: 1 });
    setCheck("letters_guichet", NOW, { code: "http_401", last_at: NOW, consecutive: 2 });
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "panne", code: "cle_refusee", n: 1 });
    setCheck("letters_guichet", NOW, { code: null, last_at: NOW, consecutive: 0 });
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "ok" });
  });

  it("un raté isolé (un vendredi soir) n'est pas une panne", () => {
    letters(NOW, "ok");
    mailWatch(NOW, "ok");
    insertLetter("queued");
    setCheck("letters_guichet", NOW, { code: "timeout", last_at: NOW, consecutive: 1 });
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "ok" });
  });

  it("un raté plus ancien que la lettre qui attend ne la concerne pas", () => {
    letters(NOW, "ok");
    mailWatch(NOW, "ok");
    insertLetter("queued"); // déposée à NOW
    setCheck("letters_guichet", NOW - 3 * DAY, { code: "http_500", last_at: NOW - 3 * DAY, consecutive: 5 });
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "ok" });
  });

  it("veille des réponses : panne seulement quand une réponse est attendue", () => {
    letters(NOW, "ok");
    mailWatch(NOW, "inactive", "not_configured");
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "ok" }); // aucune lettre n'attend de réponse

    insertLetter("sent", NOW - 10 * DAY);
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "panne", code: "collecte_arretee", n: 1 });

    mailWatch(NOW, "error", "imap_failed");
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "panne", code: "boite_injoignable", n: 1 });

    mailWatch(NOW - 31 * 60_000, "ok");
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "panne", code: "collecte_arretee", n: 1 });

    mailWatch(NOW, "ok");
    expect(diagnose(getDb(), NOW)).toEqual({ etat: "ok" });
  });

  it("429 : noté au journal (sans adresse), et redemandé à l'examen suivant", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    letters(NOW, "ok");
    const guichet = santeFake(429);
    expect(await runRobotSante({ now: () => NOW, guichet })).toBe("refused");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("plus de 200 aujourd'hui"));
    expect(warn.mock.calls.flat().join(" ")).not.toContain("@");
    letters(NOW + 5 * 60_000, "ok");
    expect(await runRobotSante({ now: () => NOW + 5 * 60_000, guichet })).toBe("refused");
    expect(guichet.bodies.length).toBe(2);
  });

  it("plafond propre de 150 essais par jour, remis à zéro le lendemain (Zurich)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const guichet = santeFake(null); // bureau injoignable : chaque examen réessaie
    let t = NOW;
    for (let i = 0; i < 150; i++) {
      letters(t, "ok");
      await runRobotSante({ now: () => t, guichet });
      t += 60_000;
    }
    expect(guichet.bodies.length).toBe(150);
    letters(t, "ok");
    expect(await runRobotSante({ now: () => t, guichet })).toBe("capped");
    expect(guichet.bodies.length).toBe(150);
    const tomorrow = Date.UTC(2026, 5, 11, 6, 0);
    letters(tomorrow, "ok");
    expect(await runRobotSante({ now: () => tomorrow, guichet })).toBe("unreachable");
    expect(guichet.bodies.length).toBe(151);
  });

  it("sans jeton : rien n'est dit, et la minuterie ne démarre pas", async () => {
    const guichet: GuichetClient = { ...santeFake(), configured: () => false };
    const sante = vi.spyOn(guichet, "sante");
    expect(await runRobotSante({ now: () => NOW, guichet })).toBe("no_token");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const stop = startRobotSante({ guichet });
    stop();
    expect(sante).not.toHaveBeenCalled();
  });

  it("date de Zurich, pas d'UTC : 23 h 30 UTC le 10 juin est déjà le 11 à Zurich", () => {
    expect(zurichDate(Date.UTC(2026, 5, 10, 23, 30))).toBe("2026-06-11");
  });

  it("par le vrai client HTTP : POST /sante avec le jeton, corps JSON exact", async () => {
    let received: { path?: string; authorization?: string; body?: unknown } = {};
    const server: Server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
      req.on("end", () => {
        received = { path: req.url, authorization: req.headers.authorization, body: JSON.parse(raw) };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, change: true, evenement: false }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    try {
      const jeton = "jeton-fictif-du-guichet-0123456789abcdef";
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/guichet`;
      letters(NOW, "error", "unexpected_error");
      expect(await runRobotSante({ now: () => NOW, guichet: createGuichetClient({ url, token: jeton, timeoutMs: 1_000 }) })).toBe("sent");
      expect(received).toEqual({
        path: "/api/guichet/sante",
        authorization: `Bearer ${jeton}`,
        body: { etat: "panne", code: "autre", depuis: "2026-06-10", n: 0 },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
