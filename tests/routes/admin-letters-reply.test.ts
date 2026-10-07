// Piste R du plan du 07.10.2026, resserrée après la relecture de sécurité du 07.10.2026 :
// GET /api/admin/letters/:id/reply relit, à la demande, EXACTEMENT le message déjà rattaché par
// `mail-watch.ts` à une lettre institutionnelle — jamais une seconde décision de rattachement.
// Correspondance stricte : hôte expéditeur EXACTEMENT égal à `reply_from` (jamais une relation de
// sous-domaine, jamais le nom affiché) ET date reçue EXACTEMENT égale à `reply_at`, calculée par la
// même formule que `attachReply` (mail-watch.ts, `internalDate ?? envelope.date`). Fenêtre de
// recherche bornée à partir de l'envoi réel de la lettre (`sent_at`), jamais « les 30 derniers
// jours » sans borne basse. Lecture seule (EXAMINE, BODY.PEEK), jamais de drapeau ni de déplacement,
// rien n'est stocké ni journalisé.
// Boîte IMAP simulée reprise de `tests/lib/mail-watch-letters.test.ts` (aucune connexion réelle,
// commandes d'écriture interdites), étendue pour vérifier qu'une même fuite d'UID entre deux
// dossiers ne renvoie jamais le mauvais message.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Message = {
  folder: string;
  uid: number;
  envelope: Record<string, unknown>;
  internalDate: Date;
  source: string;
  headers?: Record<string, string>;
  /** Pour simuler deux lignes du même en-tête (le premier doit gagner). */
  rawHeaderOverride?: string;
};
const imap = vi.hoisted(() => ({
  messages: [] as Message[],
  calls: [] as Array<{ name: string; args: unknown[] }>,
  forbidden: [] as string[],
  folders: [{ path: "INBOX" }, { path: "Spam", specialUse: "\\Junk" }] as Array<{ path: string; specialUse?: string }>,
  failConnect: false,
}));
vi.mock("imapflow", () => {
  const forbid = (name: string) => async () => {
    imap.forbidden.push(name);
    throw new Error(`commande interdite : ${name}`);
  };
  class ImapFlow {
    current = "";
    constructor(options: { host: string }) {
      imap.calls.push({ name: "constructor", args: [options.host] });
    }
    on() {}
    async connect() {
      if (imap.failConnect) throw new Error("imap indisponible");
    }
    close() {}
    async list() {
      imap.calls.push({ name: "list", args: [] });
      return imap.folders;
    }
    async mailboxOpen(path: string, options: unknown) {
      imap.calls.push({ name: "mailboxOpen", args: [path, options] });
      this.current = path;
      return { path, uidValidity: 7n };
    }
    async search(query: unknown, options: unknown) {
      imap.calls.push({ name: "search", args: [query, options] });
      // Le vrai serveur IMAP ne filtrerait sur `from` que par SOUS-CHAÎNE (cf. mail-watch.ts) : le
      // simulateur renvoie délibérément TOUT le dossier, pour que seul le code (hôte EXACT + date
      // EXACTE) décide — un filtrage fin ici masquerait une régression du code lui-même.
      return imap.messages.filter((m) => m.folder === this.current).map((m) => m.uid);
    }
    async *fetch(range: number[], query: unknown, options: unknown) {
      imap.calls.push({ name: "fetch", args: [range, query, options] });
      for (const m of imap.messages.filter((x) => x.folder === this.current && range.includes(x.uid))) {
        yield { uid: m.uid, envelope: m.envelope, internalDate: m.internalDate };
      }
    }
    async fetchOne(uid: string, query: { source?: { maxLength: number }; headers?: string[] }, options: unknown) {
      imap.calls.push({ name: "fetchOne", args: [uid, query, options] });
      // Filtré sur `this.current` : reproduit la portée par dossier d'un vrai serveur IMAP — un
      // UID n'existe que dans le dossier actuellement ouvert.
      const m = imap.messages.find((x) => x.folder === this.current && String(x.uid) === uid);
      if (!m) return false;
      if (query.headers) {
        if (m.rawHeaderOverride !== undefined) return { uid: m.uid, headers: Buffer.from(m.rawHeaderOverride) };
        const wanted = new Set(query.headers.map((h) => h.toLowerCase()));
        const lines = Object.entries(m.headers ?? {})
          .filter(([k]) => wanted.has(k.toLowerCase()))
          .map(([k, v]) => `${k}: ${v}`);
        return { uid: m.uid, headers: Buffer.from(lines.length ? `${lines.join("\r\n")}\r\n` : "") };
      }
      return { uid: m.uid, source: Buffer.from(m.source) };
    }
    messageFlagsAdd = forbid("messageFlagsAdd");
    messageFlagsSet = forbid("messageFlagsSet");
    messageFlagsRemove = forbid("messageFlagsRemove");
    setFlagColor = forbid("setFlagColor");
    messageDelete = forbid("messageDelete");
    messageMove = forbid("messageMove");
    messageCopy = forbid("messageCopy");
    append = forbid("append");
    mailboxCreate = forbid("mailboxCreate");
    mailboxRename = forbid("mailboxRename");
    mailboxDelete = forbid("mailboxDelete");
  }
  return { ImapFlow };
});

