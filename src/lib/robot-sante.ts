// Santé du programme `openswissdata` au bureau de Claude-Alain (boîte générale, étape 1, 10.11.2026 ;
// contrat `~/bureau/docs/guichet-contrat.md`, « Dire sa santé », et `~/bureau/docs/API.md`, « Robots et
// pannes »). Une seule source au bureau pour deux robots du serveur, combinés dans cet ordre :
//   1. la file des lettres (`letters-sender.ts`) : témoin en erreur, envoi impossible avec des lettres en
//      file, ou témoin muet ;
//   2. le transport vers le guichet (témoin `letters_guichet`) : délai, réseau, statut HTTP autre que 200,
//      réponse illisible, deux fois de suite, tant qu'une lettre attend (le guichet n'en garde aucune trace) ;
//   3. la veille des réponses (`mail-watch.ts`) : en panne, inactive ou muette, mais seulement quand une
//      réponse est attendue (lettre en file, ou envoyée depuis moins de 120 jours sans réponse).
// La pause des lettres et le « Tout arrêter » du bureau ne sont pas des pannes. Les refus, échecs et
// permissions sans issue, le bureau les tire seul du journal du guichet : jamais redits ici.
//
// Rythme : un examen toutes les 5 minutes ; une santé seulement quand l'état (`etat`, `code`, `depuis`)
// change, ou au plus une fois par heure pour le même état (un signe de vie, environ 24 par jour), ou au
// prochain examen si la précédente n'a pas été reçue. Au plus 150 essais par jour (Zurich), sous la borne
// de 200 du bureau. Un 429 se note au journal (signe d'une boucle). Aucune adresse, aucun texte libre.
import type Database from "better-sqlite3";
import { getDb } from "./db.js";
import { toZurichParts } from "./letters.js";
import { readGuichetTransport, readLettersSenderStatus } from "./letters-sender.js";
import { readMailWatchStatus } from "./mail-watch.js";
import { createGuichetClient, type GuichetClient, type PanneCode, type SanteBody } from "./guichet.js";

const CHECK = "guichet_sante";
const START_DELAY_MS = 3 * 60_000;
const INTERVAL_MS = 5 * 60_000;
const HEARTBEAT_MS = 60 * 60_000;
const DAILY_CAP = 150;
// L'expéditeur passe chaque minute (premier passage 90 s après le démarrage) ; la veille toutes les 10 minutes.
const LETTERS_SILENT_MS = 15 * 60_000;
const MAIL_WATCH_SILENT_MS = 30 * 60_000;
const REPLY_WINDOW_MS = 120 * 86_400_000;
const N_MAX = 9999;

export type Diagnostic = { etat: "ok" } | { etat: "panne"; code: PanneCode; n: number };

const clampN = (n: number) => Math.max(0, Math.min(N_MAX, Math.trunc(n)));

/** Date de Zurich (AAAA-MM-JJ), celle que le bureau attend dans `depuis`. */
export function zurichDate(ms: number): string {
  const p = toZurichParts(ms);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function waitingLetters(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM institutional_letters WHERE status IN ('queued','sending')").get() as { n: number }).n;
}

function oldestWaitingCreatedAt(db: Database.Database): number {
  const row = db.prepare("SELECT MIN(created_at) AS t FROM institutional_letters WHERE status IN ('queued','sending')").get() as {
    t: number | null;
  };
  return row.t ?? Number.MAX_SAFE_INTEGER;
}

function lettersAwaitingReply(db: Database.Database, now: number): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM institutional_letters WHERE status='sent' AND sent_at >= ? " +
          "AND (reply_kind IS NULL OR reply_kind NOT IN ('human','unverified'))",
      )
      .get(now - REPLY_WINDOW_MS) as { n: number }
  ).n;
}

const MAIL_WATCH_CODES: Readonly<Record<string, PanneCode>> = {
  imap_failed: "boite_injoignable",
  mailbox_unreadable: "boite_injoignable",
  telegram_timeout: "service_injoignable",
  telegram_network: "service_injoignable",
  telegram_http: "service_injoignable",
  telegram_not_ok: "service_injoignable",
};

