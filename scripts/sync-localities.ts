#!/usr/bin/env tsx
/**
 * Collecte mensuelle du répertoire officiel des localités suisses (NPA, localité, commune,
 * numéro OFS de commune, canton), depuis le catalogue STAC de swisstopo (tâche osd.localites,
 * tâche 1 du plan `2026-10-06-localites-officielles.md`, relecture finale du 06.10.2026).
 *
 * Produit `src/mcp/data/localities.csv` : colonnes réduites (postal_code,
 * postal_code_suffix, locality, municipality, municipality_bfs_id, canton, language), triées
 * par NPA puis suffixe puis localité (puis numéro OFS de commune, en départage déterministe —
 * un même NPA/suffixe/localité peut couvrir deux communes, ex. Genève 1202 chevauche aussi
 * Pregny-Chambésy) ; et `src/mcp/data/localities.meta.json` : `{ edition, source, rows }`
 * (point 4 de la relecture finale), lu par `src/mcp/data-loader.ts`. Écriture ATOMIQUE
 * (fichier temporaire dans le même dossier, puis renommage) pour les DEUX fichiers : un
 * contrôle en échec laisse les fichiers précédents intacts, jamais d'écrasement silencieux.
 *
 * Usage :
 *   tsx scripts/sync-localities.ts                                    — téléchargement réel par le STAC
 *   tsx scripts/sync-localities.ts --fixture <zip> --edition AAAA-MM-JJ — ZIP local, sans réseau (tests, seed)
 *
 * `--edition` est OBLIGATOIRE en mode `--fixture` : sans appel STAC, rien ne permet de
 * déduire la date d'édition du ZIP fourni — jamais une date devinée ou celle du jour.
 *
 * Contrôles stricts avant toute écriture (décision du 06.10.2026, affinés le même jour en
 * relecture finale) :
 *   - en-tête EXACT (douze colonnes, même ordre, même séparateur `;`) — sinon échec visible,
 *     jamais interprété comme des données.
 *   - encodage : aucun caractère de remplacement U+FFFD (signe de corruption d'encodage), et
 *     la ligne « Genève » du NPA 1204 doit exister telle quelle (canari interne : si cette
 *     commune UTF-8 à accents n'est plus lisible, le reste du fichier ne l'est pas non plus).
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
 *   - ZIP téléchargé de plus de 20 Mo : échec (le fichier officiel pèse ~560 Ko au
 *     06.10.2026 ; un dépassement massif signale une réponse inattendue, jamais traitée).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const MAX_ZIP_BYTES = 20_000_000; // relecture finale du 06.10.2026, point 7

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

const EDITION_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface LocalityRow {
  postal_code: string;
  postal_code_suffix: string;
  locality: string;
  municipality: string;
  municipality_bfs_id: string;
  canton: string;
  language: string;
}

export interface LocalitiesMeta {
  edition: string;
  source: string;
  rows: number;
}

export interface SyncLocalitiesOptions {
  /** Chemin local d'un ZIP (tests, seed initial) : aucun appel réseau si présent. */
  fixturePath?: string;
  /** OBLIGATOIRE quand `fixturePath` est fourni (format "AAAA-MM-JJ") : aucun appel STAC pour
   *  la déduire. Ignoré en mode réseau (déduit de la réponse STAC). */
  edition?: string;
  /** Défaut : `src/mcp/data/localities.csv`. */
  outputPath?: string;
  /** Défaut : dossier de `outputPath` + `localities.meta.json`. */
  metaPath?: string;
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
  metaPath: string;
  edition: string;
  changed: boolean;
}

