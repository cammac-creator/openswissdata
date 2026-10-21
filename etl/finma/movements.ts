/**
 * Mouvements mensuels FINMA (lot V1 de la vitrine « Mouvements FINMA », décisions
 * de Claude-Alain des 16.10 et 21.10.2026). Des TOTAUX seulement : aucun nom,
 * aucun IDE, aucune adresse de page ne sort de ce module. Le bloc produit est
 * publié dans `quality.json` (`history.movements`) de chaque archive FINMA et
 * repris tel quel par `/api/catalog/finma`.
 *
 * Règles (détail dans `MOVEMENTS_METHOD`) :
 * - registre : comparaison de deux collectes consécutives avec la clé du
 *   changelog (`delta.ts`) ; une apparition et une disparition de la même
 *   identité (IDE, à défaut nom exact) dans la même comparaison forment un
 *   changement de type d'autorisation, ou, avec le même libellé FINMA, un
 *   reclassement de NOTRE collecte (exclu des mouvements, compté à part) ;
 * - liste d'alerte : ajouts datés par la `date_added` de la FINMA, apparitions
 *   et retraits par l'adresse exacte `source_url`, jamais par le nom ;
 * - une comparaison de plus de `gap_days` jours (le trou du 24.08 au 25.09.2026)
 *   n'est comptée dans aucun mois : elle est publiée à part (« reprises ») ;
 * - une comparaison anormale est exclue du mois et listée, jamais comptée en silence ;
 * - un mois clos est figé, puis recopié tel quel d'archive en archive : il
 *   survit à la fenêtre glissante de 90 jours.
 *
 * Module pur, sans réseau ni fichier. Il ne dépend pas de `history.ts` (le test
 * d'arrêt de la collecte remplace ce module par un simulacre à trois exports).
 */
import { computeDelta, type DeltaChange } from "./delta.js";
import type { FinmaEntity, FinmaWarning } from "./types.js";

export const MOVEMENTS_SCHEMA_VERSION = 1;

export const MOVEMENT_RULES = Object.freeze({
  /** Même seuil que le détecteur de trous de `history.ts` : au-delà, la comparaison est une reprise. */
  gap_days: 2,
  /** Un mois est figé à la première collecte datée de ce jour du mois suivant, ou après. */
  freeze_day: 3,
  /** Seuil d'une comparaison anormale : plus de max(30 lignes, 1 % des lignes de la version précédente) par jour écoulé. */
  anomaly_min_rows: 30,
  anomaly_share: 0.01,
});

export const MOVEMENTS_METHOD = [
  "Totaux seulement : aucun nom, aucun IDE, aucune adresse de page.",
  "Registre : comparaison de deux collectes consécutives avec la clé du changelog (IDE, à défaut nom exact, catégorie et libellé d'autorisation). Une apparition et une disparition de la même identité dans la même comparaison forment un changement de type d'autorisation, compté dans la catégorie de la nouvelle autorisation ; si le libellé FINMA est le même et que seule notre catégorie change, c'est un reclassement de la collecte, compté à part et exclu des mouvements. Plusieurs apparitions ou disparitions de la même identité restent comptées telles quelles.",
  "Liste d'alerte : ajouts du mois selon la date d'ajout publiée par la FINMA, pour les entrées vues par une comparaison comptée ou déjà présentes au début de la période lue ; apparitions et retraits par l'adresse exacte de la page de détail, jamais par le nom. Un changement d'adresse de page compte comme un retrait et une apparition ; « removed_possible_url_change » signale les retraits dont la même date d'ajout réapparaît sous une autre adresse dans la même comparaison.",
  "Dates d'observation : un mouvement est rangé dans le mois de la collecte qui le constate, pas à la date de la décision de la FINMA.",
  "Une comparaison de plus de deux jours n'est comptée dans aucun mois : ses mouvements sont publiés à part, dans « resumptions » (constatés à la reprise).",
  "Une comparaison anormale (plus de max(30 lignes, 1 % des lignes de la version précédente) par jour écoulé) est exclue du mois pour la liste concernée et listée dans « excluded ».",
  "Un mois est figé à la première collecte datée du 3 du mois suivant ou après, puis recopié tel quel dans chaque archive ; un mois incomplet porte « partial ».",
  "Une disparition ou un retrait ne dit pas pourquoi : ce n'est pas une sanction.",
].join(" ");

