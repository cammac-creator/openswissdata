#!/usr/bin/env tsx
/**
 * Collecte mensuelle du répertoire officiel des localités suisses (NPA, localité, commune,
 * numéro OFS de commune, canton), depuis le catalogue STAC de swisstopo (tâche osd.localites,
 * tâche 1 du plan `2026-10-06-localites-officielles.md`).
 *
 * Produit `src/mcp/data/localities.csv` : colonnes réduites (postal_code,
 * postal_code_suffix, locality, municipality, municipality_bfs_id, canton, language), triées
 * par NPA puis suffixe puis localité (puis numéro OFS de commune, en départage déterministe —
 * un même NPA/suffixe/localité peut couvrir deux communes, ex. Genève 1202 chevauche aussi
 * Pregny-Chambésy). Écriture ATOMIQUE (fichier temporaire dans le même dossier, puis
 * renommage) : un contrôle en échec laisse le fichier précédent intact, jamais d'écrasement
 * silencieux.
 *
 * Usage :
 *   tsx scripts/sync-localities.ts                   — téléchargement réel par le STAC
 *   tsx scripts/sync-localities.ts --fixture <zip>    — ZIP local, sans réseau (tests, seed)
 *
 * Contrôles stricts avant toute écriture (décision du 06.10.2026) :
 *   - en-tête EXACT (douze colonnes, même ordre, même séparateur `;`) — sinon échec visible,
 *     jamais interprété comme des données.
 *   - communes du Liechtenstein (numéro OFS 7001 à 7011, `Kantonskürzel` vide dans le fichier
 *     officiel : elles partagent le système postal suisse sans appartenir à un canton
 *     suisse — vérifié sur le fichier du 06.10.2026, 20 lignes, communes Vaduz/Triesen/
 *     Balzers/Triesenberg/Schaan/Planken/Eschen/Mauren/Gamprin/Ruggell/Schellenberg) :
 *     EXCLUES du fichier distribué (cette collecte ne sert que des adresses suisses), comptées
 *     et journalisées — jamais une autre ligne à canton vide, qui reste un échec.
 *   - au moins `minRows` lignes de données après cette exclusion (5 000 par défaut).
 *   - NPA (PLZ4) à 4 chiffres, numéro OFS (BFS-Nr) entier, canton parmi les 26 abréviations
 *     cantonales (après l'exclusion ci-dessus : plus aucune ligne à canton vide n'est
 *     tolérée).
 *   - baisse de plus de `maxDropRatio` (2 % par défaut) du nombre de lignes par rapport au
 *     fichier précédent, quand il existe : échec, jamais un remplacement par un fichier
 *     tronqué.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import yauzl from "yauzl";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  SWISSTOPO_LOCALITIES_ASSET_NAME,
  SWISSTOPO_LOCALITIES_CSV_BASENAME,
  SWISSTOPO_LOCALITIES_STAC_ITEMS_URL,
} from "../etl/localities/sources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_PATH = join(__dirname, "..", "src", "mcp", "data", "localities.csv");
const DEFAULT_MIN_ROWS = 5000;
const DEFAULT_MAX_DROP_RATIO = 0.02;

const EXPECTED_HEADER =
  "Ortschaftsname;PLZ4;Zusatzziffer;ZIP_ID;Gemeindename;BFS-Nr;Kantonskürzel;Adressenanteil;E;N;Sprache;Validity";

const SWISS_CANTONS = new Set([
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW",
  "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH",
]);

// Les onze communes du Liechtenstein, numéro OFS officiel (vérifié sur le fichier du
// 06.10.2026 : `Kantonskürzel` vide pour ces onze numéros, et pour eux seuls).
const LIECHTENSTEIN_BFS_IDS = new Set(["7001", "7002", "7003", "7004", "7005", "7006", "7007", "7008", "7009", "7010", "7011"]);

const OUTPUT_COLUMNS = ["postal_code", "postal_code_suffix", "locality", "municipality", "municipality_bfs_id", "canton", "language"] as const;

export interface LocalityRow {
  postal_code: string;
  postal_code_suffix: string;
  locality: string;
  municipality: string;
  municipality_bfs_id: string;
  canton: string;
  language: string;
}

export interface SyncLocalitiesOptions {
  /** Chemin local d'un ZIP (tests, seed initial) : aucun appel réseau si présent. */
  fixturePath?: string;
  /** Défaut : `src/mcp/data/localities.csv`. */
  outputPath?: string;
  /** Défaut : `globalThis.fetch`. Lu seulement quand `fixturePath` est absent. */
  fetchImpl?: typeof fetch;
  /** Défaut : 5000. Paramétrable pour les tests (une fixture réduite n'atteint jamais ce seuil). */
  minRows?: number;
  /** Défaut : 0.02 (2 %). */
  maxDropRatio?: number;
}

