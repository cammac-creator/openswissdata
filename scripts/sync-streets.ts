#!/usr/bin/env tsx
/**
 * Collecte mensuelle du répertoire officiel des rues suisses (nom de rue, NPA, localité,
 * commune, numéro OFS de commune, canton), depuis le catalogue STAC de swisstopo (tâche
 * osd.localites, tâche B1 du plan `2026-10-06-prospection-et-api.md`), SUR LE MODÈLE EXACT
 * de `scripts/sync-localities.ts` (même structure, mêmes contrôles, mêmes leçons de
 * relecture déjà intégrées dans ce dernier).
 *
 * Produit `src/mcp/data/streets.csv.gz` (fichier volumineux : compressé, DÉTERMINISTE —
 * `zlib.gzipSync(buf, { level: 9 })` n'écrit ni nom ni date, deux générations successives du
 * même contenu donnent les mêmes octets) et `src/mcp/data/streets.meta.json` :
 * `{ edition, source, rows }`, lu par `src/mcp/data-loader.ts` (`getStreets()`). Écriture
 * ATOMIQUE (fichier temporaire dans le même dossier, puis renommage) pour les DEUX fichiers.
 *
 * Usage :
 *   tsx scripts/sync-streets.ts                                     — téléchargement réel par le STAC
 *   tsx scripts/sync-streets.ts --fixture <zip> --edition AAAA-MM-JJ — ZIP local, sans réseau (tests, seed)
 *
 * `--edition` est OBLIGATOIRE en mode `--fixture` : sans appel STAC, rien ne permet de
 * déduire la date d'édition du ZIP fourni — jamais une date devinée ou celle du jour.
 *
 * Contrôles stricts avant toute écriture (décision du 06.10.2026, tâche B1) :
 *   - en-tête EXACT (quatorze colonnes, même ordre, même séparateur `;`) — sinon échec
 *     visible, jamais interprété comme des données.
 *   - encodage : aucun caractère de remplacement U+FFFD, et au moins une rue de la commune de
 *     Genève (numéro OFS 6621) doit être lisible exactement ainsi (canari interne — si cette
 *     commune à accents n'est plus lisible, le reste du fichier ne l'est pas non plus).
 *   - seules les lignes `STR_STATUS=real` ET `STR_OFFICIAL=true` sont conservées (adresses
 *     réellement attribuées, écartant les tronçons encore planifiés).
 *   - communes du Liechtenstein (mêmes onze numéros OFS que `sync-localities.ts`, 7001-7011,
 *     `COM_CANTON` vide) : EXCLUES, comptées et journalisées — jamais présentes dans le
 *     fichier du 06.10.2026, mais la même règle que les localités s'applique par cohérence
 *     (cette collecte ne sert que des adresses suisses).
 *   - au moins `minRows` lignes de données après filtrage et exclusion (200 000 par défaut,
 *     décision du 06.10.2026 : le fichier officiel en compte environ 221 000 après filtrage).
 *   - NPA (premier segment de `ZIP_LABEL`) à 4 chiffres, numéro OFS (`COM_FOSNR`) entier,
 *     canton parmi les 26 abréviations cantonales (après l'exclusion ci-dessus : plus aucune
 *     ligne à canton vide n'est tolérée), nom de rue non vide.
 *   - baisse de plus de `maxDropRatio` (2 % par défaut) du nombre de lignes par rapport au
 *     fichier précédent, quand il existe : échec, jamais un remplacement par un fichier
 *     tronqué.
 *   - ZIP téléchargé de plus de 40 Mo (`MAX_ZIP_BYTES`) : échec (le fichier officiel du
 *     06.10.2026 pèse environ 6,5 Mo compressé pour 24,9 Mo de CSV ; un dépassement massif
 *     signale une réponse inattendue, jamais traitée).
 *
 * `ZIP_LABEL` peut lister PLUSIEURS couples NPA/localité séparés par ", " quand une rue
 * chevauche plusieurs secteurs postaux à l'intérieur de la même commune (environ 2,6 % des
 * lignes du fichier du 06.10.2026, ex. certaines rues de Lausanne) : seul le PREMIER couple
 * est retenu dans les colonnes `postal_code`/`locality` du fichier distribué — la
 * vérification `street_in_municipality` (`src/mcp/company/check.ts`) n'utilise que
 * `municipality_bfs_id`, toujours unique par ligne, jamais ces deux colonnes.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import yauzl from "yauzl";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  SWISSTOPO_STREETS_ASSET_NAME,
  SWISSTOPO_STREETS_CSV_BASENAME,
  SWISSTOPO_STREETS_STAC_ITEMS_URL,
} from "../etl/streets/sources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_PATH = join(__dirname, "..", "src", "mcp", "data", "streets.csv.gz");
const DEFAULT_MIN_ROWS = 200_000;
const DEFAULT_MAX_DROP_RATIO = 0.02;
const MAX_ZIP_BYTES = 40_000_000; // plafond de taille du ZIP officiel (décision du 06.10.2026)
// Plafond de l'archive extraite (le CSV est plus volumineux que le ZIP compressé, environ 24,9
// Mo au 06.10.2026 pour 6,5 Mo de ZIP) : garde-fou contre une bombe zip, distinct de MAX_ZIP_BYTES.
const MAX_EXTRACTED_CSV_BYTES = 60_000_000;

const EXPECTED_HEADER =
  "STR_ESID;STN_LABEL;ZIP_LABEL;COM_FOSNR;COM_NAME;COM_CANTON;STR_TYPE;STR_STATUS;STR_OFFICIAL;STR_MODIFIED;STR_EASTING;STR_NORTHING;STR_PARENT;STR_CHILDREN";

const SWISS_CANTONS = new Set([
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW",
  "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH",
]);

// Mêmes onze communes du Liechtenstein que `sync-localities.ts` (numéro OFS officiel,
// `COM_CANTON` vide pour ces onze numéros, et pour eux seuls).
const LIECHTENSTEIN_BFS_IDS = new Set(["7001", "7002", "7003", "7004", "7005", "7006", "7007", "7008", "7009", "7010", "7011"]);

const OUTPUT_COLUMNS = ["street", "postal_code", "locality", "municipality_bfs_id", "municipality", "canton"] as const;

const EDITION_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface StreetRow {
  street: string;
  postal_code: string;
  locality: string;
  municipality_bfs_id: string;
  municipality: string;
  canton: string;
}

export interface StreetsMeta {
  edition: string;
  source: string;
  rows: number;
}

export interface SyncStreetsOptions {
  /** Chemin local d'un ZIP (tests, seed initial) : aucun appel réseau si présent. */
  fixturePath?: string;
  /** OBLIGATOIRE quand `fixturePath` est fourni (format "AAAA-MM-JJ"). Ignoré en mode réseau. */
  edition?: string;
  /** Défaut : `src/mcp/data/streets.csv.gz`. */
  outputPath?: string;
  /** Défaut : dossier de `outputPath` + `streets.meta.json`. */
  metaPath?: string;
  /** Défaut : `globalThis.fetch`. Lu seulement quand `fixturePath` est absent. */
  fetchImpl?: typeof fetch;
  /** Défaut : 200 000. Paramétrable pour les tests (une fixture réduite n'atteint jamais ce seuil). */
  minRows?: number;
  /** Défaut : 0.02 (2 %). */
  maxDropRatio?: number;
}

