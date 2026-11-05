/**
 * Des agrégats au document réduit, et les contrôles qui arrêtent avant toute écriture.
 * Étage lu : agrégats en mémoire (`aggregate.ts`). Étage écrit : un fichier gzip local, que `collect.ts`
 * envoie dans le bucket PRIVÉ seulement si tout passe.
 *
 * Format : une première ligne JSON (provenance, totaux par année, concordance), puis une ligne par
 * année × tarif × pays, triée, séparée par des points-virgules. Une cellule vide veut dire « absent de la
 * source », jamais zéro. Aucun libellé, aucun texte libre : le contrôle de relecture relit le document
 * FINI, pas l'intention du code.
 */
import { createReadStream, createWriteStream, statSync } from "node:fs";
import { once } from "node:events";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { createGunzip, createGzip } from "node:zlib";
import { decodeKey, MEASURES, type DouaneAggregator, type FileLedger, type YearLedger } from "./aggregate.js";
import { DOUANE_SCHEMA, type DouaneFileKind } from "./sources.js";

export class DouaneControlError extends Error {
  constructor(reason: string) {
    super(`Collecte de la douane arrêtée (${reason})`);
    this.name = "DouaneControlError";
  }
}

/**
 * Repères officiels, indépendants de nos fichiers. Quand un nouveau chiffre annuel paraît, on l'ajoute ici
 * à la main, après relecture.
 *
 * Valeur du commerce, total conjoncturel : communiqué de l'OFDF du 29.01.2026 (bazg.admin.ch).
 * Mesure du 05.11.2026 : importations +0,06 %, exportations -0,06 %.
 */
export const CONJUNCTURAL_BENCHMARKS: Readonly<Record<string, { imports: number; exports: number }>> = {
  "2025": { imports: 232_700_000_000, exports: 287_000_000_000 },
};
export const CONJUNCTURAL_TOLERANCE = 0.01;

/**
 * Droits de douane au Compte d'État 2025, tome 1A (Administration fédérale des finances), en francs.
 * Comptabilité et statistique ne couvrent pas exactement la même chose : la statistique dépasse le compte
 * de 3,8 % en 2024 et de 6,1 % en 2025, écart mesuré et NON expliqué. La bande refuse la lecture naïve
 * (neuf fois le compte), pas un écart de cet ordre.
 */
export const DUTY_BENCHMARKS: Readonly<Record<string, number>> = {
  "2024": 738_000_000,
  "2025": 778_000_000,
};
export const DUTY_RATIO_MIN = 0.95;
export const DUTY_RATIO_MAX = 1.2;
/** Garde-fou sans repère, pour les années à venir. Mesure du 05.11.2026 : de 0,77 à 1,41 milliard par année close. */
export const DUTY_YEAR_MIN = 400_000_000;
export const DUTY_YEAR_MAX = 2_000_000_000;

/** Les deux fichiers d'importation, même éditeur et même jour, donnent la même valeur : écart nul mesuré le 05.11.2026. */
export const CROSS_FILE_TOLERANCE = 0.0001;

/** Lignes mesurées le 05.11.2026 : recettes 29,8 millions, importations 29,2, exportations 34,1. */
export const MIN_LINES: Readonly<Record<DouaneFileKind, number>> = { duties: 25_000_000, imports: 25_000_000, exports: 28_000_000 };
export const FIRST_YEARS: Readonly<Record<DouaneFileKind, number>> = { duties: 2000, imports: 1988, exports: 1988 };
export const MAX_BLANK_VALUE_RATIO = 0.001;
/** Mensuel : deux mois et demi sans mise à jour, on suppose une source figée. */
export const MAX_SOURCE_AGE_DAYS = 75;
/** Une année close ne bouge presque plus ; au-delà, on regarde avant de servir. */
export const MAX_CLOSED_YEAR_DRIFT = 0.01;
export const MAX_LINES_DROP = 0.03;
/** `collect.ts` charge le document en mémoire pour l'envoyer. */
export const MAX_DOCUMENT_GZIP_BYTES = 400_000_000;

export interface DouaneSourceProof {
  id: string;
  kind: DouaneFileKind | "concordance";
  url: string;
  dataset_url: string;
  licence: "terms_by_ask";
  sha256: string;
  bytes: number;
  etag: string | null;
  last_modified: string | null;
  /** `Date_actualisation` du fichier. */
  updated_at: string;
}

