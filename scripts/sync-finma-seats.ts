#!/usr/bin/env tsx
/**
 * Siège exact des établissements FINMA par IDE (combinaison FINMA × registre du commerce) —
 * tâche osd.donnees, tâche B4 du plan `2026-10-06-prospection-et-api.md` (ajoutée à 23 h).
 *
 * Pourquoi : la ville du registre FINMA (`finma_registry.csv`, colonne `city`) est une
 * LOCALITÉ POSTALE, qui peut déborder sur des communes voisines (voir
 * `src/lib/commune-profile.ts`, `entities_with_city_named_like_commune`). Seul le registre du
 * commerce (LINDAS, graphe Zefix de l'OFRC) donne la commune du SIÈGE enregistré.
 *
 * 1. Lit les IDE candidats depuis le fichier EMBARQUÉ `src/mcp/data/finma_registry.csv`
 *    (colonne `uid`) — jamais le catalogue de production : plus simple, déterministe, aucun
 *    appel réseau supplémentaire pour cette seule liste. TOUTES les catégories d'autorisation
 *    FINMA entrent dans la requête LINDAS, `entity_type` n'est JAMAIS un filtre ici : corrigé le
 *    07.10.2026 après relecture de Claude-Alain — l'ancienne exclusion préalable de
 *    `asset_manager_individual` (autorisations « Portfolio manager » et « Trustee ») reposait
 *    sur une erreur de lecture du registre : 1 519 des 1 585 lignes de cette catégorie sont des
 *    AG/SA/GmbH/Sàrl (personnes MORALES), pas des personnes physiques ; les exclure avant même
 *    d'interroger LINDAS laissait plus de la moitié des lignes sans siège et faussait les
 *    textes publics. SEULE porte contre une personne physique : la liste blanche des formes
 *    juridiques de personnes morales (`ADDRESS_AND_PURPOSE_FORM_CODES`,
 *    `src/mcp/company/check.ts`), appliquée APRÈS la réponse LINDAS (étape 3 ci-dessous) — une
 *    entreprise individuelle (forme 0101), une société en nom collectif (0103), une société en
 *    commandite (0104) ou toute forme hors liste reste exclue à cette étape, quelle que soit sa
 *    catégorie d'autorisation FINMA.
 *    Exclus seulement :
 *    - les IDE invalides ou vides (`parseUid`, chiffre de contrôle modulo 11).
 *    - les doublons (plusieurs lignes/autorisations pour le même IDE) : un seul candidat par IDE.
 * 2. Interroge LINDAS (`register.ld.admin.ch/query`, graphe Zefix, MÊME requête que
 *    `etl/finma/ingest-zefix.ts`/`src/mcp/company/lindas.ts` pour la commune et la forme
 *    juridique) en LOTS d'IDE compacts (`CHE`+9 chiffres, validés — jamais une chaîne brute
 *    insérée dans la requête) : au plus `batchSize` (500) IDE par lot, au plus `maxBatches`
 *    (10) lots, `delayMs` (2 s) entre deux lots, `timeoutMs` (60 s) par lot, User-Agent
 *    `OpenSwissData finma-seats`. AUCUNE retentative : un lot en échec (HTTP ≠ 200, délai
 *    dépassé, JSON illisible ou forme inattendue) fait échouer tout le script AVANT toute
 *    écriture — le fichier précédent reste intact (jamais une réponse partielle acceptée).
 * 3. Pour chaque IDE candidat, garde le siège SEULEMENT s'il a EXACTEMENT une commune ET
 *    EXACTEMENT une forme juridique dans la réponse LINDAS (plusieurs valeurs distinctes =
 *    ambiguë, jamais devinée) ET que cette forme figure dans la liste blanche des personnes
 *    morales. Sinon : non trouvé/incomplet, ambigu, ou forme hors liste blanche (compteurs
 *    séparés dans le résultat, jamais mélangés).
 *
 * Sortie `src/mcp/data/finma_seats.csv` (`uid,municipality_bfs_id`, trié par IDE) +
 * `finma_seats.meta.json` (`{ edition, source, rows }`, `source` = `LINDAS_ENDPOINT` —
 * identique à `src/mcp/company/lindas.ts`, jamais une URL recopiée séparément), lus par
 * `src/mcp/data-loader.ts` (`getFinmaSeats()`). Écriture ATOMIQUE pour les deux fichiers,
 * SEULEMENT après la réussite complète de tous les contrôles (jamais un fichier partiel).
 *
 * Contrôles avant toute écriture : au moins `minRows` lignes retenues (800 par défaut), baisse
 * de plus de `maxDropRatio` (5 % par défaut) par rapport au fichier précédent, numéro OFS de
 * commune entier (`^\d+$`).
 *
 * Usage :
 *   tsx scripts/sync-finma-seats.ts                                        — requêtes LINDAS réelles
 *   tsx scripts/sync-finma-seats.ts --fixture <json> --edition AAAA-MM-JJ  — réponse LINDAS enregistrée, sans réseau (tests, seed)
 *
 * `--edition` est OBLIGATOIRE en mode `--fixture` (même règle que `sync-streets.ts`/
 * `sync-localities.ts`) : sans appel réel, rien ne permet de déduire la date. En mode réseau,
 * l'édition est la date du jour UTC (`now()`, injectable — Global Constraint « horloges »).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { LINDAS_ENDPOINT, LINDAS_ZEFIX_GRAPH } from "../src/mcp/company/lindas.js";
import { ADDRESS_AND_PURPOSE_FORM_CODES } from "../src/mcp/company/check.js";
import { parseUid } from "../src/mcp/company/uid.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_PATH = join(__dirname, "..", "src", "mcp", "data", "finma_registry.csv");
const DEFAULT_OUTPUT_PATH = join(__dirname, "..", "src", "mcp", "data", "finma_seats.csv");
const DEFAULT_MIN_ROWS = 800; // 2 533 sièges au 07.10.2026 (toutes catégories FINMA) : marge large ; la baisse ≤ 5 % reste le vrai garde-fou
const DEFAULT_MAX_DROP_RATIO = 0.05;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES = 10;
const DEFAULT_DELAY_MS = 2000;
const DEFAULT_TIMEOUT_MS = 60_000;
const USER_AGENT = "OpenSwissData finma-seats";

const EDITION_RE = /^\d{4}-\d{2}-\d{2}$/;
const MUNICIPALITY_ID_RE = /^\d+$/;
const LEGAL_FORM_CODE_RE = /^\d{4}$/;
const LEGAL_FORM_URI_CODE_RE = /\/legalforms\/(\d{4})$/;
const OUTPUT_COLUMNS = ["uid", "municipality_bfs_id"] as const;

export interface FinmaSeatRow {
  uid: string;
  municipality_bfs_id: string;
}

export interface FinmaSeatsMeta {
  edition: string;
  source: string;
  rows: number;
}

export interface SyncFinmaSeatsOptions {
  /** Défaut : `src/mcp/data/finma_registry.csv` (fichier embarqué). */
  registryPath?: string;
  /** Défaut : `src/mcp/data/finma_seats.csv`. */
  outputPath?: string;
  /** Défaut : dossier de `outputPath` + `finma_seats.meta.json`. */
  metaPath?: string;
  /** Chemin local d'un JSON au format réponse SPARQL (tests, seed) : aucun appel réseau si présent. */
  fixturePath?: string;
  /** OBLIGATOIRE quand `fixturePath` est fourni (format "AAAA-MM-JJ"). Ignoré en mode réseau. */
  edition?: string;
  /** Défaut : `globalThis.fetch`. Lu seulement quand `fixturePath` est absent. */
  fetchImpl?: typeof fetch;
  /** Défaut : une vraie pause. Injectable pour les tests (jamais de délai réel en test). */
  sleep?: (ms: number) => Promise<void>;
  /** Défaut : `Date.now`. Horloge pour l'édition en mode réseau (Global Constraint « horloges »). */
  now?: () => number;
  /** Défaut : 800. */
  minRows?: number;
  /** Défaut : 0.05 (5 %). */
  maxDropRatio?: number;
  /** Défaut : 500 IDE par requête SPARQL. */
  batchSize?: number;
  /** Défaut : 10 requêtes au plus. */
  maxBatches?: number;
  /** Défaut : 2000 ms entre deux lots (jamais après le dernier). */
  delayMs?: number;
  /** Défaut : 60000 ms par requête. */
  timeoutMs?: number;
}

