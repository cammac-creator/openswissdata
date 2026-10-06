// Lettres institutionnelles : domaines autorisés, calcul pur du créneau d'envoi
// (fuseau Europe/Zurich, jours ouvrés et fériés fédéraux/cantonaux retenus) et
// types de la table `institutional_letters`. Aucun envoi ici — seulement du
// calcul, testable sans horloge système ni réseau (voir plan du 06.10.2026,
// tâche 1 : « Table, dépôt et lecture »).

export const ALLOWED_RECIPIENT_DOMAINS = Object.freeze([
  "admin.ch",
  "finma.ch",
  "un.org",
  "gleif.org",
]) as readonly string[];

export const LETTER_KINDS = ["letter", "reminder"] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

export const LETTER_STATUSES = ["queued", "sending", "sent", "failed", "cancelled"] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];

export const REPLY_KINDS = ["human", "auto"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

export interface InstitutionalLetter {
  id: string;
  kind: LetterKind;
  parent_id: string | null;
  to_address: string;
  cc: string | null;
  subject: string;
  body: string;
  purpose: string;
  status: LetterStatus;
  scheduled_at: number;
  lease_until: number | null;
  /** Moment du dernier essai réel, posé à chaque réclamation (correction du 06.10, I3/B) ; `null`
   * si la lettre n'a encore jamais été réclamée pour l'envoi. */
  attempted_at: number | null;
  attempts: number;
  resend_id: string | null;
  sent_at: number | null;
  reply_at: number | null;
  reply_from: string | null;
  reply_subject: string | null;
  reply_extract: string | null;
  reply_kind: ReplyKind | null;
  reply_processed_at: number | null;
  created_at: number;
}

// --- Domaines autorisés -----------------------------------------------------

// Local part : jeu de caractères usuel d'une adresse fonctionnelle (RFC 5322
// simplifié). Pas de guillemet, pas d'espace, pas de virgule : une tentative
// d'injection (« "FINMA" <x@finma.ch> », « a@admin.ch,b@evil.com ») est
// rejetée ici, avant même la comparaison de domaine.
const LOCAL_PART_RE = /^[A-Za-z0-9._%+-]+$/;

// Domaine : labels ASCII stricts séparés par un point, aucun label vide (donc
// ni point de tête, ni point final, ni double point), aucun caractère
// ressemblant (ex. un « а » cyrillique) puisque seul [a-z0-9-] est autorisé.
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Adresse fonctionnelle vers un domaine institutionnel autorisé.
 * Comparaison sur la partie après le DERNIER « @ », en minuscules : égalité
 * exacte du domaine OU suffixe « .<domaine> » (sous-domaine). Refuse les
 * imitations (« admin.ch.example.com », « xadmin.ch »), les adresses à
 * plusieurs « @ », les espaces et les caractères de contrôle.
 */
export function isAllowedRecipient(address: string): boolean {
  if (typeof address !== "string" || address.length === 0) return false;
  if (/[\s\x00-\x1F\x7F]/.test(address)) return false;
  const parts = address.split("@");
  if (parts.length !== 2) return false;
  const [local, domainRaw] = parts;
  if (!local || !domainRaw) return false;
  if (!LOCAL_PART_RE.test(local)) return false;
  const domain = domainRaw.toLowerCase();
  if (!DOMAIN_RE.test(domain)) return false;
  return ALLOWED_RECIPIENT_DOMAINS.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  );
}

// --- Jours fériés fédéraux/cantonaux retenus --------------------------------
// Liste fermée, Vaud et Zurich confondus, prudence : 1er et 2 janvier,
// Vendredi saint, lundi de Pâques, Ascension, lundi de Pentecôte, 1er août,
// 25 et 26 décembre. Pâques par l'algorithme grégorien (Meeus/Jones/Butcher).

/** Dimanche de Pâques (calendrier grégorien, algorithme de Meeus/Jones/Butcher). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const raw = h + l - 7 * m + 114;
  const month = Math.floor(raw / 31); // 3 = mars, 4 = avril
  const day = (raw % 31) + 1;
  return { month, day };
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  offsetDays: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function federalHolidaysOf(year: number): Set<string> {
  const easter = easterSunday(year);
  const dates = [
    { year, month: 1, day: 1 },
    { year, month: 1, day: 2 },
    addCalendarDays(year, easter.month, easter.day, -2), // Vendredi saint
    addCalendarDays(year, easter.month, easter.day, 1), // lundi de Pâques
    addCalendarDays(year, easter.month, easter.day, 39), // Ascension
    addCalendarDays(year, easter.month, easter.day, 50), // lundi de Pentecôte
    { year, month: 8, day: 1 },
    { year, month: 12, day: 25 },
    { year, month: 12, day: 26 },
  ];
  return new Set(dates.map(({ year: y, month: m, day: d }) => dateKey(y, m, d)));
}

const holidayCache = new Map<number, Set<string>>();

/** Fait partie de la liste fermée des jours fériés retenus (voir plan). */
export function isSwissFederalHoliday(year: number, month: number, day: number): boolean {
  let holidays = holidayCache.get(year);
  if (!holidays) {
    holidays = federalHolidaysOf(year);
    holidayCache.set(year, holidays);
  }
  return holidays.has(dateKey(year, month, day));
}

