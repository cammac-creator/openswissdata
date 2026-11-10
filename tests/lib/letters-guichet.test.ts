import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { getDb, closeDb } from "../../src/lib/db.js";
import { runLettersSender, readLettersPause, writeLettersPause } from "../../src/lib/letters-sender.js";
import { createGuichetClient, guichetToken, guichetUrl, recipientDomain, refusalCode, type GuichetClient } from "../../src/lib/guichet.js";
import type { EmailSendResult, PreparedEmail } from "../../src/lib/email.js";
import { guichetEnregistre } from "../helpers/guichet.js";

// Contrat du guichet du bureau (`~/bureau/docs/guichet-contrat.md`, 10.11.2026) : chaque lettre demande la
// permission, un destinataire à la fois, juste avant l'envoi ; tout ce qui n'est pas « HTTP 200 et
// `autorise === true` » vaut refus, et rien ne part. Les cas de transport passent par un VRAI serveur HTTP
// local qui joue le guichet (aucune requête vers le bureau réel) ; `send` (Resend) est toujours simulé.

// Mercredi 10 juin 2026, 12:01 à Zurich : jour ouvré, dans le créneau, minute non ronde.
const NOW = Date.UTC(2026, 5, 10, 10, 1);
const JETON = "jeton-fictif-du-guichet-0123456789abcdef";
const TELEGRAM = "123456789:jeton-fictif-TELEGRAM-abcdefghij";
const CONTACT = "contact@openswissdata.com";

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;
type Seen = { path: string; authorization: string | undefined; body: unknown };

let server: Server;
let base: string;
let handler: Handler;
let seen: Seen[];