export interface DouaneMeta {
  schema: typeof DOUANE_SCHEMA;
  notice: string;
  collected_at: string;
  columns: string[];
  row_count: number;
  sources: DouaneSourceProof[];
  ledgers: Record<DouaneFileKind, Omit<FileLedger, "updated_at">>;
  /** Tarif → années où il n'entre pas dans le total conjoncturel de l'OFDF (or et assimilés). */
  non_conjunctural: Record<"imports" | "exports", Record<string, number[]>>;
  /** [CPA à 6 chiffres, tarif à 8 chiffres, début, fin ou null], tels que l'OFDF les publie. */
  concordance_cpa6: [string, string, string, string | null][];
}

const NOTICE = "Source : Office fédéral de la douane et de la sécurité des frontières (OFDF), commerce extérieur, opendata.swiss, licence affichée terms_by_ask. Aucun accord demandé ni obtenu ; service gratuit, rien de vendu ; retrait sous 48 heures sur demande de l'éditeur.";

function byTariffYears(map: Map<string, Set<number>>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const tn8 of [...map.keys()].sort()) out[tn8] = [...(map.get(tn8) as Set<number>)].sort((a, b) => a - b);
  return out;
}

function withoutUpdatedAt(ledger: FileLedger): Omit<FileLedger, "updated_at"> {
  const { updated_at: _ignored, ...rest } = ledger;
  return rest;
}

export function buildMeta(input: {
  aggregator: DouaneAggregator;
  ledgers: Record<DouaneFileKind, FileLedger>;
  sources: DouaneSourceProof[];
  concordance: DouaneMeta["concordance_cpa6"];
  collectedAt: string;
}): DouaneMeta {
  return {
    schema: DOUANE_SCHEMA,
    notice: NOTICE,
    collected_at: input.collectedAt,
    columns: ["tn8", "country", "year", ...MEASURES],
    row_count: input.aggregator.rows,
    sources: input.sources,
    ledgers: {
      duties: withoutUpdatedAt(input.ledgers.duties),
      imports: withoutUpdatedAt(input.ledgers.imports),
      exports: withoutUpdatedAt(input.ledgers.exports),
    },
    non_conjunctural: {
      imports: byTariffYears(input.aggregator.nonConjunctural.imports),
      exports: byTariffYears(input.aggregator.nonConjunctural.exports),
    },
    concordance_cpa6: input.concordance,
  };
}

const CONCORDANCE_HEADER = "cpa6;tn8;validfrom;validto;update";
const CONCORDANCE_LINE = /^([0-9A-Z]{6});(\d{4})\.(\d{4});(\d{4}-\d{2}-\d{2})T[^;]+;(\d{4}-\d{2}-\d{2})T[^;]+;(\d{4}-\d{2}-\d{2})$/;
export const MIN_CONCORDANCE_ROWS = 10_000;

/** Table de passage CPA ↔ tarif. Une ligne hors de la forme attendue arrête la collecte. */
export function parseConcordance(csv: string): { rows: DouaneMeta["concordance_cpa6"]; updatedAt: string } {
  const lines = csv.split("\n").filter((line) => line !== "");
  if (lines[0] !== CONCORDANCE_HEADER) throw new DouaneControlError("colonnes de la concordance inattendues");
  const rows: DouaneMeta["concordance_cpa6"] = [];
  let updatedAt = "";
  for (const line of lines.slice(1)) {
    const m = CONCORDANCE_LINE.exec(line);
    if (!m) throw new DouaneControlError("ligne de concordance illisible");
    rows.push([m[1], m[2] + m[3], m[4], m[5].startsWith("9999-") ? null : m[5]]);
    if (m[6] > updatedAt) updatedAt = m[6];
  }
  return { rows, updatedAt };
}

