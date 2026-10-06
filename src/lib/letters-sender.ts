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
// Délai maximal que `stopLettersSender()` attend la fin d'un passage en cours (correction I4e).
const SHUTDOWN_GRACE_MS = 10_000;
const LEASE_MS = 10 * 60_000;
// Une lettre en retard d'au moins dix minutes sur son créneau n'est jamais envoyée en retard : elle
// est replanifiée (nouvelle minute tirée, jamais une minute multiple de 5).
const LATE_THRESHOLD_MS = 10 * 60_000;
// Écart minimal réel entre deux envois (correction I3) : `scheduleSlot` le garantit déjà sur
// `scheduled_at`, mais un passage en retard qui rattrape plusieurs lettres d'un coup pourrait
// comprimer cet écart dans le temps réel. Même valeur que `MIN_GAP_MINUTES` de `letters.ts`.
const MIN_REAL_GAP_MS = 12 * 60_000;
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

/**
 * Correction I4 (relecture Opus, 06.10) : quand on ne sait pas si Resend a déjà accepté l'envoi
 * (délai réseau, exception, bail `sending` expiré), jamais de retentative automatique — un second
 * envoi pourrait dupliquer une lettre déjà partie. Texte imposé par la décision.
 */
function uncertainText(letter: Pick<InstitutionalLetter, "to_address">): string {
  return `⚠️ Lettre à ${domainOf(letter.to_address)} : issue incertaine, vérifier dans Resend avant tout renvoi`;
}

/**
 * Classe un échec d'envoi renvoyé par `sendPreparedEmail` :
 * - `"unknown"` — on ne sait pas si Resend a accepté (erreur réseau, forme inattendue) : jamais de
 *   retentative automatique (I4a).
 * - `"retryable"` — Resend a explicitement refusé par 5xx ou 429 (jamais accepté, sûr de
 *   retenter) : repasse en `queued`, `attempts+1`, `failed` au troisième essai (I4c), comme avant.
 * - `"definite"` — Resend a explicitement refusé par un autre 4xx (400, 401, 403, 409, 422, et tout
 *   autre code 4xx non énuméré) : la requête elle-même est rejetée, retenter ne changerait rien ;
 *   `failed` directement (I4d).
 */
function classifySendFailure(result: EmailSendResult): "unknown" | "retryable" | "definite" {
  if (result.reason !== "resend_error") return "unknown"; // forme inattendue : jamais supposer un refus propre
  const httpMatch = /^HTTP (\d{3})$/.exec(result.details ?? "");
  if (!httpMatch) return "unknown"; // ex. "network_error" : Resend a pu recevoir la requête malgré tout
  const status = Number(httpMatch[1]);
  return status >= 500 || status === 429 ? "retryable" : "definite";
}

// --- Construction de l'email --------------------------------------------------

