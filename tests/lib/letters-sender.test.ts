import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, closeDb } from "../../src/lib/db.js";
import { runLettersSender, readLettersSenderStatus, startLettersSender } from "../../src/lib/letters-sender.js";
import { scheduleSlot, toZurichParts } from "../../src/lib/letters.js";
import type { EmailSendResult, PreparedEmail } from "../../src/lib/email.js";

// Mercredi ouvrable, dans la fenêtre 09:05-17:30 Zurich, sur une minute qui n'est PAS un multiple de
// 5 (10:00 UTC = 12:00 Zurich en était un : `isSendableNow` l'aurait refusée, cf. Review Focus #4).
// On ne teste jamais ici le calcul précis de `scheduleSlot`, déjà couvert par letters.test.ts.
const NOW = Date.UTC(2026, 5, 10, 10, 1); // 10 juin 2026, 10:01 UTC = 12:01 Zurich (CEST, UTC+2)
// Même mercredi, heure d'été (UTC+2) : raccourci pour écrire des horaires Zurich lisibles dans le
// groupe de tests « Review Focus #4 » ci-dessous, sans reconstruire le calcul général de fuseau.
const zurichSummer = (hour: number, minute: number) => Date.UTC(2026, 5, 10, hour - 2, minute);
const TOKEN = "123456789:jeton-fictif-TELEGRAM-abcdefghij";
const CHAT = "424242";

const telegramOk = () => vi.fn(async () => Response.json({ ok: true, result: { message_id: 1 } }));
const sentTexts = (fetcher: ReturnType<typeof telegramOk>) =>
  fetcher.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body)) as { chat_id: string; text: string });