export interface SyncLocalitiesResult {
  rowCount: number;
  excludedLiechtenstein: number;
  previousRowCount: number | null;
  outputPath: string;
  changed: boolean;
}

/** Un seul argument reconnu : `--fixture <chemin>`. */
export function parseArgs(argv: string[]): { fixturePath?: string } {
  const idx = argv.indexOf("--fixture");
  if (idx === -1) return {};
  const value = argv[idx + 1];
  if (!value) throw new Error("--fixture nécessite un chemin de ZIP");
  return { fixturePath: value };
}

/** Extrait un fichier d'un ZIP en mémoire par son nom seul (pas son chemin) : un changement
 *  de dossier dans l'archive officielle ne doit pas faire échouer la collecte. */
export function extractCsvFromZip(zipBuf: Buffer, wantedBasename: string, maxBytes = 5_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) { reject(err ?? new Error("ouverture du ZIP impossible")); return; }
      let resolved = false;
      zip.on("entry", (entry) => {
        if (entry.fileName.split("/").pop() === wantedBasename) {
          if (entry.uncompressedSize > maxBytes) { zip.close(); reject(new Error(`Fichier trop volumineux dans le ZIP : ${wantedBasename}`)); return; }
          zip.openReadStream(entry, (e, rs) => {
            if (e || !rs) { reject(e ?? new Error("lecture du ZIP impossible")); return; }
            const parts: Buffer[] = [];
            let size = 0;
            rs.on("data", (d: Buffer) => {
              size += d.length;
              if (size > maxBytes) { rs.destroy(); zip.close(); reject(new Error(`Fichier trop volumineux dans le ZIP : ${wantedBasename}`)); return; }
              parts.push(d);
            });
            rs.on("end", () => { resolved = true; zip.close(); resolve(Buffer.concat(parts)); });
            rs.on("error", reject);
          });
        } else {
          zip.readEntry();
        }
      });
      zip.on("error", reject);
      zip.on("end", () => { if (!resolved) reject(new Error(`${wantedBasename} absent du ZIP`)); });
      zip.readEntry();
    });
  });
}

