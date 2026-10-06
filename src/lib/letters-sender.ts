// Expéditeur périodique des lettres institutionnelles et relance automatique unique (plan du
// 06.10.2026, tâche 2). Toutes les 60 secondes (premier passage 90 s après le démarrage réel, dans
// `src/index.ts` à côté de `startMailWatch`, jamais dans `createApp()`) : prend la plus ancienne
// lettre `queued` dont `scheduled_at <= now`, l'envoie par `sendPreparedEmail` (Resend) ou la
// replanifie si elle a trop attendu. Une seule lettre par passage. Relance automatique unique
// 15 jours ouvrés après un envoi resté sans réponse humaine.
//
// Marquage atomique « en cours » avec bail de 10 min (UPDATE conditionnel `WHERE status='queued'`,
// `changes===1`) : un redémarrage au milieu d'un envoi ou deux passages concurrents ne font jamais
// partir la même lettre deux fois. Clé d'idempotence Resend = `letter-<id>` (redondant avec le bail,
// défense en profondeur si Resend retente une requête identique).
//
// Témoin `operation_checks/letters` : compteurs et code fermé, jamais une adresse ni un objet.
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db.js";
import {
  isAllowedRecipient,
  scheduleSlot,
  isSendableNow,
  businessDaysSince,
  toZurichParts,
  type InstitutionalLetter,
  type LetterStatus,
} from "./letters.js";
// Import en espace de noms (et non nominatif) : certains tests existants simulent `email.js` avec un
// jeu d'exports limité à leurs propres besoins (ex. `tests/routes/auth.test.ts`) ; un import nominatif
// de `sendPreparedEmail`/`hasResendApiKey`/`fromAddress` y échouerait au chargement du module, avant
// même qu'ils soient appelés. L'accès en propriété, résolu à l'appel, n'a pas ce problème.
import * as emailLib from "./email.js";
import type { PreparedEmail, EmailSendResult } from "./email.js";
import { telegramConfig, sendTelegram } from "./mail-watch.js";

const CHECK = "letters";
const START_DELAY = 90_000;
const INTERVAL = 60_000;
const LEASE_MS = 10 * 60_000;
// Une lettre en retard d'au moins dix minutes sur son créneau n'est jamais envoyée en retard : elle
// est replanifiée (nouvelle minute tirée, jamais une minute multiple de 5).
const LATE_THRESHOLD_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
const REMINDER_BUSINESS_DAYS = 15;
// Statuts qui occupent encore un créneau (même convention que `admin-letters.ts`).
const OCCUPYING_STATUSES = "('queued','sending','sent')";
const CONTACT_ADDRESS = "contact@openswissdata.com";
const SIGNATURE_RE = /Meilleures salutations[\s\S]*$/;
const FALLBACK_SIGNATURE = "Meilleures salutations\n\nClaude-Alain Martin\nOpenSwissData\ncontact@openswissdata.com";

export type LettersSenderStatus = {
  checked_at: number;
  status: "ok" | "not_configured" | "error";
  code: string | null;
  /** Lettres encore en file au moment de ce passage (snapshot, pas cumulé). */
  queued: number;
  /** Lettres déjà envoyées au total (snapshot, le statut `sent` est définitif). */
  sent: number;
  /** Lettres en échec définitif au total (snapshot, le statut `failed` est définitif). */
  failed: number;
  /** Replanifications cumulées depuis la création du témoin (lettre en retard ≥ 10 min sur son créneau, nouvelle minute tirée par `scheduleSlot`). */
  total_rescheduled: number;
  /** Relances créées cumulées depuis la création du témoin. */
  total_reminders_created: number;
  last_run_at: number | null;
};

type State = LettersSenderStatus & { version: 1 };

type SendFn = (payload: PreparedEmail, idempotencyKey?: string) => Promise<EmailSendResult>;

type Dependencies = {
  database: () => Database.Database;
  now: () => number;
  rng: () => number;
  send: SendFn;
  fetch: typeof fetch;
  hasApiKey: () => boolean;
};

const defaults: Dependencies = {
  database: getDb,
  // Lue à chaque appel, pas au chargement : une horloge simulée (tests) doit être vue.
  now: () => Date.now(),
  rng: () => Math.random(),
  send: (payload, idempotencyKey) => emailLib.sendPreparedEmail(payload, idempotencyKey),
  fetch: (input, init) => fetch(input, init),
  hasApiKey: () => emailLib.hasResendApiKey(),
};