/** Deux arguments reconnus : `--fixture <chemin>` et `--edition <AAAA-MM-JJ>`. */
export function parseArgs(argv: string[]): { fixturePath?: string; edition?: string } {
  const out: { fixturePath?: string; edition?: string } = {};
  const fixtureIdx = argv.indexOf("--fixture");
  if (fixtureIdx !== -1) {
    const value = argv[fixtureIdx + 1];
    if (!value) throw new Error("--fixture nécessite un chemin de ZIP");
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

/** Contrôle d'encodage (relecture finale du 06.10.2026, point 6) : AUCUN caractère de
 *  remplacement U+FFFD dans le texte décodé (signe d'un octet mal interprété), et la ligne
 *  « Genève » du NPA 1204 doit exister EXACTEMENT ainsi (canari interne — si cette commune à
 *  accents n'est plus lisible telle quelle, l'ensemble du fichier a un problème d'encodage,
 *  même quand aucun U+FFFD n'apparaît, ex. une transcodification silencieuse ISO-8859-1). */
export function validateEncoding(buf: Buffer, rows: Record<string, string>[]): void {
  const text = stripBom(buf.toString("utf8"));
  if (text.includes("�")) {
    throw new Error("Encodage corrompu : caractère de remplacement U+FFFD détecté dans le fichier officiel");
  }
  const geneve1204 = rows.some((row) => row["PLZ4"] === "1204" && row["Ortschaftsname"] === "Genève");
  if (!geneve1204) {
    throw new Error('Contrôle d\'encodage : la ligne "Genève" (NPA 1204) est absente ou altérée');
  }
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

/** Résout l'actif CSV réel ET la date d'édition (propriété STAC `datetime` de l'item,
 *  tronquée au jour) depuis le catalogue — relecture finale du 06.10.2026, point 4. */
async function resolveAsset(fetchImpl: typeof fetch): Promise<{ href: string; edition: string }> {
  const res = await fetchImpl(SWISSTOPO_LOCALITIES_STAC_ITEMS_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Catalogue STAC swisstopo indisponible : HTTP ${res.status}`);
  const body = (await res.json()) as {
    features?: Array<{ properties?: { datetime?: string }; assets?: Record<string, { href?: string }> }>;
  };
  const feature = body.features?.[0];
  const href = feature?.assets?.[SWISSTOPO_LOCALITIES_ASSET_NAME]?.href;
  if (!href) throw new Error(`Actif STAC introuvable dans la réponse : ${SWISSTOPO_LOCALITIES_ASSET_NAME}`);
  const datetime = feature?.properties?.datetime;
  if (!datetime) throw new Error("Date d'édition STAC absente de la réponse (propriété datetime)");
  const edition = datetime.slice(0, 10);
  if (!EDITION_RE.test(edition)) throw new Error(`Date d'édition STAC invalide : "${datetime}"`);
  return { href, edition };
}

async function downloadZip(fetchImpl: typeof fetch, url: string): Promise<Buffer> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Téléchargement du ZIP impossible : HTTP ${res.status}`);
  const declared = res.headers.get("content-length");
  if (declared && Number(declared) > MAX_ZIP_BYTES) {
    throw new Error(`ZIP officiel trop volumineux (Content-Length ${declared} octets > ${MAX_ZIP_BYTES})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("ZIP officiel vide");
  return buf;
}

export async function syncLocalities(opts: SyncLocalitiesOptions = {}): Promise<SyncLocalitiesResult> {
  const outputPath = opts.outputPath ?? DEFAULT_OUTPUT_PATH;
  const metaPath = opts.metaPath ?? join(dirname(outputPath), "localities.meta.json");
  const minRows = opts.minRows ?? DEFAULT_MIN_ROWS;
  const maxDropRatio = opts.maxDropRatio ?? DEFAULT_MAX_DROP_RATIO;

  let zipBuf: Buffer;
  let edition: string;
  if (opts.fixturePath) {
    if (!opts.edition) throw new Error("--edition est requis en mode --fixture (aucun appel STAC pour déduire la date d'édition)");
    if (!EDITION_RE.test(opts.edition)) throw new Error(`--edition invalide : "${opts.edition}" (attendu AAAA-MM-JJ)`);
    edition = opts.edition;
    console.log(`[sync:localities] mode fixture : ${opts.fixturePath} (aucun réseau, édition ${edition})`);
    zipBuf = readFileSync(opts.fixturePath);
  } else {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    console.log("[sync:localities] résolution de l'actif via le catalogue STAC swisstopo...");
    const asset = await resolveAsset(fetchImpl);
    edition = asset.edition;
    console.log(`[sync:localities] téléchargement (édition ${edition}) : ${asset.href}`);
    zipBuf = await downloadZip(fetchImpl, asset.href);
  }

  // Relecture finale du 06.10.2026, point 7 : plafond unique, quelle que soit la source
  // (réseau ou fixture) — défense en profondeur, même si une fixture de test ne l'atteint
  // jamais en pratique.
  if (zipBuf.length > MAX_ZIP_BYTES) {
    throw new Error(`ZIP trop volumineux (${zipBuf.length} octets > ${MAX_ZIP_BYTES})`);
  }

  const csvBuf = await extractCsvFromZip(zipBuf, SWISSTOPO_LOCALITIES_CSV_BASENAME);
  const rawRows = parseOfficialCsv(csvBuf);
  validateEncoding(csvBuf, rawRows);
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
  const meta: LocalitiesMeta = { edition, source: SWISSTOPO_LOCALITIES_STAC_ITEMS_URL, rows: rows.length };
  const metaJson = JSON.stringify(meta, null, 2) + "\n";

  const previousCsv = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : null;
  const previousMeta = existsSync(metaPath) ? readFileSync(metaPath, "utf8") : null;
  const changed = previousCsv !== csv || previousMeta !== metaJson;

  if (changed) {
    writeAtomic(outputPath, csv);
    writeAtomic(metaPath, metaJson);
    const note = excluded > 0 ? ` (${excluded} commune(s) du Liechtenstein exclues)` : "";
    console.log(`[sync:localities] écrit ${rows.length} lignes (édition ${edition}) → ${outputPath}${note}`);
  } else {
    console.log(`[sync:localities] aucun changement (${rows.length} lignes, édition ${edition}, fichiers déjà à jour)`);
  }

  return { rowCount: rows.length, excludedLiechtenstein: excluded, previousRowCount, outputPath, metaPath, edition, changed };
}

async function main(): Promise<void> {
  const { fixturePath, edition } = parseArgs(process.argv.slice(2));
  const result = await syncLocalities({ fixturePath, edition });
  console.log(`[sync:localities] terminé : ${JSON.stringify(result)}`);
}

// Relecture finale du 06.10.2026, point 7 : détection robuste du module principal (chemins
// avec espaces ou caractères spéciaux, Windows), au lieu de la comparaison littérale
// `file://${process.argv[1]}` qui échoue sur ces cas.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error("[sync:localities] ERREUR :", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