const REGISTRY_KINDS = ["added", "removed", "licence_changed", "name_changed", "city_changed", "status_changed", "address_changed"] as const;
export type RegistryKind = (typeof REGISTRY_KINDS)[number];
export type RegistryCounts = Record<RegistryKind, number>;

const WARNING_COUNTERS = ["appeared", "appeared_late", "removed", "removed_possible_url_change"] as const;
export type WarningCounts = Record<(typeof WARNING_COUNTERS)[number], number>;

export interface RegistryMovements {
  totals: RegistryCounts;
  /** Catégories qui ont au moins un mouvement compté ; une catégorie absente n'en a aucun. */
  by_category: Record<string, RegistryCounts>;
  /** Reclassements de notre collecte (même libellé FINMA, autre catégorie) : exclus des totaux. */
  reclassified_by_collection: number;
}

export interface Coverage {
  /** Comparaisons comptées pour cette liste. */
  comparisons: number;
  /** Jours du mois couverts par une comparaison comptée. */
  days_covered: number;
  complete: boolean;
}

export interface ExcludedComparison {
  from: string;
  to: string;
  days: number;
  list: "registry" | "warnings";
  movements: number;
  limit: number;
  reason: string;
}

export interface MonthMovements {
  month: string;
  status: "open" | "frozen";
  frozen_in_version: string | null;
  days_in_month: number;
  first_observed: string | null;
  last_observed: string | null;
  partial: boolean;
  registry: RegistryMovements & Coverage;
  warnings: WarningCounts & Coverage & {
    /** Entrées dont la date d'ajout FINMA tombe dans le mois (adresses distinctes). */
    added_dated_in_month: number;
    /** Version d'après laquelle `added_dated_in_month` a été compté. */
    added_as_of: string;
  };
  excluded: ExcludedComparison[];
}

export interface Resumption {
  from: string;
  to: string;
  days: number;
  registry: RegistryMovements;
  registry_anomaly: string | null;
  warnings: (WarningCounts & {
    /** Apparitions ventilées par mois de la date d'ajout FINMA. */
    appeared_by_finma_month: Record<string, number>;
    appeared_undated: number;
  }) | null;
  warnings_anomaly: string | null;
}

export interface MovementsBlock {
  schema_version: typeof MOVEMENTS_SCHEMA_VERSION;
  method: string;
  rules: typeof MOVEMENT_RULES;
  computed_in_version: string;
  /** Bornes propres du bloc : il garde les mois figés au-delà de la fenêtre de `history`. */
  first_observed: string | null;
  last_observed: string | null;
  months: MonthMovements[];
  resumptions: Resumption[];
  /** Entrées de la liste d'alerte de cette version sans date d'ajout (non rangées dans un mois). */
  warnings_without_date_added: number | null;
}

/** Une version lue : registre, et, quand l'archive les porte, liste d'alerte et `quality.json`. */
export interface MovementsSnapshot {
  version: string;
  entities: FinmaEntity[];
  warnings?: FinmaWarning[];
  quality?: unknown;
}

/** Bloc hérité présent mais illisible : la publication s'arrête plutôt que de perdre des mois figés. */
export class MovementsInheritanceError extends Error {
  constructor(public readonly version: string, detail: string) {
    super(`Mouvements FINMA hérités illisibles (version ${version}) : ${detail}`);
    this.name = "MovementsInheritanceError";
  }
}