/** Jour ouvré : lundi-vendredi, hors jours fériés retenus. */
export function isSwissBusinessDay(year: number, month: number, day: number): boolean {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !isSwissFederalHoliday(year, month, day);
}

// --- Heure de Zurich (Intl, sans dépendance, gère l'heure d'été) -----------

const ZURICH_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Zurich",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function zurichFormatParts(utcMs: number): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of ZURICH_FORMAT.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

/** Décalage de Zurich par rapport à l'UTC, en minutes, à l'instant donné. */
function zurichOffsetMinutes(utcMs: number): number {
  const p = zurichFormatParts(utcMs);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - utcMs) / 60_000);
}

export interface ZurichParts {
  year: number;
  month: number;
  day: number;
  /** Minute depuis minuit, heure de Zurich (0–1439). */
  minuteOfDay: number;
  /** 0 = dimanche … 6 = samedi. */
  weekday: number;
}

/** Date et heure de Zurich correspondant à un instant epoch (ms). */
export function toZurichParts(utcMs: number): ZurichParts {
  const p = zurichFormatParts(utcMs);
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, minuteOfDay: Number(p.hour) * 60 + Number(p.minute), weekday };
}

/**
 * Instant epoch (ms) correspondant à une date et heure de Zurich. Un seul
 * calcul de décalage suffit : la fenêtre 09:05–17:30 ne traverse jamais un
 * changement d'heure (toujours vers 2 h ou 3 h du matin).
 */
function zurichToUtc(year: number, month: number, day: number, minuteOfDay: number): number {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = zurichOffsetMinutes(guess);
  return guess - offset * 60_000;
}

// --- Créneau d'envoi ---------------------------------------------------------

const WINDOW_START_MINUTE = 9 * 60 + 5; // 09:05
const WINDOW_END_MINUTE = 17 * 60 + 30; // 17:30 — fenêtre générale, utilisée par `isSendableNow`.
// Correction du 06.10.2026 (relecture Opus, I2c) : un multiple de 5 ne suffisait pas à écarter le
// risque qu'un passage qui glisse (retentative Resend, Telegram) envoie une lettre hors créneau.
// `scheduleSlot` ne tire donc plus désormais que des minutes dont le dernier chiffre est 1, 2, 6 ou
// 7 (marge d'au moins 3 min avant tout multiple de 5) et jamais plus tard que 17:27 (marge de 3 min
// avant la fermeture à 17:30). `isSendableNow` reste inchangée (fenêtre 09:05-17:30, non multiple de
// 5) : c'est le filet de sécurité au moment réel de l'envoi, plus large que ce tirage par construction.
const SCHEDULE_LATEST_MINUTE = 17 * 60 + 27; // 17:27
const SCHEDULABLE_LAST_DIGITS: ReadonlySet<number> = new Set([1, 2, 6, 7]);
const MIN_GAP_MINUTES = 12;
const MAX_LETTERS_PER_DAY = 5;
// Garde-fou : une file saturée pendant des mois ne doit jamais boucler sans fin.
const MAX_DAYS_FORWARD = 400;

/** Minutes valides d'un jour donné : dans la fenêtre (jusqu'à 17:27 au plus tard), le dernier
 * chiffre dans {1,2,6,7}, à au moins MIN_GAP_MINUTES de toute autre lettre déjà planifiée ce
 * jour-là. */
function validMinutesOfDay(earliestMinute: number, sameDayMinutes: readonly number[]): number[] {
  const start = Math.max(WINDOW_START_MINUTE, earliestMinute);
  const minutes: number[] = [];
  for (let minute = start; minute <= SCHEDULE_LATEST_MINUTE; minute++) {
    if (!SCHEDULABLE_LAST_DIGITS.has(minute % 10)) continue;
    if (sameDayMinutes.some((m) => Math.abs(m - minute) < MIN_GAP_MINUTES)) continue;
    minutes.push(minute);
  }
  return minutes;
}

