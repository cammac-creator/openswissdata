#!/usr/bin/env tsx
/**
 * Collecte mensuelle du fichier OFEN de la rétribution unique pour les installations
 * photovoltaïques — l'OFEN republie ce jeu de données une fois par an, la collecte est
 * mensuelle par cohérence avec les autres `refresh-*.yml`, mais ne commite qu'un vrai
 * changement de contenu (voir « édition », plus bas) — tâche osd.donnees, tâche B5 du plan
 * `2026-10-06-prospection-et-api.md`, sur le modèle de `scripts/sync-localities.ts`, EN PLUS
 * SIMPLE : une adresse directe (pas de catalogue STAC à résoudre), un CSV déjà plat (pas de ZIP
 * à ouvrir).
 *
 * Produit `src/mcp/data/bfe_pv.csv` (colonnes en anglais : year, canton, installations_count,
 * installed_capacity_kw, remuneration_chf, installations_per_100000_inhabitants,
 * installed_capacity_kw_per_100000_inhabitants ; triées par année puis canton) et
 * `src/mcp/data/bfe_pv.meta.json` (`{ edition, source, rows }`), lus par
 * `src/mcp/data-loader.ts` (`getBfePv()`). Écriture ATOMIQUE pour les deux fichiers.
 *
 * Les deux ratios « pro 100 000 Einwohner » sont ceux PUBLIÉS par l'OFEN : jamais recalculés
 * ici, seulement recopiés (Global Constraint du plan du 06.10.2026).
 *
 * Usage :
 *   tsx scripts/sync-bfe-pv.ts                                    — téléchargement réel (adresse directe)
 *   tsx scripts/sync-bfe-pv.ts --fixture <csv> --edition AAAA-MM-JJ — CSV local, sans réseau (tests, seed)
 *
 * `--edition` est OBLIGATOIRE en mode `--fixture` (même règle que les autres scripts `sync-*`).
 * En mode réseau, l'édition PROPOSÉE est la date du jour UTC (`now()`, injectable — Global
 * Constraint « horloges ») : contrairement aux répertoires swisstopo, cette ressource n'a pas
 * de catalogue STAC qui porte une date d'édition officielle ; contrairement à TARES, elle n'a
 * pas de date de validité par ligne. MAIS, à la différence de `sync-finma-seats.ts` (dont les
 * données changent réellement chaque mois), l'OFEN ne republie ce jeu de données qu'une fois
 * par an : si le CSV produit est OCTET POUR OCTET identique au précédent, l'édition RETENUE
 * est celle déjà publiée dans `bfe_pv.meta.json` (date de la première collecte de CE contenu),
 * jamais la date du jour — sinon la fiche changerait chaque mois sans aucune donnée nouvelle,
 * ce qui commiterait et redéploierait pour rien. `editions.bfe_pv`, dans le profil de canton et
 * `/api/v1/sources`, se lit donc comme « depuis quand ce contenu est en ligne », pas comme
 * « date du dernier passage réussi ».
 *
 * Contrôles stricts avant toute écriture :
 *   - en-tête EXACT (sept colonnes, même ordre, séparateur `,`, BOM toléré) — sinon échec visible.
 *   - chaque ligne : année à quatre chiffres, canton parmi les 26 abréviations cantonales,
 *     les quatre champs numériques valides (entiers ou décimaux, jamais négatifs) OU la valeur
 *     publiée `NA` (donnée non disponible pour ce couple canton/année — relevé le 07.10.2026 :
 *     les neuf plus petits cantons en 2014, les cinq colonnes toujours ensemble) ; `NA` est
 *     recopié tel quel, jamais remplacé par un zéro deviné.
 *   - CHAQUE année doit compter les 26 cantons, tous distincts (aucun doublon Jahr/Kanton) —
 *     un contrôle sur l'ensemble du fichier seulement laisserait passer une année incomplète
 *     (ex. une nouvelle année encore à moitié publiée), que la baisse de lignes ne détecte pas
 *     forcément puisque le nombre total de lignes peut rester stable ou augmenter.
 *   - au moins `minRows` lignes de données (200 par défaut : la plage réelle 2014-2023 en
 *     compte 260, marge large — le vrai garde-fou reste la baisse de `maxDropRatio`).
 *   - baisse de plus de `maxDropRatio` (2 % par défaut) par rapport au fichier précédent.
 *   - téléchargement de plus de `MAX_CSV_BYTES` : échec (le fichier officiel pèse quelques
 *     dizaines de Ko ; un dépassement massif signale une réponse inattendue).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { BFE_PV_CSV_URL } from "../etl/bfe/sources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_PATH = join(__dirname, "..", "src", "mcp", "data", "bfe_pv.csv");
const DEFAULT_MIN_ROWS = 200;
const DEFAULT_MAX_DROP_RATIO = 0.02;
const MAX_CSV_BYTES = 5_000_000; // fichier officiel : quelques dizaines de Ko au 07.10.2026
const USER_AGENT = "OpenSwissData sync-bfe-pv";

const EXPECTED_HEADER =
  "Jahr,Kanton,Anzahl_Anlagen,Installierte_Leistung_kW,Verguetung_CHF,Anzahl_Anlagen_pro_100000_Einwohner,Installierte_Leistung_kW_pro_100000_Einwohner";

const SWISS_CANTONS = new Set([
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW",
  "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH",
]);

const OUTPUT_COLUMNS = [
  "year", "canton", "installations_count", "installed_capacity_kw", "remuneration_chf",
  "installations_per_100000_inhabitants", "installed_capacity_kw_per_100000_inhabitants",
] as const;

const EDITION_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_RE = /^\d{4}$/;
// L'OFEN publie "NA" (jamais un zéro deviné) pour un couple canton/année sans valeur
// disponible — relevé le 07.10.2026 : les neuf plus petits cantons en 2014, les cinq colonnes
// toujours ensemble. Un fait de la source, jamais recalculé ni rempli : accepté tel quel.
const NA_VALUE = "NA";
const NUMBER_RE = /^\d+(\.\d+)?$/;
const NUMERIC_COLUMNS = [
  "Anzahl_Anlagen", "Installierte_Leistung_kW", "Verguetung_CHF",
  "Anzahl_Anlagen_pro_100000_Einwohner", "Installierte_Leistung_kW_pro_100000_Einwohner",
] as const;

export interface BfePvRow {
  year: string;
  canton: string;
  installations_count: string;
  installed_capacity_kw: string;
  remuneration_chf: string;
  installations_per_100000_inhabitants: string;
  installed_capacity_kw_per_100000_inhabitants: string;
}

export interface BfePvMeta {
  edition: string;
  source: string;
  rows: number;
}

export interface SyncBfePvOptions {
  /** Chemin local d'un CSV (tests, seed initial) : aucun appel réseau si présent. */
  fixturePath?: string;
  /** OBLIGATOIRE quand `fixturePath` est fourni (format "AAAA-MM-JJ"). Ignoré en mode réseau. */
  edition?: string;
  /** Défaut : `src/mcp/data/bfe_pv.csv`. */
  outputPath?: string;
  /** Défaut : dossier de `outputPath` + `bfe_pv.meta.json`. */
  metaPath?: string;
  /** Défaut : `globalThis.fetch`. Lu seulement quand `fixturePath` est absent. */
  fetchImpl?: typeof fetch;
  /** Défaut : `Date.now`. Horloge pour l'édition en mode réseau (Global Constraint « horloges »). */
  now?: () => number;
  /** Défaut : 200. */
  minRows?: number;
  /** Défaut : 0.02 (2 %). */
  maxDropRatio?: number;
}