const DAY = 86_400_000;
const VERSION_PATTERN = /^\d{4}\.\d{2}\.\d{2}(\.[0-9A-Za-z]+)?$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const versionDate = (version: string) => `${version.slice(0, 4)}-${version.slice(5, 7)}-${version.slice(8, 10)}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);
const compareVersions = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function daysInMonth(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

function freezeDate(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return isoDay(Date.UTC(year, m, MOVEMENT_RULES.freeze_day));
}

const emptyRegistryCounts = (): RegistryCounts => Object.fromEntries(REGISTRY_KINDS.map(k => [k, 0])) as RegistryCounts;
const emptyWarningCounts = (): WarningCounts => Object.fromEntries(WARNING_COUNTERS.map(k => [k, 0])) as WarningCounts;
const emptyRegistry = (): RegistryMovements => ({ totals: emptyRegistryCounts(), by_category: {}, reclassified_by_collection: 0 });

function bump(registry: RegistryMovements, category: string, kind: RegistryKind, by = 1) {
  registry.totals[kind] += by;
  (registry.by_category[category] ??= emptyRegistryCounts())[kind] += by;
}

function addRegistry(target: RegistryMovements, source: RegistryMovements) {
  for (const [category, counts] of Object.entries(source.by_category)) {
    for (const kind of REGISTRY_KINDS) if (counts[kind]) bump(target, category, kind, counts[kind]);
  }
  target.reclassified_by_collection += source.reclassified_by_collection;
}

const registryTotal = (registry: RegistryMovements) =>
  REGISTRY_KINDS.reduce((sum, kind) => sum + registry.totals[kind], 0) + registry.reclassified_by_collection;

/**
 * Mêmes champs comparés que `buildHistory` (`history.ts`) : guillemets retirés
 * du nom, adresse ignorée quand elle vient de GLEIF. Ajouter GLEIF n'est pas un
 * changement d'autorisation.
 */
function comparableRows(rows: FinmaEntity[]): FinmaEntity[] {
  return rows.map(row => ({
    ...row,
    name: typeof row.name === "string" ? row.name.replaceAll('"', "") : row.name,
    address: row.address_source_url ? undefined : row.address,
  }));
}

/** Identité d'une ligne : celle de la clé du changelog, sans catégorie ni libellé (`delta.ts`). */
const identity = (change: DeltaChange) => `${change.uid ?? change.name}`;
const label = (change: DeltaChange) => (change.after ?? change.before)?.licence_type ?? "";

export function compareRegistry(before: FinmaEntity[], after: FinmaEntity[]): RegistryMovements {
  const registry = emptyRegistry();
  const added = new Map<string, DeltaChange[]>();
  const removed = new Map<string, DeltaChange[]>();
  const push = (map: Map<string, DeltaChange[]>, change: DeltaChange) => {
    const list = map.get(identity(change)) ?? [];
    list.push(change);
    map.set(identity(change), list);
  };
  for (const change of computeDelta(comparableRows(before), comparableRows(after)).changes) {
    if (change.kind === "added") push(added, change);
    else if (change.kind === "removed") push(removed, change);
    else bump(registry, change.entity_type, change.kind);
  }
  for (const [id, appearing] of added) {
    const disappearing = removed.get(id) ?? [];
    const paired = new Set<DeltaChange>();
    // Reclassement de la collecte : même libellé FINMA, seule notre catégorie change.
    // Apparié seulement si la correspondance est unique ; sinon, compté tel quel.
    for (const text of new Set(appearing.map(label))) {
      const a = appearing.filter(c => label(c) === text);
      const r = disappearing.filter(c => label(c) === text);
      if (a.length === 1 && r.length === 1) {
        registry.reclassified_by_collection++;
        paired.add(a[0]).add(r[0]);
      }
    }
    // Changement de type d'autorisation : exactement une apparition et une disparition restantes.
    const restA = appearing.filter(c => !paired.has(c));
    const restR = disappearing.filter(c => !paired.has(c));
    if (restA.length === 1 && restR.length === 1) {
      bump(registry, restA[0].entity_type, "licence_changed");
      paired.add(restA[0]).add(restR[0]);
    }
    for (const c of appearing) if (!paired.has(c)) bump(registry, c.entity_type, "added");
    removed.set(id, disappearing.filter(c => !paired.has(c)));
  }
  for (const rest of removed.values()) for (const c of rest) bump(registry, c.entity_type, "removed");
  return registry;
}

/** Adresse exacte → date d'ajout FINMA (première occurrence ; une adresse en double compte une fois). */
function warningMap(list: FinmaWarning[]): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const w of list) if (typeof w.source_url === "string" && !map.has(w.source_url)) map.set(w.source_url, w.date_added || undefined);
  return map;
}

interface WarningComparison extends WarningCounts { appearedDates: Array<string | undefined>; appearedUrls: string[] }

export function compareWarnings(before: FinmaWarning[], after: FinmaWarning[], beforeDate: string): WarningComparison {
  const previous = warningMap(before), current = warningMap(after);
  const counts = emptyWarningCounts();
  const appearedDates: Array<string | undefined> = [], appearedUrls: string[] = [];
  const appearedByDate = new Map<string, number>(), removedByDate = new Map<string, number>();
  for (const [url, date] of current) {
    if (previous.has(url)) continue;
    counts.appeared++;
    appearedDates.push(date); appearedUrls.push(url);
    // Date FINMA antérieure à la collecte précédente : publiée tardivement ou rétroactivement.
    if (date && date < beforeDate) counts.appeared_late++;
    if (date) appearedByDate.set(date, (appearedByDate.get(date) ?? 0) + 1);
  }
  for (const [url, date] of previous) {
    if (current.has(url)) continue;
    counts.removed++;
    if (date) removedByDate.set(date, (removedByDate.get(date) ?? 0) + 1);
  }
  for (const [date, n] of removedByDate) counts.removed_possible_url_change += Math.min(n, appearedByDate.get(date) ?? 0);
  return { ...counts, appearedDates, appearedUrls };
}

function anomalyLimit(previousRows: number, days: number): number {
  return Math.max(MOVEMENT_RULES.anomaly_min_rows, Math.ceil(MOVEMENT_RULES.anomaly_share * previousRows)) * Math.max(1, days);
}

interface Comparison {
  from: string; to: string; days: number; observed: string;
  resumption: boolean;
  registry: RegistryMovements; registryMovements: number; registryLimit: number;
  warnings: WarningComparison | null; warningMovements: number; warningLimit: number;
}

const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkRegistry(value: unknown, where: string): string | null {
  if (!isObject(value) || !isObject(value.totals) || !isObject(value.by_category)) return `${where} : registre illisible`;
  if (!REGISTRY_KINDS.every(k => isCount((value.totals as Record<string, unknown>)[k]))) return `${where} : totaux du registre illisibles`;
  if (!isCount(value.reclassified_by_collection)) return `${where} : reclassements illisibles`;
  return null;
}

/** Contrôle un bloc hérité ; renvoie la première anomalie lue, ou null. */
export function movementsBlockProblem(value: unknown): string | null {
  if (!isObject(value)) return "bloc absent ou non objet";
  if (value.schema_version !== MOVEMENTS_SCHEMA_VERSION) return `version de schéma ${String(value.schema_version)}`;
  if (!Array.isArray(value.months) || !Array.isArray(value.resumptions)) return "mois ou reprises illisibles";
  const seen = new Set<string>();
  for (const month of value.months) {
    if (!isObject(month) || typeof month.month !== "string" || !MONTH_PATTERN.test(month.month)) return "mois illisible";
    if (seen.has(month.month)) return `mois ${month.month} en double`;
    seen.add(month.month);
    if (month.status !== "open" && month.status !== "frozen") return `statut du mois ${month.month} illisible`;
    if (month.status === "frozen" && (typeof month.frozen_in_version !== "string" || !VERSION_PATTERN.test(month.frozen_in_version))) return `version de gel du mois ${month.month} illisible`;
    const registryProblem = checkRegistry(month.registry, `mois ${month.month}`);
    if (registryProblem) return registryProblem;
    if (!isObject(month.warnings) || !WARNING_COUNTERS.every(k => isCount((month.warnings as Record<string, unknown>)[k])) || !isCount(month.warnings.added_dated_in_month)) return `liste d'alerte du mois ${month.month} illisible`;
    if (!Array.isArray(month.excluded)) return `exclusions du mois ${month.month} illisibles`;
  }
  for (const r of value.resumptions) {
    if (!isObject(r) || typeof r.from !== "string" || typeof r.to !== "string" || !VERSION_PATTERN.test(r.from) || !VERSION_PATTERN.test(r.to) || !isCount(r.days)) return "reprise illisible";
    const registryProblem = checkRegistry(r.registry, `reprise ${r.from} → ${r.to}`);
    if (registryProblem) return registryProblem;
  }
  return null;
}

