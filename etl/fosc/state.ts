/**
 * État « argent » de la collecte FOSC (rubrique HR) et ses règles de conservation.
 *
 * Étage écrit : argent. Il contient seulement :
 *   - `events` : une ligne par avis d'une SOCIÉTÉ de la liste blanche (`legal-forms.ts`) :
 *     identifiant technique de l'avis (pour l'idempotence et la revérification, jamais publié),
 *     IDE, type d'événement (sous-rubrique HR01, HR02, HR03), date de publication, numéro OFS de
 *     la commune du siège, canton, forme juridique, jour de suppression (`delete_on`), date de
 *     la dernière revérification. Jamais de texte libre, de raison sociale, de nom, de but ni
 *     d'adresse. Jamais une entreprise individuelle.
 *   - `days` : par jour de publication, des TOTAUX (type × canton × forme juridique), entreprises
 *     individuelles comprises, sans aucun identifiant d'avis ni d'entreprise.
 *   - `months` : les mois figés, mêmes totaux.
 *
 * Conservation des lignes (règle prudente, rapport du lot du 22.10.2026, rendue exacte après
 * relecture) : une ligne part dès que
 *   (a) son jour de suppression `delete_on` arrive : min(`expirationDate` de l'avis, publication
 *       + `MAX_RETENTION_DAYS`). Un passage du jour T supprime toute ligne dont `delete_on` ≤ T + 1 :
 *       la ligne n'existe donc plus le jour `delete_on` (J + 30 au plus tard, J = publication) dès
 *       que le passage de la veille a eu lieu ; sinon elle part au premier passage suivant ;
 *   (b) l'avis n'est plus dans la liste PUBLISHED de son jour lors d'une revérification ;
 *   (c) elle n'a pas pu être revérifiée depuis plus de `MAX_UNVERIFIED_DAYS` jours.
 * La durée de publication d'un avis HR n'est pas fixée (`expirationDate` nul, art. 11 al. 2
 * OFOSC : accès de durée indéterminée que le service d'annonces peut limiter, au moins un mois) :
 * `MAX_RETENTION_DAYS` reprend ce plancher d'un mois. Le prolonger est une décision de
 * Claude-Alain.
 */
import { SOLE_PROPRIETORSHIP } from "./legal-forms.js";

export const STATE_SCHEMA = "openswissdata.fosc-hr-state";
export const STATE_SCHEMA_VERSION = 1;

/** Plancher d'un mois de l'art. 11 al. 2 OFOSC : la ligne n'existe plus le 30e jour après la publication. */
export const MAX_RETENTION_DAYS = 30;
/** Une ligne qu'on n'a pas pu revérifier depuis plus de 3 jours est supprimée. */
export const MAX_UNVERIFIED_DAYS = 3;
/** Fenêtre de rattrapage : jours recalculés s'ils changent ; au-delà, un jour est figé. */
export const WINDOW_DAYS = 7;

export interface FoscEventRow {
  publication_id: string;
  ide: string;
  event_type: string;
  publication_date: string;
  municipality_bfs_id: number | null;
  canton: string;
  legal_form: string;
  /** Jour où la ligne ne doit plus exister (supprimée au passage de la veille au plus tard possible). */
  delete_on: string;
  verified_on: string;
}

export interface Tally {
  event_type: string;
  canton: string;
  legal_form: string;
  count: number;
}

export interface DayRecord {
  date: string;
  /** Avis PUBLISHED de la liste lors du dernier calcul complet du jour. */
  listed: number;
  /** Dont avis dont une ligne de société est stockée. */
  stored_rows: number;
  /** Dont avis comptés seulement (entreprise individuelle, autre forme, champ manquant). */
  totals_only: number;
  /** Dont entreprises individuelles (forme 0101), comptées dans les totaux seulement. */
  sole_proprietorships: number;
  /** Avis d'essai (`testImport`), écartés de tout. */
  test_imports: number;
  /** Détails illisibles ou en échec : comptés avec une forme « inconnue ». */
  detail_failed: number;
  computed_at: string;
  tallies: Tally[];
}

export interface MonthRecord {
  month: string;
  frozen_at: string;
  days_collected: string[];
  listed: number;
  detail_failed: number;
  tallies: Tally[];
}

