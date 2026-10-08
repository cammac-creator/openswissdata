import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, closeDb } from "../../src/lib/db.js";
import { runLettersSender } from "../../src/lib/letters-sender.js";

// Demandes de licence aux distributeurs officiels (relecture de sécurité du 08.10.2026) : aucune
// relance automatique. La relance générique est en français et partirait même après une lettre en
// allemand ou en italien, ou après que la licence a été ouverte ; la lettre dit déjà qu'une courte
// réponse suffit. Les autres lettres gardent leur relance unique.

const TOKEN = "123456789:jeton-fictif-TELEGRAM-abcdefghij";
// Lundi 5 octobre 2026 → lundi 26 octobre 2026 : 15 jours ouvrés (voir letters-sender.test.ts).
const SENT_AT = Date.UTC(2026, 9, 5, 12, 0);
const DUE_NOW = Date.UTC(2026, 9, 26, 12, 0);

function insertSent(purpose: string, to: string): string {
  const id = `id-${Math.random().toString(36).slice(2)}`;
  getDb().prepare(
    `INSERT INTO institutional_letters
      (id, kind, parent_id, to_address, cc, subject, body, purpose, status, scheduled_at,
       lease_until, attempted_at, attempts, resend_id, sent_at, reply_at, reply_from, reply_subject,
       reply_extract, reply_kind, reply_processed_at, created_at)
     VALUES (?, 'letter', NULL, ?, NULL, 'Anfrage für eine offene Lizenz auf opendata.swiss (Amt)',
       'Text.\n\nFreundliche Grüsse\n\nClaude-Alain Martin\nOpenSwissData\ncontact@openswissdata.com', ?, 'sent', ?,
       NULL, ?, 1, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
  ).run(id, to, purpose, SENT_AT - 60_000, SENT_AT, SENT_AT, SENT_AT);
  return id;
}

function seedFreshMailWatch(at: number): void {
  getDb()
    .prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('mail_watch',?,?)")
    .run(at, JSON.stringify({
      version: 1, checked_at: at, status: "ok", code: null, http_status: null, last_success_at: at, last_alert_at: null,
      matched: 0, alerted: 0, pending: 0, total_alerted: 0, domains: 0, total_attached: 0, seen: [], headerFailures: {},
    }));
}

const reminders = (parentId: string) =>
  (getDb().prepare("SELECT COUNT(*) AS n FROM institutional_letters WHERE parent_id=? AND kind='reminder'").get(parentId) as { n: number }).n;

describe("Expéditeur : aucune relance pour une demande de licence", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-relance-demandes-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.OSD_VEILLE_TELEGRAM_TOKEN = TOKEN;
    process.env.OSD_VEILLE_TELEGRAM_CHAT = "424242";
    getDb();
  });
  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.OSD_VEILLE_TELEGRAM_TOKEN;
    delete process.env.OSD_VEILLE_TELEGRAM_CHAT;
  });

  it("15 jours ouvrés sans réponse : la demande de licence n'est pas relancée, la lettre ordinaire l'est", async () => {
    const licence = insertSent("demande-licence:lustat", "boite-fictive@lustat.ch");
    const majuscules = insertSent("Demande-Licence:autre", "boite-fictive@zh.ch");
    const ordinaire = insertSent("Clarification de réutilisation", "boite-fictive@admin.ch");
    seedFreshMailWatch(DUE_NOW);
    await runLettersSender({
      now: () => DUE_NOW,
      rng: () => 0,
      send: async () => ({ sent: true }),
      fetch: (async () => Response.json({ ok: true })) as unknown as typeof fetch,
      hasApiKey: () => true,
    });
    expect(reminders(licence)).toBe(0);
    expect(reminders(majuscules)).toBe(0);
    expect(reminders(ordinaire)).toBe(1);
  });
});