/**
 * Bloc hérité : celui de la version publiée la plus récente qui en porte un.
 * Présent mais illisible → arrêt (`MovementsInheritanceError`) : repartir de
 * zéro perdrait en silence les mois figés sortis de la fenêtre.
 */
export function inheritedMovements(snapshots: MovementsSnapshot[]): { version: string; block: MovementsBlock } | null {
  const ordered = [...snapshots].sort((a, b) => compareVersions(a.version, b.version));
  for (let i = ordered.length - 1; i >= 0; i--) {
    const quality = ordered[i].quality;
    if (!isObject(quality) || !isObject(quality.history) || !("movements" in quality.history)) continue;
    const block = quality.history.movements;
    const problem = movementsBlockProblem(block);
    if (problem) throw new MovementsInheritanceError(ordered[i].version, problem);
    return { version: ordered[i].version, block: block as MovementsBlock };
  }
  return null;
}

function coveredDays(c: Comparison, month: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(versionDate(c.from)) + DAY; t <= Date.parse(c.observed); t += DAY) {
    const day = isoDay(t);
    if (day.slice(0, 7) === month) days.push(day);
  }
  return days;
}

/**
 * Calcule le bloc des mouvements de la version `current`, à partir des versions
 * publiées lues (`snapshots`, la fenêtre de la collecte) et du bloc hérité de la
 * plus récente d'entre elles. Les mois figés hérités et les reprises héritées
 * sont recopiés tels quels ; seuls les mois non figés sont recalculés.
 */