function escapeHtmlBody(text: string): string {
  const escaped = text.replace(/[&<>"]/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&quot;",
  );
  return escaped.split(/\r\n|\r|\n/).join("<br>");
}

/** Adresse nue (sans `Nom <...>`), en minuscules, pour une comparaison exacte. */
function bareAddress(value: string): string {
  const match = /<([^>]+)>\s*$/.exec(value);
  return (match ? match[1] : value).trim().toLowerCase();
}

/**
 * `from` des autres envois s'il désigne exactement `contact@openswissdata.com` ; sinon la forme
 * fixée par le plan. Comparaison EXACTE (corrigé le 06.10, relecture Opus) : un simple `includes`
 * aurait accepté à tort une adresse qui contient seulement le mot « contact@ » ailleurs dans la
 * chaîne (ex. un nom d'affichage trompeur).
 */
function lettersFromAddress(): string {
  const configured = emailLib.fromAddress();
  return bareAddress(configured) === CONTACT_ADDRESS ? configured : `OpenSwissData <${CONTACT_ADDRESS}>`;
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

/**
 * Un bail `sending` expiré signifie qu'on ne sait pas si l'envoi est parti (le serveur a pu tomber
 * entre la requête à Resend et l'écriture de `sent_at`) : jamais de retour en `queued` (correction
 * I4b, 06.10) — un second envoi pourrait dupliquer une lettre déjà réellement partie. Toujours
 * `failed` directement, avec l'alerte « issue incertaine ».
 */
function recoverExpiredLeases(db: Database.Database, now: number): Array<{ to_address: string }> {
  const expired = db
    .prepare("SELECT id, to_address, attempts FROM institutional_letters WHERE status='sending' AND lease_until < ?")
    .all(now) as Array<{ id: string; to_address: string; attempts: number }>;
  const results: Array<{ to_address: string }> = [];
  for (const row of expired) {
    const result = db
      .prepare(
        "UPDATE institutional_letters SET status='failed', attempts=?, lease_until=NULL " +
          "WHERE id=? AND status='sending' AND lease_until < ?",
      )
      .run(row.attempts + 1, row.id, now);
    if (result.changes === 1) results.push({ to_address: row.to_address });
  }
  return results;
}

// --- Sélection : envoi, replanification ou annulation ------------------------

type ClaimResult =
  | { action: "none" }
  | { action: "rescheduled" }
  | { action: "cancelled" }
  | { action: "claimed"; letter: InstitutionalLetter };

/** Un envoi `sent` dans les douze dernières minutes au moins (correction I3, 06.10). */
function recentlySentWithin(db: Database.Database, now: number, windowMs: number): boolean {
  const row = db.prepare("SELECT 1 FROM institutional_letters WHERE status='sent' AND sent_at > ? LIMIT 1").get(now - windowMs);
  return !!row;
}

/**
 * Prend la plus ancienne lettre `queued` dont `scheduled_at <= now`.
 *
 * Une relance (`kind='reminder'`) dont la lettre d'origine a depuis reçu une réponse humaine est
 * annulée sans jamais être envoyée (correction I1, 06.10) : une relance restée en file peut devenir
 * obsolète entre sa création et sa réclamation.
 *
 * Sinon, en retard d'au moins dix minutes → replanifiée par `scheduleSlot` (aucun envoi en retard).
 * Sinon → deux garde-fous avant d'envoyer MAINTENANT (corrections I2b et I3, 06.10) : un envoi
 * `sent` trop récent (moins de douze minutes réelles, l'écart que `scheduleSlot` garantit sur
 * `scheduled_at` mais qu'un passage en retard qui rattrape plusieurs lettres pourrait comprimer
 * dans le temps réel) bloque tout envoi ce passage-ci ; et `now` ET `now + 60 s` doivent rester dans
 * le créneau d'envoi (un envoi qui prendrait jusqu'à une minute ne doit, lui non plus, jamais finir
 * hors créneau). Si aucun des deux ne bloque → passage atomique en `sending` avec bail de dix
 * minutes.
 *
 * Transaction IMMEDIATE : deux passages concurrents ne peuvent jamais agir sur la même lettre (le
 * second trouve `changes !== 1` et ne fait rien).
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

    if (candidate.kind === "reminder" && candidate.parent_id) {
      const parent = db.prepare("SELECT reply_kind FROM institutional_letters WHERE id=?").get(candidate.parent_id) as
        | { reply_kind: string | null }
        | undefined;
      if (parent?.reply_kind === "human") {
        const result = db
          .prepare("UPDATE institutional_letters SET status='cancelled' WHERE id=? AND status='queued'")
          .run(candidate.id);
        if (result.changes !== 1) return { action: "none" }; // concurrence : déjà traitée ailleurs
        return { action: "cancelled" };
      }
    }

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

    // Pas encore en retard : deux garde-fous avant d'envoyer maintenant (I2b, I3).
    if (recentlySentWithin(db, now, MIN_REAL_GAP_MS)) return { action: "none" };
    if (!(isSendableNow(now) && isSendableNow(now + 60_000))) return { action: "none" };

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
  // Horodatage du témoin seulement (« quand ce passage a tourné ») : chaque décision sensible au
  // temps relit `deps.now()` à son propre moment (voir plus bas, correction I2a).
  const passStartedAt = deps.now();
  const previous = readState(db);
  let totalRescheduled = previous?.total_rescheduled ?? 0;
  let totalReminders = previous?.total_reminders_created ?? 0;

  const finish = (status: LettersSenderStatus["status"], code: string | null, lastRunAt: number | null): LettersSenderStatus => {
    const state: State = {
      version: 1,
      checked_at: passStartedAt,
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
    // 1) Baux `sending` expirés : toujours `failed` directement (issue incertaine, correction I4b).
    //    Synchrone, aucun `await` avant la sélection suivante : pas de course avec le reste de ce
    //    même passage. Les alertes Telegram, elles, sont bien `await`ées ici — c'est précisément
    //    pourquoi la réclamation ci-dessous relit l'horloge au lieu de réutiliser `passStartedAt`
    //    (correction I2a : ce `await` peut faire avancer le temps réel de plusieurs secondes).
    const recovered = recoverExpiredLeases(db, deps.now());
    for (const r of recovered) await notifyTelegram(uncertainText(r), deps.fetch);

    // 2) Sélection atomique (toujours synchrone jusqu'à la claim, cf. `claimOrReschedule`) : au plus
    //    une lettre par passage, jamais la même lettre deux fois sous deux passages concurrents.
    //    Horloge relue ici (I2a), pas celle du début du passage.
    const claimNow = deps.now();
    const claim = claimOrReschedule(db, claimNow, deps.rng);
    if (claim.action === "rescheduled") totalRescheduled++;

    if (claim.action === "claimed") {
      const letter = claim.letter;
      const recipientOk = isAllowedRecipient(letter.to_address) && (!letter.cc || isAllowedRecipient(letter.cc));
      if (!recipientOk) {
        markFailed(db, letter.id, letter.attempts);
        await notifyTelegram(failedText(letter, "destinataire non autorisé"), deps.fetch);
      } else {
        const prepared = buildPreparedEmail(letter);
        // `null` seulement si l'envoi a jeté une exception : déjà entièrement traité dans le
        // `catch` (I4a), rien de plus à faire pour cette lettre ce passage-ci.
        let result: EmailSendResult | null;
        try {
          result = await deps.send(prepared, `letter-${letter.id}`);
        } catch {
          // Toute exception pendant l'envoi (I4a) : on ne sait pas si Resend a reçu la requête —
          // jamais de retentative automatique.
          markFailed(db, letter.id, letter.attempts + 1);
          await notifyTelegram(uncertainText(letter), deps.fetch);
          result = null;
        }
        if (result?.sent) {
          // Lu APRÈS la réponse de Resend (I2d), jamais avant l'envoi : un passage qui prend du
          // temps (retentatives internes à `sendPreparedEmail`, par exemple) ne doit pas enregistrer
          // une heure d'envoi antérieure à l'acceptation réelle. Écrit avant toute notification
          // Telegram : un échec Telegram ne doit jamais faire rejouer un envoi déjà accepté.
          const sentAt = deps.now();
          markSent(db, letter.id, sentAt, result.providerId ?? null);
          await notifyTelegram(sentText(letter), deps.fetch);
        } else if (result?.reason === "no_api_key") {
          // Course très improbable (clé retirée entre le contrôle du début de passage et l'envoi) :
          // remise en file sans pénalité, rien d'autre ce passage-ci.
          revertClaim(db, letter.id);
          return finish("not_configured", "no_api_key", previous?.last_run_at ?? null);
        } else if (result !== null) {
          // Résultat d'échec normal renvoyé par `sendPreparedEmail` (pas l'exception déjà traitée
          // ci-dessus) : classer pour décider retentative ou échec définitif.
          const category = classifySendFailure(result);
          if (category === "unknown") {
            markFailed(db, letter.id, letter.attempts + 1);
            await notifyTelegram(uncertainText(letter), deps.fetch);
          } else if (category === "definite") {
            markFailed(db, letter.id, letter.attempts + 1);
            await notifyTelegram(failedText(letter, result.details ?? result.reason ?? "échec d'envoi"), deps.fetch);
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
    }

    // 3) Relance automatique unique, 15 jours ouvrés après un envoi resté sans réponse humaine.
    const reminderNow = deps.now();
    for (const candidate of findReminderCandidates(db)) {
      if (businessDaysSince(candidate.sent_at as number, reminderNow) < REMINDER_BUSINESS_DAYS) continue;
      if (createReminder(db, candidate, reminderNow, deps.rng)) totalReminders++;
    }

    return finish("ok", null, passStartedAt);
  } catch (error) {
    console.error("[lettres] passage interrompu :", error instanceof Error ? error.message : "erreur inconnue");
    return finish("error", "unexpected_error", previous?.last_run_at ?? null);
  }
}

// --- Minuterie du point d'entrée réel ----------------------------------------

/** Minuterie du point d'entrée réel (jamais dans `createApp`) : premier passage après 90 s, puis toutes les 60 s. */
/**
 * Minuterie du point d'entrée réel (jamais dans `createApp`) : premier passage après 90 s, puis
 * toutes les 60 s. La fonction d'arrêt renvoyée est asynchrone (correction I4e, 06.10) : elle
 * attend la fin d'un passage en cours (au plus `SHUTDOWN_GRACE_MS`) avant de résoudre, pour qu'un
 * arrêt serveur n'interrompe jamais un envoi entre la requête à Resend et l'écriture de `sent_at`
 * (ce qui laisserait un bail `sending` à récupérer comme « issue incertaine » au prochain démarrage
 * — correct, mais évitable si on peut simplement attendre).
 */
export function startLettersSender(
  overrides: Partial<Dependencies> & { run?: () => Promise<LettersSenderStatus> } = {},
): () => Promise<void> {
  const { run = () => runLettersSender(overrides) } = overrides;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let inFlight: Promise<LettersSenderStatus> | null = null;
  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delay);
    timer.unref();
  };
  const tick = async () => {
    if (stopped) return;
    const p = run();
    inFlight = p;
    try {
      const result = await p;
      // Codes fermés et nombres seulement : jamais d'adresse, d'objet ni de message d'erreur brut.
      if (result.status === "error") console.error(`[lettres] passage en échec (${result.code ?? "inconnu"})`);
    } catch {
      console.error("[lettres] passage interrompu ; nouvel essai à la prochaine minuterie");
    } finally {
      inFlight = null;
      // Une seule minuterie, réarmée après la fin : aucun passage concurrent ni relance après arrêt.
      schedule(INTERVAL);
    }
  };
  schedule(START_DELAY);
  console.info("[lettres] minuterie active ; premier passage après 90 secondes");
  return async () => {
    stopped = true;
    clearTimeout(timer);
    if (!inFlight) return;
    await Promise.race([
      inFlight.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
    ]);
  };
}