export interface FoscState {
  schema: typeof STATE_SCHEMA;
  schema_version: typeof STATE_SCHEMA_VERSION;
  /** Premier jour collecté : la couverture se compte à partir de lui. */
  collection_started_on: string | null;
  updated_at: string;
  events: FoscEventRow[];
  days: DayRecord[];
  months: MonthRecord[];
}

export function emptyState(now: Date): FoscState {
  return {
    schema: STATE_SCHEMA,
    schema_version: STATE_SCHEMA_VERSION,
    collection_started_on: null,
    updated_at: now.toISOString(),
    events: [],
    days: [],
    months: [],
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const IDE_RE = /^CHE-\d{3}\.\d{3}\.\d{3}$/;

export class FoscStateError extends Error {
  constructor(reason: string) {
    super(`État FOSC illisible (${reason}) : passage arrêté, l'état n'est jamais recréé à vide`);
    this.name = "FoscStateError";
  }
}

const isTally = (t: unknown): t is Tally => {
  const x = t as Tally;
  return !!x && typeof x.event_type === "string" && typeof x.canton === "string" && typeof x.legal_form === "string"
    && Number.isInteger(x.count) && x.count > 0;
};

/** Contrôle strict d'un état relu : une forme inattendue arrête le passage. */
export function validateState(value: unknown): FoscState {
  const s = value as FoscState;
  if (!s || typeof s !== "object") throw new FoscStateError("pas un objet");
  if (s.schema !== STATE_SCHEMA || s.schema_version !== STATE_SCHEMA_VERSION) throw new FoscStateError("schéma inattendu");
  if (s.collection_started_on !== null && !DAY_RE.test(String(s.collection_started_on))) throw new FoscStateError("date de début");
  if (!Array.isArray(s.events) || !Array.isArray(s.days) || !Array.isArray(s.months)) throw new FoscStateError("tableaux absents");
  const allowedRowKeys = new Set(["publication_id", "ide", "event_type", "publication_date", "municipality_bfs_id", "canton", "legal_form", "delete_on", "verified_on"]);
  for (const e of s.events) {
    if (!e || typeof e !== "object") throw new FoscStateError("ligne");
    for (const k of Object.keys(e)) if (!allowedRowKeys.has(k)) throw new FoscStateError("champ de ligne non autorisé");
    if (!IDE_RE.test(e.ide) || !DAY_RE.test(e.publication_date) || !DAY_RE.test(e.delete_on) || !DAY_RE.test(e.verified_on)) {
      throw new FoscStateError("ligne mal formée");
    }
    if (e.legal_form === SOLE_PROPRIETORSHIP) throw new FoscStateError("entreprise individuelle en ligne");
  }
  for (const d of s.days) {
    if (!d || !DAY_RE.test(d.date) || !Array.isArray(d.tallies) || !d.tallies.every(isTally)) throw new FoscStateError("jour mal formé");
  }
  for (const m of s.months) {
    if (!m || !MONTH_RE.test(m.month) || !Array.isArray(m.tallies) || !m.tallies.every(isTally) || !Array.isArray(m.days_collected)) {
      throw new FoscStateError("mois mal formé");
    }
  }
  return s;
}

/** Date civile suisse (Europe/Zurich) d'un instant, AAAA-MM-JJ. */
export function zurichDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Jours de la fenêtre de rattrapage, du plus ancien au plus récent (aujourd'hui compris). */
export function windowDays(today: string, windowDays = WINDOW_DAYS): string[] {
  const out: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}

/** Jour de suppression : min(échéance de l'avis, publication + 30 jours). */
export function deleteOn(publicationDate: string, expirationDate: string | null): string {
  const max = addDays(publicationDate, MAX_RETENTION_DAYS);
  return expirationDate && expirationDate < max ? expirationDate : max;
}

/** Une ligne doit partir au passage du jour `today` si elle ne peut pas exister demain. */
export function isDeletionDue(deleteOnDay: string, today: string): boolean {
  return deleteOnDay <= addDays(today, 1);
}

export interface PurgeCounts { expired: number; unverified: number; unpublished: number }

/** Règle (a) : sans réseau, au début de chaque passage, avant toute lecture du portail. */
export function purgeExpired(state: FoscState, today: string): number {
  const before = state.events.length;
  state.events = state.events.filter((e) => !isDeletionDue(e.delete_on, today));
  return before - state.events.length;
}

/**
 * Règle (c) : à la fin de chaque passage, après la tentative de revérification (ou à sa place si
 * le portail n'a pas pu être lu) : une ligne non revérifiée depuis plus de trois jours part.
 */
export function purgeUnverified(state: FoscState, today: string): number {
  const oldestVerified = addDays(today, -MAX_UNVERIFIED_DAYS);
  const before = state.events.length;
  state.events = state.events.filter((e) => e.verified_on >= oldestVerified);
  return before - state.events.length;
}

/**
 * Règle (b) : `publishedIds` = identifiants de la liste PUBLISHED du jour, relue en entier.
 * Les lignes absentes partent ; les autres sont marquées revérifiées aujourd'hui.
 */
export function applyVerification(state: FoscState, day: string, publishedIds: ReadonlySet<string>, today: string): number {
  let removed = 0;
  state.events = state.events.filter((e) => {
    if (e.publication_date !== day) return true;
    if (!publishedIds.has(e.publication_id)) { removed++; return false; }
    e.verified_on = today;
    return true;
  });
  return removed;
}

export function addTally(tallies: Map<string, Tally>, t: Omit<Tally, "count">, count = 1): void {
  const k = `${t.event_type}|${t.canton}|${t.legal_form}`;
  const prev = tallies.get(k);
  if (prev) prev.count += count;
  else tallies.set(k, { ...t, count });
}

export function sortTallies(tallies: Iterable<Tally>): Tally[] {
  return [...tallies].sort((a, b) =>
    a.event_type.localeCompare(b.event_type) || a.canton.localeCompare(b.canton) || a.legal_form.localeCompare(b.legal_form));
}

/** Remplace (jamais n'ajoute) le calcul d'un jour : rejouer un jour ne double rien. */
export function replaceDay(state: FoscState, record: DayRecord, rows: FoscEventRow[]): void {
  state.days = [...state.days.filter((d) => d.date !== record.date), record].sort((a, b) => a.date.localeCompare(b.date));
  state.events = [...state.events.filter((e) => e.publication_date !== record.date), ...rows]
    .sort((a, b) => a.publication_date.localeCompare(b.publication_date) || a.publication_id.localeCompare(b.publication_id));
  if (!state.collection_started_on || record.date < state.collection_started_on) state.collection_started_on = record.date;
}

const lastDayOfMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * Fige un mois quand tous ses jours sont sortis de la fenêtre : ses totaux sont recopiés une fois
 * pour toutes dans `months`, puis ses totaux par jour sont retirés. Un mois figé n'est jamais
 * recalculé (comme les mois figés des mouvements FINMA).
 */
export function freezeMonths(state: FoscState, today: string, now: Date, window = WINDOW_DAYS): string[] {
  const windowStart = addDays(today, -(window - 1));
  const byMonth = new Map<string, DayRecord[]>();
  for (const d of state.days) {
    const m = d.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), d]);
  }
  const due = [...byMonth.keys()].filter((month) => lastDayOfMonth(month) < windowStart);
  // Contrôle AVANT toute modification : une erreur laisse l'état intact (la purge reste enregistrable).
  if (due.some((month) => state.months.some((m) => m.month === month))) throw new FoscStateError("mois déjà figé recalculé");
  const frozen: string[] = [];
  for (const [month, days] of byMonth) {
    if (!due.includes(month)) continue;
    const tallies = new Map<string, Tally>();
    for (const d of days) for (const t of d.tallies) addTally(tallies, t, t.count);
    state.months.push({
      month,
      frozen_at: now.toISOString(),
      days_collected: days.map((d) => d.date).sort(),
      listed: days.reduce((s, d) => s + d.listed, 0),
      detail_failed: days.reduce((s, d) => s + d.detail_failed, 0),
      tallies: sortTallies(tallies.values()),
    });
    state.days = state.days.filter((d) => d.date.slice(0, 7) !== month);
    frozen.push(month);
  }
  state.months.sort((a, b) => a.month.localeCompare(b.month));
  return frozen;
}