// --- Témoin operation_checks -------------------------------------------------

function readState(db: Database.Database): State | null {
  const row = db.prepare("SELECT details_json FROM operation_checks WHERE name=?").get(CHECK) as
    | { details_json: string }
    | undefined;
  if (!row) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(row.details_json) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const status = raw.status === "ok" || raw.status === "not_configured" || raw.status === "error" ? raw.status : "error";
  const num = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0);
  const stamp = (v: unknown) => (Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : null);
  return {
    version: 1,
    checked_at: stamp(raw.checked_at) ?? 0,
    status,
    code: typeof raw.code === "string" ? raw.code : null,
    queued: num(raw.queued),
    sent: num(raw.sent),
    failed: num(raw.failed),
    total_rescheduled: num(raw.total_rescheduled),
    total_reminders_created: num(raw.total_reminders_created),
    last_run_at: stamp(raw.last_run_at),
  };
}

function save(db: Database.Database, state: State): State {
  db.prepare(
    "INSERT INTO operation_checks(name,checked_at,details_json) VALUES(?,?,?) " +
      "ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json",
  ).run(CHECK, state.checked_at, JSON.stringify(state));
  return state;
}

function publicView(state: State): LettersSenderStatus {
  const { version, ...rest } = state;
  void version;
  return rest;
}

/** Vue exposée au bureau (comme `readMailWatchStatus`) : jamais d'adresse ni d'objet. */
export function readLettersSenderStatus(db: Database.Database = getDb()): LettersSenderStatus | null {
  const state = readState(db);
  return state ? publicView(state) : null;
}

function countStatus(db: Database.Database, status: LetterStatus): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM institutional_letters WHERE status=?").get(status) as { n: number };
  return row.n;
}

// --- Domaine (pour les messages Telegram, jamais l'adresse) ----------------

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).trim().toLowerCase();
}

async function notifyTelegram(text: string, fetcher: typeof fetch): Promise<void> {
  const config = telegramConfig();
  if (typeof config === "string") return; // non configuré : aucune alerte, jamais une erreur pour autant
  try {
    await sendTelegram(config, text, fetcher);
  } catch {
    // Une alerte Telegram manquée ne doit jamais bloquer ni rejouer un envoi de lettre.
  }
}

function sentText(letter: Pick<InstitutionalLetter, "to_address" | "subject">): string {
  return `Lettre envoyée à ${domainOf(letter.to_address)} : ${letter.subject}`;
}

function failedText(letter: Pick<InstitutionalLetter, "to_address" | "subject">, reason: string): string {
  return `⚠️ Lettre en échec : ${domainOf(letter.to_address)} : ${letter.subject} (${reason})`;
}

// --- Construction de l'email --------------------------------------------------

