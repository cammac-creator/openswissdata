/**
 * Mémoire du tarif : quelle ligne TARES avions-nous archivée à telle date, et qu'est-ce qui a
 * changé entre deux dates (`/api/v1/tariff/...`). Lecture seule des archives déjà publiées dans
 * R2 : aucune écriture R2, aucune collecte, rien sur le disque, rien dans la base.
 *
 * Mesures du 05.11.2026, qui fixent les choix ci-dessous :
 * - Seules les archives au format 2 (`quality.json`, `schema_version: 2`) sont servies, soit à
 *   partir de 2026.09.25. Avant, l'assembleur prenait le premier taux trouvé et le plus bas par
 *   régime, et déduisait le nom des accords du libellé : 654 lignes portent un MFN choisi, et
 *   comparer 2026.08.24 à 2026.09.25 ferait apparaître 7 511 faux changements.
 * - Pas de `readTaresArchive` : son plafond de 200 Mo vaut pour tout le jeu. Neuf archives pèsent
 *   déjà 118 Mo et chaque semaine en ajoute 13 ; le plafond atteint, c'est la lecture de la
 *   version courante qui échouerait (incident du 07.10.2026).
 * - Pas de `dataset_snapshots` : cinq champs par version seulement, ni préférences ni allègements.
 * - Pas de `tares_rates.csv` : de 1,7 à 2,2 s d'analyse par version, un tas de 79 à 322 Mo et un
 *   pic de 559 Mo de RSS (environ 2,2 Go seulement pour neuf versions gardées ensemble).
 *   Les réponses portent donc sur le résumé de chaque ligne, et elles le disent.
 *
 * Une archive se contrôle entière (taille, empreinte, format, lignes) ou n'est pas servie.
 * L'objet R2 de 2026.05.03 ne correspond pas à l'empreinte enregistrée : le cas existe.
 * Les archives sont immuables : une version chargée ne se retélécharge pas avant un redémarrage,
 * qui relit environ 13 Mo par version servie, l'une après l'autre. Sans borne, ce coût croîtrait
 * chaque semaine : voir `TARIFF_HISTORY_MAX_VERSIONS`.
 */
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { extractCsvFromZip, refreshTaresFromR2 } from "../mcp/r2-refresh.js";
import { getDb } from "./db.js";
import { getObjectBuffer } from "./r2.js";

/** Première archive au format 2. Les précédentes ne sont pas téléchargées. */
export const TARIFF_HISTORY_FIRST_VERSION = "2026.09.25";
/** La collecte passe chaque semaine : au-delà de ce nombre de jours sans archive, c'est un trou. */
export const TARIFF_HISTORY_MAX_INTERVAL_DAYS = 8;
/**
 * Versions gardées, les plus récentes : environ cinq mois (`refresh-tares.yml` : chaque lundi et le 1er du mois, soit 64 versions par an au plus). Le démarrage
 * relit chaque version gardée (mesure du 05.11.2026 : 9 versions en 28 s sur dory, 13 Mo chacune,
 * 17 Mo de tas retenus) ; 26 versions bornent donc la lecture à environ 350 Mo et 80 s (estimation).
 * Allonger cette fenêtre demanderait d'abord un cache dérivé qui évite de tout relire.
 */
export const TARIFF_HISTORY_MAX_VERSIONS = 26;

const LINE_FIELDS = [
  "hs6", "chapter", "heading",
  "designation_fr", "designation_de", "designation_it", "designation_en",
  "unit_stat", "duty_mfn_value", "duty_mfn_unit", "duty_mfn_currency",
  "preferential_regimes", "restrictions_codes", "customs_relief_codes",
  "valid_from", "duty_rates_count", "source_url",
] as const;
type LineField = (typeof LINE_FIELDS)[number];
export type ArchivedLine = Readonly<Record<LineField, string>>;

/** Droit de base et préférences : ce que la réponse appelle un taux. */
const RATE_FIELDS: readonly LineField[] = ["duty_mfn_value", "duty_mfn_unit", "duty_mfn_currency", "preferential_regimes"];