/**
 * Vrai seulement un jour ouvré, dans la fenêtre 09:05–17:30 (Zurich), à une minute qui n'est
 * jamais un multiple de 5. Plus large que la contrainte que `scheduleSlot` impose désormais au
 * tirage (minute dont le dernier chiffre est 1, 2, 6 ou 7, jusqu'à 17:27 au plus tard) : c'est le
 * filet de sécurité au moment réel de l'envoi, pas une seconde copie de ce tirage. Sert à
 * l'expéditeur périodique (tâche 2) : si un passage glisse (retentative Resend, Telegram), il ne
 * doit jamais envoyer hors de ce créneau même pour une lettre qui n'est pas encore « en retard »
 * au sens des dix minutes (Review Focus #4 : jamais après 17:30, jamais sur une minute ronde).
 * L'expéditeur l'appelle deux fois (`t` et `t + 60 s`) avant de réclamer une lettre : un envoi qui
 * prendrait jusqu'à une minute ne doit pas, lui non plus, finir hors créneau.
 */
export function isSendableNow(utcMs: number): boolean {
  const p = toZurichParts(utcMs);
  if (!isSwissBusinessDay(p.year, p.month, p.day)) return false;
  if (p.minuteOfDay < WINDOW_START_MINUTE || p.minuteOfDay > WINDOW_END_MINUTE) return false;
  return p.minuteOfDay % 5 !== 0;
}

/**
 * Premier créneau d'envoi valide à partir de `now` : jour ouvré (aujourd'hui
 * si l'heure le permet encore), moins de 5 lettres déjà planifiées ce jour,
 * minute tirée au hasard dans 09:05–17:30 heure de Zurich, jamais multiple de
 * 5, au moins 12 minutes d'écart avec toute autre lettre planifiée, jamais
 * dans le passé.
 *
 * Implémentation : plutôt que de tirer une minute au hasard et de réessayer
 * jusqu'à ce qu'elle convienne (qui peut échouer à tort si la fenêtre est
 * presque pleine), on énumère toutes les minutes valides du jour puis on
 * choisit l'une d'elles au hasard via `rng()` — même garantie, sans faux
 * négatif. Si aucune minute ne convient ce jour-là, on passe au jour ouvré
 * suivant.
 *
 * `existingScheduled` : les `scheduled_at` (epoch ms) des lettres à compter
 * pour le plafond et l'écart (lettres `queued`/`sending`/`sent`, jamais
 * `cancelled`/`failed` — à la charge de l'appelant). `rng` : générateur
 * injecté, `() => number` dans [0, 1), pour des tests déterministes.
 */
export function scheduleSlot(
  now: number,
  existingScheduled: readonly number[],
  rng: () => number,
): number {
  const nowParts = toZurichParts(now);
  let cursor = { year: nowParts.year, month: nowParts.month, day: nowParts.day };

  for (let daysTried = 0; daysTried < MAX_DAYS_FORWARD; daysTried++) {
    const isToday = daysTried === 0;
    if (isSwissBusinessDay(cursor.year, cursor.month, cursor.day)) {
      const sameDayExisting = existingScheduled.filter((ts) => {
        const p = toZurichParts(ts);
        return p.year === cursor.year && p.month === cursor.month && p.day === cursor.day;
      });
      if (sameDayExisting.length < MAX_LETTERS_PER_DAY) {
        const earliestMinute = isToday ? nowParts.minuteOfDay + 1 : WINDOW_START_MINUTE;
        const sameDayMinutes = sameDayExisting.map((ts) => toZurichParts(ts).minuteOfDay);
        const candidates = validMinutesOfDay(earliestMinute, sameDayMinutes);
        if (candidates.length > 0) {
          const index = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length));
          const minute = candidates[index];
          return zurichToUtc(cursor.year, cursor.month, cursor.day, minute);
        }
      }
    }
    cursor = addCalendarDays(cursor.year, cursor.month, cursor.day, 1);
  }
  throw new Error("letters_schedule_saturated");
}

// --- Jours ouvrés écoulés (relance) -----------------------------------------

/** Index entier du jour calendaire (fuseau Europe/Zurich), pour comparer deux dates sans heure. */
function calendarDayIndex(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Nombre de jours ouvrés strictement après la date (Zurich) de `fromMs`
 * jusqu'à la date (Zurich) de `toMs` incluse — mêmes jours fériés que
 * `scheduleSlot`. Sert à la relance : « 15 jours ouvrés après l'envoi sans
 * réponse » (tâche 2). `fromMs`/`toMs` dans le désordre ou le même jour → 0.
 */
export function businessDaysSince(fromMs: number, toMs: number): number {
  const from = toZurichParts(fromMs);
  const to = toZurichParts(toMs);
  const fromIndex = calendarDayIndex(from.year, from.month, from.day);
  const toIndex = calendarDayIndex(to.year, to.month, to.day);
  if (toIndex <= fromIndex) return 0;
  let count = 0;
  for (let index = fromIndex + 1; index <= toIndex; index++) {
    const d = new Date(index * 86_400_000);
    if (isSwissBusinessDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())) count++;
  }
  return count;
}