/** Écrit le document et rend ses tailles. Rien n'est gardé en mémoire : 400 Mo de texte n'y tiendraient pas sans risque. */
export async function writeDocument(meta: DouaneMeta, aggregator: DouaneAggregator, path: string): Promise<{ raw_bytes: number; gzip_bytes: number }> {
  const gzip = createGzip({ level: 9 });
  const out = createWriteStream(path);
  gzip.pipe(out);
  let rawBytes = 0;
  const push = async (text: string): Promise<void> => {
    rawBytes += Buffer.byteLength(text);
    if (!gzip.write(text)) await once(gzip, "drain");
  };
  await push(`${JSON.stringify(meta)}\n`);
  let batch = "";
  for (const key of aggregator.sortedKeys()) {
    const { tn8, country, year } = decodeKey(key);
    let row = `${tn8};${country};${year}`;
    for (const value of aggregator.valuesOf(key)) row += Number.isNaN(value) ? ";" : `;${value}`;
    batch += `${row}\n`;
    if (batch.length > 1_000_000) {
      await push(batch);
      batch = "";
    }
  }
  if (batch) await push(batch);
  gzip.end();
  await finished(out);
  return { raw_bytes: rawBytes, gzip_bytes: statSync(path).size };
}

const ROW = /^(\d{8});([A-Z]{2});(\d{4});(\d*);(\d*);(\d*);(\d*);(\d*)$/;

interface YearSums {
  import_value_chf: number;
  import_kg: number;
  duties_chf: number;
  export_value_chf: number;
  export_kg: number;
  import_conjunctural: number;
  export_conjunctural: number;
}

const zeroSums = (): YearSums => ({ import_value_chf: 0, import_kg: 0, duties_chf: 0, export_value_chf: 0, export_kg: 0, import_conjunctural: 0, export_conjunctural: 0 });

/**
 * Relit le document écrit, du disque, et le compare au grand livre tenu pendant la lecture : même nombre
 * de lignes, mêmes totaux au franc près, chaque ligne de la forme attendue, tri strict.
 */
export async function verifyDocument(path: string, meta: DouaneMeta): Promise<void> {
  const decoder = new StringDecoder("utf8");
  const gunzip = createReadStream(path).pipe(createGunzip());
  const sums = new Map<string, YearSums>();
  const nonConj = {
    imports: new Set(Object.entries(meta.non_conjunctural.imports).flatMap(([tn8, years]) => years.map((y) => `${tn8}${y}`))),
    exports: new Set(Object.entries(meta.non_conjunctural.exports).flatMap(([tn8, years]) => years.map((y) => `${tn8}${y}`))),
  };
  let carry = "";
  let first = true;
  let rows = 0;
  let previousOrder = "";

  const consume = (line: string): void => {
    if (first) {
      if (line !== JSON.stringify(meta)) throw new DouaneControlError("en-tête du document différent");
      first = false;
      return;
    }
    const m = ROW.exec(line);
    if (!m) throw new DouaneControlError("ligne du document hors de la forme attendue");
    const order = `${m[1]}${m[2]}${m[3]}`;
    if (order <= previousOrder) throw new DouaneControlError("document mal trié ou en double");
    previousOrder = order;
    rows++;
    let year = sums.get(m[3]);
    if (!year) sums.set(m[3], (year = zeroSums()));
    const importValue = Number(m[4] || 0);
    const exportValue = Number(m[7] || 0);
    year.import_value_chf += importValue;
    year.import_kg += Number(m[5] || 0);
    year.duties_chf += Number(m[6] || 0);
    year.export_value_chf += exportValue;
    year.export_kg += Number(m[8] || 0);
    if (!nonConj.imports.has(`${m[1]}${m[3]}`)) year.import_conjunctural += importValue;
    if (!nonConj.exports.has(`${m[1]}${m[3]}`)) year.export_conjunctural += exportValue;
  };

  for await (const chunk of gunzip as AsyncIterable<Buffer>) {
    const text = carry + decoder.write(chunk);
    let start = 0;
    let end = text.indexOf("\n", start);
    while (end !== -1) {
      consume(text.slice(start, end));
      start = end + 1;
      end = text.indexOf("\n", start);
    }
    carry = text.slice(start);
  }
  if (carry + decoder.end() !== "") throw new DouaneControlError("document tronqué");
  if (rows !== meta.row_count) throw new DouaneControlError("nombre de lignes du document différent");

  const expect = (actual: number, wanted: number, what: string): void => {
    if (actual !== wanted) throw new DouaneControlError(`total du document différent du fichier lu (${what})`);
  };
  const years = new Set([...Object.keys(meta.ledgers.imports.by_year), ...Object.keys(meta.ledgers.exports.by_year), ...Object.keys(meta.ledgers.duties.by_year)]);
  for (const key of years) {
    const year = sums.get(key) ?? zeroSums();
    const imports = meta.ledgers.imports.by_year[key];
    const exports = meta.ledgers.exports.by_year[key];
    const duties = meta.ledgers.duties.by_year[key];
    expect(year.import_value_chf, imports?.value_chf ?? 0, "valeur importée");
    expect(year.import_kg, imports?.kg ?? 0, "poids importé");
    expect(year.duties_chf, duties?.duties_chf ?? 0, "droits");
    expect(year.export_value_chf, exports?.value_chf ?? 0, "valeur exportée");
    expect(year.export_kg, exports?.kg ?? 0, "poids exporté");
    expect(year.import_conjunctural, imports?.conjunctural_value_chf ?? 0, "valeur conjoncturelle importée");
    expect(year.export_conjunctural, exports?.conjunctural_value_chf ?? 0, "valeur conjoncturelle exportée");
  }
}

