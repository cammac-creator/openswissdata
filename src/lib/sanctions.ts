/**
 * Liste des sanctions du SECO (SESAM) servie par `/api/v1/sanctions` : organisations et bateaux
 * seulement (décision de Claude-Alain du 04.11.2026, « A : sans les personnes »).
 *
 * Étage lu : or réduit du bucket R2 privé, écrit par `etl/sanctions/collect.ts`. Jamais dans le
 * dépôt public : un fichier commité garderait à vie, dans l'historique, chaque organisation radiée
 * ensuite. Le service relit l'objet au démarrage puis chaque heure et garde la dernière version
 * bonne si une lecture échoue ; une liste trop ancienne n'est jamais présentée comme actuelle.
 *
 * Rapprochement exact seulement (règle du projet) : même clé que `exactMatchKey` de
 * `etl/finma/ingest-supervision.ts` (NFC et espaces ; casse, ponctuation et forme juridique
 * conservées), comparée par `tests/lib/sanctions.test.ts`.
 */
import { gunzipSync } from "node:zlib";
import { getObjectBuffer } from "./r2.js";

export const SANCTIONS_SCHEMA = "osd-sanctions-v1";
export const SANCTIONS_R2_KEY = "sanctions/or/current-v1.json.gz";
export const SANCTIONS_SOURCE_ID = "seco.sesam_sanctions";
export const SANCTIONS_OFFICIAL_SEARCH_URL = "https://www.sesam.search.admin.ch/sesam-search-web/pages/search.xhtml?lang=en";
/** Sans relevé réussi depuis ce délai, la liste est dite périmée. Les passages de GitHub peuvent être omis ou retardés. */
export const SANCTIONS_MAX_AGE_DAYS = 3;

const MAX_GZIP_BYTES = 30_000_000;
const MAX_JSON_BYTES = 120_000_000;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SanctionNameType = "primary" | "alias" | "former";
export type SanctionKind = "organisation" | "vessel";

export interface SanctionEntry {
  id: string;
  kind: SanctionKind;
  names: { type: SanctionNameType; value: string }[];
  programmes: { id: string; name: string; origin: string }[];
  listed_on: string | null;
  countries: string[];
  imo: string | null;
}

/** La preuve par comptage, calculée sur le document écrit (`etl/sanctions/build.ts`). */
export interface SanctionsExclusionProof {
  source_entries: { natural_persons: number; organisations: number; vessels: number };
  excluded: {
    natural_persons: number;
    delisted_organisations: number;
    delisted_vessels: number;
    organisations_primary_name_carries_person: number;
  };
  organisation_names_removed_carrying_person: number;
  vessels_name_equals_person_entry: number;
  organisation_names_honouring_a_person_kept: number;
  organisation_names_kept_after_review: number;
  natural_persons_served: number;
  relations_served: number;
  free_text_fields_served: number;
  organisation_names_caught_and_not_reviewed_served: number;
}

export interface SanctionsDocument {
  schema: typeof SANCTIONS_SCHEMA;
  source_id: typeof SANCTIONS_SOURCE_ID;
  list_date: string;
  source_sha256: string;
  source_bytes: number;
  collected_at: string;
  counts: { organisations: number; vessels: number };
  vessels_without_imo: number;
  exclusion_proof: SanctionsExclusionProof;
  entries: SanctionEntry[];
}