function escapeHtmlBody(text: string): string {
  const escaped = text.replace(/[&<>"]/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&quot;",
  );
  return escaped.split(/\r\n|\r|\n/).join("<br>");
}

/** `from` des autres envois s'il désigne déjà `contact@` ; sinon la forme fixée par le plan. */
function lettersFromAddress(): string {
  const configured = emailLib.fromAddress();
  return configured.toLowerCase().includes("contact@") ? configured : `OpenSwissData <${CONTACT_ADDRESS}>`;
}

function buildPreparedEmail(letter: InstitutionalLetter): PreparedEmail {
  return {
    from: lettersFromAddress(),
    to: [letter.to_address],
    ...(letter.cc ? { cc: [letter.cc] } : {}),
    bcc: [CONTACT_ADDRESS],
    reply_to: CONTACT_ADDRESS,
    subject: letter.subject,
    text: letter.body,
    html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#0A0A0C;">${escapeHtmlBody(letter.body)}</div>`,
  };
}

// --- Relance : gabarit ---------------------------------------------------------

function formatZurichDate(ms: number): string {
  const p = toZurichParts(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.day)}.${pad(p.month)}.${p.year}`;
}

/** Signature reprise depuis « Meilleures salutations » (incluse) ; repli sur la signature du plan. */
function extractSignature(body: string): string {
  const match = SIGNATURE_RE.exec(body);
  return match ? match[0].trim() : FALLBACK_SIGNATURE;
}

function reminderBody(letter: InstitutionalLetter): string {
  const date = formatZurichDate(letter.sent_at as number);
  const signature = extractSignature(letter.body);
  return (
    `Pour mémoire, je vous ai écrit le ${date} au sujet de « ${letter.subject} », sans avoir reçu de réponse à ce jour.\n` +
    `Je me permets de revenir brièvement vers vous pour cette demande.\n\n${signature}`
  );
}

// --- Récupération des baux expirés ------------------------------------------

/** Un bail `sending` expiré repasse en `queued` (sans envoi), `attempts+1` ; à 3, `failed`. */
function recoverExpiredLeases(db: Database.Database, now: number): Array<{ id: string; to_address: string; subject: string; failed: boolean }> {
  const expired = db
    .prepare("SELECT id, to_address, subject, attempts FROM institutional_letters WHERE status='sending' AND lease_until < ?")
    .all(now) as Array<{ id: string; to_address: string; subject: string; attempts: number }>;
  const results: Array<{ id: string; to_address: string; subject: string; failed: boolean }> = [];
  for (const row of expired) {
    const attempts = row.attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    const newStatus: LetterStatus = failed ? "failed" : "queued";
    const result = db
      .prepare(
        "UPDATE institutional_letters SET status=?, attempts=?, lease_until=NULL " +
          "WHERE id=? AND status='sending' AND lease_until < ?",
      )
      .run(newStatus, attempts, row.id, now);
    if (result.changes === 1) results.push({ id: row.id, to_address: row.to_address, subject: row.subject, failed });
  }
  return results;
}

// --- Sélection : envoi ou replanification ------------------------------------

type ClaimResult =
  | { action: "none" }
  | { action: "rescheduled" }
  | { action: "claimed"; letter: InstitutionalLetter };

/**
 * Prend la plus ancienne lettre `queued` dont `scheduled_at <= now`. En retard d'au moins dix
 * minutes → replanifiée par `scheduleSlot` (aucun envoi en retard). Sinon → passage atomique en
 * `sending` avec bail de dix minutes. Transaction IMMEDIATE : deux passages concurrents ne peuvent
 * jamais agir sur la même lettre (le second trouve `changes !== 1` et ne fait rien).
 */
function claimOrReschedule(db: Database.Database, now: number, rng: () => number): ClaimResult {
  const txn = db.transaction((): ClaimResult => {
    const candidate = db
      .prepare(
        "SELECT * FROM institutional_letters WHERE status='queued' AND scheduled_at<=? " +
          "ORDER BY scheduled_at ASC, created_at ASC, id ASC LIMIT 1",
      )
      .get(now) as InstitutionalLetter | undefined;
    if (!candidate) return { action: "none" };

    const lateMs = now - candidate.scheduled_at;
    if (lateMs >= LATE_THRESHOLD_MS) {
      const existing = db
        .prepare(`SELECT scheduled_at FROM institutional_letters WHERE status IN ${OCCUPYING_STATUSES} AND id != ?`)
        .all(candidate.id) as Array<{ scheduled_at: number }>;
      const newScheduledAt = scheduleSlot(now, existing.map((r) => r.scheduled_at), rng);
      const result = db
        .prepare("UPDATE institutional_letters SET scheduled_at=? WHERE id=? AND status='queued'")
        .run(newScheduledAt, candidate.id);
      if (result.changes !== 1) return { action: "none" }; // concurrence : déjà traitée ailleurs
      return { action: "rescheduled" };
    }

    // Pas encore en retard, mais un passage qui a glissé (retentative Resend, Telegram) peut tomber
    // hors du créneau d'envoi (après 17:30, sur une minute multiple de 5) : la lettre attend le
    // prochain passage plutôt que de partir hors créneau (Review Focus #4). Le bail de dix minutes
    // la replanifiera si l'attente se prolonge.
    if (!isSendableNow(now)) return { action: "none" };

    const leaseUntil = now + LEASE_MS;
    const result = db
      .prepare("UPDATE institutional_letters SET status='sending', lease_until=? WHERE id=? AND status='queued'")
      .run(leaseUntil, candidate.id);
    if (result.changes !== 1) return { action: "none" }; // concurrence : déjà réclamée ailleurs
    return { action: "claimed", letter: { ...candidate, status: "sending", lease_until: leaseUntil } };
  });
  return txn.immediate();
}

function revertClaim(db: Database.Database, id: string): void {
  // Remet en file sans pénalité : cas défensif où la clé Resend aurait disparu entre le contrôle du
  // début de passage et l'envoi (course très improbable, jamais observée en pratique).
  db.prepare("UPDATE institutional_letters SET status='queued', lease_until=NULL WHERE id=? AND status='sending'").run(id);
}

function markSent(db: Database.Database, id: string, now: number, resendId: string | null): void {
  db.prepare(
    "UPDATE institutional_letters SET status='sent', sent_at=?, resend_id=?, lease_until=NULL WHERE id=? AND status='sending'",
  ).run(now, resendId, id);
}

function markFailed(db: Database.Database, id: string, attempts: number): void {
  db.prepare("UPDATE institutional_letters SET status='failed', attempts=?, lease_until=NULL WHERE id=? AND status='sending'").run(
    attempts,
    id,
  );
}

function markRetryQueued(db: Database.Database, id: string, attempts: number): void {
  db.prepare("UPDATE institutional_letters SET status='queued', attempts=?, lease_until=NULL WHERE id=? AND status='sending'").run(
    attempts,
    id,
  );
}

// --- Relance automatique -----------------------------------------------------

/**
 * Lettres `letter` envoyées, sans réponse humaine rattachée et sans relance déjà créée (quel que
 * soit son statut, y compris `cancelled` : jamais de seconde relance). Jamais de relance d'une
 * relance (`kind='letter'` seulement).
 */
function findReminderCandidates(db: Database.Database): InstitutionalLetter[] {
  return db
    .prepare(
      `SELECT l.* FROM institutional_letters l
       WHERE l.kind='letter' AND l.status='sent' AND l.sent_at IS NOT NULL
         AND (l.reply_kind IS NULL OR l.reply_kind != 'human')
         AND NOT EXISTS (SELECT 1 FROM institutional_letters r WHERE r.parent_id = l.id AND r.kind='reminder')
       ORDER BY l.sent_at ASC`,
    )
    .all() as InstitutionalLetter[];
}

/** Crée UNE relance pour cette lettre, atomiquement (revérifie l'absence de relance dans la transaction). */
function createReminder(db: Database.Database, letter: InstitutionalLetter, now: number, rng: () => number): boolean {
  const txn = db.transaction((): boolean => {
    const already = db
      .prepare("SELECT 1 FROM institutional_letters WHERE parent_id=? AND kind='reminder'")
      .get(letter.id);
    if (already) return false;
    const existing = db
      .prepare(`SELECT scheduled_at FROM institutional_letters WHERE status IN ${OCCUPYING_STATUSES}`)
      .all() as Array<{ scheduled_at: number }>;
    const scheduledAt = scheduleSlot(now, existing.map((r) => r.scheduled_at), rng);
    db.prepare(
      `INSERT INTO institutional_letters
        (id, kind, parent_id, to_address, cc, subject, body, purpose, status, scheduled_at,
         lease_until, attempts, resend_id, sent_at, reply_at, reply_from, reply_subject,
         reply_extract, reply_kind, reply_processed_at, created_at)
       VALUES
        (@id, 'reminder', @parent_id, @to_address, @cc, @subject, @body, @purpose, 'queued', @scheduled_at,
         NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, @created_at)`,
    ).run({
      id: randomUUID(),
      parent_id: letter.id,
      to_address: letter.to_address,
      cc: letter.cc,
      subject: `Relance : ${letter.subject}`,
      body: reminderBody(letter),
      purpose: letter.purpose,
      scheduled_at: scheduledAt,
      created_at: now,
    });
    return true;
  });
  return txn.immediate();
}

// --- Un passage ---------------------------------------------------------------

export async function runLettersSender(overrides: Partial<Dependencies> = {}): Promise<LettersSenderStatus> {
  const deps: Dependencies = { ...defaults, ...overrides };
  const db = deps.database();
  const now = deps.now();
  const previous = readState(db);
  let totalRescheduled = previous?.total_rescheduled ?? 0;
  let totalReminders = previous?.total_reminders_created ?? 0;

  const finish = (status: LettersSenderStatus["status"], code: string | null, lastRunAt: number | null): LettersSenderStatus => {
    const state: State = {
      version: 1,
      checked_at: now,
      status,
      code,
      queued: countStatus(db, "queued"),
      sent: countStatus(db, "sent"),
      failed: countStatus(db, "failed"),
      total_rescheduled: totalRescheduled,
      total_reminders_created: totalReminders,
      last_run_at: lastRunAt,
    };
    return publicView(save(db, state));
  };

  // Clé Resend absente : ne rien changer et ne rien envoyer, avant la moindre écriture (y compris
  // la récupération des baux ou la relance). Témoin « non configuré ».
  if (!deps.hasApiKey()) {
    return finish("not_configured", "no_api_key", previous?.last_run_at ?? null);
  }

  try {
    // 1) Baux `sending` expirés : repassent en `queued` (attempts+1) ou `failed` à trois essais —
    //    jamais d'envoi ici, seulement de la comptabilité. Synchrone, aucun `await` avant la
    //    sélection suivante : pas de course avec le reste de ce même passage.
    const recovered = recoverExpiredLeases(db, now);
    for (const r of recovered) {
      if (r.failed) await notifyTelegram(failedText(r, "délai d'envoi dépassé, trois essais atteints"), deps.fetch);
    }

    // 2) Sélection atomique (toujours synchrone jusqu'à la claim, cf. `claimOrReschedule`) : au plus
    //    une lettre par passage, jamais la même lettre deux fois sous deux passages concurrents.
    const claim = claimOrReschedule(db, now, deps.rng);
    if (claim.action === "rescheduled") totalRescheduled++;

    if (claim.action === "claimed") {
      const letter = claim.letter;
      const recipientOk = isAllowedRecipient(letter.to_address) && (!letter.cc || isAllowedRecipient(letter.cc));
      if (!recipientOk) {
        markFailed(db, letter.id, letter.attempts);
        await notifyTelegram(failedText(letter, "destinataire non autorisé"), deps.fetch);
      } else {
        const prepared = buildPreparedEmail(letter);
        const result = await deps.send(prepared, `letter-${letter.id}`);
        if (result.sent) {
          // Écrit avant toute notification Telegram : un échec Telegram ne doit jamais faire
          // rejouer un envoi déjà accepté par Resend.
          markSent(db, letter.id, now, result.providerId ?? null);
          await notifyTelegram(sentText(letter), deps.fetch);
        } else if (result.reason === "no_api_key") {
          // Course très improbable (clé retirée entre le contrôle du début de passage et l'envoi) :
          // remise en file sans pénalité, rien d'autre ce passage-ci.
          revertClaim(db, letter.id);
          return finish("not_configured", "no_api_key", previous?.last_run_at ?? null);
        } else {
          const attempts = letter.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            markFailed(db, letter.id, attempts);
            await notifyTelegram(failedText(letter, result.details ?? result.reason ?? "échec d'envoi"), deps.fetch);
          } else {
            markRetryQueued(db, letter.id, attempts);
          }
        }
      }
    }

    // 3) Relance automatique unique, 15 jours ouvrés après un envoi resté sans réponse humaine.
    for (const candidate of findReminderCandidates(db)) {
      if (businessDaysSince(candidate.sent_at as number, now) < REMINDER_BUSINESS_DAYS) continue;
      if (createReminder(db, candidate, now, deps.rng)) totalReminders++;
    }

    return finish("ok", null, now);
  } catch (error) {
    console.error("[lettres] passage interrompu :", error instanceof Error ? error.message : "erreur inconnue");
    return finish("error", "unexpected_error", previous?.last_run_at ?? null);
  }
}

// --- Minuterie du point d'entrée réel ----------------------------------------

/** Minuterie du point d'entrée réel (jamais dans `createApp`) : premier passage après 90 s, puis toutes les 60 s. */
export function startLettersSender(
  overrides: Partial<Dependencies> & { run?: () => Promise<LettersSenderStatus> } = {},
): () => void {
  const { run = () => runLettersSender(overrides) } = overrides;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delay);
    timer.unref();
  };
  const tick = async () => {
    if (stopped) return;
    try {
      const result = await run();
      // Codes fermés et nombres seulement : jamais d'adresse, d'objet ni de message d'erreur brut.
      if (result.status === "error") console.error(`[lettres] passage en échec (${result.code ?? "inconnu"})`);
    } catch {
      console.error("[lettres] passage interrompu ; nouvel essai à la prochaine minuterie");
    } finally {
      // Une seule minuterie, réarmée après la fin : aucun passage concurrent ni relance après arrêt.
      schedule(INTERVAL);
    }
  };
  schedule(START_DELAY);
  console.info("[lettres] minuterie active ; premier passage après 90 secondes");
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