/** Lit la première ligne d'un document gzip sans décompresser le reste. `null` si elle est illisible. */
export async function readMetaFromGzip(bytes: Buffer): Promise<DouaneMeta | null> {
  const decoder = new StringDecoder("utf8");
  const gunzip = Readable.from([bytes]).pipe(createGunzip());
  let text = "";
  try {
    for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      text += decoder.write(chunk);
      const end = text.indexOf("\n");
      if (end !== -1) {
        gunzip.destroy();
        const meta = JSON.parse(text.slice(0, end)) as DouaneMeta;
        return meta.schema === DOUANE_SCHEMA ? meta : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function closedYears(ledger: Pick<FileLedger, "by_year">): [string, YearLedger][] {
  return Object.entries(ledger.by_year).filter(([, year]) => !year.provisional);
}

export interface ControlOptions {
  now: number;
  previous: DouaneMeta | null;
  acceptAnomaly: boolean;
  /** Pour les fichiers fictifs des tests ; `collect.ts` ne les remplace jamais. */
  floors?: { minLines: Readonly<Record<DouaneFileKind, number>>; firstYears: Readonly<Record<DouaneFileKind, number>>; minConcordanceRows: number };
  benchmarks?: { conjunctural: typeof CONJUNCTURAL_BENCHMARKS; duties: typeof DUTY_BENCHMARKS; dutyYearMin: number; dutyYearMax: number };
}

/** Contrôles avant écriture : forme, volume, totaux contre les repères, date de la source, version précédente. */
export function checkDocument(meta: DouaneMeta, updatedAt: Record<DouaneFileKind, string[]>, options: ControlOptions): void {
  const floors = options.floors ?? { minLines: MIN_LINES, firstYears: FIRST_YEARS, minConcordanceRows: MIN_CONCORDANCE_ROWS };
  const benchmarks = options.benchmarks ?? { conjunctural: CONJUNCTURAL_BENCHMARKS, duties: DUTY_BENCHMARKS, dutyYearMin: DUTY_YEAR_MIN, dutyYearMax: DUTY_YEAR_MAX };
  const kinds: DouaneFileKind[] = ["duties", "imports", "exports"];
  const nowYear = new Date(options.now).getUTCFullYear();

  // Forme et volume.
  for (const kind of kinds) {
    const ledger = meta.ledgers[kind];
    if (ledger.lines < floors.minLines[kind]) throw new DouaneControlError(`trop peu de lignes (${kind})`);
    if (ledger.lines_blank_value > ledger.lines * MAX_BLANK_VALUE_RATIO) throw new DouaneControlError(`trop de valeurs vides (${kind})`);
    if (updatedAt[kind].length !== 1) throw new DouaneControlError(`plusieurs dates de mise à jour dans un fichier (${kind})`);

    // Couverture : années contiguës, années closes complètes, seule la dernière peut être provisoire.
    const years = Object.keys(ledger.by_year).map(Number).sort((a, b) => a - b);
    if (years.length === 0 || years[0] > floors.firstYears[kind]) throw new DouaneControlError(`historique incomplet (${kind})`);
    const last = years[years.length - 1];
    if (last > nowYear) throw new DouaneControlError(`année dans le futur (${kind})`);
    if (last < nowYear - 1) throw new DouaneControlError(`dernière année trop ancienne (${kind})`);
    if (last - years[0] + 1 !== years.length) throw new DouaneControlError(`année manquante (${kind})`);
    for (const year of years) {
      const entry = ledger.by_year[String(year)];
      if (year !== last && entry.provisional) throw new DouaneControlError(`année ancienne encore provisoire (${kind})`);
      if (year !== last && entry.months !== 12) throw new DouaneControlError(`année close incomplète (${kind})`);
    }
  }
  if (meta.concordance_cpa6.length < floors.minConcordanceRows) throw new DouaneControlError("concordance trop courte");

  // Recoupement entre les deux fichiers d'importation, année par année.
  for (const [key, duties] of Object.entries(meta.ledgers.duties.by_year)) {
    const imports = meta.ledgers.imports.by_year[key];
    if (!imports) throw new DouaneControlError("année des recettes absente du commerce");
    if (Math.abs(duties.value_chf - imports.value_chf) > imports.value_chf * CROSS_FILE_TOLERANCE) {
      throw new DouaneControlError("valeur importée différente entre les deux fichiers");
    }
  }

  // Repères officiels.
  for (const [key, wanted] of Object.entries(benchmarks.conjunctural)) {
    const imports = meta.ledgers.imports.by_year[key]?.conjunctural_value_chf;
    const exports = meta.ledgers.exports.by_year[key]?.conjunctural_value_chf;
    if (imports === undefined || exports === undefined) throw new DouaneControlError("année du repère absente");
    if (Math.abs(imports / wanted.imports - 1) > CONJUNCTURAL_TOLERANCE) throw new DouaneControlError("total des importations loin du repère officiel");
    if (Math.abs(exports / wanted.exports - 1) > CONJUNCTURAL_TOLERANCE) throw new DouaneControlError("total des exportations loin du repère officiel");
  }
  for (const [key, wanted] of Object.entries(benchmarks.duties)) {
    const duties = meta.ledgers.duties.by_year[key]?.duties_chf;
    if (duties === undefined) throw new DouaneControlError("année du repère absente");
    const ratio = duties / wanted;
    if (ratio < DUTY_RATIO_MIN || ratio > DUTY_RATIO_MAX) throw new DouaneControlError("droits loin du Compte d'État");
  }
  for (const [, year] of closedYears(meta.ledgers.duties)) {
    const duties = year.duties_chf ?? 0;
    if (duties < benchmarks.dutyYearMin || duties > benchmarks.dutyYearMax) throw new DouaneControlError("droits annuels invraisemblables");
  }

  // Date de mise à jour de la source.
  const updatedDates = kinds.map((kind) => updatedAt[kind][0]);
  for (const text of updatedDates) {
    const time = Date.parse(text);
    if (!Number.isFinite(time)) throw new DouaneControlError("date de mise à jour illisible");
    if (time > options.now + 86_400_000) throw new DouaneControlError("date de mise à jour dans le futur");
    if ((options.now - time) / 86_400_000 > MAX_SOURCE_AGE_DAYS && !options.acceptAnomaly) throw new DouaneControlError("source inchangée depuis trop longtemps");
  }

  // Version précédente.
  if (options.previous && !options.acceptAnomaly) {
    const before = new Map(options.previous.sources.map((s) => [s.id, s.updated_at]));
    for (const source of meta.sources) {
      const earlier = before.get(source.id);
      if (earlier && Date.parse(source.updated_at) < Date.parse(earlier)) throw new DouaneControlError("date de mise à jour qui recule");
    }
    for (const kind of kinds) {
      const old = options.previous.ledgers[kind];
      if (!old) continue;
      if (meta.ledgers[kind].lines < old.lines * (1 - MAX_LINES_DROP)) throw new DouaneControlError(`baisse inhabituelle du volume (${kind})`);
      for (const [key, oldYear] of closedYears(old)) {
        const year = meta.ledgers[kind].by_year[key];
        if (!year) throw new DouaneControlError(`année disparue (${kind})`);
        const moved = (now: number, then: number): boolean => then > 0 && Math.abs(now - then) / then > MAX_CLOSED_YEAR_DRIFT;
        if (moved(year.value_chf, oldYear.value_chf) || moved(year.duties_chf ?? 0, oldYear.duties_chf ?? 0)) {
          throw new DouaneControlError(`année close qui bouge (${kind})`);
        }
      }
    }
  }
}