export interface SyncBfePvResult {
  rowCount: number;
  cantonsSeen: number;
  previousRowCount: number | null;
  outputPath: string;
  metaPath: string;
  edition: string;
  changed: boolean;
}

/** Deux arguments reconnus : `--fixture <chemin>` et `--edition <AAAA-MM-JJ>` (identique aux
 *  autres scripts `sync-*`). */
export function parseArgs(argv: string[]): { fixturePath?: string; edition?: string } {
  const out: { fixturePath?: string; edition?: string } = {};
  const fixtureIdx = argv.indexOf("--fixture");
  if (fixtureIdx !== -1) {
    const value = argv[fixtureIdx + 1];
    if (!value) throw new Error("--fixture nécessite un chemin de CSV");
    out.fixturePath = value;
  }
  const editionIdx = argv.indexOf("--edition");
  if (editionIdx !== -1) {
    const value = argv[editionIdx + 1];
    if (!value) throw new Error("--edition nécessite une date AAAA-MM-JJ");
    out.edition = value;
  }
  return out;
}

function stripBom(text: string): string {
  return text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Vérifie l'en-tête EXACT (BOM et `\r` de fin de ligne tolérés) avant toute interprétation des
 *  lignes, puis parse par `,`. Les clés rendues sont les noms officiels allemands. */
export function parseOfficialCsv(buf: Buffer): Record<string, string>[] {
  const text = stripBom(buf.toString("utf8"));
  const firstBreak = text.indexOf("\n");
  const headerLine = (firstBreak === -1 ? text : text.slice(0, firstBreak)).replace(/\r$/, "");
  if (headerLine !== EXPECTED_HEADER) {
    throw new Error(`En-tête du fichier officiel inattendu (fichier OFEN modifié) : attendu "${EXPECTED_HEADER}", lu "${headerLine}"`);
  }
  return parse(text, { columns: true, delimiter: ",", skip_empty_lines: true, relax_quotes: true }) as Record<string, string>[];
}

/** Contrôles stricts avant toute écriture : année à quatre chiffres, canton parmi les 26, les
 *  quatre champs numériques valides et non négatifs, les 26 cantons tous présents. Fonction
 *  pure, testée sans fichier. */
export function validateRows(rows: Record<string, string>[], minRows: number): void {
  if (rows.length < minRows) {
    throw new Error(`Trop peu de lignes dans le fichier officiel : ${rows.length} (seuil ${minRows})`);
  }
  // Relecture du 07.10.2026 : un contrôle sur l'ENSEMBLE du fichier seulement laissait passer
  // une année incomplète (ex. une nouvelle année qui n'a encore que la moitié des cantons) ou
  // un doublon (Jahr, Kanton) — la baisse ≤ `maxDropRatio` ne l'arrête pas puisque le nombre de
  // lignes total peut rester stable ou augmenter. Le contrôle porte donc sur CHAQUE année.
  const cantonsByYear = new Map<string, Set<string>>();
  const seenPairs = new Set<string>();
  rows.forEach((row, i) => {
    const line = i + 2; // ligne 1 = en-tête
    const year = row["Jahr"] ?? "";
    if (!YEAR_RE.test(year)) throw new Error(`Année invalide ligne ${line} : "${year}"`);
    const canton = row["Kanton"] ?? "";
    if (!SWISS_CANTONS.has(canton)) throw new Error(`Canton invalide ligne ${line} : "${canton}"`);
    const pair = `${year}|${canton}`;
    if (seenPairs.has(pair)) throw new Error(`Doublon année/canton ligne ${line} : "${pair}"`);
    seenPairs.add(pair);
    const set = cantonsByYear.get(year);
    if (set) set.add(canton);
    else cantonsByYear.set(year, new Set([canton]));
    for (const col of NUMERIC_COLUMNS) {
      const value = row[col] ?? "";
      if (value === NA_VALUE) continue; // valeur officiellement non disponible : jamais un zéro deviné
      if (!NUMBER_RE.test(value)) throw new Error(`Nombre invalide ligne ${line}, colonne ${col} : "${value}"`);
    }
  });
  for (const [year, cantons] of cantonsByYear) {
    if (cantons.size < SWISS_CANTONS.size) {
      throw new Error(`Cantons manquants pour l'année ${year} : ${cantons.size}/${SWISS_CANTONS.size} présents`);
    }
  }
}

export function reduceRows(rows: Record<string, string>[]): BfePvRow[] {
  return rows.map((r) => ({
    year: r["Jahr"],
    canton: r["Kanton"],
    installations_count: r["Anzahl_Anlagen"],
    installed_capacity_kw: r["Installierte_Leistung_kW"],
    remuneration_chf: r["Verguetung_CHF"],
    installations_per_100000_inhabitants: r["Anzahl_Anlagen_pro_100000_Einwohner"],
    installed_capacity_kw_per_100000_inhabitants: r["Installierte_Leistung_kW_pro_100000_Einwohner"],
  }));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Année puis canton, par point de code (jamais `localeCompare`) : déterministe sur toute
 *  machine, comme `sortRows` de `sync-localities.ts`. */
export function sortRows(rows: BfePvRow[]): BfePvRow[] {
  return [...rows].sort((a, b) => cmp(a.year, b.year) || cmp(a.canton, b.canton));
}

export function toCsv(rows: readonly BfePvRow[]): string {
  return stringify(rows, { header: true, columns: [...OUTPUT_COLUMNS], record_delimiter: "\n" });
}

function readPreviousRowCount(path: string): number | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  return Math.max(0, lines.length - 1); // moins l'en-tête
}

function writeAtomic(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${randomUUID()}.tmp`);
  writeFileSync(tmp, content, "utf8");
  try {
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* fichier temporaire déjà absent */ }
    throw err;
  }
}

function todayUtc(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

async function downloadCsv(fetchImpl: typeof fetch, url: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new Error(`Téléchargement OFEN impossible ou délai dépassé : ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`Téléchargement OFEN impossible : HTTP ${res.status}`);
  const declared = res.headers.get("content-length");
  if (declared && Number(declared) > MAX_CSV_BYTES) {
    throw new Error(`CSV OFEN trop volumineux (Content-Length ${declared} octets > ${MAX_CSV_BYTES})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("CSV OFEN vide");
  if (buf.length > MAX_CSV_BYTES) throw new Error(`CSV OFEN trop volumineux (${buf.length} octets > ${MAX_CSV_BYTES})`);
  return buf;
}

export async function syncBfePv(opts: SyncBfePvOptions = {}): Promise<SyncBfePvResult> {
  const outputPath = opts.outputPath ?? DEFAULT_OUTPUT_PATH;
  const metaPath = opts.metaPath ?? join(dirname(outputPath), "bfe_pv.meta.json");
  const minRows = opts.minRows ?? DEFAULT_MIN_ROWS;
  const maxDropRatio = opts.maxDropRatio ?? DEFAULT_MAX_DROP_RATIO;
  const now = opts.now ?? (() => Date.now());

  let csvBuf: Buffer;
  let edition: string;
  if (opts.fixturePath) {
    if (!opts.edition) throw new Error("--edition est requis en mode --fixture (aucune date déductible sans appel réseau)");
    if (!EDITION_RE.test(opts.edition)) throw new Error(`--edition invalide : "${opts.edition}" (attendu AAAA-MM-JJ)`);
    edition = opts.edition;
    console.log(`[sync:bfe-pv] mode fixture : ${opts.fixturePath} (aucun réseau, édition ${edition})`);
    csvBuf = readFileSync(opts.fixturePath);
  } else {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    console.log(`[sync:bfe-pv] téléchargement : ${BFE_PV_CSV_URL}`);
    csvBuf = await downloadCsv(fetchImpl, BFE_PV_CSV_URL);
    edition = todayUtc(now());
  }

  const rawRows = parseOfficialCsv(csvBuf);
  validateRows(rawRows, minRows);
  const cantonsSeen = new Set(rawRows.map((r) => r["Kanton"])).size;
  const rows = sortRows(reduceRows(rawRows));

  const previousRowCount = readPreviousRowCount(outputPath);
  if (previousRowCount !== null && rows.length < previousRowCount * (1 - maxDropRatio)) {
    throw new Error(
      `Baisse de plus de ${(maxDropRatio * 100).toFixed(0)} % du nombre de lignes par rapport au fichier précédent ` +
        `(${previousRowCount} → ${rows.length}) : fichier NON remplacé`,
    );
  }

  const csv = toCsv(rows);
  const previousCsv = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : null;

  // L'édition d'une collecte ANNUELLE rejouée chaque mois doit rester la date de la première
  // collecte de CE CONTENU, jamais la date du dernier passage réussi : sinon `bfe_pv.meta.json`
  // change chaque mois sans aucune donnée nouvelle, ce qui commiterait et redéploierait pour
  // rien (contrairement au siège exact FINMA, qui change réellement chaque mois). Quand le CSV
  // produit est identique au précédent, on reprend l'édition déjà publiée — seulement si la
  // fiche précédente est saine et porte le même nombre de lignes, jamais une date devinée sinon.
  let finalEdition = edition;
  if (previousCsv === csv && existsSync(metaPath)) {
    try {
      const prevMeta = JSON.parse(readFileSync(metaPath, "utf8")) as { edition?: unknown; rows?: unknown };
      if (typeof prevMeta.edition === "string" && EDITION_RE.test(prevMeta.edition) && prevMeta.rows === rows.length) {
        finalEdition = prevMeta.edition;
      }
    } catch {
      // fiche précédente illisible : on garde l'édition calculée ci-dessus, jamais une devinée.
    }
  }

  const meta: BfePvMeta = { edition: finalEdition, source: BFE_PV_CSV_URL, rows: rows.length };
  const metaJson = JSON.stringify(meta, null, 2) + "\n";

  const previousMeta = existsSync(metaPath) ? readFileSync(metaPath, "utf8") : null;
  const changed = previousCsv !== csv || previousMeta !== metaJson;
  edition = finalEdition;

  if (changed) {
    writeAtomic(outputPath, csv);
    writeAtomic(metaPath, metaJson);
    console.log(`[sync:bfe-pv] écrit ${rows.length} lignes (édition ${edition}) → ${outputPath}`);
  } else {
    console.log(`[sync:bfe-pv] aucun changement (${rows.length} lignes, édition ${edition})`);
  }

  return { rowCount: rows.length, cantonsSeen, previousRowCount, outputPath, metaPath, edition, changed };
}

async function main(): Promise<void> {
  const { fixturePath, edition } = parseArgs(process.argv.slice(2));
  const result = await syncBfePv({ fixturePath, edition });
  console.log(`[sync:bfe-pv] terminé : ${JSON.stringify(result)}`);
}

// Détection robuste du module principal (chemins avec espaces ou caractères spéciaux,
// Windows), même motif que `sync-localities.ts`/`sync-streets.ts`/`sync-finma-seats.ts`.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error("[sync:bfe-pv] ERREUR :", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