function stripBom(text: string): string {
  return text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Vérifie l'en-tête EXACT avant toute interprétation des lignes, puis parse par `;`. Les
 *  clés rendues sont les noms officiels (`PLZ4`, `BFS-Nr`, `Kantonskürzel`, …). */
export function parseOfficialCsv(buf: Buffer): Record<string, string>[] {
  const text = stripBom(buf.toString("utf8"));
  const firstBreak = text.indexOf("\n");
  const headerLine = (firstBreak === -1 ? text : text.slice(0, firstBreak)).replace(/\r$/, "");
  if (headerLine !== EXPECTED_HEADER) {
    throw new Error(`En-tête du fichier officiel inattendu (fichier swisstopo modifié) : attendu "${EXPECTED_HEADER}", lu "${headerLine}"`);
  }
  return parse(text, { columns: true, delimiter: ";", skip_empty_lines: true, relax_quotes: true }) as Record<string, string>[];
}

/** Écarte UNIQUEMENT les onze communes du Liechtenstein (canton vide ET numéro OFS parmi
 *  7001-7011) ; toute autre ligne à canton vide reste soumise à `validateRows` (échec). */
export function partitionLiechtenstein(rows: Record<string, string>[]): { rows: Record<string, string>[]; excluded: number } {
  const kept: Record<string, string>[] = [];
  let excluded = 0;
  for (const row of rows) {
    if ((row["Kantonskürzel"] ?? "") === "" && LIECHTENSTEIN_BFS_IDS.has(row["BFS-Nr"] ?? "")) {
      excluded += 1;
    } else {
      kept.push(row);
    }
  }
  return { rows: kept, excluded };
}

/** Contrôles stricts (décision du 06.10.2026) : seuil de lignes, NPA, numéro OFS, canton. */
export function validateRows(rows: Record<string, string>[], minRows: number): void {
  if (rows.length < minRows) {
    throw new Error(`Trop peu de lignes dans le fichier officiel : ${rows.length} (seuil ${minRows})`);
  }
  rows.forEach((row, i) => {
    const line = i + 2; // ligne 1 = en-tête, lignes de données numérotées à partir de 2
    const npa = row["PLZ4"] ?? "";
    if (!/^\d{4}$/.test(npa)) throw new Error(`NPA invalide ligne ${line} : "${npa}"`);
    const bfs = row["BFS-Nr"] ?? "";
    if (!/^\d+$/.test(bfs)) throw new Error(`Numéro OFS invalide ligne ${line} : "${bfs}"`);
    const canton = row["Kantonskürzel"] ?? "";
    if (!SWISS_CANTONS.has(canton)) throw new Error(`Canton invalide ligne ${line} : "${canton}"`);
  });
}

export function reduceRows(rows: Record<string, string>[]): LocalityRow[] {
  return rows.map((r) => ({
    postal_code: r["PLZ4"],
    postal_code_suffix: r["Zusatzziffer"],
    locality: r["Ortschaftsname"],
    municipality: r["Gemeindename"],
    municipality_bfs_id: r["BFS-Nr"],
    canton: r["Kantonskürzel"],
    language: r["Sprache"],
  }));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** NPA puis suffixe puis localité (plan), puis numéro OFS de commune en départage
 *  déterministe : une même localité peut chevaucher deux communes avec un même NPA et
 *  suffixe (ex. Genève 1202 chevauche aussi Pregny-Chambésy) — sans ce 4e critère, l'ordre
 *  entre ces deux lignes dépendrait de l'ordre d'arrivée, et le workflow mensuel commiterait
 *  un remaniement sans rien avoir changé. Comparaison par point de code (jamais
 *  `localeCompare`), pour rester identique sur toute machine. */
export function sortRows(rows: LocalityRow[]): LocalityRow[] {
  return [...rows].sort(
    (a, b) =>
      cmp(a.postal_code, b.postal_code) ||
      cmp(a.postal_code_suffix, b.postal_code_suffix) ||
      cmp(a.locality, b.locality) ||
      cmp(a.municipality_bfs_id, b.municipality_bfs_id),
  );
}

export function toCsv(rows: LocalityRow[]): string {
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

async function resolveAssetUrl(fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(SWISSTOPO_LOCALITIES_STAC_ITEMS_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Catalogue STAC swisstopo indisponible : HTTP ${res.status}`);
  const body = (await res.json()) as { features?: Array<{ assets?: Record<string, { href?: string }> }> };
  const href = body.features?.[0]?.assets?.[SWISSTOPO_LOCALITIES_ASSET_NAME]?.href;
  if (!href) throw new Error(`Actif STAC introuvable dans la réponse : ${SWISSTOPO_LOCALITIES_ASSET_NAME}`);
  return href;
}

async function downloadZip(fetchImpl: typeof fetch, url: string): Promise<Buffer> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Téléchargement du ZIP impossible : HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("ZIP officiel vide");
  return buf;
}

export async function syncLocalities(opts: SyncLocalitiesOptions = {}): Promise<SyncLocalitiesResult> {
  const outputPath = opts.outputPath ?? DEFAULT_OUTPUT_PATH;
  const minRows = opts.minRows ?? DEFAULT_MIN_ROWS;
  const maxDropRatio = opts.maxDropRatio ?? DEFAULT_MAX_DROP_RATIO;

  let zipBuf: Buffer;
  if (opts.fixturePath) {
    console.log(`[sync:localities] mode fixture : ${opts.fixturePath} (aucun réseau)`);
    zipBuf = readFileSync(opts.fixturePath);
  } else {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    console.log("[sync:localities] résolution de l'actif via le catalogue STAC swisstopo...");
    const assetUrl = await resolveAssetUrl(fetchImpl);
    console.log(`[sync:localities] téléchargement : ${assetUrl}`);
    zipBuf = await downloadZip(fetchImpl, assetUrl);
  }

  const csvBuf = await extractCsvFromZip(zipBuf, SWISSTOPO_LOCALITIES_CSV_BASENAME);
  const rawRows = parseOfficialCsv(csvBuf);
  const { rows: swissRows, excluded } = partitionLiechtenstein(rawRows);
  validateRows(swissRows, minRows);
  const rows = sortRows(reduceRows(swissRows));

  const previousRowCount = readPreviousRowCount(outputPath);
  if (previousRowCount !== null && rows.length < previousRowCount * (1 - maxDropRatio)) {
    throw new Error(
      `Baisse de plus de ${(maxDropRatio * 100).toFixed(0)} % du nombre de lignes par rapport au fichier précédent ` +
        `(${previousRowCount} → ${rows.length}) : fichier NON remplacé`,
    );
  }

  const csv = toCsv(rows);
  const previousContent = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : null;
  const changed = previousContent !== csv;
  if (changed) {
    writeAtomic(outputPath, csv);
    const note = excluded > 0 ? ` (${excluded} commune(s) du Liechtenstein exclues)` : "";
    console.log(`[sync:localities] écrit ${rows.length} lignes → ${outputPath}${note}`);
  } else {
    console.log(`[sync:localities] aucun changement (${rows.length} lignes, fichier déjà à jour)`);
  }

  return { rowCount: rows.length, excludedLiechtenstein: excluded, previousRowCount, outputPath, changed };
}

async function main(): Promise<void> {
  const { fixturePath } = parseArgs(process.argv.slice(2));
  const result = await syncLocalities({ fixturePath });
  console.log(`[sync:localities] terminé : ${JSON.stringify(result)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[sync:localities] ERREUR :", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