/** Clé exacte des recherches : voir l'en-tête. */
export function exactSanctionKey(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

const isIsoDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Refuse tout document qui ne tient pas sa promesse ; message fixe, jamais d'extrait du contenu. */
export function validateSanctionsDocument(value: unknown): SanctionsDocument {
  const fail = (reason: string): never => { throw new Error(`Liste des sanctions refusée (${reason})`); };
  if (typeof value !== "object" || value === null) return fail("document");
  const doc = value as Partial<SanctionsDocument>;
  if (doc.schema !== SANCTIONS_SCHEMA || doc.source_id !== SANCTIONS_SOURCE_ID) return fail("schéma");
  if (!isIsoDate(doc.list_date)) return fail("date");
  if (typeof doc.source_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(doc.source_sha256)) return fail("empreinte");
  if (!isCount(doc.source_bytes) || typeof doc.collected_at !== "string" || !Number.isFinite(Date.parse(doc.collected_at))) return fail("relevé");
  if (!doc.counts || !isCount(doc.counts.organisations) || !isCount(doc.counts.vessels)) return fail("comptes");
  const proof = doc.exclusion_proof;
  if (!proof) return fail("preuve");
  if (proof.natural_persons_served !== 0 || proof.relations_served !== 0 || proof.free_text_fields_served !== 0
    || proof.organisation_names_caught_and_not_reviewed_served !== 0) return fail("preuve");
  if (!Array.isArray(doc.entries)) return fail("entrées");
  let organisations = 0;
  let vessels = 0;
  for (const entry of doc.entries as SanctionEntry[]) {
    if (entry?.kind === "organisation") organisations++;
    else if (entry?.kind === "vessel") vessels++;
    else return fail("genre");
    if (typeof entry.id !== "string" || !Array.isArray(entry.names) || entry.names.length === 0) return fail("entrée");
  }
  if (organisations !== doc.counts.organisations || vessels !== doc.counts.vessels) return fail("comptes");
  return doc as SanctionsDocument;
}

export interface LoadedSanctions {
  document: SanctionsDocument;
  byName: Map<string, { entry: SanctionEntry; type: SanctionNameType }[]>;
  byImo: Map<string, SanctionEntry[]>;
}

let loaded: LoadedSanctions | null = null;
let lastError: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function indexSanctions(document: SanctionsDocument): LoadedSanctions {
  const byName: LoadedSanctions["byName"] = new Map();
  const byImo: LoadedSanctions["byImo"] = new Map();
  for (const entry of document.entries) {
    const seen = new Set<string>();
    for (const name of entry.names) {
      const key = exactSanctionKey(name.value);
      if (seen.has(key)) continue;
      seen.add(key);
      const list = byName.get(key) ?? [];
      list.push({ entry, type: name.type });
      byName.set(key, list);
    }
    if (entry.imo) {
      const list = byImo.get(entry.imo) ?? [];
      list.push(entry);
      byImo.set(entry.imo, list);
    }
  }
  return { document, byName, byImo };
}

export function getSanctions(): LoadedSanctions | null {
  return loaded;
}

/** Test : poser (ou retirer) la liste en mémoire sans passer par R2. */
export function _setSanctionsForTest(document: SanctionsDocument | null): void {
  loaded = document ? indexSanctions(validateSanctionsDocument(document)) : null;
  lastError = null;
}

export function getSanctionsLastError(): string | null {
  return lastError;
}

/**
 * La date du fichier reste la même tant que le SECO ne change pas sa liste : seule la date du dernier
 * relevé réussi dit si ce qu'on sert est encore à jour. Une date illisible n'est jamais « à jour ».
 */
export function isSanctionsListCurrent(collectedAt: string, now: number): boolean {
  const at = Date.parse(collectedAt);
  return Number.isFinite(at) && now - at <= SANCTIONS_MAX_AGE_DAYS * DAY_MS;
}

export function decodeSanctionsObject(gzipped: Buffer): SanctionsDocument {
  const json = gunzipSync(gzipped, { maxOutputLength: MAX_JSON_BYTES }).toString("utf8");
  return validateSanctionsDocument(JSON.parse(json));
}

/** Une lecture ratée garde la version précédente. Avant la première collecte, l'objet n'existe pas. */
export async function refreshSanctionsFromR2(read: (key: string, opts: { maxBytes: number }) => Promise<Buffer> = getObjectBuffer): Promise<void> {
  try {
    const document = decodeSanctionsObject(await read(SANCTIONS_R2_KEY, { maxBytes: MAX_GZIP_BYTES }));
    loaded = indexSanctions(document);
    lastError = null;
  } catch (err) {
    // Nom d'erreur seul : le message de JSON.parse cite un extrait du contenu.
    lastError = err instanceof Error ? err.name : "Error";
  }
}

export function startSanctionsRefresh(): void {
  void refreshSanctionsFromR2();
  if (!timer) {
    timer = setInterval(() => { void refreshSanctionsFromR2(); }, REFRESH_INTERVAL_MS);
    // Ne garde pas le processus en vie pour ce seul minuteur.
    timer.unref?.();
  }
}
