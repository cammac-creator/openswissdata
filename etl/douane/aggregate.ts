/**
 * Du fichier ZIP aux agrégats, en flux : un membre de 11 Go n'est jamais écrit sur le disque ni chargé.
 * Étage lu : bronze temporaire (ZIP). Étage écrit : rien (tableaux en mémoire, rendus à `build.ts`).
 *
 * Mémoire : une ligne d'agrégat coûte une entrée de table et cinq nombres, jamais un objet ni un texte.
 */
import { StringDecoder } from "node:string_decoder";
import yauzl from "yauzl";
import { checkHeader, DouaneFormatError, readLine, type DouaneRecord } from "./parse.js";
import type { DouaneFileKind } from "./sources.js";

/** Plus grand membre mesuré le 05.11.2026 : 11,2 Go. Protection contre un ZIP anormal. */
export const MAX_MEMBER_BYTES = 30_000_000_000;
/** Une table `Map` de V8 plafonne à 16,7 millions d'entrées : on s'arrête avant, proprement. */
export const MAX_AGGREGATE_ROWS = 15_000_000;

const SAFE_MEMBER = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.csv$/;
const FIRST_YEAR = 1980;
const YEAR_SLOTS = 128;
const COUNTRY_SLOTS = 26 * 26;
const A = "A".charCodeAt(0);

export const MEASURES = ["import_value_chf", "import_kg", "duties_chf", "export_value_chf", "export_kg"] as const;
export type Measure = (typeof MEASURES)[number];

export interface YearLedger {
  lines: number;
  value_chf: number;
  kg: number;
  /** Recettes seulement. */
  duties_chf?: number;
  /** Commerce seulement. */
  conjunctural_value_chf?: number;
  /** Mois vus (12 pour une année close). */
  months: number;
  /** Au moins une ligne porte l'état `prov`. */
  provisional: boolean;
}

export interface FileLedger {
  lines: number;
  lines_label_overflow: number;
  lines_blank_value: number;
  lines_blank_kg: number;
  /** Valeurs distinctes de `Date_actualisation` : une seule attendue. */
  updated_at: string[];
  by_year: Record<string, YearLedger>;
}

function keyOf(record: DouaneRecord): number {
  const country = (record.country.charCodeAt(0) - A) * 26 + (record.country.charCodeAt(1) - A);
  return (Number(record.tn8) * COUNTRY_SLOTS + country) * YEAR_SLOTS + (record.year - FIRST_YEAR);
}

export function decodeKey(key: number): { tn8: string; country: string; year: number } {
  const year = key % YEAR_SLOTS;
  const rest = (key - year) / YEAR_SLOTS;
  const country = rest % COUNTRY_SLOTS;
  const tn8 = (rest - country) / COUNTRY_SLOTS;
  return {
    tn8: String(tn8).padStart(8, "0"),
    country: String.fromCharCode(A + Math.floor(country / 26), A + (country % 26)),
    year: year + FIRST_YEAR,
  };
}

/** Agrégats année × tarif × pays. Une cellule jamais alimentée reste `NaN` : absence n'est pas zéro. */
export class DouaneAggregator {
  private readonly index = new Map<number, number>();
  private capacity = 1 << 20;
  private columns: Float64Array[] = MEASURES.map(() => new Float64Array(this.capacity).fill(Number.NaN));
  /** Tarifs comptés hors du total conjoncturel, par sens et par année. */
  readonly nonConjunctural: Record<"imports" | "exports", Map<string, Set<number>>> = { imports: new Map(), exports: new Map() };

  get rows(): number {
    return this.index.size;
  }

  private slot(key: number): number {
    const found = this.index.get(key);
    if (found !== undefined) return found;
    const slot = this.index.size;
    if (slot >= MAX_AGGREGATE_ROWS) throw new DouaneFormatError("trop de lignes d'agrégats");
    if (slot >= this.capacity) this.grow();
    this.index.set(key, slot);
    return slot;
  }

  private grow(): void {
    const capacity = this.capacity * 2;
    this.columns = this.columns.map((old) => {
      const next = new Float64Array(capacity).fill(Number.NaN);
      next.set(old);
      return next;
    });
    this.capacity = capacity;
  }

  private addTo(measure: number, slot: number, amount: number | null): void {
    if (amount === null) return;
    const column = this.columns[measure];
    const before = column[slot];
    column[slot] = Number.isNaN(before) ? amount : before + amount;
  }

  add(kind: DouaneFileKind, record: DouaneRecord): void {
    const slot = this.slot(keyOf(record));
    if (kind === "duties") {
      // Valeur et poids des importations viennent du fichier du commerce : ici, seulement les droits.
      this.addTo(2, slot, record.dutiesChf);
    } else if (kind === "imports") {
      this.addTo(0, slot, record.valueChf);
      this.addTo(1, slot, record.kg);
    } else {
      this.addTo(3, slot, record.valueChf);
      this.addTo(4, slot, record.kg);
    }
    if (kind !== "duties" && record.conjunctural === false) {
      const byTariff = this.nonConjunctural[kind];
      const years = byTariff.get(record.tn8) ?? new Set<number>();
      years.add(record.year);
      byTariff.set(record.tn8, years);
    }
  }

