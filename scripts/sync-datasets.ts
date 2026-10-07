#!/usr/bin/env tsx
/**
 * Collecteur générique des jeux ouverts APPROUVÉS (tâche osd.jeux, piste G1 du plan
 * `2026-10-07-moteur-jeux-ouverts.md`) : pour chaque jeu de
 * `docs/data-status/datasets-approved.json`, télécharge la ressource déclarée, vérifie son
 * en-tête EXACT, l'absence de colonne de personne (réutilise `detectPersonColumns` de
 * `scripts/prospect-sources.ts`, JAMAIS recopiée), normalise les clés de jointure
 * (`src/lib/dataset-keys.ts`, PARTAGÉ avec `src/routes/api-v1.ts`) et écrit
 * `src/mcp/data/datasets/<id>.csv.gz` (gzip déterministe) + une entrée dans
 * `src/mcp/data/datasets/index.json`, lus par `src/mcp/data-loader.ts`.
 *
 * Isolation (Global Constraint du plan, piste G) : un jeu en échec n'empêche PAS les autres et NE
 * TOUCHE JAMAIS à son fichier précédent (`.csv.gz` déjà écrit, entrée d'index déjà publiée). Le
 * script sort avec un code non nul si AU MOINS un jeu a échoué (`main()`) ; le workflow commite
 * d'abord les jeux réussis, puis échoue pour l'alerte (même ordre que `prospect-sources.yml`).
 *
 * Plafonds (décision de l'intégrateur, piste G, 07.10.2026) : 20 Mo par ressource — téléchargement
 * BORNÉ EN FLUX, jamais `arrayBuffer()` d'abord : un point `/exports/csv` Opendatasoft (fréquent
 * chez les éditeurs cantonaux, voir `scripts/prospect-sources.ts`) ignore parfois le `Range` et
 * répond 200 avec le fichier entier, le même piège que `readCsvHeaderPartial` — ; 60 s par
 * téléchargement ; 50 jeux au plus par passage (`selectEntriesForRun`, le reste `skipped`, jamais
 * traité ce passage).
 *
 * Détection de changement sur le CSV DÉCOMPRESSÉ, jamais sur les octets `.gz` eux-mêmes
 * (contrairement à `sync-streets.ts`, qui compare les `.gz`) : l'octet OS de l'en-tête gzip de
 * `zlib.gzipSync` peut différer entre la machine de départ (Mac, seed initial) et le runner
 * GitHub (Linux), ce qui ferait croire à un changement — et donc avancer l'édition — au premier
 * passage sur une nouvelle machine, sans aucune donnée réellement différente.
 *
 * Usage :
 *   tsx scripts/sync-datasets.ts
 *   tsx scripts/sync-datasets.ts --registry <chemin> --out-dir <dossier>
 *
 * Tests (aucun réseau) : options `fetchImpl` (maquette) ou `fixtureDir` (un `<id>.csv` par jeu,
 * lu au lieu du réseau — jamais de mélange fixture/réseau au sein d'un même jeu).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { detectPersonColumns, splitHeaderColumns } from "./prospect-sources.js";
import { DATASET_KEY_NAMES, isDatasetKeyName, normalizeDatasetKeyValue, type DatasetKeyName } from "../src/lib/dataset-keys.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_PATH = join(__dirname, "..", "docs", "data-status", "datasets-approved.json");
const DEFAULT_OUT_DIR = join(__dirname, "..", "src", "mcp", "data", "datasets");
const DEFAULT_MAX_BYTES_PER_RESOURCE = 20_000_000; // 20 Mo, décision du 07.10.2026
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_DATASETS_PER_RUN = 50;
const DEFAULT_MAX_DROP_RATIO = 0.2; // 20 %, plus large que les 2 % des collectes spécialisées : jeux hétérogènes
const USER_AGENT = "OpenSwissData sync-datasets";

const DATASET_ID_RE = /^[a-z][a-z0-9-]{2,63}$/;
const VALID_LICENCES = new Set(["terms_open", "terms_by", "cc0", "cc-by"]);

export interface DatasetApprovalEntry {
  id: string;
  title: string;
  ckan_uuid: string;
  publisher: string;
  licence: "terms_open" | "terms_by" | "cc0" | "cc-by";
  /** Texte d'attribution exigé par la licence ; peut être vide pour terms_open/cc0 (aucune
   *  attribution requise), mais JAMAIS vide pour terms_by/cc-by (`validateRegistryEntry`). */
  attribution: string;
  resource_url: string;
  /** Colonnes EXACTES attendues dans l'en-tête réel de la ressource, dans l'ordre. */
  expected_header: string[];
  /** Colonne source → clé de jointure normalisée (`src/lib/dataset-keys.ts`). */
  keys: Record<string, DatasetKeyName>;
  /** Colonnes gardées dans l'ordre (sous-ensemble de `expected_header`) ; toutes les autres
   *  colonnes de la ressource source sont ignorées à l'écriture. */
  columns: string[];
  approved_on: string;
  checked_by: string;
  notes: string;
}