import { getDb, closeDb } from "../../src/lib/db.js";
import { seal, clearCrmCache } from "../../src/lib/crm-source.js";
import { createApp } from "../../src/index.js";
import { createAdminLettersRoute } from "../../src/routes/admin-letters.js";

const SECRET = "test-secret-1234567890";
const DAY = 86_400_000;

function buildApp() {
  const app = new Hono();
  app.route("/", createAdminLettersRoute());
  return app;
}

function insertLetter(overrides: Record<string, unknown> = {}): string {
  const db = getDb();
  const id = (overrides.id as string) ?? `id-${Math.random().toString(36).slice(2)}`;
  const row = {
    id,
    kind: "letter",
    parent_id: null,
    to_address: "boite-fictive@seco.admin.ch",
    cc: null,
    subject: "Autorisation de reprise",
    body: "Texte de la lettre.",
    purpose: "Clarification",
    status: "sent",
    scheduled_at: 0,
    lease_until: null,
    attempted_at: null,
    attempts: 0,
    resend_id: null,
    sent_at: 0,
    reply_at: null,
    reply_from: null,
    reply_subject: null,
    reply_extract: null,
    reply_kind: null,
    reply_processed_at: null,
    created_at: 0,
    ...overrides,
    id,
  };
  db.prepare(
    `INSERT INTO institutional_letters
      (id, kind, parent_id, to_address, cc, subject, body, purpose, status, scheduled_at,
       lease_until, attempted_at, attempts, resend_id, sent_at, reply_at, reply_from, reply_subject,
       reply_extract, reply_kind, reply_processed_at, created_at)
     VALUES
      (@id, @kind, @parent_id, @to_address, @cc, @subject, @body, @purpose, @status, @scheduled_at,
       @lease_until, @attempted_at, @attempts, @resend_id, @sent_at, @reply_at, @reply_from, @reply_subject,
       @reply_extract, @reply_kind, @reply_processed_at, @created_at)`,
  ).run(row);
  return id;
}

const msg = (over: Partial<Message> & { uid: number; address: string; subject: string; receivedAt: number; body?: string; name?: string }): Message => ({
  folder: "INBOX",
  uid: over.uid,
  internalDate: new Date(over.receivedAt),
  source: `From: ${over.name ?? "Service"} <${over.address}>\r\nSubject: ${over.subject}\r\n\r\n${over.body ?? "Corps de la réponse."}`,
  envelope: { messageId: `<m-${over.uid}@x.test>`, from: [{ name: over.name ?? "Service", address: over.address }], subject: over.subject, date: new Date(over.receivedAt) },
  ...over,
});