/** L'état combiné du programme, d'après ses témoins (`operation_checks`) et la file des lettres. */
export function diagnose(db: Database.Database, now: number): Diagnostic {
  const waiting = waitingLetters(db);

  // 1. La file des lettres.
  const letters = readLettersSenderStatus(db);
  if (letters) {
    if (now - letters.checked_at > LETTERS_SILENT_MS) return { etat: "panne", code: "autre", n: clampN(waiting) };
    if (letters.status === "error") return { etat: "panne", code: "autre", n: clampN(waiting) };
    if (letters.status === "not_configured" && waiting > 0) {
      return { etat: "panne", code: letters.code === "no_api_key" ? "cle_refusee" : "autre", n: clampN(waiting) };
    }
  }

  // 2. Le transport vers le guichet : un guichet muet ou en erreur n'inscrit rien à son journal ; tant
  //    qu'une lettre attend, c'est une panne (`cle_refusee` si le jeton est refusé). Deux ratés de suite
  //    au moins (un raté isolé un vendredi soir ne fait pas une carte rouge tout le week-end), et pas un
  //    raté plus ancien que la plus ancienne lettre qui attend (il ne la concerne pas).
  const transport = readGuichetTransport(db);
  if (transport?.code && transport.consecutive >= 2 && waiting > 0 && transport.last_at >= oldestWaitingCreatedAt(db)) {
    const refused = transport.code === "http_401" || transport.code === "http_403";
    return { etat: "panne", code: refused ? "cle_refusee" : "service_injoignable", n: clampN(waiting) };
  }

  // 3. La veille des réponses, seulement quand une réponse est attendue.
  const expected = waiting + lettersAwaitingReply(db, now);
  if (expected > 0) {
    const watch = readMailWatchStatus(db);
    if (!watch || watch.status === "inactive" || now - watch.checked_at > MAIL_WATCH_SILENT_MS) {
      return { etat: "panne", code: "collecte_arretee", n: clampN(expected) };
    }
    if (watch.status === "error") {
      return { etat: "panne", code: MAIL_WATCH_CODES[watch.code ?? ""] ?? "autre", n: clampN(expected) };
    }
  }
  return { etat: "ok" };
}

// --- État de la santé (témoin `operation_checks/guichet_sante`, sans adresse) --------------------

type State = {
  version: 1;
  /** Jour de Zurich des essais comptés. */
  day: string;
  attempts_today: number;
  /** Dernière santé reçue par le bureau (HTTP 200) : sa clé et son heure. */
  last_key: string | null;
  last_sent_at: number | null;
  /** Le dernier essai a-t-il été reçu ? Sinon, nouvel essai à l'examen suivant. */
  last_ok: boolean;
  last_status: number | null;
  /** Panne en cours et le jour où elle a commencé (ne bouge pas tant qu'elle dure). */
  panne_code: PanneCode | null;
  depuis: string | null;
  /** Jour où le plafond quotidien a déjà été noté au journal. */
  capped_day: string | null;
};

function readState(db: Database.Database): State | null {
  const row = db.prepare("SELECT details_json FROM operation_checks WHERE name=?").get(CHECK) as { details_json: string } | undefined;
  if (!row) return null;
  try {
    const raw = JSON.parse(row.details_json) as Partial<State>;
    if (!raw || typeof raw !== "object" || raw.version !== 1 || typeof raw.day !== "string") return null;
    return {
      version: 1,
      day: raw.day,
      attempts_today: Number.isSafeInteger(raw.attempts_today) && (raw.attempts_today as number) >= 0 ? (raw.attempts_today as number) : 0,
      last_key: typeof raw.last_key === "string" ? raw.last_key : null,
      last_sent_at: Number.isSafeInteger(raw.last_sent_at) ? (raw.last_sent_at as number) : null,
      last_ok: raw.last_ok === true,
      last_status: Number.isSafeInteger(raw.last_status) ? (raw.last_status as number) : null,
      panne_code: typeof raw.panne_code === "string" ? (raw.panne_code as PanneCode) : null,
      depuis: typeof raw.depuis === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.depuis) ? raw.depuis : null,
      capped_day: typeof raw.capped_day === "string" ? raw.capped_day : null,
    };
  } catch {
    return null;
  }
}

function save(db: Database.Database, now: number, state: State): void {
  db.prepare(
    "INSERT INTO operation_checks(name,checked_at,details_json) VALUES(?,?,?) " +
      "ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json",
  ).run(CHECK, now, JSON.stringify(state));
}