interface DatasetsRegistryFile {
  version?: number;
  notes?: string;
  datasets: DatasetApprovalEntry[];
}

/** Valide une entrée du registre (défense en profondeur : le registre est versionné et relu par
 *  l'intégrateur, mais une entrée malformée ne doit jamais faire planter tout le passage — voir
 *  `syncDatasets`, qui rend cette entrée en échec plutôt que de la traiter). Liste d'erreurs
 *  vide = entrée valide. Fonction pure, sans E/S. */
export function validateRegistryEntry(entry: DatasetApprovalEntry): string[] {
  const errors: string[] = [];
  if (!entry || typeof entry !== "object") return ["entrée invalide (pas un objet)"];
  if (!DATASET_ID_RE.test(entry.id ?? "")) errors.push(`id invalide (gabarit attendu ^[a-z][a-z0-9-]{2,63}$) : "${entry.id}"`);
  if (!Array.isArray(entry.expected_header) || entry.expected_header.length === 0) errors.push("expected_header manquant ou vide");
  if (!Array.isArray(entry.columns) || entry.columns.length === 0) errors.push("columns manquant ou vide");
  if (!VALID_LICENCES.has(entry.licence)) errors.push(`licence inconnue : "${entry.licence}"`);
  if (!entry.resource_url || typeof entry.resource_url !== "string") errors.push("resource_url manquant");
  else if (/bfs\.admin\.ch/i.test(entry.resource_url)) {
    errors.push("resource_url sur bfs.admin.ch : aucune donnée OFS tant que la clarification écrite n'a pas abouti (AGENTS.md)");
  }
  if (errors.length > 0) return errors; // les contrôles de sous-ensembles ci-dessous supposent ces bases présentes

  const headerSet = new Set(entry.expected_header);
  for (const c of entry.columns) {
    if (!headerSet.has(c)) errors.push(`columns contient une colonne hors de expected_header : "${c}"`);
  }
  const columnsSet = new Set(entry.columns);
  const seenTargets = new Map<string, string>();
  for (const [sourceCol, target] of Object.entries(entry.keys ?? {})) {
    if (!columnsSet.has(sourceCol)) errors.push(`keys référence une colonne hors de columns : "${sourceCol}"`);
    if (!isDatasetKeyName(target)) {
      errors.push(`keys("${sourceCol}") cible une clé inconnue (attendu l'une de ${DATASET_KEY_NAMES.join(", ")}) : "${target}"`);
    } else if (seenTargets.has(target)) {
      errors.push(`deux colonnes ciblent la même clé "${target}" : "${seenTargets.get(target)}" et "${sourceCol}"`);
    } else {
      seenTargets.set(target, sourceCol);
    }
  }
  if ((entry.licence === "terms_by" || entry.licence === "cc-by") && !(entry.attribution ?? "").trim()) {
    errors.push(`attribution requise pour une licence "${entry.licence}" (texte vide)`);
  }
  return errors;
}

/** Plafond de jeux traités en UN passage (50 par défaut) : les premiers de la liste sont
 *  traités, le reste `skipped` (jamais traité ce passage, jamais en échec non plus — un passage
 *  suivant les reprendra). Fonction pure, triviale, testée directement. */
export function selectEntriesForRun(entries: DatasetApprovalEntry[], max: number): { toProcess: DatasetApprovalEntry[]; skipped: DatasetApprovalEntry[] } {
  return { toProcess: entries.slice(0, max), skipped: entries.slice(max) };
}

/** Construit la ligne de sortie : colonnes-clés renommées vers leur nom canonique et
 *  normalisées (`src/lib/dataset-keys.ts`), les autres colonnes gardées telles quelles (nom et
 *  valeur source). Lève une erreur explicite (avec le numéro de ligne) pour une valeur de clé
 *  invalide — jamais une ligne silencieusement écartée. Fonction pure, sans E/S. */