export function buildMovements(snapshots: MovementsSnapshot[], current: MovementsSnapshot): MovementsBlock {
  const ordered = [...snapshots.filter(s => s.version !== current.version), current]
    .sort((a, b) => compareVersions(a.version, b.version));
  const inherited = inheritedMovements(ordered.filter(s => s !== current));
  const currentDate = versionDate(current.version);

  const comparisons: Comparison[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const before = ordered[i - 1], after = ordered[i];
    const fromDate = versionDate(before.version), observed = versionDate(after.version);
    const days = daysBetween(fromDate, observed);
    const registry = compareRegistry(before.entities, after.entities);
    const warnings = before.warnings && after.warnings ? compareWarnings(before.warnings, after.warnings, fromDate) : null;
    comparisons.push({
      from: before.version, to: after.version, days, observed,
      resumption: days > MOVEMENT_RULES.gap_days,
      registry, registryMovements: registryTotal(registry), registryLimit: anomalyLimit(before.entities.length, days),
      warnings, warningMovements: warnings ? warnings.appeared + warnings.removed : 0,
      warningLimit: anomalyLimit(warningMap(before.warnings ?? []).size, days),
    });
  }
  const registryAnomalous = (c: Comparison) => c.registryMovements > c.registryLimit;
  const warningsAnomalous = (c: Comparison) => c.warnings !== null && c.warningMovements > c.warningLimit;
  const reason = (list: "registry" | "warnings", c: Comparison) => list === "registry"
    ? `${c.registryMovements} mouvements du registre pour un seuil de ${c.registryLimit} : changement probable de la collecte, à examiner`
    : `${c.warningMovements} apparitions et retraits de la liste d'alerte pour un seuil de ${c.warningLimit} : changement probable de la collecte, à examiner`;

  // Ajouts datés de la liste d'alerte : une adresse n'est retenue que si elle est vue par
  // une comparaison comptée, ou déjà présente au début de la période lue. Une adresse vue
  // pour la première fois à une reprise ou par une comparaison anormale ne compte dans aucun mois.
  const eligible = new Map<string, string | undefined>();
  const seen = new Set<string>();
  let previousHadWarnings = false;
  for (let i = 0; i < ordered.length; i++) {
    const list = ordered[i].warnings;
    if (!list) { previousHadWarnings = false; continue; }
    const map = warningMap(list);
    const comparison = i > 0 ? comparisons[i - 1] : undefined;
    const counted = previousHadWarnings && comparison !== undefined && !comparison.resumption && !warningsAnomalous(comparison);
    for (const [url, date] of map) {
      if (seen.has(url)) continue;
      seen.add(url);
      // Début de période (aucune liste avant) ou comparaison comptée : retenue.
      if (!previousHadWarnings || counted) eligible.set(url, date);
    }
    previousHadWarnings = true;
  }
  const addedDated = (month: string) => [...eligible.values()].filter(date => date?.slice(0, 7) === month).length;

  const computed = new Map<string, MonthMovements>();
  const covered = new Map<string, { registry: Set<string>; warnings: Set<string> }>();
  for (const c of comparisons) {
    if (c.resumption) continue;
    const month = c.observed.slice(0, 7);
    const record = computed.get(month) ?? {
      month, status: "open", frozen_in_version: null, days_in_month: daysInMonth(month),
      first_observed: null, last_observed: null, partial: true,
      registry: { ...emptyRegistry(), comparisons: 0, days_covered: 0, complete: false },
      warnings: { ...emptyWarningCounts(), comparisons: 0, days_covered: 0, complete: false, added_dated_in_month: addedDated(month), added_as_of: current.version },
      excluded: [],
    } satisfies MonthMovements;
    computed.set(month, record);
    record.first_observed ??= c.observed;
    record.last_observed = c.observed;
    const days = covered.get(month) ?? { registry: new Set<string>(), warnings: new Set<string>() };
    covered.set(month, days);
    if (registryAnomalous(c)) {
      record.excluded.push({ from: c.from, to: c.to, days: c.days, list: "registry", movements: c.registryMovements, limit: c.registryLimit, reason: reason("registry", c) });
    } else {
      addRegistry(record.registry, c.registry);
      record.registry.comparisons++;
      coveredDays(c, month).forEach(d => days.registry.add(d));
    }
    if (c.warnings && warningsAnomalous(c)) {
      record.excluded.push({ from: c.from, to: c.to, days: c.days, list: "warnings", movements: c.warningMovements, limit: c.warningLimit, reason: reason("warnings", c) });
    } else if (c.warnings) {
      for (const k of WARNING_COUNTERS) record.warnings[k] += c.warnings[k];
      record.warnings.comparisons++;
      coveredDays(c, month).forEach(d => days.warnings.add(d));
    }
    record.registry.days_covered = days.registry.size;
    record.warnings.days_covered = days.warnings.size;
    record.registry.complete = days.registry.size === record.days_in_month;
    record.warnings.complete = days.warnings.size === record.days_in_month;
    record.partial = !record.registry.complete || !record.warnings.complete;
  }

  const frozen = new Map((inherited?.block.months ?? []).filter(m => m.status === "frozen").map(m => [m.month, m]));
  const months: MonthMovements[] = [...frozen.values()];
  for (const record of computed.values()) {
    if (frozen.has(record.month)) continue; // Un mois figé n'est jamais recalculé.
    months.push(currentDate >= freezeDate(record.month) ? { ...record, status: "frozen", frozen_in_version: current.version } : record);
  }
  months.sort((a, b) => a.month.localeCompare(b.month));

  const resumptions = new Map((inherited?.block.resumptions ?? []).map(r => [`${r.from}→${r.to}`, r]));
  for (const c of comparisons) {
    if (!c.resumption || resumptions.has(`${c.from}→${c.to}`)) continue;
    const byMonth: Record<string, number> = {};
    let undated = 0;
    for (const date of c.warnings?.appearedDates ?? []) {
      if (date) byMonth[date.slice(0, 7)] = (byMonth[date.slice(0, 7)] ?? 0) + 1;
      else undated++;
    }
    resumptions.set(`${c.from}→${c.to}`, {
      from: c.from, to: c.to, days: c.days,
      registry: c.registry,
      registry_anomaly: registryAnomalous(c) ? reason("registry", c) : null,
      warnings: c.warnings ? {
        ...Object.fromEntries(WARNING_COUNTERS.map(k => [k, c.warnings![k]])) as WarningCounts,
        appeared_by_finma_month: Object.fromEntries(Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))),
        appeared_undated: undated,
      } : null,
      warnings_anomaly: warningsAnomalous(c) ? reason("warnings", c) : null,
    });
  }

  const observedDates = [
    ...months.flatMap(m => (m.first_observed ? [m.first_observed] : [])),
    ...[...resumptions.values()].map(r => versionDate(r.to)),
  ].sort();
  const currentWarnings = current.warnings ? warningMap(current.warnings) : null;
  return {
    schema_version: MOVEMENTS_SCHEMA_VERSION,
    method: MOVEMENTS_METHOD,
    rules: MOVEMENT_RULES,
    computed_in_version: current.version,
    first_observed: observedDates[0] ?? null,
    last_observed: comparisons.length > 0 || inherited !== null ? currentDate : null,
    months,
    resumptions: [...resumptions.values()].sort((a, b) => compareVersions(a.from, b.from)),
    warnings_without_date_added: currentWarnings ? [...currentWarnings.values()].filter(d => !d).length : null,
  };
}

/** Résumé chiffré pour le journal de la collecte et `controle-<version>.json`. */
export function summarizeMovements(block: MovementsBlock) {
  return {
    months: block.months.length,
    frozen_months: block.months.filter(m => m.status === "frozen").length,
    open_months: block.months.filter(m => m.status === "open").map(m => m.month),
    excluded_comparisons: block.months.reduce((n, m) => n + m.excluded.length, 0),
    resumptions: block.resumptions.map(r => ({ from: r.from, to: r.to, days: r.days })),
  };
}