type Dependencies = {
  database: () => Database.Database;
  now: () => number;
  guichet: GuichetClient;
};

const defaults: Dependencies = {
  database: getDb,
  now: () => Date.now(),
  guichet: createGuichetClient(),
};

export type SanteOutcome = "sent" | "unchanged" | "refused" | "unreachable" | "capped" | "no_token";

/** Un examen : diagnostic, puis une santé si elle est due. Ne lève jamais pour une panne du bureau. */
export async function runRobotSante(overrides: Partial<Dependencies> = {}): Promise<SanteOutcome> {
  const deps: Dependencies = { ...defaults, ...overrides };
  if (!deps.guichet.configured()) return "no_token";
  const db = deps.database();
  const now = deps.now();
  const today = zurichDate(now);
  const previous = readState(db);
  const diagnostic = diagnose(db, now);

  const panneCode = diagnostic.etat === "panne" ? diagnostic.code : null;
  // `depuis` : le jour où CETTE panne a commencé ; il ne bouge pas tant que le même code dure.
  const depuis = panneCode ? (previous?.panne_code === panneCode && previous.depuis ? previous.depuis : today) : null;
  const key = panneCode ? `panne:${panneCode}:${depuis}` : "ok";
  const attemptsToday = previous?.day === today ? previous.attempts_today : 0;

  const base: State = {
    version: 1,
    day: today,
    attempts_today: attemptsToday,
    last_key: previous?.last_key ?? null,
    last_sent_at: previous?.last_sent_at ?? null,
    last_ok: previous?.last_ok ?? false,
    last_status: previous?.last_status ?? null,
    panne_code: panneCode,
    depuis,
    capped_day: previous?.capped_day ?? null,
  };

  const due =
    !previous ||
    !previous.last_ok ||
    previous.last_key !== key ||
    previous.last_sent_at === null ||
    now - previous.last_sent_at >= HEARTBEAT_MS;
  if (!due) {
    save(db, now, base);
    return "unchanged";
  }
  if (attemptsToday >= DAILY_CAP) {
    if (base.capped_day !== today) console.warn(`[santé] ${DAILY_CAP} essais aujourd'hui : plus rien jusqu'à minuit (Zurich)`);
    save(db, now, { ...base, capped_day: today });
    return "capped";
  }

  const body: SanteBody =
    diagnostic.etat === "panne"
      ? { etat: "panne", code: diagnostic.code, depuis: depuis as string, n: diagnostic.n }
      : { etat: "ok", code: "ok", n: 0 };
  let status: number | null;
  try {
    status = await deps.guichet.sante(body);
  } catch {
    status = null;
  }
  if (status === 429) console.warn("[santé] refusée par le bureau : plus de 200 aujourd'hui, mon état affiché n'est plus à jour");
  else if (status !== null && status !== 200) console.warn(`[santé] refusée par le bureau (HTTP ${status})`);

  const received = status === 200;
  save(db, now, {
    ...base,
    attempts_today: attemptsToday + 1,
    last_ok: received,
    last_status: status,
    ...(received ? { last_key: key, last_sent_at: now } : {}),
  });
  if (received) return "sent";
  return status === null ? "unreachable" : "refused";
}

/**
 * Minuterie du point d'entrée réel (jamais dans `createApp`) : premier examen après 3 minutes (après le
 * premier passage de l'expéditeur et de la veille), puis toutes les 5 minutes. Sans jeton ni adresse du guichet,
 * rien ne démarre (une ligne au journal).
 */
export function startRobotSante(
  overrides: Partial<Dependencies> & { run?: () => Promise<SanteOutcome> } = {},
): () => void {
  const guichet = overrides.guichet ?? defaults.guichet;
  if (!guichet.configured()) {
    console.info("[santé] guichet non configuré (jeton ou adresse) : santé non dite au bureau");
    return () => undefined;
  }
  const { run = () => runRobotSante(overrides) } = overrides;
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
      await run();
    } catch {
      console.error("[santé] examen interrompu ; nouvel essai dans cinq minutes");
    } finally {
      schedule(INTERVAL_MS);
    }
  };
  schedule(START_DELAY_MS);
  console.info("[santé] minuterie active ; premier examen après 3 minutes");
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