export function buildOutputRow(entry: DatasetApprovalEntry, sourceRow: Record<string, string>, lineNumber: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of entry.columns) {
    const keyName = entry.keys[col];
    const raw = sourceRow[col] ?? "";
    if (keyName) {
      const normalized = normalizeDatasetKeyValue(keyName, raw);
      if (normalized === null) {
        throw new Error(`Valeur invalide pour la clé "${keyName}" (colonne source "${col}") ligne ${lineNumber} : "${raw}"`);
      }
      out[keyName] = normalized;
    } else {
      out[col] = raw;
    }
  }
  return out;
}

/** Noms de colonnes de sortie, dans l'ordre de `entry.columns`, clés renommées vers leur nom
 *  canonique. Partagé entre l'écriture du CSV et l'entrée d'index (`keys` listées). */
function outputColumnNames(entry: DatasetApprovalEntry): string[] {
  return entry.columns.map((c) => entry.keys[c] ?? c);
}

function outputKeyNames(entry: DatasetApprovalEntry): DatasetKeyName[] {
  return [...new Set(Object.values(entry.keys))].sort();
}

function stripBom(text: string): string {
  return text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function detectDelimiter(headerLine: string): "," | ";" {
  const semi = (headerLine.match(/;/g) ?? []).length;
  const comma = (headerLine.match(/,/g) ?? []).length;
  return semi >= comma ? ";" : ",";
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Tri déterministe par les colonnes de sortie dans l'ordre, point de code (jamais
 *  `localeCompare`) — même principe que les autres scripts `sync-*.ts`. */
function sortRows(rows: Record<string, string>[], columns: string[]): Record<string, string>[] {
  return [...rows].sort((a, b) => {
    for (const col of columns) {
      const c = cmp(a[col] ?? "", b[col] ?? "");
      if (c !== 0) return c;
    }
    return 0;
  });
}

function writeAtomic(path: string, content: string | Buffer): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${randomUUID()}.tmp`);
  writeFileSync(tmp, content);
  try {
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* fichier temporaire déjà absent */ }
    throw err;
  }
}

/** Lit le CSV décompressé PRÉCÉDENT d'un jeu (`<id>.csv.gz`) ; `null` si absent ou illisible —
 *  jamais une exception (premier passage pour ce jeu). */
function readPreviousCsv(outDir: string, id: string): string | null {
  const path = join(outDir, `${id}.csv.gz`);
  if (!existsSync(path)) return null;
  try {
    return gunzipSync(readFileSync(path)).toString("utf8");
  } catch {
    return null;
  }
}

function previousRowCount(csv: string | null): number {
  if (csv === null) return 0;
  return Math.max(0, csv.split(/\r?\n/).filter((l) => l.length > 0).length - 1);
}

/** Téléchargement BORNÉ en flux (jamais `arrayBuffer()` d'abord) : un serveur qui ignore le
 *  `Range`/répond intégralement reste quand même borné, le flux est annulé dès que `maxBytes`
 *  est dépassé — même piège que `readCsvHeaderPartial` de `scripts/prospect-sources.ts`. */
async function downloadBounded(fetchImpl: typeof fetch, url: string, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new Error(`Téléchargement impossible ou délai dépassé : ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`Téléchargement impossible : HTTP ${res.status}`);
  const declared = res.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    throw new Error(`Ressource trop volumineuse (Content-Length ${declared} octets > ${maxBytes})`);
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`Ressource trop volumineuse (${buf.length} octets > ${maxBytes})`);
    return buf;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* flux déjà clos ou serveur l'ayant coupé : sans conséquence */ }
      throw new Error(`Ressource trop volumineuse (téléchargement interrompu à > ${maxBytes} octets)`);
    }
    chunks.push(Buffer.from(value));
  }
  const buf = Buffer.concat(chunks);
  if (buf.length === 0) throw new Error("Ressource vide");
  return buf;
}