function insertLetter(overrides: Record<string, unknown> = {}): string {
  const db = getDb();
  const id = (overrides.id as string) ?? `id-${Math.random().toString(36).slice(2)}`;
  const row = {
    id,
    kind: "letter",
    parent_id: null,
    to_address: "boite-fictive@admin.ch",
    cc: null,
    subject: "Demande de données",
    body: "Texte de la lettre.\n\nMeilleures salutations\n\nClaude-Alain Martin\nOpenSwissData\ncontact@openswissdata.com",
    purpose: "Clarification de réutilisation",
    status: "queued",
    scheduled_at: NOW,
    lease_until: null,
    attempted_at: null,
    attempts: 0,
    resend_id: null,
    sent_at: null,
    reply_at: null,
    reply_from: null,
    reply_subject: null,
    reply_extract: null,
    reply_kind: null,
    reply_processed_at: null,
    created_at: NOW,
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

function getLetter(id: string): Record<string, unknown> {
  return getDb().prepare("SELECT * FROM institutional_letters WHERE id=?").get(id) as Record<string, unknown>;
}

function countReminders(parentId: string): number {
  return (
    getDb().prepare("SELECT COUNT(*) AS n FROM institutional_letters WHERE parent_id=? AND kind='reminder'").get(parentId) as {
      n: number;
    }
  ).n;
}

type Overrides = {
  now?: () => number;
  rng?: () => number;
  send?: (payload: PreparedEmail, idempotencyKey?: string) => Promise<EmailSendResult>;
  fetch?: typeof fetch;
  hasApiKey?: () => boolean;
};

/** Un passage, déterministe et sans réseau : clé Resend « présente » par défaut (surchargeable). */
function run(overrides: Overrides = {}) {
  return runLettersSender({
    now: () => NOW,
    rng: () => 0,
    send: async () => ({ sent: true }),
    fetch: (async () => Response.json({ ok: true })) as unknown as typeof fetch,
    hasApiKey: () => true,
    ...overrides,
  });
}

describe("Expéditeur périodique des lettres institutionnelles", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-lettres-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.OSD_VEILLE_TELEGRAM_TOKEN = TOKEN;
    process.env.OSD_VEILLE_TELEGRAM_CHAT = CHAT;
    getDb(); // ouvre la base fictive, migrations comprises
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.OSD_VEILLE_TELEGRAM_TOKEN;
    delete process.env.OSD_VEILLE_TELEGRAM_CHAT;
  });

  it("envoie la lettre dont le créneau est atteint, marque `sent` et prévient Telegram (domaine seulement)", async () => {
    const id = insertLetter({ scheduled_at: NOW - 1_000 });
    const send = vi.fn(async (): Promise<EmailSendResult> => ({ sent: true, providerId: "abc12345-1111-2222-3333-444444444444" }));
    const fetcher = telegramOk();

    const status = await run({ send, fetch: fetcher });

    expect(send).toHaveBeenCalledTimes(1);
    const [payload, idempotencyKey] = send.mock.calls[0];
    expect(idempotencyKey).toBe(`letter-${id}`);
    expect(payload.to).toEqual(["boite-fictive@admin.ch"]);
    expect(payload.bcc).toEqual(["contact@openswissdata.com"]);
    expect(payload.reply_to).toBe("contact@openswissdata.com");
    expect(payload.cc).toBeUndefined();

    const row = getLetter(id);
    expect(row.status).toBe("sent");
    expect(row.resend_id).toBe("abc12345-1111-2222-3333-444444444444");
    expect(row.sent_at).toBe(NOW);
    expect(row.lease_until).toBeNull();
    expect(status.sent).toBe(1);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const text = sentTexts(fetcher)[0].text;
    expect(text).toContain("admin.ch");
    expect(text).not.toContain("boite-fictive@admin.ch");
  });

  it("transmet aussi le cc à Resend quand il est présent", async () => {
    const id = insertLetter({ scheduled_at: NOW - 1_000, cc: "autre-boite@admin.ch" });
    const send = vi.fn(async (): Promise<EmailSendResult> => ({ sent: true }));
    await run({ send });
    expect(send.mock.calls[0][0].cc).toEqual(["autre-boite@admin.ch"]);
    expect(getLetter(id).status).toBe("sent");
  });

  it("marque `sent` même quand Resend ne renvoie pas d'identifiant (décision du 06.10, divergence avec le plan)", async () => {
    const id = insertLetter({ scheduled_at: NOW - 1_000 });
    await run({ send: async () => ({ sent: true }) });
    const row = getLetter(id);
    expect(row.status).toBe("sent");
    expect(row.resend_id).toBeNull();
  });

  it("une lettre en retard de dix minutes ou plus est replanifiée, jamais envoyée en retard", async () => {
    const id = insertLetter({ scheduled_at: NOW - 11 * 60_000 });
    const send = vi.fn();
    const status = await run({ send });

    expect(send).not.toHaveBeenCalled();
    const row = getLetter(id);
    expect(row.status).toBe("queued");
    expect(row.scheduled_at).not.toBe(NOW - 11 * 60_000);
    expect(row.scheduled_at as number).toBeGreaterThan(NOW);
    expect(status.total_rescheduled).toBe(1);
  });

  it("une lettre en retard de moins de dix minutes part normalement", async () => {
    const id = insertLetter({ scheduled_at: NOW - 9 * 60_000 });
    const send = vi.fn(async (): Promise<EmailSendResult> => ({ sent: true }));
    await run({ send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(getLetter(id).status).toBe("sent");
  });

  it("deux passages concurrents sur la même lettre due n'envoient qu'une seule fois", async () => {
    const id = insertLetter({ scheduled_at: NOW - 1_000 });
    let resolveSend: ((v: EmailSendResult) => void) | null = null;
    const send = vi.fn(
      () =>
        new Promise<EmailSendResult>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const fetcher = telegramOk();

    // La réclamation (SELECT+UPDATE conditionnel) est synchrone, sans `await` avant elle : le second
    // passage, lancé juste après, s'exécute déjà après que le premier a marqué la lettre `sending`.
    const p1 = run({ send, fetch: fetcher });
    const p2 = run({ send, fetch: fetcher });
    expect(send).toHaveBeenCalledTimes(1); // le second passage n'a rien trouvé à réclamer
    resolveSend?.({ sent: true });
    await Promise.all([p1, p2]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(getLetter(id).status).toBe("sent");
  });

  it("un bail `sending` expiré passe directement `failed` (issue incertaine, correction I4b) : jamais de retour en `queued`", async () => {
    const id = insertLetter({ status: "sending", lease_until: NOW - 1_000, attempts: 0, scheduled_at: NOW - 20 * 60_000 });
    const send = vi.fn();
    const fetcher = telegramOk();
    await run({ send, fetch: fetcher });
    expect(send).not.toHaveBeenCalled(); // jamais un second envoi quand on ne sait pas si le premier est parti
    const row = getLetter(id);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(row.lease_until).toBeNull();
    const text = sentTexts(fetcher)[0].text;
    expect(text).toContain("issue incertaine");
    expect(text).toContain("admin.ch");
    expect(text).not.toContain("boite-fictive@admin.ch");
  });

  it("un échec transitoire retourne en `queued` (`attempts+1`), le passage suivant réussit", async () => {
    const id = insertLetter({ scheduled_at: NOW - 1_000 });
    const send = vi
      .fn<(payload: PreparedEmail, key?: string) => Promise<EmailSendResult>>()
      .mockResolvedValueOnce({ sent: false, reason: "resend_error", details: "HTTP 500" })
      .mockResolvedValueOnce({ sent: true, providerId: "abc12345-1111-2222-3333-444444444444" });
    const fetcher = telegramOk();

    await run({ send, fetch: fetcher, now: () => NOW });
    let row = getLetter(id);
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(fetcher).not.toHaveBeenCalled(); // pas encore un échec définitif : pas d'alerte

    await run({ send, fetch: fetcher, now: () => NOW + 60_000 });
    row = getLetter(id);
    expect(row.status).toBe("sent");
    expect(row.resend_id).toBe("abc12345-1111-2222-3333-444444444444");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("trois échecs consécutifs marquent `failed` et alertent Telegram ; jamais avant", async () => {
    const id = insertLetter({ scheduled_at: NOW - 1_000 });
    const send = vi.fn(async (): Promise<EmailSendResult> => ({ sent: false, reason: "resend_error", details: "HTTP 500" }));
    const fetcher = telegramOk();

    await run({ send, fetch: fetcher, now: () => NOW });
    expect(getLetter(id).status).toBe("queued");
    expect(fetcher).not.toHaveBeenCalled();

    await run({ send, fetch: fetcher, now: () => NOW + 60_000 });
    expect(getLetter(id).status).toBe("queued");
    expect(fetcher).not.toHaveBeenCalled();

    await run({ send, fetch: fetcher, now: () => NOW + 120_000 });
    const row = getLetter(id);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("un destinataire devenu interdit échoue sans envoi, Telegram ne cite jamais l'adresse complète", async () => {
    const id = insertLetter({ scheduled_at: NOW - 1_000, to_address: "boite@example.com" });
    const send = vi.fn();
    const fetcher = telegramOk();

    await run({ send, fetch: fetcher });

    expect(send).not.toHaveBeenCalled();
    const row = getLetter(id);
    expect(row.status).toBe("failed");
    const text = sentTexts(fetcher)[0].text;
    expect(text).toContain("non autorisé");
    expect(text).not.toContain("boite@example.com");
  });

  it("un cc devenu interdit échoue aussi, sans envoi", async () => {
    const id = insertLetter({ scheduled_at: NOW - 1_000, cc: "boite@example.com" });
    const send = vi.fn();
    await run({ send });
    expect(send).not.toHaveBeenCalled();
    expect(getLetter(id).status).toBe("failed");
  });

  it("sans clé Resend configurée : rien n'est envoyé, rien n'est modifié en base", async () => {
    const dueId = insertLetter({ scheduled_at: NOW - 1_000 });
    const leasedId = insertLetter({ status: "sending", lease_until: NOW - 1_000, attempts: 1, scheduled_at: NOW - 500_000 });
    const send = vi.fn();
    const fetcher = telegramOk();

    const status = await run({ send, fetch: fetcher, hasApiKey: () => false });

    expect(send).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(status.status).toBe("not_configured");
    expect(status.code).toBe("no_api_key");

    const due = getLetter(dueId);
    expect(due.status).toBe("queued");
    expect(due.attempts).toBe(0);
    expect(due.scheduled_at).toBe(NOW - 1_000);

    const leased = getLetter(leasedId);
    expect(leased.status).toBe("sending");
    expect(leased.attempts).toBe(1);
    expect(leased.lease_until).toBe(NOW - 1_000);
  });

  it("échappe le html du corps (&, <, >, \") et pose des <br> pour les retours à la ligne, tout en gardant le texte brut intact", async () => {
    const body = 'Bonjour <FINMA> & "vous",\nDeuxième ligne.';
    const id = insertLetter({ scheduled_at: NOW - 1_000, body });
    const send = vi.fn(async (): Promise<EmailSendResult> => ({ sent: true }));

    await run({ send });

    const payload = send.mock.calls[0][0];
    expect(payload.text).toBe(body);
    expect(payload.html).toContain("&lt;FINMA&gt;");
    expect(payload.html).toContain("&amp;");
    expect(payload.html).toContain("&quot;vous&quot;");
    expect(payload.html).toContain("<br>");
    expect(payload.html).not.toContain("<FINMA>");
    expect(getLetter(id).status).toBe("sent");
  });

  describe("jamais hors créneau même si un passage glisse (Review Focus #4)", () => {
    it("un passage qui glisse sur une minute multiple de 5 attend plutôt que d'envoyer, puis part au passage suivant", async () => {
      const id = insertLetter({ scheduled_at: zurichSummer(12, 14) });
      const send = vi.fn(async (): Promise<EmailSendResult> => ({ sent: true }));

      // Le passage prévu glisse à 12:15 (minute multiple de 5, hors créneau) : seulement 1 min de
      // retard, bien avant le seuil des dix minutes qui déclenche la replanification.
      await run({ send, now: () => zurichSummer(12, 15) });
      expect(send).not.toHaveBeenCalled();
      let row = getLetter(id);
      expect(row.status).toBe("queued");
      expect(row.scheduled_at).toBe(zurichSummer(12, 14)); // pas touchée : ni envoyée, ni replanifiée

      await run({ send, now: () => zurichSummer(12, 16) });
      expect(send).toHaveBeenCalledTimes(1);
      row = getLetter(id);
      expect(row.status).toBe("sent");
    });

    it("après 17:30, une lettre pas encore en retard de dix minutes attend plutôt que de partir hors créneau", async () => {
      const id = insertLetter({ scheduled_at: zurichSummer(17, 29) });
      const send = vi.fn();

      // 17:35 : six minutes de retard sur 17:29, donc pas « en retard » au sens des dix minutes —
      // mais 17:35 est après la fermeture de la fenêtre (17:30). Sans ce garde-fou, elle partirait
      // hors créneau ; avec lui, elle attend simplement un prochain passage dans la fenêtre.
      const status = await run({ send, now: () => zurichSummer(17, 35) });

      expect(send).not.toHaveBeenCalled();
      const row = getLetter(id);
      expect(row.status).toBe("queued");
      expect(row.scheduled_at).toBe(zurichSummer(17, 29));
      expect(status.total_rescheduled).toBe(0);
    });

    it("la même lettre, encore en attente dix minutes après son créneau, est replanifiée au jour ouvré suivant", async () => {
      const id = insertLetter({ scheduled_at: zurichSummer(17, 29) });
      const send = vi.fn();

      const status = await run({ send, now: () => zurichSummer(17, 39) }); // dix minutes de retard

      expect(send).not.toHaveBeenCalled();
      const row = getLetter(id);
      expect(row.status).toBe("queued");
      expect(row.scheduled_at as number).toBeGreaterThan(zurichSummer(17, 29));
      expect(status.total_rescheduled).toBe(1);
    });

    it("I2b : à 17:29, le double contrôle (t et t+60s) attend — la minute suivante serait hors créneau même si celle-ci ne l'est pas", async () => {
      // Sonde b (relecture Opus, 06.10) : un passage qui démarre juste avant la fermeture peut
      // prendre jusqu'à une minute à répondre (retentatives Resend, Telegram). Le simple contrôle
      // `isSendableNow(now)` aurait laissé partir cette lettre à 17:29 ; le double contrôle l'arrête.
      const id = insertLetter({ scheduled_at: zurichSummer(17, 28) }); // due depuis 1 min, pas « en retard »
      const send = vi.fn();
      await run({ send, now: () => zurichSummer(17, 29) });
      expect(send).not.toHaveBeenCalled();
      expect(getLetter(id).status).toBe("queued");
    });
  });

  describe("relance automatique unique", () => {
    // Lundi 5 octobre 2026 → lundi 26 octobre 2026 : exactement trois semaines, aucun jour férié
    // fédéral en octobre → exactement 15 jours ouvrés (voir tests/lib/letters.test.ts).
    const SENT_AT = Date.UTC(2026, 9, 5, 12, 0);
    const DUE_NOW = Date.UTC(2026, 9, 26, 12, 0);
    const NOT_YET_NOW = Date.UTC(2026, 9, 23, 12, 0); // 14 jours ouvrés seulement

    it("crée une relance après 15 jours ouvrés sans réponse, planifiée par scheduleSlot", async () => {
      const id = insertLetter({
        status: "sent",
        sent_at: SENT_AT,
        scheduled_at: SENT_AT - 60_000,
        subject: "Autorisation de reprise",
        body: "Texte original.\n\nMeilleures salutations\n\nClaude-Alain Martin\nOpenSwissData\ncontact@openswissdata.com",
      });
      const send = vi.fn();

      const status = await run({ send, now: () => DUE_NOW });

      expect(send).not.toHaveBeenCalled(); // la relance est créée `queued`, pas envoyée ce passage-ci
      expect(countReminders(id)).toBe(1);
      expect(status.total_reminders_created).toBe(1);

      const reminder = getDb()
        .prepare("SELECT * FROM institutional_letters WHERE parent_id=? AND kind='reminder'")
        .get(id) as Record<string, unknown>;
      expect(reminder.subject).toBe("Relance : Autorisation de reprise");
      expect(reminder.to_address).toBe("boite-fictive@admin.ch");
      expect(reminder.status).toBe("queued");
      expect(reminder.scheduled_at as number).toBeGreaterThan(DUE_NOW);
      expect(reminder.body as string).toContain("05.10.2026");
      expect(reminder.body as string).toContain("Meilleures salutations");
      expect(reminder.body as string).toContain("Claude-Alain Martin");
    });

    it("reprend le destinataire (cc compris) et le motif de la lettre d'origine", async () => {
      const id = insertLetter({
        status: "sent",
        sent_at: SENT_AT,
        cc: "autre-boite@admin.ch",
        purpose: "Clarification des conditions",
      });
      await run({ send: vi.fn(), now: () => DUE_NOW });
      const reminder = getDb()
        .prepare("SELECT * FROM institutional_letters WHERE parent_id=? AND kind='reminder'")
        .get(id) as Record<string, unknown>;
      expect(reminder.cc).toBe("autre-boite@admin.ch");
      expect(reminder.purpose).toBe("Clarification des conditions");
    });

    it("pas encore 15 jours ouvrés : aucune relance", async () => {
      const id = insertLetter({ status: "sent", sent_at: SENT_AT });
      await run({ send: vi.fn(), now: () => NOT_YET_NOW });
      expect(countReminders(id)).toBe(0);
    });

    it("jamais de relance après une réponse humaine", async () => {
      const id = insertLetter({ status: "sent", sent_at: SENT_AT, reply_at: SENT_AT + 1000, reply_kind: "human" });
      await run({ send: vi.fn(), now: () => DUE_NOW });
      expect(countReminders(id)).toBe(0);
    });

    it("une réponse automatique n'arrête pas la relance", async () => {
      const id = insertLetter({ status: "sent", sent_at: SENT_AT, reply_at: SENT_AT + 1000, reply_kind: "auto" });
      await run({ send: vi.fn(), now: () => DUE_NOW });
      expect(countReminders(id)).toBe(1);
    });

    it("jamais de relance d'une relance", async () => {
      const parentId = insertLetter({ status: "sent", sent_at: SENT_AT });
      insertLetter({
        kind: "reminder",
        parent_id: parentId,
        status: "sent",
        sent_at: SENT_AT, // la relance elle-même est due depuis 15 jours ouvrés
        subject: "Relance : Demande de données",
      });
      await run({ send: vi.fn(), now: () => DUE_NOW });
      // Une seule relance au total : celle insérée à la main, jamais une seconde pour la relance elle-même.
      const total = getDb().prepare("SELECT COUNT(*) AS n FROM institutional_letters WHERE kind='reminder'").get() as { n: number };
      expect(total.n).toBe(1);
    });

    it("une relance n'est jamais créée deux fois, même si la première est ensuite annulée", async () => {
      const id = insertLetter({ status: "sent", sent_at: SENT_AT });
      await run({ send: vi.fn(), now: () => DUE_NOW });
      expect(countReminders(id)).toBe(1);

      getDb().prepare("UPDATE institutional_letters SET status='cancelled' WHERE parent_id=?").run(id);

      await run({ send: vi.fn(), now: () => DUE_NOW + 86_400_000 });
      expect(countReminders(id)).toBe(1); // toujours une seule, malgré l'annulation
    });
  });

  describe("I1 : une relance déjà en file est annulée si une réponse humaine arrive après sa création", () => {
    // Même calendrier que le groupe précédent (octobre 2026, sans férié).
    const SENT_AT = Date.UTC(2026, 9, 5, 12, 0);
    const DUE_NOW = Date.UTC(2026, 9, 26, 12, 0);

    it("sonde d : la relance part malgré une réponse humaine rattachée ensuite — corrigé : elle est `cancelled`, jamais envoyée", async () => {
      const parentId = insertLetter({ status: "sent", sent_at: SENT_AT });

      // La relance est créée, encore `queued` : aucun envoi à ce stade.
      await run({ send: vi.fn(), now: () => DUE_NOW });
      const reminder = getDb()
        .prepare("SELECT id, scheduled_at FROM institutional_letters WHERE parent_id=? AND kind='reminder'")
        .get(parentId) as { id: string; scheduled_at: number };
      expect(reminder).toBeDefined();
      expect(getLetter(reminder.id).status).toBe("queued");

      // Une réponse humaine arrive sur la lettre d'ORIGINE, après coup, avant que la relance ne soit réclamée.
      getDb()
        .prepare("UPDATE institutional_letters SET reply_kind='human', reply_at=? WHERE id=?")
        .run(reminder.scheduled_at - 60_000, parentId);

      const send = vi.fn();
      await run({ send, now: () => reminder.scheduled_at + 30_000 });

      expect(send).not.toHaveBeenCalled();
      expect(getLetter(reminder.id).status).toBe("cancelled");
    });

    it("une réponse automatique (pas humaine) sur la lettre d'origine n'annule pas la relance", async () => {
      const parentId = insertLetter({ status: "sent", sent_at: SENT_AT });
      await run({ send: vi.fn(), now: () => DUE_NOW });
      const reminder = getDb()
        .prepare("SELECT id, scheduled_at FROM institutional_letters WHERE parent_id=? AND kind='reminder'")
        .get(parentId) as { id: string; scheduled_at: number };

      getDb().prepare("UPDATE institutional_letters SET reply_kind='auto', reply_at=? WHERE id=?").run(reminder.scheduled_at - 60_000, parentId);

      const send = vi.fn(async (): Promise<EmailSendResult> => ({ sent: true }));
      await run({ send, now: () => reminder.scheduled_at + 30_000 });

      expect(send).toHaveBeenCalledTimes(1);
      expect(getLetter(reminder.id).status).toBe("sent");
    });
  });

  describe("I3 : écart réel d'au moins douze minutes entre deux envois (sonde ecart, corrigée)", () => {
    it("une seconde lettre due pendant que le serveur rattrape un retard attend que douze minutes réelles se soient écoulées depuis le dernier envoi", async () => {
      const idA = insertLetter({ id: "A", scheduled_at: zurichSummer(10, 12) });
      const idB = insertLetter({ id: "B", scheduled_at: zurichSummer(10, 20) });
      const send = vi.fn(async (): Promise<EmailSendResult> => ({ sent: true }));

      // Passage 1 : A est due (4 min de retard), rien ne l'empêche de partir.
      await run({ send, now: () => zurichSummer(10, 16) });
      expect(getLetter(idA).status).toBe("sent");
      expect(getLetter(idA).sent_at).toBe(zurichSummer(10, 16));
      expect(getLetter(idB).status).toBe("queued"); // B n'est même pas encore due à 10:16

      // Passage 2 : B est due (10:20 ≤ 10:21), mais A n'a été envoyée que 5 min plus tôt — moins de
      // douze minutes réelles : B attend, sans pour autant être « en retard » (1 min) ni replanifiée.
      await run({ send, now: () => zurichSummer(10, 21) });
      expect(send).toHaveBeenCalledTimes(1); // toujours un seul envoi réel
      expect(getLetter(idB).status).toBe("queued");
      expect(getLetter(idB).scheduled_at).toBe(zurichSummer(10, 20)); // pas replanifiée : pas encore 10 min de retard

      // Passage 3 : exactement douze minutes réelles après l'envoi de A — plus de blocage, B part.
      await run({ send, now: () => zurichSummer(10, 28) });
      expect(send).toHaveBeenCalledTimes(2);
      const rows = getDb().prepare("SELECT id,status,sent_at FROM institutional_letters ORDER BY id").all() as Array<{
        id: string;
        status: string;
        sent_at: number;
      }>;
      expect(rows.map((r) => r.status)).toEqual(["sent", "sent"]);
      const [a, b] = rows;
      expect((b.sent_at - a.sent_at) / 60_000).toBeGreaterThanOrEqual(12); // l'écart réel garanti, pas seulement sur `scheduled_at`
    });
  });

  describe("I4 : jamais de renvoi automatique quand l'issue d'un envoi est incertaine", () => {
    it("I4a : une exception pendant l'envoi échoue directement (issue incertaine), jamais de retentative", async () => {
      const id = insertLetter({ scheduled_at: NOW - 1_000 });
      const send = vi.fn(async () => {
        throw new Error("panne réseau simulée");
      });
      const fetcher = telegramOk();

      await run({ send, fetch: fetcher });

      expect(send).toHaveBeenCalledTimes(1);
      const row = getLetter(id);
      expect(row.status).toBe("failed");
      expect(row.attempts).toBe(1);
      const text = sentTexts(fetcher)[0].text;
      expect(text).toContain("issue incertaine");
      expect(text).toContain("admin.ch");
    });

    it("I4a : un `network_error` explicite de `sendPreparedEmail` échoue aussi directement", async () => {
      const id = insertLetter({ scheduled_at: NOW - 1_000 });
      const send = vi.fn(async (): Promise<EmailSendResult> => ({ sent: false, reason: "resend_error", details: "network_error" }));
      const fetcher = telegramOk();

      await run({ send, fetch: fetcher });

      const row = getLetter(id);
      expect(row.status).toBe("failed");
      expect(row.attempts).toBe(1);
      expect(sentTexts(fetcher)[0].text).toContain("issue incertaine");
    });

    it.each(["HTTP 502", "HTTP 504"])("%s vient d'une passerelle : issue incertaine, jamais renvoyée", async (details) => {
      const id = insertLetter({ scheduled_at: NOW - 1_000 });
      const send = vi.fn(async (): Promise<EmailSendResult> => ({ sent: false, reason: "resend_error", details }));
      const fetcher = telegramOk();

      await run({ send, fetch: fetcher });

      const row = getLetter(id);
      expect(row.status).toBe("failed");
      expect(send).toHaveBeenCalledTimes(1);
      expect(sentTexts(fetcher)[0].text).toContain("issue incertaine");
    });

    it("I4c : un 429 (taux limité) reste retentable comme un 5xx — Resend n'a pas accepté", async () => {
      const id = insertLetter({ scheduled_at: NOW - 1_000 });
      const send = vi.fn(async (): Promise<EmailSendResult> => ({ sent: false, reason: "resend_error", details: "HTTP 429" }));
      const fetcher = telegramOk();

      await run({ send, fetch: fetcher });

      const row = getLetter(id);
      expect(row.status).toBe("queued"); // pas définitif : une retentative suit
      expect(row.attempts).toBe(1);
      expect(fetcher).not.toHaveBeenCalled(); // pas encore un échec définitif
    });

    it("I4d : un refus 4xx définitif (ex. 400) échoue directement, dès le premier essai, jamais retenté", async () => {
      const id = insertLetter({ scheduled_at: NOW - 1_000 });
      const send = vi.fn(async (): Promise<EmailSendResult> => ({ sent: false, reason: "resend_error", details: "HTTP 400" }));
      const fetcher = telegramOk();

      await run({ send, fetch: fetcher });

      expect(send).toHaveBeenCalledTimes(1);
      const row = getLetter(id);
      expect(row.status).toBe("failed");
      expect(row.attempts).toBe(1);
      const text = sentTexts(fetcher)[0].text;
      expect(text).toContain("HTTP 400");
      expect(text).not.toContain("issue incertaine"); // refus clair, pas une issue inconnue
    });

    it("I4e : stopLettersSender() attend la fin d'un passage en cours avant de résoudre", async () => {
      vi.useFakeTimers();
      try {
        let resolveRun: (() => void) | undefined;
        const slowRun = () =>
          new Promise<Awaited<ReturnType<typeof runLettersSender>>>((resolve) => {
            resolveRun = () =>
              resolve({
                checked_at: 0,
                status: "ok",
                code: null,
                queued: 0,
                sent: 0,
                failed: 0,
                total_rescheduled: 0,
                total_reminders_created: 0,
                last_run_at: 0,
              });
          });

        const stop = startLettersSender({ run: slowRun });
        await vi.advanceTimersByTimeAsync(90_000); // déclenche le premier passage, jamais résolu
        expect(resolveRun).toBeDefined(); // le passage est bien en cours (`inFlight` posé)

        let settled = false;
        const stopPromise = stop().then(() => {
          settled = true;
        });
        await vi.advanceTimersByTimeAsync(0); // laisse `stop()` s'exécuter jusqu'à son `await`
        expect(settled).toBe(false); // le passage n'est pas fini : stop() attend, ne résout pas tout de suite

        resolveRun?.();
        await stopPromise;
        expect(settled).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Correction 2 (06.10) : écart réel par attempted_at (B) et robustesse de la minuterie (C)", () => {
    it("sonde p1 réaliste : B ne part pas 4,4 min après une tentative incertaine sur A (créneaux tirés par scheduleSlot)", async () => {
      // Mêmes données que la sonde : A à 10:12 (créneau valide), B au premier créneau que
      // `scheduleSlot` aurait tiré après A (10:26, ≥12 min d'écart THÉORIQUE sur `scheduled_at`).
      const aAt = zurichSummer(10, 12);
      const bAt = scheduleSlot(zurichSummer(10, 0), [aAt], () => 0);
      insertLetter({ id: "A", scheduled_at: aAt });
      insertLetter({ id: "B", scheduled_at: bAt });

      // Le serveur était arrêté ; il rattrape à 10:21:05 — A est en retard de 9 min 5 s, pas encore
      // « en retard » (seuil 10 min). L'envoi jette (délai dépassé) : issue incertaine, `failed`.
      let clock = zurichSummer(10, 21) + 5_000;
      const send = vi
        .fn()
        .mockImplementationOnce(async () => {
          throw new Error("timeout");
        })
        .mockResolvedValue({ sent: true } satisfies EmailSendResult);
      await runLettersSender({ now: () => clock, rng: () => 0, send, fetch: telegramOk(), hasApiKey: () => true });
      expect(getLetter("A").status).toBe("failed");
      const aAttemptedAt = getLetter("A").attempted_at as number;

      // B est déjà dû à son propre créneau (bAt + 20 s), mais A n'a été TENTÉE (pas forcément
      // envoyée : issue incertaine) que depuis moins de douze minutes réelles : B attend.
      clock = bAt + 20_000;
      expect((clock - aAttemptedAt) / 60_000).toBeLessThan(12); // l'écart réel, pas celui de `scheduled_at`
      await runLettersSender({ now: () => clock, rng: () => 0, send, fetch: telegramOk(), hasApiKey: () => true });
      expect(send).toHaveBeenCalledTimes(1); // toujours un seul appel réel (celui, incertain, de A)
      expect(getLetter("B").status).toBe("queued");
    });

    it("sonde bords P1 : un écart artificiel de 4,4 min entre A et B — B attend malgré son propre créneau déjà dû", async () => {
      insertLetter({ id: "A", scheduled_at: zurichSummer(10, 11) });
      insertLetter({ id: "B", scheduled_at: zurichSummer(10, 16) }); // écart artificiel de 5 min
      const send = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue({ sent: true } satisfies EmailSendResult);

      await runLettersSender({ now: () => zurichSummer(10, 12), rng: () => 0, send, fetch: telegramOk(), hasApiKey: () => true });
      expect(getLetter("A").status).toBe("failed");

      await runLettersSender({ now: () => zurichSummer(10, 16) + 10_000, rng: () => 0, send, fetch: telegramOk(), hasApiKey: () => true });
      expect(send).toHaveBeenCalledTimes(1); // B n'a pas été tentée : moins de 12 min depuis A (≈4,4 min)
      expect(getLetter("B").status).toBe("queued");
    });

    it("une lettre `failed` tentée aujourd'hui occupe une des cinq places du jour pour une nouvelle relance", async () => {
      const SENT_AT = Date.UTC(2026, 9, 5, 12, 0); // lundi 5 octobre 2026
      const DAY_NOON = Date.UTC(2026, 9, 26, 12, 0); // lundi 26 octobre 2026 — exactement 15 jours ouvrés, sans férié
      for (let i = 0; i < 4; i++) {
        insertLetter({ id: `occ-${i}`, status: "sent", sent_at: DAY_NOON, scheduled_at: DAY_NOON + i * 3_600_000 });
      }
      // Tentée aujourd'hui (`attempted_at`) mais `failed` : son ancien `scheduled_at` ne compte plus
      // par son statut, mais la tentative d'aujourd'hui doit tout de même occuper une des 5 places.
      insertLetter({ id: "occ-failed", status: "failed", scheduled_at: DAY_NOON - 30 * 86_400_000, attempted_at: DAY_NOON });
      const parentId = insertLetter({ id: "parent", status: "sent", sent_at: SENT_AT });

      await run({ send: vi.fn(), now: () => DAY_NOON });

      const reminder = getDb().prepare("SELECT scheduled_at FROM institutional_letters WHERE parent_id=?").get(parentId) as {
        scheduled_at: number;
      };
      const z = toZurichParts(reminder.scheduled_at);
      expect(`${z.year}-${z.month}-${z.day}`).not.toBe("2026-10-26"); // le jour est déjà plein (4 sent + 1 failed = 5/5)
    });

    it("un `run` qui jette de façon synchrone ne tue jamais la minuterie (sonde bords P3)", async () => {
      vi.useFakeTimers();
      try {
        let calls = 0;
        const stop = startLettersSender({
          run: (() => {
            calls++;
            throw new Error("rejet synchrone");
          }) as never,
        });
        await vi.advanceTimersByTimeAsync(90_000);
        expect(calls).toBe(1);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(calls).toBe(2); // la minuterie s'est bien réarmée malgré le rejet synchrone du premier passage
        await vi.advanceTimersByTimeAsync(60_000);
        expect(calls).toBe(3);
        await stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("témoin operation_checks/letters", () => {
    it("expose des compteurs sans adresse ni objet, lisible par `readLettersSenderStatus`", async () => {
      insertLetter({ scheduled_at: NOW - 1_000 });
      insertLetter({ status: "failed", scheduled_at: NOW - 1_000 });
      await run({ send: async () => ({ sent: true }) });

      const status = readLettersSenderStatus(getDb());
      expect(status).not.toBeNull();
      expect(status?.status).toBe("ok");
      expect(status?.sent).toBe(1);
      expect(status?.failed).toBe(1);
      expect(status?.queued).toBe(0);
      expect(JSON.stringify(status)).not.toMatch(/@/); // jamais une adresse
    });
  });
});