export interface SyncStreetsResult {
  rowCount: number;
  excludedLiechtenstein: number;
  previousRowCount: number | null;
  outputPath: string;
  metaPath: string;
  edition: string;
  changed: boolean;
}

/** Deux arguments reconnus : `--fixture <chemin>` et `--edition <AAAA-MM-JJ>` (identique à
 *  `sync-localities.ts`). */
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

/** Extrait un fichier d'un ZIP en mémoire par son nom seul (pas son chemin). */
export function extractCsvFromZip(zipBuf: Buffer, wantedBasename: string, maxBytes = MAX_EXTRACTED_CSV_BYTES): Promise<Buffer> {
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
 *  clés rendues sont les noms officiels (`STN_LABEL`, `COM_FOSNR`, `COM_CANTON`, …). */
export function parseOfficialCsv(buf: Buffer): Record<string, string>[] {
  const text = stripBom(buf.toString("utf8"));
  const firstBreak = text.indexOf("\n");
  const headerLine = (firstBreak === -1 ? text : text.slice(0, firstBreak)).replace(/\r$/, "");
  if (headerLine !== EXPECTED_HEADER) {
    throw new Error(`En-tête du fichier officiel inattendu (fichier swisstopo modifié) : attendu "${EXPECTED_HEADER}", lu "${headerLine}"`);
  }
  return parse(text, { columns: true, delimiter: ";", skip_empty_lines: true, relax_quotes: true }) as Record<string, string>[];
}

/** Contrôle d'encodage : AUCUN caractère de remplacement U+FFFD, et au moins une rue de la
 *  commune de Genève (numéro OFS 6621) doit être lisible exactement ainsi (canari interne). */
export function validateEncoding(buf: Buffer, rows: Record<string, string>[]): void {
  const text = stripBom(buf.toString("utf8"));
  if (text.includes("�")) {
    throw new Error("Encodage corrompu : caractère de remplacement U+FFFD détecté dans le fichier officiel");
  }
  const geneve = rows.some((row) => row["COM_FOSNR"] === "6621" && row["COM_NAME"] === "Genève");
  if (!geneve) {
    throw new Error("Contrôle d'encodage : aucune rue de la commune de Genève (numéro OFS 6621) n'est lisible ou présente");
  }
}

/** Écarte UNIQUEMENT les onze communes du Liechtenstein (canton vide ET numéro OFS parmi
 *  7001-7011) ; toute autre ligne à canton vide reste soumise à `validateRows` (échec). */
export function partitionLiechtenstein(rows: Record<string, string>[]): { rows: Record<string, string>[]; excluded: number } {
  const kept: Record<string, string>[] = [];
  let excluded = 0;
  for (const row of rows) {
    if ((row["COM_CANTON"] ?? "") === "" && LIECHTENSTEIN_BFS_IDS.has(row["COM_FOSNR"] ?? "")) {
      excluded += 1;
    } else {
      kept.push(row);
    }
  }
  return { rows: kept, excluded };
}

/** Seules les rues réellement attribuées (`STR_STATUS=real`) ET officielles
 *  (`STR_OFFICIAL=true`) sont distribuées : les tronçons `planned` ne sont pas des adresses. */
export function filterRealOfficial(rows: Record<string, string>[]): Record<string, string>[] {
  return rows.filter((row) => row["STR_STATUS"] === "real" && row["STR_OFFICIAL"] === "true");
}

/** Contrôles stricts (décision du 06.10.2026) : seuil de lignes, NPA, numéro OFS, canton, nom
 *  de rue. Appelé APRÈS `filterRealOfficial` et `partitionLiechtenstein`. */
export function validateRows(rows: Record<string, string>[], minRows: number): void {
  if (rows.length < minRows) {
    throw new Error(`Trop peu de lignes dans le fichier officiel : ${rows.length} (seuil ${minRows})`);
  }
  rows.forEach((row, i) => {
    const line = i + 2; // ligne 1 = en-tête, lignes de données numérotées à partir de 2
    const street = row["STN_LABEL"] ?? "";
    if (street.trim() === "") throw new Error(`Nom de rue vide ligne ${line}`);
    const { postalCode } = parseZipLabel(row["ZIP_LABEL"] ?? "");
    if (!/^\d{4}$/.test(postalCode)) throw new Error(`NPA invalide ligne ${line} : "${postalCode}"`);
    const bfs = row["COM_FOSNR"] ?? "";
    if (!/^\d+$/.test(bfs)) throw new Error(`Numéro OFS invalide ligne ${line} : "${bfs}"`);
    const canton = row["COM_CANTON"] ?? "";
    if (!SWISS_CANTONS.has(canton)) throw new Error(`Canton invalide ligne ${line} : "${canton}"`);
  });
}

export interface ZipLabelParts {
  postalCode: string;
  locality: string;
}

/** `ZIP_LABEL` officiel ("8400 Winterthur", parfois "9053 Teufen AR", parfois une LISTE de
 *  couples séparés par ", " quand une rue chevauche plusieurs secteurs postaux) : seul le
 *  PREMIER couple est retenu (voir le commentaire d'en-tête du fichier). */
export function parseZipLabel(zipLabel: string): ZipLabelParts {
  const firstSegment = zipLabel.split(",")[0]?.trim() ?? "";
  const spaceIdx = firstSegment.indexOf(" ");
  if (spaceIdx === -1) return { postalCode: firstSegment, locality: "" };
  return { postalCode: firstSegment.slice(0, spaceIdx), locality: firstSegment.slice(spaceIdx + 1).trim() };
}

export function reduceRows(rows: Record<string, string>[]): StreetRow[] {
  return rows.map((r) => {
    const { postalCode, locality } = parseZipLabel(r["ZIP_LABEL"] ?? "");
    return {
      street: r["STN_LABEL"],
      postal_code: postalCode,
      locality,
      municipality_bfs_id: r["COM_FOSNR"],
      municipality: r["COM_NAME"],
      canton: r["COM_CANTON"],
    };
  });
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Numéro OFS de commune, puis rue, puis NPA, puis localité (déterministe) : le fichier
 *  officiel garde plusieurs lignes (un `STR_ESID` par tronçon) pour une même rue d'une même
 *  commune — ce tri place les doublons résultants côte à côte pour `dedupeRows`. Comparaison
 *  par point de code (jamais `localeCompare`), pour rester identique sur toute machine. */
export function sortRows(rows: StreetRow[]): StreetRow[] {
  return [...rows].sort(
    (a, b) =>
      cmp(a.municipality_bfs_id, b.municipality_bfs_id) ||
      cmp(a.street, b.street) ||
      cmp(a.postal_code, b.postal_code) ||
      cmp(a.locality, b.locality),
  );
}

/** Retire les doublons EXACTS (même rue, même NPA/localité retenus, même commune, même
 *  canton) issus de plusieurs tronçons `STR_ESID` du fichier officiel pour la même rue d'une
 *  même commune. Appelé APRÈS `sortRows` : les doublons sont alors consécutifs, le résultat
 *  est donc indépendant de l'ordre d'arrivée des lignes dans le fichier source. */
export function dedupeRows(sortedRows: StreetRow[]): StreetRow[] {
  const out: StreetRow[] = [];
  let previousKey: string | null = null;
  for (const row of sortedRows) {
    const key = `${row.municipality_bfs_id}\u0000${row.street}\u0000${row.postal_code}\u0000${row.locality}\u0000${row.municipality}\u0000${row.canton}`;
    if (key !== previousKey) out.push(row);
    previousKey = key;
  }
  return out;
}

export function toCsv(rows: StreetRow[]): string {
  return stringify(rows, { header: true, columns: [...OUTPUT_COLUMNS], record_delimiter: "\n" });
}

/** Lit le nombre de lignes du fichier `.csv.gz` PRÉCÉDENT (décompressé en mémoire) ; `null`
 *  si absent (premier run : aucun contrôle de baisse). */
function readPreviousRowCount(path: string): number | null {
  if (!existsSync(path)) return null;
  const text = gunzipSync(readFileSync(path)).toString("utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  return Math.max(0, lines.length - 1); // moins l'en-tête
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

/** Résout l'actif ZIP réel ET la date d'édition (propriété STAC `datetime` de l'item,
 *  tronquée au jour) depuis le catalogue (identique à `sync-localities.ts`). */
async function resolveAsset(fetchImpl: typeof fetch): Promise<{ href: string; edition: string }> {
  const res = await fetchImpl(SWISSTOPO_STREETS_STAC_ITEMS_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Catalogue STAC swisstopo indisponible : HTTP ${res.status}`);
  const body = (await res.json()) as {
    features?: Array<{ properties?: { datetime?: string }; assets?: Record<string, { href?: string }> }>;
  };
  const feature = body.features?.[0];
  const href = feature?.assets?.[SWISSTOPO_STREETS_ASSET_NAME]?.href;
  if (!href) throw new Error(`Actif STAC introuvable dans la réponse : ${SWISSTOPO_STREETS_ASSET_NAME}`);
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

export async function syncStreets(opts: SyncStreetsOptions = {}): Promise<SyncStreetsResult> {
  const outputPath = opts.outputPath ?? DEFAULT_OUTPUT_PATH;
  const metaPath = opts.metaPath ?? join(dirname(outputPath), "streets.meta.json");
  const minRows = opts.minRows ?? DEFAULT_MIN_ROWS;
  const maxDropRatio = opts.maxDropRatio ?? DEFAULT_MAX_DROP_RATIO;

  let zipBuf: Buffer;
  let edition: string;
  if (opts.fixturePath) {
    if (!opts.edition) throw new Error("--edition est requis en mode --fixture (aucun appel STAC pour déduire la date d'édition)");
    if (!EDITION_RE.test(opts.edition)) throw new Error(`--edition invalide : "${opts.edition}" (attendu AAAA-MM-JJ)`);
    edition = opts.edition;
    console.log(`[sync:streets] mode fixture : ${opts.fixturePath} (aucun réseau, édition ${edition})`);
    zipBuf = readFileSync(opts.fixturePath);
  } else {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    console.log("[sync:streets] résolution de l'actif via le catalogue STAC swisstopo...");
    const asset = await resolveAsset(fetchImpl);
    edition = asset.edition;
    console.log(`[sync:streets] téléchargement (édition ${edition}) : ${asset.href}`);
    zipBuf = await downloadZip(fetchImpl, asset.href);
  }

  // Défense en profondeur, même si une fixture de test ne l'atteint jamais en pratique.
  if (zipBuf.length > MAX_ZIP_BYTES) {
    throw new Error(`ZIP trop volumineux (${zipBuf.length} octets > ${MAX_ZIP_BYTES})`);
  }

  const csvBuf = await extractCsvFromZip(zipBuf, SWISSTOPO_STREETS_CSV_BASENAME);
  const rawRows = parseOfficialCsv(csvBuf);
  validateEncoding(csvBuf, rawRows);
  const { rows: swissRows, excluded } = partitionLiechtenstein(rawRows);
  const realOfficial = filterRealOfficial(swissRows);
  validateRows(realOfficial, minRows);
  const rows = dedupeRows(sortRows(reduceRows(realOfficial)));

  const previousRowCount = readPreviousRowCount(outputPath);
  if (previousRowCount !== null && rows.length < previousRowCount * (1 - maxDropRatio)) {
    throw new Error(
      `Baisse de plus de ${(maxDropRatio * 100).toFixed(0)} % du nombre de lignes par rapport au fichier précédent ` +
        `(${previousRowCount} → ${rows.length}) : fichier NON remplacé`,
    );
  }

  const csv = toCsv(rows);
  // Déterministe : `zlib.gzipSync` n'écrit ni nom de fichier ni date (contrairement à un `gzip`
  // en ligne de commande) — deux générations successives du même CSV donnent les mêmes octets,
  // vérifié par `tests/scripts/sync-streets.test.ts`.
  const gz = gzipSync(Buffer.from(csv, "utf8"), { level: 9 });
  const meta: StreetsMeta = { edition, source: SWISSTOPO_STREETS_STAC_ITEMS_URL, rows: rows.length };
  const metaJson = JSON.stringify(meta, null, 2) + "\n";

  const previousGz = existsSync(outputPath) ? readFileSync(outputPath) : null;
  const previousMeta = existsSync(metaPath) ? readFileSync(metaPath, "utf8") : null;
  const changed = previousGz === null || !previousGz.equals(gz) || previousMeta !== metaJson;

  if (changed) {
    writeAtomic(outputPath, gz);
    writeAtomic(metaPath, metaJson);
    const note = excluded > 0 ? ` (${excluded} commune(s) du Liechtenstein exclues)` : "";
    console.log(`[sync:streets] écrit ${rows.length} lignes (édition ${edition}) → ${outputPath}${note}`);
  } else {
    console.log(`[sync:streets] aucun changement (${rows.length} lignes, édition ${edition}, fichiers déjà à jour)`);
  }

  return { rowCount: rows.length, excludedLiechtenstein: excluded, previousRowCount, outputPath, metaPath, edition, changed };
}

async function main(): Promise<void> {
  const { fixturePath, edition } = parseArgs(process.argv.slice(2));
  const result = await syncStreets({ fixturePath, edition });
  console.log(`[sync:streets] terminé : ${JSON.stringify(result)}`);
}

// Détection robuste du module principal (chemins avec espaces ou caractères spéciaux,
// Windows), au lieu de la comparaison littérale `file://${process.argv[1]}` (même motif que
// `sync-localities.ts`).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error("[sync:streets] ERREUR :", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