export interface SyncDatasetsOptions {
  /** Défaut : `docs/data-status/datasets-approved.json`. */
  registryPath?: string;
  /** Défaut : `src/mcp/data/datasets`. */
  outDir?: string;
  /** Tests/seed local : `<fixtureDir>/<id>.csv` lu au lieu du réseau pour CE jeu. */
  fixtureDir?: string;
  /** Défaut : `globalThis.fetch`. Lu seulement pour un jeu sans fixture. */
  fetchImpl?: typeof fetch;
  /** Défaut : `Date.now`. */
  now?: () => number;
  maxBytesPerResource?: number;
  downloadTimeoutMs?: number;
  maxDatasetsPerRun?: number;
  maxDropRatio?: number;
}

export interface SyncDatasetsResult {
  succeeded: string[];
  unchanged: string[];
  failed: { id: string; error: string }[];
  skipped: string[];
  /** Ids présents dans `index.json` au DÉBUT du passage mais absents du registre actuel (sorti
   *  de `docs/data-status/datasets-approved.json`) : retirés de l'index ET leur `.csv.gz`
   *  effacé, ce passage (relecture adverse du 07.10.2026). */
  removed: string[];
  anyFailed: boolean;
}

interface IndexEntry {
  id: string;
  title: string;
  publisher: string;
  licence: string;
  attribution: string;
  resource_url: string;
  columns: string[];
  keys: string[];
  rows: number;
  edition: string;
  by_canton?: Record<string, number>;
  by_commune_bfs?: Record<string, number>;
}

/** Nombre de lignes PAR VALEUR d'un champ de sortie, PRÉCALCULÉ ici pour que les profils de
 *  canton/commune n'ouvrent JAMAIS le `.csv.gz` du jeu (relecture adverse du 07.10.2026, avant le
 *  lot de 36 jeux — voir `src/lib/dataset-query.ts`, `datasetsForCanton`/`datasetsForCommune`).
 *  `undefined` quand `field` n'est pas une colonne de sortie de ce jeu (jamais un objet vide, pour
 *  que `"by_canton" in entry"`/`entry.by_canton` reste un test fiable d'applicabilité). */
function aggregateByField(rows: readonly Record<string, string>[], outColumns: string[], field: string): Record<string, number> | undefined {
  if (!outColumns.includes(field)) return undefined;
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const v = r[field];
    if (!v) continue;
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
}