describe("GET /api/admin/letters/:id/reply", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-letters-reply-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.ADMIN_SECRET = SECRET;
    process.env.OSD_BACKUP_KEY = "c".repeat(64);
    imap.messages = [];
    imap.calls = [];
    imap.forbidden = [];
    imap.failConnect = false;
    clearCrmCache();
    getDb(); // ouvre la base fictive, migrations comprises
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.ADMIN_SECRET;
    delete process.env.OSD_BACKUP_KEY;
  });

  /** Connecte la boîte `support` (contact@openswissdata.com), comme le ferait le bureau. */
  function connectSupportMailbox(): void {
    getDb()
      .prepare("INSERT INTO crm_connections(name,secret_encrypted,updated_at) VALUES(?,?,?)")
      .run("support", seal(JSON.stringify({ user: "contact@openswissdata.com", pass: "fictif" })), 0);
  }

  it("401 sans en-tête, 401 avec un mauvais secret", async () => {
    const app = buildApp();
    const id = insertLetter({ reply_at: 1000, reply_from: "seco.admin.ch" });
    const noHeader = await app.request(`/${id}/reply`);
    expect(noHeader.status).toBe(401);
    const bad = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": "faux" } });
    expect(bad.status).toBe(401);
  });

  it("401 sur le chemin monté en production (src/index.ts), avant même d'atteindre la logique de la route", async () => {
    const id = insertLetter({ reply_at: 1000, reply_from: "seco.admin.ch" });
    const app = createApp();
    const res = await app.request(`/api/admin/letters/${id}/reply`);
    expect(res.status).toBe(401);
  });

  it("404 : lettre inconnue", async () => {
    const app = buildApp();
    const res = await app.request("/id-inconnu/reply", { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("404 : lettre connue mais sans réponse rattachée (reply_at NULL)", async () => {
    const app = buildApp();
    const id = insertLetter({ reply_at: null, reply_from: null });
    const res = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("503 : boîte non connectée (mailbox_not_configured)", async () => {
    const app = buildApp();
    const id = insertLetter({ reply_at: 1000, reply_from: "seco.admin.ch" }); // pas de connectSupportMailbox()
    const res = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("mailbox_not_configured");
  });

  it("502 : erreur IMAP (mailbox_unavailable)", async () => {
    connectSupportMailbox();
    imap.failConnect = true;
    const app = buildApp();
    const id = insertLetter({ reply_at: 1000, reply_from: "seco.admin.ch" });
    const res = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("mailbox_unavailable");
  });

  it("rend EXACTEMENT le message rattaché : letter_id, from_domain (jamais l'adresse), subject, date ISO, texte, premier Authentication-Results, reply_kind", async () => {
    connectSupportMailbox();
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - 5 * DAY, reply_at: now - DAY, reply_from: "seco.admin.ch", reply_kind: "unverified" });
    imap.messages = [
      msg({
        uid: 1,
        address: "juriste@seco.admin.ch",
        subject: "Re: Autorisation de reprise",
        receivedAt: now - DAY, // == reply_at, à la milliseconde
        body: "Bonjour, voici notre réponse sans adresse ni arobase dans le corps.",
        // Deux lignes du même en-tête : seule la PREMIÈRE doit être rendue (un serveur receveur
        // ajoute la sienne en tête ; une occurrence plus bas peut être forgée).
        rawHeaderOverride: "Authentication-Results: mx.infomaniak.ch; dkim=pass header.d=seco.admin.ch\r\nAuthentication-Results: forgee; dkim=pass header.d=evil.example\r\n",
      }),
    ];
    const app = buildApp();
    const res = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.letter_id).toBe(id);
    expect(body.from_domain).toBe("seco.admin.ch");
    expect(body.from_domain).not.toMatch(/@/);
    expect(body.subject).toBe("Re: Autorisation de reprise");
    expect(body.date).toBe(new Date(now - DAY).toISOString());
    expect(body.text).toBe("Bonjour, voici notre réponse sans adresse ni arobase dans le corps.");
    expect(body.text).not.toMatch(/@/);
    expect(body.authentication_results).toBe("mx.infomaniak.ch; dkim=pass header.d=seco.admin.ch");
    expect(body.reply_kind).toBe("unverified");
    expect(JSON.stringify(body)).not.toMatch(/juriste/);
  });

  it("texte tronqué à 20 000 caractères au plus", async () => {
    connectSupportMailbox();
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - 5 * DAY, reply_at: now - DAY, reply_from: "seco.admin.ch" });
    const longBody = "A".repeat(25_000);
    imap.messages = [msg({ uid: 1, address: "juriste@seco.admin.ch", subject: "Re: Autorisation de reprise", receivedAt: now - DAY, body: longBody })];
    const app = buildApp();
    const res = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    const body = await res.json();
    expect(Array.from(body.text as string).length).toBe(20_000);
    expect((body.text as string).endsWith("…")).toBe(true);
  });

  it("404 reply_not_found : un message du même domaine, plus RÉCENT, mais qui n'est PAS le message rattaché — jamais rendu à sa place", async () => {
    connectSupportMailbox();
    const now = Date.UTC(2026, 9, 10, 12, 0);
    // reply_at pointe précisément sur le message A (le plus ANCIEN des deux) — c'est lui, et lui
    // seul, que `mail-watch.ts` a rattaché ; B est un message non rattaché plus récent du même domaine.
    const id = insertLetter({ sent_at: now - 10 * DAY, reply_at: now - 5 * DAY, reply_from: "seco.admin.ch" });
    imap.messages = [
      msg({ uid: 1, address: "juriste@seco.admin.ch", subject: "Re: Autorisation de reprise", receivedAt: now - 5 * DAY, body: "Message rattaché." }),
      msg({ uid: 2, address: "juriste@seco.admin.ch", subject: "Autre échange", receivedAt: now - 1 * DAY, body: "Message plus récent, jamais rattaché." }),
    ];
    const app = buildApp();
    const res = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("Message rattaché.");
  });

  it("404 reply_not_found : domaine PARENT (admin.ch) pour une lettre rattachée à seco.admin.ch — jamais une relation de sous-domaine", async () => {
    connectSupportMailbox();
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - 5 * DAY, reply_at: now - DAY, reply_from: "seco.admin.ch" });
    // Même date EXACTE que reply_at, mais un domaine PARENT (admin.ch, pas seco.admin.ch) : ne doit
    // jamais être pris pour le message rattaché, même si un domaine parent peut légitimement signer
    // DKIM pour un sous-domaine (cette règle d'alignement ne s'applique PAS ici).
    imap.messages = [msg({ uid: 1, address: "juriste@admin.ch", subject: "Re: Autorisation de reprise", receivedAt: now - DAY })];
    const app = buildApp();
    const res = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("reply_not_found");
  });

  it("404 reply_not_found : un message existe mais d'un AUTRE domaine sans relation — jamais rendu", async () => {
    connectSupportMailbox();
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - 5 * DAY, reply_at: now - DAY, reply_from: "seco.admin.ch" });
    imap.messages = [msg({ uid: 1, address: "quidam@autre.example", subject: "Re: Autorisation de reprise", receivedAt: now - DAY })];
    const app = buildApp();
    const res = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("reply_not_found");
  });

  it("404 reply_not_found : nom affiché contenant le domaine attendu, mais adresse réelle ailleurs — lu dans l'adresse, jamais le nom affiché", async () => {
    connectSupportMailbox();
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - 5 * DAY, reply_at: now - DAY, reply_from: "seco.admin.ch" });
    imap.messages = [
      msg({ uid: 1, address: "x@evil.example", name: "SECO - seco.admin.ch", subject: "Re: Autorisation de reprise", receivedAt: now - DAY }),
    ];
    const app = buildApp();
    const res = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("reply_not_found");
  });

  it("404 reply_not_found : lettre marquée à la main (reply_at/reply_from posés sans message réel derrière)", async () => {
    connectSupportMailbox();
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - 5 * DAY, reply_at: now - DAY, reply_from: "seco.admin.ch" });
    imap.messages = []; // boîte vide : rien ne correspond à la trace posée à la main
    const app = buildApp();
    const res = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("reply_not_found");
  });

  it("404 reply_not_found : message antérieur à l'envoi de la lettre (sent_at) — jamais rendu même si domaine et date 'collent' par ailleurs", async () => {
    connectSupportMailbox();
    const now = Date.UTC(2026, 9, 10, 12, 0);
    // État incohérent délibéré (reply_at AVANT sent_at) : vérifie que la borne basse de recherche
    // (sent_at) est bien appliquée en code, indépendamment de l'égalité stricte domaine/date.
    const id = insertLetter({ sent_at: now - 5 * DAY, reply_at: now - 10 * DAY, reply_from: "seco.admin.ch" });
    imap.messages = [msg({ uid: 1, address: "juriste@seco.admin.ch", subject: "Re: Autorisation de reprise", receivedAt: now - 10 * DAY })];
    const app = buildApp();
    const res = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("reply_not_found");
  });

  it("une même valeur d'UID dans deux dossiers différents ne mélange jamais les messages (Spam rattaché, INBOX non rattaché ignoré)", async () => {
    connectSupportMailbox();
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - 5 * DAY, reply_at: now - DAY, reply_from: "seco.admin.ch" });
    imap.messages = [
      msg({ folder: "INBOX", uid: 1, address: "quidam@autre.example", subject: "Bulletin météo", receivedAt: now - 2 * DAY, body: "Contenu INBOX, ne doit jamais sortir." }),
      msg({ folder: "Spam", uid: 1, address: "juriste@seco.admin.ch", subject: "Re: Autorisation de reprise", receivedAt: now - DAY, body: "Contenu Spam, rattaché." }),
    ];
    const app = buildApp();
    const res = await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("Contenu Spam, rattaché.");
    expect(body.from_domain).toBe("seco.admin.ch");
  });

  it("jamais de commande d'écriture IMAP, et chaque mailboxOpen est en lecture seule (EXAMINE)", async () => {
    connectSupportMailbox();
    const now = Date.UTC(2026, 9, 10, 12, 0);
    const id = insertLetter({ sent_at: now - 5 * DAY, reply_at: now - DAY, reply_from: "seco.admin.ch" });
    imap.messages = [msg({ uid: 1, address: "juriste@seco.admin.ch", subject: "Re: Autorisation de reprise", receivedAt: now - DAY })];
    const app = buildApp();
    await app.request(`/${id}/reply`, { headers: { "x-admin-secret": SECRET } });
    expect(imap.forbidden).toEqual([]);
    const opens = imap.calls.filter((c) => c.name === "mailboxOpen");
    expect(opens.length).toBeGreaterThan(0);
    for (const call of opens) expect((call.args[1] as { readOnly?: boolean } | undefined)?.readOnly).toBe(true);
  });
});