  /** Clés triées par tarif, pays, année : ce tri fait la moitié de la compression. */
  sortedKeys(): Float64Array {
    const keys = new Float64Array(this.index.size);
    let i = 0;
    for (const key of this.index.keys()) keys[i++] = key;
    return keys.sort();
  }

  /** Valeurs d'une clé, dans l'ordre de `MEASURES` ; `NaN` si absente de la source. */
  valuesOf(key: number): number[] {
    const slot = this.index.get(key);
    if (slot === undefined) throw new DouaneFormatError("clé inconnue");
    return this.columns.map((column) => column[slot]);
  }
}

/** Ouvre le ZIP et rend le flux de son unique membre CSV. */
function openSingleCsv(path: string): Promise<{ stream: NodeJS.ReadableStream; close: () => void }> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) return reject(new DouaneFormatError("archive illisible"));
      if (zip.entryCount !== 1) {
        zip.close();
        return reject(new DouaneFormatError("archive à plusieurs fichiers"));
      }
      zip.once("error", () => reject(new DouaneFormatError("archive illisible")));
      zip.once("entry", (entry: yauzl.Entry) => {
        if (!SAFE_MEMBER.test(entry.fileName) || entry.uncompressedSize > MAX_MEMBER_BYTES) {
          zip.close();
          return reject(new DouaneFormatError("membre de l'archive refusé"));
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            zip.close();
            return reject(new DouaneFormatError("membre de l'archive illisible"));
          }
          resolve({ stream, close: () => zip.close() });
        });
      });
      zip.readEntry();
    });
  });
}

function ledgerYear(ledger: FileLedger, kind: DouaneFileKind, year: number): YearLedger {
  const key = String(year);
  let entry = ledger.by_year[key];
  if (!entry) {
    entry = kind === "duties"
      ? { lines: 0, value_chf: 0, kg: 0, duties_chf: 0, months: 0, provisional: false }
      : { lines: 0, value_chf: 0, kg: 0, conjunctural_value_chf: 0, months: 0, provisional: false };
    ledger.by_year[key] = entry;
  }
  return entry;
}

/**
 * Lit un ZIP en flux, alimente les agrégats et rend le grand livre du fichier : lignes et totaux par
 * année, comptés AVANT toute agrégation pour être comparés au document fini.
 */
export async function readZipInto(kind: DouaneFileKind, path: string, aggregator: DouaneAggregator): Promise<FileLedger> {
  const ledger: FileLedger = { lines: 0, lines_label_overflow: 0, lines_blank_value: 0, lines_blank_kg: 0, updated_at: [], by_year: {} };
  const monthsSeen = new Map<number, Set<number>>();
  const { stream, close } = await openSingleCsv(path);
  const decoder = new StringDecoder("utf8");
  let carry = "";
  let headerRead = false;
  let lastUpdatedAt = "";

  const consume = (line: string): void => {
    if (!headerRead) {
      checkHeader(kind, line);
      headerRead = true;
      return;
    }
    if (line === "") throw new DouaneFormatError("ligne vide");
    const record = readLine(kind, line);
    ledger.lines++;
    if (record.labelOverflow) ledger.lines_label_overflow++;
    if (record.valueChf === null) ledger.lines_blank_value++;
    if (record.kg === null) ledger.lines_blank_kg++;
    if (record.updatedAt !== lastUpdatedAt) {
      if (!ledger.updated_at.includes(record.updatedAt)) ledger.updated_at.push(record.updatedAt);
      lastUpdatedAt = record.updatedAt;
    }
    const year = ledgerYear(ledger, kind, record.year);
    year.lines++;
    year.value_chf += record.valueChf ?? 0;
    year.kg += record.kg ?? 0;
    if (kind === "duties") year.duties_chf = (year.duties_chf ?? 0) + (record.dutiesChf ?? 0);
    else if (record.conjunctural) year.conjunctural_value_chf = (year.conjunctural_value_chf ?? 0) + (record.valueChf ?? 0);
    if (record.status === "prov") year.provisional = true;
    let months = monthsSeen.get(record.year);
    if (!months) monthsSeen.set(record.year, (months = new Set()));
    months.add(record.month);
    aggregator.add(kind, record);
  };

  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
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
    const tail = carry + decoder.end();
    if (tail !== "") consume(tail);
  } finally {
    close();
  }
  if (!headerRead) throw new DouaneFormatError("archive vide");
  for (const [year, months] of monthsSeen) ledger.by_year[String(year)].months = months.size;
  return ledger;
}