function todayUtc(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function loadRegistry(path: string): DatasetApprovalEntry[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as DatasetsRegistryFile;
  if (!Array.isArray(raw.datasets)) throw new Error(`Registre invalide (champ "datasets" absent) : ${path}`);
  return raw.datasets;
}

function loadIndex(outDir: string): Map<string, IndexEntry> {
  const path = join(outDir, "index.json");
  if (!existsSync(path)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { datasets?: IndexEntry[] };
    return new Map((raw.datasets ?? []).map((e) => [e.id, e]));
  } catch {
    return new Map();
  }
}

/** Traite UN jeu : télécharge (ou lit la fixture), vérifie l'en-tête, l'absence de colonne de
 *  personne, normalise les clés, contrôle la baisse de lignes, écrit `<id>.csv.gz` si le contenu
 *  a changé, met à jour son entrée dans `index` (en mémoire — JAMAIS écrit sur disque ici : voir
 *  `syncDatasets`, qui charge et réécrit `index.json` UNE SEULE FOIS pour tout le passage, afin
 *  de pouvoir aussi y appliquer le retrait des jeux sortis du registre). Lève une erreur
 *  explicite en cas d'échec (jamais silencieuse) ; n'écrit JAMAIS rien en cas d'échec (le
 *  fichier précédent, s'il existe, et l'entrée d'index précédente restent intacts). */
async function syncOneDataset(
  entry: DatasetApprovalEntry,
  index: Map<string, IndexEntry>,
  opts: { outDir: string; fixtureDir?: string; fetchImpl: typeof fetch; now: () => number; maxBytes: number; timeoutMs: number; maxDropRatio: number },
): Promise<{ rows: number; edition: string; changed: boolean }> {
  let buf: Buffer;
  if (opts.fixtureDir) {
    const fixturePath = join(opts.fixtureDir, `${entry.id}.csv`);
    if (!existsSync(fixturePath)) throw new Error(`Mode fixture sans fichier pour ce jeu : "${fixturePath}" absent`);
    buf = readFileSync(fixturePath);
  } else {
    buf = await downloadBounded(opts.fetchImpl, entry.resource_url, opts.maxBytes, opts.timeoutMs);
  }

  const text = buf.toString("utf8");
  if (text.includes("�")) {
    throw new Error("Encodage inattendu : caractère de remplacement U+FFFD détecté (UTF-8 attendu)");
  }
  const stripped = stripBom(text);
  const firstBreak = stripped.indexOf("\n");
  const headerLine = (firstBreak === -1 ? stripped : stripped.slice(0, firstBreak)).replace(/\r$/, "");
  const delimiter = detectDelimiter(headerLine);
  const actualHeader = splitHeaderColumns(headerLine);
  const expected = entry.expected_header;
  const headerMatches = actualHeader.length === expected.length && actualHeader.every((c, i) => c === expected[i]);
  if (!headerMatches) {
    throw new Error(`En-tête inattendu : attendu [${expected.join(", ")}], lu [${actualHeader.join(", ")}]`);
  }

  const personColumns = detectPersonColumns(actualHeader);
  if (personColumns.length > 0) {
    throw new Error(`Colonne(s) de personne détectée(s), jeu écarté : ${personColumns.join(", ")}`);
  }

  // `columns: actualHeader` (jamais `columns: true`) : `actualHeader` vient de `splitHeaderColumns`,
  // qui TRIME chaque nom de colonne (relecture adverse du 07.10.2026) — le mode `columns: true` de
  // csv-parse utilise la ligne d'en-tête BRUTE (espaces non retirés) comme clés des lignes, ce qui
  // aurait désaccordé silencieusement `sourceRow[col]` dans `buildOutputRow` (col vient de
  // `entry.columns`, toujours trimé) dès qu'un en-tête source porte un espace parasite autour d'un
  // nom de colonne : la valeur aurait été perdue (repliée sur "" par `sourceRow[col] ?? ""`) SANS
  // jamais lever d'erreur, pour une colonne non-clé (une colonne-clé l'aurait fait échouer, normalize
  // rejetant une chaîne vide). `from_line: 2` saute la ligne d'en-tête réelle, déjà lue à part.
  const rawRows = parse(stripped, { columns: actualHeader, from_line: 2, delimiter, skip_empty_lines: true, relax_quotes: true }) as Record<string, string>[];
  const outputRows = rawRows.map((row, i) => buildOutputRow(entry, row, i + 2));
  const outColumns = outputColumnNames(entry);
  const sorted = sortRows(outputRows, outColumns);

  // Un fichier sans aucune ligne de données n'est jamais publié (en-tête seul, export cassé).
  if (sorted.length === 0) throw new Error("Aucune ligne de données : jeu non publié");

  const previousCsv = readPreviousCsv(opts.outDir, entry.id);
  if (previousCsv !== null) {
    const prevRowCount = previousRowCount(previousCsv);
    if (sorted.length < prevRowCount * (1 - opts.maxDropRatio)) {
      throw new Error(
        `Baisse de plus de ${(opts.maxDropRatio * 100).toFixed(0)} % du nombre de lignes par rapport au fichier précédent ` +
          `(${prevRowCount} → ${sorted.length}) : fichier NON remplacé`,
      );
    }
  }

  const csv = stringify(sorted, { header: true, columns: outColumns, record_delimiter: "\n" });
  const changed = previousCsv !== csv;

  const existing = index.get(entry.id);
  const edition = !changed && existing ? existing.edition : todayUtc(opts.now());

  if (changed) {
    const gz = gzipSync(Buffer.from(csv, "utf8"), { level: 9 });
    writeAtomic(join(opts.outDir, `${entry.id}.csv.gz`), gz);
  }

  index.set(entry.id, {
    id: entry.id,
    title: entry.title,
    publisher: entry.publisher,
    licence: entry.licence,
    attribution: entry.attribution,
    resource_url: entry.resource_url,
    columns: outColumns,
    keys: outputKeyNames(entry),
    rows: sorted.length,
    edition,
    by_canton: aggregateByField(sorted, outColumns, "canton"),
    by_commune_bfs: aggregateByField(sorted, outColumns, "commune_bfs"),
  });

  return { rows: sorted.length, edition, changed };
}

function writeIndex(outDir: string, index: Map<string, IndexEntry>): void {
  const datasets = [...index.values()].sort((a, b) => cmp(a.id, b.id));
  const json = JSON.stringify({ datasets }, null, 2) + "\n";
  writeAtomic(join(outDir, "index.json"), json);
}

export async function syncDatasets(opts: SyncDatasetsOptions = {}): Promise<SyncDatasetsResult> {
  const registryPath = opts.registryPath ?? DEFAULT_REGISTRY_PATH;
  const outDir = opts.outDir ?? DEFAULT_OUT_DIR;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? (() => Date.now());
  const maxBytes = opts.maxBytesPerResource ?? DEFAULT_MAX_BYTES_PER_RESOURCE;
  const timeoutMs = opts.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const maxDatasets = opts.maxDatasetsPerRun ?? DEFAULT_MAX_DATASETS_PER_RUN;
  const maxDropRatio = opts.maxDropRatio ?? DEFAULT_MAX_DROP_RATIO;

  const allEntries = loadRegistry(registryPath);
  const { toProcess, skipped } = selectEntriesForRun(allEntries, maxDatasets);

  // Index chargé UNE SEULE FOIS pour tout le passage (relecture adverse du 07.10.2026, avant le
  // lot de 36 jeux : charger/réécrire `index.json` à chaque jeu était inutilement coûteux pour un
  // gros registre, et empêchait d'y appliquer le retrait ci-dessous en une seule écriture finale).
  const index = loadIndex(outDir);

  const succeeded: string[] = [];
  const unchanged: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const seenIds = new Set<string>();

  for (const entry of toProcess) {
    const id = entry?.id ?? "(id manquant)";
    if (seenIds.has(id)) {
      failed.push({ id, error: `identifiant en double dans le registre : "${id}"` });
      continue;
    }
    seenIds.add(id);

    const entryErrors = validateRegistryEntry(entry);
    if (entryErrors.length > 0) {
      console.error(`[sync:datasets] registre invalide pour "${id}" : ${entryErrors.join(" ; ")}`);
      failed.push({ id, error: entryErrors.join(" ; ") });
      continue;
    }

    try {
      const result = await syncOneDataset(entry, index, { outDir, fixtureDir: opts.fixtureDir, fetchImpl, now, maxBytes, timeoutMs, maxDropRatio });
      if (result.changed) {
        succeeded.push(id);
        console.log(`[sync:datasets] "${id}" : ${result.rows} lignes, édition ${result.edition} (changé)`);
      } else {
        unchanged.push(id);
        console.log(`[sync:datasets] "${id}" : ${result.rows} lignes, édition ${result.edition} (inchangé)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sync:datasets] "${id}" en échec : ${message}`);
      failed.push({ id, error: message });
    }
  }

  // Retrait (relecture adverse du 07.10.2026) : un id présent dans `index.json` mais qui n'existe
  // PLUS DU TOUT dans le registre actuel (`allEntries`, jamais seulement `toProcess` — un id
  // seulement `skipped` par le plafond reste approuvé, jamais retiré) est retiré de l'index ET son
  // `.csv.gz` effacé. Une entrée `failed` (encore présente mais actuellement invalide/en échec)
  // n'est JAMAIS retirée : seule une absence TOTALE du registre déclenche le retrait.
  const registryIds = new Set(allEntries.map((e) => e?.id).filter((id): id is string => typeof id === "string"));
  const removed: string[] = [];
  for (const id of [...index.keys()]) {
    if (registryIds.has(id)) continue;
    index.delete(id);
    const file = join(outDir, `${id}.csv.gz`);
    if (existsSync(file)) unlinkSync(file);
    removed.push(id);
    console.log(`[sync:datasets] "${id}" retiré (absent du registre) : index et .csv.gz effacés`);
  }

  writeIndex(outDir, index);

  return {
    succeeded,
    unchanged,
    failed,
    skipped: skipped.map((e) => e?.id ?? "(id manquant)"),
    removed,
    anyFailed: failed.length > 0,
  };
}

function parseArgs(argv: string[]): { registryPath?: string; outDir?: string } {
  const out: { registryPath?: string; outDir?: string } = {};
  const regIdx = argv.indexOf("--registry");
  if (regIdx !== -1) out.registryPath = argv[regIdx + 1];
  const outIdx = argv.indexOf("--out-dir");
  if (outIdx !== -1) out.outDir = argv[outIdx + 1];
  return out;
}

async function main(): Promise<void> {
  const { registryPath, outDir } = parseArgs(process.argv.slice(2));
  const result = await syncDatasets({ registryPath, outDir });
  console.log(`[sync:datasets] terminé : ${JSON.stringify(result)}`);
  if (result.anyFailed) process.exitCode = 1;
}

// Même détection robuste du module principal que les autres scripts `sync-*.ts`.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error("[sync:datasets] ERREUR :", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