function json(res: ServerResponse, status: number, value: unknown): void {
  const text = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function startServer(): Promise<void> {
  seen = [];
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      let parsed: unknown = body;
      try {
        parsed = JSON.parse(body);
      } catch {
        /* corps gardé tel quel */
      }
      seen.push({ path: req.url ?? "", authorization: req.headers.authorization, body: parsed });
      handler(req, res, body);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/guichet`;
      resolve();
    }),
  );
}

function stopServer(): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Le vrai client HTTP, pointé sur le serveur local, avec un délai court pour l'essai « délai dépassé ». */
function client(options: { token?: string | null; url?: string } = {}): GuichetClient {
  return createGuichetClient({ url: options.url ?? base, token: options.token === undefined ? JETON : options.token, timeoutMs: 300 });
}

/** Le guichet qui dit oui, comme le vrai : un identifiant par demande. */
const accorde: Handler = (req, res) => {
  if (req.url?.endsWith("/demande")) return json(res, 200, { autorise: true, id: `g-20260610-120100-${seen.length}`, raison: "", valable_jusqu_a: "x" });
  return json(res, 200, { ok: true });
};

function insertLetter(overrides: Record<string, unknown> = {}): string {
  const id = (overrides.id as string) ?? `id-${Math.random().toString(36).slice(2)}`;
  getDb()
    .prepare(
      `INSERT INTO institutional_letters
        (id, kind, parent_id, to_address, cc, subject, body, purpose, status, scheduled_at,
         lease_until, attempted_at, attempts, resend_id, sent_at, reply_at, reply_from, reply_subject,
         reply_extract, reply_kind, reply_processed_at, created_at)
       VALUES
        (@id, 'letter', NULL, @to_address, @cc, 'Demande de données', 'Texte.\n\nMeilleures salutations', 'Clarification',
         'queued', @scheduled_at, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, @created_at)`,
    )
    .run({ id, to_address: "boite-fictive@admin.ch", cc: null, scheduled_at: NOW - 1_000, created_at: NOW, ...overrides });
  return id;
}

function getLetter(id: string): Record<string, unknown> {
  return getDb().prepare("SELECT * FROM institutional_letters WHERE id=?").get(id) as Record<string, unknown>;
}

const telegramOk = () => vi.fn(async () => Response.json({ ok: true, result: { message_id: 1 } }));

function run(guichet: GuichetClient, overrides: { send?: (p: PreparedEmail, k?: string) => Promise<EmailSendResult>; now?: () => number } = {}) {
  const send = vi.fn(overrides.send ?? (async () => ({ sent: true, providerId: "00000000-0000-0000-0000-000000000000" }) as EmailSendResult));
  const fetcher = telegramOk();
  const status = runLettersSender({ now: overrides.now ?? (() => NOW), rng: () => 0, send, fetch: fetcher, hasApiKey: () => true, guichet });
  return { status, send, fetcher };
}

/** Rien n'est parti, la lettre attend sans pénalité, et sa prochaine demande est à 30 minutes au moins. */
function expectHeld(id: string, send: ReturnType<typeof vi.fn>): void {
  expect(send).not.toHaveBeenCalled();
  const letter = getLetter(id);
  expect(letter.status).toBe("queued");
  expect(letter.attempts).toBe(0);
  expect(letter.attempted_at).toBeNull();
  expect(letter.lease_until).toBeNull();
  expect(letter.scheduled_at as number).toBeGreaterThanOrEqual(NOW + 30 * 60_000);
}

describe("Lettres institutionnelles : permission du guichet avant chaque envoi", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "osd-guichet-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.OSD_VEILLE_TELEGRAM_TOKEN = TELEGRAM;
    process.env.OSD_VEILLE_TELEGRAM_CHAT = "424242";
    getDb();
    handler = accorde;
    await startServer();
  });

  afterEach(async () => {
    await stopServer();
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.OSD_VEILLE_TELEGRAM_TOKEN;
    delete process.env.OSD_VEILLE_TELEGRAM_CHAT;
    delete process.env.RESEND_FROM_EMAIL;
  });

  describe("0 envoi, un essai par cas", () => {
    it("guichet injoignable (port fermé)", async () => {
      const closed = createServer();
      await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", () => resolve()));
      const port = (closed.address() as AddressInfo).port;
      await new Promise<void>((resolve) => closed.close(() => resolve()));
      const id = insertLetter();
      const { status, send } = run(client({ url: `http://127.0.0.1:${port}/api/guichet` }));
      expect((await status).code).toBe("guichet_unreachable");
      expectHeld(id, send);
    });

    it("délai dépassé (le guichet ne répond jamais)", async () => {
      handler = () => undefined; // aucune réponse : la connexion reste pendante
      const id = insertLetter();
      const { status, send } = run(client());
      expect((await status).code).toBe("guichet_timeout");
      expectHeld(id, send);
      expect(seen.length).toBe(1); // une seule demande, aucune nouvelle tentative qui saute le guichet
    });

    it.each([401, 422, 500])("HTTP %i", async (code) => {
      handler = (_req, res) => json(res, code, { detail: "refus" });
      const id = insertLetter();
      const { status, send } = run(client());
      expect((await status).code).toBe(`guichet_http_${code}`);
      expectHeld(id, send);
    });

    it("arrêt (« Tout arrêter » posé depuis son bureau)", async () => {
      handler = (_req, res) => json(res, 200, { autorise: false, id: "g-1", raison: "arrêt : Claude-Alain a tout arrêté depuis son bureau" });
      const id = insertLetter();
      const { status, send } = run(client());
      expect((await status).code).toBe("guichet_arret");
      expectHeld(id, send);
    });

    it("plafond atteint", async () => {
      handler = (_req, res) => json(res, 200, { autorise: false, id: "g-1", raison: "plafond atteint (10 sur 10 en 24 heures)" });
      const id = insertLetter();
      const { status, send } = run(client());
      expect((await status).code).toBe("guichet_plafond");
      expectHeld(id, send);
    });

    it("boîte inconnue du registre", async () => {
      handler = (_req, res) => json(res, 200, { autorise: false, id: "g-1", raison: "boîte inconnue du registre" });
      const id = insertLetter();
      const { status, send } = run(client());
      expect((await status).code).toBe("guichet_boite");
      expectHeld(id, send);
    });

    it("« true » écrit comme du texte", async () => {
      handler = (_req, res) => json(res, 200, { autorise: "true", id: "g-1" });
      const id = insertLetter();
      const { status, send } = run(client());
      expect((await status).code).toBe("guichet_malformed");
      expectHeld(id, send);
    });

    it("oui sans identifiant", async () => {
      handler = (_req, res) => json(res, 200, { autorise: true, id: "" });
      const id = insertLetter();
      const { status, send } = run(client());
      expect((await status).code).toBe("guichet_malformed");
      expectHeld(id, send);
    });

    it("réponse non JSON", async () => {
      handler = (_req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("oui");
      };
      const id = insertLetter();
      const { status, send } = run(client());
      expect((await status).code).toBe("guichet_not_json");
      expectHeld(id, send);
    });

    it("redirection (jamais suivie : le jeton ne part pas ailleurs)", async () => {
      handler = (_req, res) => {
        res.writeHead(302, { location: "http://127.0.0.1:9/ailleurs" });
        res.end();
      };
      const id = insertLetter();
      const { status, send } = run(client());
      expect((await status).code).toMatch(/^guichet_(unreachable|http_302)$/);
      expectHeld(id, send);
    });

    it("jeton absent : rien ne part, aucune demande, aucune écriture", async () => {
      const id = insertLetter();
      const { status, send } = run(client({ token: null }));
      const result = await status;
      expect(result.status).toBe("not_configured");
      expect(result.code).toBe("guichet_not_configured");
      expect(send).not.toHaveBeenCalled();
      expect(seen.length).toBe(0);
      expect(getLetter(id).status).toBe("queued");
      expect(getLetter(id).scheduled_at).toBe(NOW - 1_000);
    });

    it("permission de plus de 12 s au moment d'envoyer : issue « annule », rien ne part", async () => {
      let clock = NOW;
      const guichet = guichetEnregistre((index) => {
        clock += 7_000; // deux demandes de 7 s : 14 s écoulées avant l'appel à Resend
        return { ok: true, id: `g-${index + 1}` };
      });
      const id = insertLetter();
      const { status, send } = run(guichet, { now: () => clock });
      expect((await status).code).toBe("guichet_delai");
      expect(send).not.toHaveBeenCalled();
      expect(guichet.record.issues).toEqual([
        { id: "g-1", issue: "annule" },
        { id: "g-2", issue: "annule" },
      ]);
      const letter = getLetter(id);
      expect(letter.status).toBe("queued");
      expect(letter.attempts).toBe(0);
    });

    it("un destinataire refusé sur trois : les permissions déjà accordées sont annulées", async () => {
      const guichet = guichetEnregistre((index) => (index === 1 ? { ok: false, code: "plafond" } : { ok: true, id: `g-${index + 1}` }));
      const id = insertLetter({ cc: "copie-fictive@bfs.admin.ch" });
      const { status, send } = run(guichet);
      expect((await status).code).toBe("guichet_plafond");
      expectHeld(id, send);
      expect(guichet.record.demandes.length).toBe(2); // on s'arrête au premier « non »
      expect(guichet.record.issues).toEqual([{ id: "g-1", issue: "annule" }]);
    });

    it("pause posée pendant les demandes au guichet : rien ne part, permissions annulées", async () => {
      const guichet = guichetEnregistre((index) => {
        writeLettersPause(true, NOW, getDb());
        return { ok: true, id: `g-${index + 1}` };
      });
      const id = insertLetter();
      const { status, send } = run(guichet);
      expect((await status).status).toBe("paused");
      expect(readLettersPause().paused).toBe(true);
      expect(send).not.toHaveBeenCalled();
      expect(guichet.record.issues.map((i) => i.issue)).toEqual(["annule", "annule"]);
      expect(getLetter(id).status).toBe("queued");
    });
  });

  describe("envoi accordé : une demande par destinataire, puis l'issue", () => {
    it("À et copie cachée : deux demandes avec la boîte du From, le jeton, puis « parti » pour chacune", async () => {
      const id = insertLetter({ to_address: "Boite-Fictive@BFS.Admin.ch" });
      const { status, send } = run(client());
      expect((await status).status).toBe("ok");
      expect(send).toHaveBeenCalledTimes(1);
      expect(getLetter(id).status).toBe("sent");

      const demandes = seen.filter((s) => s.path === "/api/guichet/demande");
      expect(demandes.map((d) => d.body)).toEqual([
        { boite: CONTACT, domaine: "bfs.admin.ch" },
        { boite: CONTACT, domaine: "openswissdata.com" }, // la copie cachée vers contact@ est un destinataire
      ]);
      for (const s of seen) expect(s.authorization).toBe(`Bearer ${JETON}`);
      // Le From réellement envoyé est la boîte annoncée.
      const prepared = send.mock.calls[0][0] as PreparedEmail;
      expect(prepared.from).toContain(CONTACT);
      expect(prepared.bcc).toEqual([CONTACT]);

      const issues = seen.filter((s) => s.path === "/api/guichet/issue").map((s) => s.body);
      expect(issues).toEqual([
        { id: "g-20260610-120100-1", issue: "parti" },
        { id: "g-20260610-120100-2", issue: "parti" },
      ]);
      // Ni adresse ni contenu vers le guichet : seulement la boîte, le domaine, l'identifiant et l'issue.
      const wire = JSON.stringify(seen.map((s) => s.body));
      expect(wire).not.toContain("boite-fictive");
      expect(wire).not.toContain("Demande de données");
    });

    it("avec une copie visible : trois demandes", async () => {
      const guichet = guichetEnregistre();
      insertLetter({ cc: "copie-fictive@zh.ch" });
      const { send } = run(guichet);
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(guichet.record.demandes.map((d) => d.domaine)).toEqual(["admin.ch", "zh.ch", "openswissdata.com"]);
    });

    it("un From configuré ailleurs ne change pas la boîte : les lettres partent toujours de contact@", async () => {
      process.env.RESEND_FROM_EMAIL = "OpenSwissData <hello@openswissdata.com>";
      const guichet = guichetEnregistre();
      insertLetter();
      const { status, send } = run(guichet);
      await status;
      expect(guichet.record.demandes.every((d) => d.boite === CONTACT)).toBe(true);
      expect((send.mock.calls[0][0] as PreparedEmail).from).toBe(`OpenSwissData <${CONTACT}>`);
    });

    it("refus net de Resend (HTTP 400) : issue « echec »", async () => {
      const guichet = guichetEnregistre();
      const id = insertLetter();
      const { status } = run(guichet, { send: async () => ({ sent: false, reason: "resend_error", details: "HTTP 400" }) });
      await status;
      expect(getLetter(id).status).toBe("failed");
      expect(guichet.record.issues.map((i) => i.issue)).toEqual(["echec", "echec"]);
    });

    it("Resend 500 (retentable) : issue « echec », et le nouvel essai redemande la permission", async () => {
      const guichet = guichetEnregistre();
      const id = insertLetter();
      await run(guichet, { send: async () => ({ sent: false, reason: "resend_error", details: "HTTP 500" }) }).status;
      expect(getLetter(id).status).toBe("queued");
      expect(guichet.record.issues.map((i) => i.issue)).toEqual(["echec", "echec"]);
      expect(guichet.record.demandes.length).toBe(2);
    });

    it("issue incertaine (réseau) : aucune issue dite, le bureau montrera « sans nouvelle »", async () => {
      const guichet = guichetEnregistre();
      const id = insertLetter();
      await run(guichet, { send: async () => ({ sent: false, reason: "resend_error", details: "network_error" }) }).status;
      expect(getLetter(id).status).toBe("failed");
      expect(guichet.record.issues).toEqual([]);
    });

    it("une lettre retenue n'est pas redemandée à chaque passage, puis l'est à son nouveau créneau", async () => {
      let refuse = true;
      const guichet = guichetEnregistre((index) => (refuse ? { ok: false, code: "arret" } : { ok: true, id: `g-${index + 1}` }));
      const id = insertLetter();
      await run(guichet).status;
      const nextSlot = getLetter(id).scheduled_at as number;
      expect(guichet.record.demandes.length).toBe(1);

      // Passages suivants avant le nouveau créneau : aucune demande.
      for (const minutes of [1, 2, 10, 20]) await run(guichet, { now: () => NOW + minutes * 60_000 }).status;
      expect(guichet.record.demandes.length).toBe(1);

      // Au nouveau créneau, après la levée de l'arrêt : nouvelle demande, puis envoi.
      refuse = false;
      const { status, send } = run(guichet, { now: () => nextSlot + 1_000 });
      await status;
      expect(send).toHaveBeenCalledTimes(1);
      expect(guichet.record.demandes.length).toBe(3); // 1 refusée + 2 (À et copie cachée)
      expect(getLetter(id).status).toBe("sent");
    });
  });

  describe("outils du client", () => {
    it("domaine du destinataire : minuscules, après le dernier @, punycode", () => {
      expect(recipientDomain("Boite@Admin.CH")).toBe("admin.ch");
      expect(recipientDomain("Nom <boite@zh.ch>")).toBe("zh.ch");
      expect(recipientDomain("boite@bücher.ch")).toBe("xn--bcher-kva.ch");
      expect(recipientDomain("sans-arobase")).toBeNull();
    });

    it("configuration : adresse en https seulement, jeton de 32 signes au moins", () => {
      expect(guichetUrl("https://exemple.invalid/api/guichet/")).toBe("https://exemple.invalid/api/guichet");
      expect(guichetUrl("http://exemple.invalid/api/guichet")).toBeNull(); // le jeton ne voyage jamais en clair
      expect(guichetUrl("https://moi:secret@exemple.invalid/api/guichet")).toBeNull();
      expect(guichetUrl("https://exemple.invalid/api/guichet?x=1")).toBeNull();
      expect(guichetUrl("")).toBeNull();
      expect(guichetToken("court")).toBeNull();
      expect(guichetToken("avec espace " + "x".repeat(40))).toBeNull();
      expect(guichetToken(` ${JETON} `)).toBe(JETON);
      // Sans variables, le client par défaut n'est pas configuré : rien ne peut partir.
      delete process.env.GUICHET_URL;
      delete process.env.GUICHET_JETON;
      expect(createGuichetClient().configured()).toBe(false);
    });

    it("raisons fixes du guichet → codes fermés", () => {
      expect(refusalCode("arrêt : Claude-Alain a tout arrêté depuis son bureau")).toBe("arret");
      expect(refusalCode("plafond atteint (3 sur 3 en 24 heures)")).toBe("plafond");
      expect(refusalCode("borne des demandes du jour atteinte pour ce programme")).toBe("borne");
      expect(refusalCode("boîte non permise à ce programme")).toBe("boite");
      expect(refusalCode("aucun envoi depuis cette boîte")).toBe("boite");
      expect(refusalCode("domaine du destinataire mal formé")).toBe("domaine");
      expect(refusalCode("registre des boîtes illisible : aucun envoi")).toBe("registre");
      expect(refusalCode(42)).toBe("refus");
    });
  });
});