const MIN_ROWS = 6_000;
const MAX_ROWS = 10_000;
const MAX_ARCHIVE_BYTES = 100_000_000;
const VERSION_PATTERN = /^(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/;
const DAY_MS = 86_400_000;
const FETCH_TIMEOUT_MS = 60_000;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

interface ArchivedVersion {
  version: string;
  /** Jour de collecte : le libellé de la version, recoupé avec `quality.json.checked_at`. */
  date: string;
  /** Indexé par la position du numéro dans `lineIndex`. Une ligne inchangée garde le même objet. */
  lines: readonly (ArchivedLine | undefined)[];
}

export interface VersionRef {
  version: string;
  date: string;
}

export interface TariffHistory {
  /** Par date croissante, puis par suffixe de version. */
  versions: readonly ArchivedVersion[];
  /** Versions au format attendu mais non servies (empreinte fausse, contenu refusé, panne de lecture). */
  unavailable: readonly VersionRef[];
  /** Tous les numéros vus, triés : ordre stable de la comparaison. */
  codes: readonly string[];
}

class ArchiveRefused extends Error {}

const lineIndex = new Map<string, number>();
const distinctLines = new Map<string, ArchivedLine[]>();
const loaded = new Map<string, ArchivedVersion>();
/** Refus définitif jusqu'au prochain démarrage : relire le même objet donnerait le même refus. */
const refused = new Set<string>();
let history: TariffHistory | null = null;
let lastPassAt = 0;

export function getTariffHistory(): TariffHistory | null {
  return history;
}

function versionDate(version: string): string | null {
  const m = VERSION_PATTERN.exec(version);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function versionOrder(a: VersionRef, b: VersionRef): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return Number(VERSION_PATTERN.exec(a.version)?.[4] ?? 0) - Number(VERSION_PATTERN.exec(b.version)?.[4] ?? 0);
}

function canonicalRegimes(text: string): string {
  const value: unknown = text ? JSON.parse(text) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ArchiveRefused("préférences illisibles");
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [, rate] of entries) {
    if (rate !== "free" && (typeof rate !== "number" || !Number.isFinite(rate))) throw new ArchiveRefused("préférence illisible");
  }
  return JSON.stringify(Object.fromEntries(entries));
}

function checkedLine(row: Record<string, string>): ArchivedLine {
  const line = {} as Record<LineField, string>;
  for (const field of LINE_FIELDS) line[field] = row[field] ?? "";
  // Un pourcentage n'est jamais une somme en francs : une telle archive n'est pas servie.
  if (line.duty_mfn_currency === "CHF" && line.duty_mfn_unit.includes("%")) throw new ArchiveRefused("pourcentage étiqueté CHF");
  if (line.duty_mfn_value !== "" && !Number.isFinite(Number(line.duty_mfn_value))) throw new ArchiveRefused("droit illisible");
  if (!line.designation_fr) throw new ArchiveRefused("désignation vide");
  try {
    line.preferential_regimes = canonicalRegimes(line.preferential_regimes);
  } catch (error) {
    if (error instanceof ArchiveRefused) throw error;
    throw new ArchiveRefused("préférences illisibles");
  }
  return line;
}

/** Une ligne identique à une version déjà lue réutilise le même objet (mémoire, et comparaison par référence). */
function internLine(hs8: string, line: ArchivedLine): ArchivedLine {
  const known = distinctLines.get(hs8);
  if (!known) {
    distinctLines.set(hs8, [line]);
    return line;
  }
  const same = known.find((candidate) => LINE_FIELDS.every((field) => candidate[field] === line[field]));
  if (same) return same;
  // Partage les textes inchangés avec la dernière variante de ce numéro.
  const previous = known[known.length - 1];
  const shared = {} as Record<LineField, string>;
  for (const field of LINE_FIELDS) shared[field] = previous[field] === line[field] ? previous[field] : line[field];
  known.push(shared);
  return shared;
}