export interface SyncFinmaSeatsResult {
  rowCount: number;
  queriedUids: number;
  excludedInvalidUid: number;
  notFoundOrIncomplete: number;
  ambiguous: number;
  excludedLegalForm: number;
  previousRowCount: number | null;
  outputPath: string;
  metaPath: string;
  edition: string;
  changed: boolean;
  batches: number;
}

/** Deux arguments reconnus : `--fixture <chemin>` et `--edition <AAAA-MM-JJ>` (identique aux
 *  autres scripts `sync-*`). */
export function parseArgs(argv: string[]): { fixturePath?: string; edition?: string } {
  const out: { fixturePath?: string; edition?: string } = {};
  const fixtureIdx = argv.indexOf("--fixture");
  if (fixtureIdx !== -1) {
    const value = argv[fixtureIdx + 1];
    if (!value) throw new Error("--fixture nécessite un chemin de fichier JSON");
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

/** IDE candidats : TOUTES les catégories d'autorisation FINMA (`entity_type` n'est jamais lu —
 *  voir le commentaire d'en-tête du fichier, correction du 07.10.2026). Exclut seulement les IDE
 *  invalides ou vides, et dédoublonne (plusieurs autorisations pour le même IDE = un seul
 *  candidat). Rend une table IDE compact (VALUES SPARQL) → IDE canonique (sortie
 *  `finma_seats.csv`). */
export function candidateUids(rows: ReadonlyArray<{ uid: string }>): {
  compactToCanonical: Map<string, string>;
  excludedInvalid: number;
} {
  const compactToCanonical = new Map<string, string>();
  let excludedInvalid = 0;
  for (const row of rows) {
    if (!row.uid) {
      excludedInvalid += 1;
      continue;
    }
    const parsed = parseUid(row.uid);
    if (!parsed.ok) {
      excludedInvalid += 1;
      continue;
    }
    compactToCanonical.set(parsed.compact, parsed.uid);
  }
  return { compactToCanonical, excludedInvalid };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

interface SparqlResponseShape {
  results: { bindings: unknown[] };
}

/** Même garde que `src/mcp/company/lindas.ts` (`isSparqlResponse`) : seule la forme de haut
 *  niveau est vérifiée ici, chaque ligne est lue de façon défensive ensuite. */
function isSparqlResponse(body: unknown): body is SparqlResponseShape {
  if (!isPlainObject(body)) return false;
  const results = (body as { results?: unknown }).results;
  if (!isPlainObject(results)) return false;
  return Array.isArray((results as { bindings?: unknown }).bindings);
}

function bindingValue(row: Record<string, unknown>, field: string): string | undefined {
  const binding = row[field];
  if (!isPlainObject(binding)) return undefined;
  const value = (binding as { value?: unknown }).value;
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Même repli que `src/mcp/company/lindas.ts` (`legalFormCodeFromUri`/`validLegalFormCode`) :
 *  le code à quatre chiffres lu directement, sinon le suffixe de l'URI eCH-0097. */
function resolveLegalFormCode(rawCode: string | undefined, formUri: string | undefined): string | null {
  if (rawCode && LEGAL_FORM_CODE_RE.test(rawCode)) return rawCode;
  if (formUri) {
    const m = LEGAL_FORM_URI_CODE_RE.exec(formUri);
    if (m) return m[1];
  }
  return null;
}

interface SeatCandidate {
  municipalities: Set<string>;
  forms: Set<string>;
}

/** Accumule les liaisons SPARQL d'UN lot (réseau) ou de la fixture entière dans `acc`, limité
 *  aux IDE réellement demandés (`wanted`) : une ligne pour un IDE hors de cet ensemble est
 *  ignorée (ne devrait jamais arriver avec une vraie requête VALUES, mais une fixture de test
 *  ne doit jamais polluer le résultat d'un autre test). */
export function accumulateBindings(rawRows: readonly unknown[], wanted: ReadonlySet<string>, acc: Map<string, SeatCandidate>): void {
  for (const raw of rawRows) {
    if (!isPlainObject(raw)) continue;
    const uidValue = bindingValue(raw, "uidValue");
    if (!uidValue || !wanted.has(uidValue)) continue;
    let entry = acc.get(uidValue);
    if (!entry) {
      entry = { municipalities: new Set(), forms: new Set() };
      acc.set(uidValue, entry);
    }
    const municipalityId = bindingValue(raw, "municipalityId");
    if (municipalityId && MUNICIPALITY_ID_RE.test(municipalityId)) entry.municipalities.add(municipalityId);
    const formCode = resolveLegalFormCode(bindingValue(raw, "legalFormCode"), bindingValue(raw, "legalForm"));
    if (formCode) entry.forms.add(formCode);
  }
}

/** Résout chaque IDE candidat : gardé seulement avec EXACTEMENT une commune ET EXACTEMENT une
 *  forme juridique, cette forme figurant dans la liste blanche des personnes morales
 *  (`ADDRESS_AND_PURPOSE_FORM_CODES`) — SEULE porte contre une personne physique (entreprise
 *  individuelle 0101, société en nom collectif 0103, société en commandite 0104, ou toute forme
 *  hors liste), quelle que soit la catégorie d'autorisation FINMA d'origine du candidat. */
export function finalizeSeats(
  acc: ReadonlyMap<string, SeatCandidate>,
  compactToCanonical: ReadonlyMap<string, string>,
): { rows: FinmaSeatRow[]; notFoundOrIncomplete: number; ambiguous: number; excludedLegalForm: number } {
  const rows: FinmaSeatRow[] = [];
  let notFoundOrIncomplete = 0;
  let ambiguous = 0;
  let excludedLegalForm = 0;
  for (const [compactUid, canonicalUid] of compactToCanonical) {
    const entry = acc.get(compactUid);
    if (!entry || entry.municipalities.size === 0 || entry.forms.size === 0) {
      notFoundOrIncomplete += 1;
      continue;
    }
    if (entry.municipalities.size > 1 || entry.forms.size > 1) {
      ambiguous += 1;
      continue;
    }
    const [municipalityId] = entry.municipalities;
    const [formCode] = entry.forms;
    if (!ADDRESS_AND_PURPOSE_FORM_CODES.has(formCode)) {
      excludedLegalForm += 1;
      continue;
    }
    rows.push({ uid: canonicalUid, municipality_bfs_id: municipalityId });
  }
  return { rows, notFoundOrIncomplete, ambiguous, excludedLegalForm };
}

export function toCsv(rows: readonly FinmaSeatRow[]): string {
  return stringify(rows, { header: true, columns: [...OUTPUT_COLUMNS], record_delimiter: "\n" });
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Même requête que `src/mcp/company/lindas.ts` pour la commune et la forme juridique (second
 *  bloc HORS du graphe Zefix : vérifié en direct le 06.10.2026, ces libellés/identifiants
 *  vivent dans le graphe par défaut) — en lot, sans les champs de nom (jamais de nom en mémoire
 *  ni dans un journal de ce script). */
function buildBatchQuery(compactUids: readonly string[]): string {
  const valuesClause = compactUids.map((u) => `"${u}"`).join(" ");
  return `PREFIX schema: <http://schema.org/>
SELECT ?uidValue ?legalForm ?legalFormCode ?municipalityId WHERE {
  GRAPH <${LINDAS_ZEFIX_GRAPH}> {
    VALUES ?uidValue { ${valuesClause} }
    ?uidNode schema:name "CompanyUID" ;
             schema:value ?uidValue .
    ?company schema:identifier ?uidNode .
    OPTIONAL { ?company schema:additionalType ?legalForm }
    OPTIONAL { ?company <https://schema.ld.admin.ch/municipality> ?municipality }
  }
  OPTIONAL { ?legalForm schema:identifier ?legalFormCode }
  OPTIONAL { ?municipality schema:identifier ?municipalityId }
}`;
}

async function fetchBatch(fetchImpl: typeof fetch, compactUids: readonly string[], timeoutMs: number): Promise<SparqlResponseShape> {
  let res: Response;
  try {
    res = await fetchImpl(LINDAS_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/sparql-query",
        accept: "application/sparql-results+json",
        "user-agent": USER_AGENT,
      },
      body: buildBatchQuery(compactUids),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`Requête LINDAS impossible ou délai dépassé : ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status !== 200) {
    throw new Error(`LINDAS a répondu HTTP ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("Réponse LINDAS illisible (JSON invalide)");
  }
  if (!isSparqlResponse(body)) {
    throw new Error("Forme de réponse LINDAS inattendue");
  }
  return body;
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

export async function syncFinmaSeats(opts: SyncFinmaSeatsOptions = {}): Promise<SyncFinmaSeatsResult> {
  const registryPath = opts.registryPath ?? DEFAULT_REGISTRY_PATH;
  const outputPath = opts.outputPath ?? DEFAULT_OUTPUT_PATH;
  const metaPath = opts.metaPath ?? join(dirname(outputPath), "finma_seats.meta.json");
  const minRows = opts.minRows ?? DEFAULT_MIN_ROWS;
  const maxDropRatio = opts.maxDropRatio ?? DEFAULT_MAX_DROP_RATIO;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = opts.maxBatches ?? DEFAULT_MAX_BATCHES;
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const registryRaw = readFileSync(registryPath, "utf8");
  const registryRows = parse(registryRaw, { columns: true, skip_empty_lines: true, relax_quotes: true }) as Array<{ uid: string }>;
  const { compactToCanonical, excludedInvalid } = candidateUids(registryRows);
  const wanted = new Set(compactToCanonical.keys());
  const acc = new Map<string, SeatCandidate>();

  let edition: string;
  let batches = 0;

  if (opts.fixturePath) {
    if (!opts.edition) throw new Error("--edition est requis en mode --fixture (aucune date déductible sans appel réseau)");
    if (!EDITION_RE.test(opts.edition)) throw new Error(`--edition invalide : "${opts.edition}" (attendu AAAA-MM-JJ)`);
    edition = opts.edition;
    console.log(`[sync:finma-seats] mode fixture : ${opts.fixturePath} (aucun réseau, édition ${edition})`);
    const body = JSON.parse(readFileSync(opts.fixturePath, "utf8")) as unknown;
    if (!isSparqlResponse(body)) throw new Error("Fixture : forme de réponse SPARQL inattendue");
    accumulateBindings(body.results.bindings, wanted, acc);
  } else {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const allCompact = [...wanted];
    if (allCompact.length > batchSize * maxBatches) {
      throw new Error(
        `Trop d'IDE candidats (${allCompact.length}) pour ${maxBatches} lots de ${batchSize} : plafond de requêtes dépassé`,
      );
    }
    edition = todayUtc(now());
    for (let i = 0; i < allCompact.length; i += batchSize) {
      const batch = allCompact.slice(i, i + batchSize);
      console.log(`[sync:finma-seats] lot ${batches + 1} (${batch.length} IDE)...`);
      const body = await fetchBatch(fetchImpl, batch, timeoutMs);
      accumulateBindings(body.results.bindings, wanted, acc);
      batches += 1;
      const isLast = i + batchSize >= allCompact.length;
      if (!isLast) await sleep(delayMs);
    }
  }

  const { rows, notFoundOrIncomplete, ambiguous, excludedLegalForm } = finalizeSeats(acc, compactToCanonical);
  const sorted = [...rows].sort((a, b) => cmp(a.uid, b.uid));

  if (sorted.length < minRows) {
    throw new Error(
      `Trop peu de sièges retenus : ${sorted.length} lignes (seuil ${minRows}) — ${wanted.size} IDE interrogés, ` +
        `${notFoundOrIncomplete} non trouvés/incomplets, ${ambiguous} ambigus, ${excludedLegalForm} forme hors liste blanche`,
    );
  }

  const previousRowCount = readPreviousRowCount(outputPath);
  if (previousRowCount !== null && sorted.length < previousRowCount * (1 - maxDropRatio)) {
    throw new Error(
      `Baisse de plus de ${(maxDropRatio * 100).toFixed(0)} % du nombre de lignes par rapport au fichier précédent ` +
        `(${previousRowCount} → ${sorted.length}) : fichier NON remplacé`,
    );
  }

  const csv = toCsv(sorted);
  const meta: FinmaSeatsMeta = { edition, source: LINDAS_ENDPOINT, rows: sorted.length };
  const metaJson = JSON.stringify(meta, null, 2) + "\n";

  const previousCsv = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : null;
  const previousMeta = existsSync(metaPath) ? readFileSync(metaPath, "utf8") : null;
  const changed = previousCsv !== csv || previousMeta !== metaJson;

  if (changed) {
    writeAtomic(outputPath, csv);
    writeAtomic(metaPath, metaJson);
    console.log(`[sync:finma-seats] écrit ${sorted.length} lignes (édition ${edition}) → ${outputPath}`);
  } else {
    console.log(`[sync:finma-seats] aucun changement (${sorted.length} lignes, édition ${edition})`);
  }

  return {
    rowCount: sorted.length,
    queriedUids: wanted.size,
    excludedInvalidUid: excludedInvalid,
    notFoundOrIncomplete,
    ambiguous,
    excludedLegalForm,
    previousRowCount,
    outputPath,
    metaPath,
    edition,
    changed,
    batches,
  };
}

async function main(): Promise<void> {
  const { fixturePath, edition } = parseArgs(process.argv.slice(2));
  const result = await syncFinmaSeats({ fixturePath, edition });
  console.log(`[sync:finma-seats] terminé : ${JSON.stringify(result)}`);
}

// Détection robuste du module principal (chemins avec espaces ou caractères spéciaux, Windows),
// même motif que `sync-streets.ts`/`sync-localities.ts`.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error("[sync:finma-seats] ERREUR :", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