async function readVersion(row: VersionRow, date: string): Promise<ArchivedVersion> {
  if (!/^tares\/[\d.]+\/tares\.zip$/.test(row.r2_key) || !/^[a-f0-9]{64}$/.test(row.sha256) || row.size_bytes <= 0 || row.size_bytes > MAX_ARCHIVE_BYTES) {
    throw new ArchiveRefused("métadonnées invalides");
  }
  const bytes = await getObjectBuffer(row.r2_key, { maxBytes: row.size_bytes + 1_000_000, timeoutMs: FETCH_TIMEOUT_MS });
  if (bytes.length !== row.size_bytes || createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new ArchiveRefused("empreinte différente");

  let quality: { schema_version?: unknown; rows?: unknown; checked_at?: unknown };
  let rows: Record<string, string>[];
  try {
    quality = JSON.parse(await extractCsvFromZip(bytes, "quality.json")) as typeof quality;
    rows = parse(await extractCsvFromZip(bytes, "tares.csv"), { columns: true, skip_empty_lines: true, relax_quotes: true }) as Record<string, string>[];
  } catch {
    throw new ArchiveRefused("contenu illisible");
  }
  if (quality.schema_version !== 2) throw new ArchiveRefused("format ancien");
  if (typeof quality.checked_at !== "string" || quality.checked_at.slice(0, 10) !== date) throw new ArchiveRefused("date de collecte différente de la version");
  if (quality.rows !== rows.length || rows.length < MIN_ROWS || rows.length > MAX_ROWS) throw new ArchiveRefused("nombre de lignes");
  const missing = rows.length ? LINE_FIELDS.filter((field) => !(field in rows[0])) : [];
  if (missing.length > 0) throw new ArchiveRefused("colonne absente");

  // Tout se contrôle avant de toucher aux index : une archive refusée n'y laisse rien.
  const seen = new Set<string>();
  const checked = rows.map((raw) => {
    if (!/^\d{8}$/.test(raw.hs8) || seen.has(raw.hs8)) throw new ArchiveRefused("numéro invalide ou en double");
    seen.add(raw.hs8);
    return { hs8: raw.hs8, line: checkedLine(raw) };
  });
  const lines: (ArchivedLine | undefined)[] = [];
  for (const { hs8, line } of checked) {
    let index = lineIndex.get(hs8);
    if (index === undefined) {
      index = lineIndex.size;
      lineIndex.set(hs8, index);
    }
    lines[index] = internLine(hs8, line);
  }
  return { version: row.version, date, lines };
}

interface VersionRow {
  version: string;
  r2_key: string;
  sha256: string;
  size_bytes: number;
}

/** Oublie les versions sorties de la fenêtre, et les lignes que plus aucune version ne porte. */
function forgetVersionsOutside(kept: ReadonlySet<string>): void {
  let forgotten = false;
  for (const version of loaded.keys()) {
    if (kept.has(version)) continue;
    loaded.delete(version);
    forgotten = true;
  }
  if (!forgotten) return;
  // Mêmes objets conservés : la comparaison par référence reste juste entre les versions gardées.
  distinctLines.clear();
  for (const [hs8, position] of lineIndex) {
    const lines = new Set<ArchivedLine>();
    for (const version of loaded.values()) {
      const line = version.lines[position];
      if (line) lines.add(line);
    }
    if (lines.size > 0) distinctLines.set(hs8, [...lines]);
  }
}

async function runPass(): Promise<void> {
  lastPassAt = Date.now();
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_BUCKET) return;
  const rows = getDb()
    .prepare("SELECT version, r2_key, sha256, size_bytes FROM versions WHERE dataset_id='tares'")
    .all() as VersionRow[];
  // Les plus récentes d'abord. Une version non servie compte dans la fenêtre : elle reste nommée.
  const window = rows
    .flatMap((row) => {
      const date = versionDate(row.version);
      return date && row.version >= TARIFF_HISTORY_FIRST_VERSION ? [{ version: row.version, date, row }] : [];
    })
    .sort((a, b) => versionOrder(b, a))
    .slice(0, TARIFF_HISTORY_MAX_VERSIONS);
  forgetVersionsOutside(new Set(window.map((entry) => entry.version)));
  const unavailable: VersionRef[] = [];
  for (const { row, date } of window) {
    if (loaded.has(row.version)) continue;
    if (refused.has(row.version)) {
      unavailable.push({ version: row.version, date });
      continue;
    }
    try {
      loaded.set(row.version, await readVersion(row, date));
    } catch (error) {
      if (error instanceof ArchiveRefused) refused.add(row.version);
      unavailable.push({ version: row.version, date });
      // Un message de fournisseur ne sort pas ; le motif de refus est un texte fixe de ce fichier.
      console.error(`[tariff-history] ${row.version} non servie : ${error instanceof ArchiveRefused ? error.message : "lecture impossible"}`);
    }
    // Laisse passer les requêtes entre deux lectures : l'analyse d'une archive est synchrone.
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (loaded.size === 0) return;
  // Remplacement en une seule fois : jamais une réponse tirée d'un passage à moitié fait.
  history = {
    versions: [...loaded.values()].sort(versionOrder),
    unavailable: unavailable.sort(versionOrder),
    codes: [...lineIndex.keys()].sort(),
  };
  console.log(`[tariff-history] ${loaded.size} versions servies, ${unavailable.length} non servie(s)`);
}

let inFlight: Promise<void> | null = null;
let again = false;

/** Sûr à appeler plusieurs fois : ne lit que les versions manquantes et ne lève jamais. */
export function refreshTariffHistory(): Promise<void> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = (async () => {
    do {
      again = false;
      try {
        await runPass();
      } catch {
        console.error("[tariff-history] passage interrompu ; dernière version complète conservée");
      }
    } while (again);
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Premier passage une fois la version courante chargée, jamais en même temps qu'elle ; puis toutes
 * les 12 h, et toutes les 10 min tant que rien n'est servi. Si le chargement de la version courante
 * est déjà en cours, cet appel s'y raccroche ; le passage de plus qu'il provoque s'arrête à sa version déjà lue.
 */
export function startTariffHistoryRefresh(): void {
  if (timer) return;
  void refreshTaresFromR2().then(refreshTariffHistory);
  timer = setInterval(() => {
    if (lastPassAt !== 0 && (!history || Date.now() - lastPassAt >= REFRESH_INTERVAL_MS)) void refreshTariffHistory();
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
}

// --- Lecture ------------------------------------------------------------------------------

/** Vrai pour une date civile qui existe : `2026-02-30` est refusé, pas reporté au 2 mars. */
export function isCalendarDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Position de la version la plus récente non postérieure à `date`, -1 avant la première. */
export function versionIndexAt(h: TariffHistory, date: string): number {
  let found = -1;
  for (let i = 0; i < h.versions.length; i += 1) {
    if (h.versions[i].date > date) break;
    found = i;
  }
  return found;
}

export function versionRef(h: TariffHistory, index: number): VersionRef {
  const { version, date } = h.versions[index];
  return { version, date };
}

/** Une ligne du résumé à cette version, jamais une autre : aucun repli sur une version voisine. */
export function lineAtVersion(h: TariffHistory, index: number, hs8: string): ArchivedLine | undefined {
  const position = lineIndex.get(hs8);
  return position === undefined ? undefined : h.versions[index].lines[position];
}

function unavailableBetween(h: TariffHistory, afterDate: string, beforeDate: string | null): VersionRef[] {
  return h.unavailable.filter((v) => v.date >= afterDate && (beforeDate === null || v.date <= beforeDate));
}

export interface ArchiveGap {
  days_without_archive: number;
  unavailable_versions: VersionRef[];
}

/** Trou après la version `index` : intervalle trop long ou version existante non servie. `date` compte quand aucune version ne suit. */
export function gapAfter(h: TariffHistory, index: number, date: string): ArchiveGap | null {
  const current = h.versions[index];
  const next = h.versions[index + 1] ?? null;
  const days = daysBetween(current.date, next ? next.date : date);
  const unavailable = unavailableBetween(h, current.date, next ? next.date : null);
  if (days <= TARIFF_HISTORY_MAX_INTERVAL_DAYS && unavailable.length === 0) return null;
  return { days_without_archive: days, unavailable_versions: unavailable };
}

/** Trous dans la période comparée, qui s'arrête à `endDate` : une version non servie après cette date n'y compte pas. */
export function gapsBetween(h: TariffHistory, fromIndex: number, toIndex: number, endDate: string): (ArchiveGap & { after: VersionRef })[] {
  const gaps: (ArchiveGap & { after: VersionRef })[] = [];
  for (let i = fromIndex; i <= toIndex; i += 1) {
    const stop = i < toIndex ? h.versions[i + 1].date : endDate;
    const days = daysBetween(h.versions[i].date, stop);
    const unavailable = unavailableBetween(h, h.versions[i].date, stop);
    if (days > TARIFF_HISTORY_MAX_INTERVAL_DAYS || unavailable.length > 0) gaps.push({ after: versionRef(h, i), days_without_archive: days, unavailable_versions: unavailable });
  }
  return gaps;
}

export interface ChangeEntry {
  hs8: string;
  kind: "added" | "removed" | "rates_changed" | "other_fields_changed";
  changed_fields: string[];
  before: ArchivedLine | null;
  after: ArchivedLine | null;
}

/** Compare deux versions sur le résumé. Triée par numéro. Les mouvements intermédiaires ne sont pas vus. */
export function compareVersions(h: TariffHistory, fromIndex: number, toIndex: number): ChangeEntry[] {
  const from = h.versions[fromIndex];
  const to = h.versions[toIndex];
  const out: ChangeEntry[] = [];
  for (const hs8 of h.codes) {
    const position = lineIndex.get(hs8)!;
    const before = from.lines[position];
    const after = to.lines[position];
    if (before === after) continue;
    if (!before || !after) {
      out.push({ hs8, kind: before ? "removed" : "added", changed_fields: [], before: before ?? null, after: after ?? null });
      continue;
    }
    const changed = LINE_FIELDS.filter((field) => before[field] !== after[field]);
    out.push({ hs8, kind: changed.some((field) => RATE_FIELDS.includes(field)) ? "rates_changed" : "other_fields_changed", changed_fields: [...changed], before, after });
  }
  return out;
}

/** Vrai si cette ligne diffère entre deux versions (par référence, voir `internLine`). */
export function lineChangedBetween(h: TariffHistory, fromIndex: number, toIndex: number, hs8: string): boolean {
  return lineAtVersion(h, fromIndex, hs8) !== lineAtVersion(h, toIndex, hs8);
}

function jsonList(text: string): string[] {
  if (!text) return [];
  const value: unknown = JSON.parse(text);
  return Array.isArray(value) ? value.map(String) : [];
}

/** Valeurs telles qu'archivées : un droit absent reste nul, jamais zéro ni « free ». */
function rates(line: ArchivedLine) {
  return {
    duty_mfn: {
      value: line.duty_mfn_value === "" ? null : Number(line.duty_mfn_value),
      unit: line.duty_mfn_unit || null,
      currency: line.duty_mfn_currency || null,
    },
    preferential_regimes: JSON.parse(line.preferential_regimes) as Record<string, number | "free">,
  };
}

export function serveLine(hs8: string, line: ArchivedLine) {
  return {
    hs8,
    hs6: line.hs6,
    chapter: line.chapter,
    heading: line.heading,
    designations: { fr: line.designation_fr, de: line.designation_de, it: line.designation_it, en: line.designation_en },
    ...rates(line),
    unit_stat: line.unit_stat,
    restrictions_codes: jsonList(line.restrictions_codes),
    customs_relief_codes: jsonList(line.customs_relief_codes),
    valid_from: line.valid_from,
    duty_rates_count: line.duty_rates_count === "" ? null : Number(line.duty_rates_count),
    source_url: line.source_url,
  };
}

/** Forme courte d'une ligne dans une comparaison : les taux et de quoi la reconnaître. */
export function serveChangeSide(line: ArchivedLine | null) {
  if (!line) return null;
  return {
    designation_fr: line.designation_fr,
    ...rates(line),
    customs_relief_codes: jsonList(line.customs_relief_codes),
    valid_from: line.valid_from,
    duty_rates_count: line.duty_rates_count === "" ? null : Number(line.duty_rates_count),
  };
}

/** Test seulement : repart de zéro. */
export function _resetTariffHistoryForTest(): void {
  lineIndex.clear();
  distinctLines.clear();
  loaded.clear();
  refused.clear();
  history = null;
  lastPassAt = 0;
  inFlight = null;
  again = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
