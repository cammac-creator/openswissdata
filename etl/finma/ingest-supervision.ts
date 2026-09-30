/**
 * Organismes de surveillance (OS) des gestionnaires de fortune et trustees,
 * et tables de référence des OAR et des OS reconnus par la FINMA.
 *
 * Sources → bronze daté (fetchBronze) → lecture contrôlée → rapprochement exact.
 *
 * Vocabulaire (à ne jamais mélanger, voir le rapport
 * docs/internal/audit-global-20260925/sro-20260930/RAPPORT.md) :
 * - OS = organisme de surveillance des gestionnaires de fortune et trustees
 *   (loi sur les établissements financiers, LEFin ; art. 43a LFINMA) ;
 * - OAR = organisme d'autorégulation (loi sur le blanchiment d'argent, LBA).
 * Le champ `supervisory_organisation` porte un OS, jamais une affiliation OAR.
 *
 * Règle du projet depuis le 25.09.2026 : aucune ressemblance approximative.
 * Un rapprochement ambigu ou absent laisse le champ vide.
 */
import { readFileSync } from "node:fs";
import XLSX from "../shared/xlsx.js";
import { fetchBronze } from "../shared/bronze.js";
import { FINMA_AO_XLSX_URL, FINMA_SRO_XLSX_URL, FINMA_VVTR_XLSX_URL } from "./sources.js";
import type {
  FinmaEntity,
  FinmaReferenceOrganisation,
  FinmaSourceFileMeta,
  FinmaSupervisedManager,
} from "./types.js";

type Row = unknown[];

/** Contenu d'une cellule en texte, sans modifier le texte publié. */
function cell(row: Row, index: number | undefined): string {
  if (index === undefined) return "";
  const value = row[index];
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Seule normalisation admise pour comparer deux libellés : forme Unicode NFC,
 * espaces (y compris insécables) réduits à un seul, bords retirés. Casse,
 * ponctuation, guillemets et formes juridiques sont conservés : « X AG » et
 * « X SA » restent deux clés différentes.
 */
export function exactMatchKey(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** Lit la première feuille d'un classeur, après contrôle de la signature XLSX. */
export function readXlsxRows(path: string, label: string): Row[] {
  const bytes = readFileSync(path);
  // SheetJS lit aussi une page HTML d'erreur comme un classeur : refuser avant.
  if (bytes.subarray(0, 4).toString("hex") !== "504b0304") {
    throw new Error(`${label} : la source n'est pas un classeur XLSX, publication annulée`);
  }
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const sheet = workbook.SheetNames.length ? workbook.Sheets[workbook.SheetNames[0]] : undefined;
  if (!sheet) throw new Error(`${label} : classeur sans feuille, publication annulée`);
  return XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, defval: null, raw: false, blankrows: true });
}

const isBlank = (row: Row) => row.every(value => String(value ?? "").trim() === "");

/**
 * Repère la ligne d'en-tête par son texte (jamais par sa position : titres,
 * lignes vides et cellules fusionnées précèdent l'en-tête), puis la ligne
 * « Total …: N ». Le nombre de lignes lues doit être exactement N.
 */
export function readFinmaTable(rows: Row[], required: string[], label: string): {
  columns: Map<string, number>;
  data: Array<{ row: Row; line: number }>;
  declaredTotal: number;
} {
  let headerIndex = -1;
  let columns = new Map<string, number>();
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const found = new Map<string, number>();
    rows[i].forEach((value, j) => {
      const name = exactMatchKey(String(value ?? ""));
      if (name && !found.has(name)) found.set(name, j);
    });
    if (required.every(name => found.has(name))) { headerIndex = i; columns = found; break; }
  }
  if (headerIndex < 0) throw new Error(`${label} : colonnes FINMA inattendues, publication annulée`);

  const data: Array<{ row: Row; line: number }> = [];
  let declaredTotal: number | undefined;
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (isBlank(row)) continue;
    if (declaredTotal !== undefined) {
      throw new Error(`${label} : contenu inattendu après la ligne de total (ligne ${i + 1}), publication annulée`);
    }
    const first = exactMatchKey(row.map(value => String(value ?? "")).find(text => text.trim()) ?? "");
    // « Total …: 1508 » (séparateur de milliers toléré : 1'508, 1 508).
    const total = first.match(/^Total\b[^:]*:\s*(\d[\d'’ ]*)$/i);
    if (total) { declaredTotal = Number(total[1].replace(/\D/g, "")); continue; }
    data.push({ row, line: i + 1 });
  }
  if (declaredTotal === undefined) throw new Error(`${label} : ligne de total absente, publication annulée`);
  if (declaredTotal !== data.length) {
    throw new Error(`${label} : ${data.length} lignes lues pour un total annoncé de ${declaredTotal}, publication annulée`);
  }
  if (data.length === 0) throw new Error(`${label} : table vide, publication annulée`);
  return { columns, data, declaredTotal };
}

const VVTR_COLUMNS = ["Name", "City", "Portfolio Manager", "Trustee", "Supervisory organisation"];

/** vvtr.xlsx : gestionnaires de fortune et trustees surveillés par un OS. */
export function parseSupervisedManagersXlsx(path: string): FinmaSupervisedManager[] {
  const label = "vvtr.xlsx";
  const { columns, data } = readFinmaTable(readXlsxRows(path, label), VVTR_COLUMNS, label);
  return data.map(({ row, line }) => {
    const name = cell(row, columns.get("Name")).trim();
    const city = cell(row, columns.get("City")).trim();
    const pm = cell(row, columns.get("Portfolio Manager")).trim();
    const trustee = cell(row, columns.get("Trustee")).trim();
    const supervisory = cell(row, columns.get("Supervisory organisation")).trim();
    if (!name || !city || !supervisory) throw new Error(`${label} : ligne ${line} incomplète, publication annulée`);
    if (![pm, trustee].every(flag => flag === "" || flag === "X") || (pm === "" && trustee === "")) {
      throw new Error(`${label} : type d'autorisation illisible à la ligne ${line}, publication annulée`);
    }
    return { name, city, portfolio_manager: pm === "X", trustee: trustee === "X", supervisory_organisation: supervisory };
  });
}

/**
 * sro.xlsx (OAR reconnus) et ao.xlsx (OS autorisés) : raison sociale, adresse,
 * site. Les colonnes e-mail et téléphone ne sont jamais lues.
 */
export function parseReferenceOrganisationsXlsx(
  path: string,
  kind: "sro" | "ao",
  provenance: { source_url: string; observed_on: string },
): FinmaReferenceOrganisation[] {
  const label = `${kind}.xlsx`;
  const nameColumn = kind === "sro" ? "Company name" : "Name";
  const required = kind === "sro" ? [nameColumn, "Address", "Homepage"] : [nameColumn, "Address", "City", "Homepage"];
  const { columns, data } = readFinmaTable(readXlsxRows(path, label), required, label);
  return data.map(({ row, line }) => {
    const name = cell(row, columns.get(nameColumn)).trim();
    const address = cell(row, columns.get("Address")).trim();
    if (!name || !address) throw new Error(`${label} : ligne ${line} incomplète, publication annulée`);
    const organisation: FinmaReferenceOrganisation = { name, address, source_url: provenance.source_url, observed_on: provenance.observed_on };
    if (kind === "ao") {
      const city = cell(row, columns.get("City")).trim();
      if (!city) throw new Error(`${label} : ligne ${line} sans localité, publication annulée`);
      organisation.city = city;
    }
    const website = cell(row, columns.get("Homepage")).trim();
    if (website) organisation.website = website;
    return organisation;
  });
}

/** Chaque OS cité dans vvtr.xlsx doit figurer tel quel dans ao.xlsx du même passage. */
export function assertKnownSupervisoryOrganisations(
  managers: FinmaSupervisedManager[],
  supervisoryOrganisations: FinmaReferenceOrganisation[],
): void {
  const known = new Set(supervisoryOrganisations.map(o => exactMatchKey(o.name)));
  const unknown = [...new Set(managers.map(m => m.supervisory_organisation))].filter(name => !known.has(exactMatchKey(name)));
  if (unknown.length) {
    throw new Error(`vvtr.xlsx : ${unknown.length} organisme(s) de surveillance absent(s) de ao.xlsx, publication annulée`);
  }
}

export interface SupervisionMatchStats {
  /** Lignes de vvtr.xlsx. */
  source_rows: number;
  /** Lignes de vvtr.xlsx rattachées à au moins une ligne du registre. */
  matched_source_rows: number;
  /** Lignes de vvtr.xlsx dont le nom et la localité se répètent : ambiguës, non attribuées. */
  duplicate_source_rows: number;
  /** Lignes de vvtr.xlsx dont les lignes candidates du registre portent plusieurs UID. */
  ambiguous_uid_source_rows: number;
  /** Lignes de vvtr.xlsx sans ligne correspondante dans le registre. */
  unmatched_source_rows: number;
  /** Lignes du registre écartées : type d'autorisation absent de la ligne vvtr correspondante. */
  type_mismatch_rows: number;
  /** Lignes « Portfolio manager » et « Trustee » du registre. */
  registry_candidate_rows: number;
  /** Lignes du registre qui reçoivent un organisme de surveillance. */
  registry_rows_with_value: number;
}

const PORTFOLIO_MANAGER = "portfolio manager";
const TRUSTEE = "trustee";

/**
 * Rattache l'OS aux lignes « Portfolio manager » et « Trustee » du registre.
 * Une ligne reçoit une valeur seulement si :
 * 1. nom ET localité identiques (exactMatchKey) ;
 * 2. cette clé est unique dans vvtr.xlsx ;
 * 3. les lignes candidates du registre ont un seul UID (ou toutes aucun) ;
 * 4. le type de la ligne du registre est coché dans la ligne vvtr.
 * Sinon le champ reste vide. Modifie `entities` en place.
 */
export function attachSupervisoryOrganisations(
  entities: FinmaEntity[],
  managers: FinmaSupervisedManager[],
  provenance: { source_url: string; observed_on: string },
): SupervisionMatchStats {
  const key = (name: string, city: string) => `${exactMatchKey(name)}\u0000${exactMatchKey(city)}`;
  const candidates = entities.filter(e => {
    const licence = (e.licence_type ?? "").trim().toLowerCase();
    return e.entity_type === "asset_manager_individual" && (licence === PORTFOLIO_MANAGER || licence === TRUSTEE);
  });
  const registry = new Map<string, FinmaEntity[]>();
  for (const entity of candidates) {
    delete entity.supervisory_organisation;
    delete entity.supervisory_organisation_source_url;
    delete entity.supervisory_organisation_observed_on;
    const k = key(entity.name, entity.city ?? "");
    registry.set(k, [...(registry.get(k) ?? []), entity]);
  }
  const occurrences = new Map<string, number>();
  for (const manager of managers) {
    const k = key(manager.name, manager.city);
    occurrences.set(k, (occurrences.get(k) ?? 0) + 1);
  }

  const stats: SupervisionMatchStats = {
    source_rows: managers.length, matched_source_rows: 0, duplicate_source_rows: 0,
    ambiguous_uid_source_rows: 0, unmatched_source_rows: 0, type_mismatch_rows: 0,
    registry_candidate_rows: candidates.length, registry_rows_with_value: 0,
  };
  for (const manager of managers) {
    const k = key(manager.name, manager.city);
    if ((occurrences.get(k) ?? 0) > 1) { stats.duplicate_source_rows++; continue; }
    const hits = registry.get(k) ?? [];
    if (!hits.length) { stats.unmatched_source_rows++; continue; }
    if (new Set(hits.map(h => h.uid ?? "")).size > 1) { stats.ambiguous_uid_source_rows++; continue; }
    let attached = false;
    for (const entity of hits) {
      const licence = (entity.licence_type ?? "").trim().toLowerCase();
      const flagged = licence === PORTFOLIO_MANAGER ? manager.portfolio_manager : manager.trustee;
      if (!flagged) { stats.type_mismatch_rows++; continue; }
      entity.supervisory_organisation = manager.supervisory_organisation;
      entity.supervisory_organisation_source_url = provenance.source_url;
      entity.supervisory_organisation_observed_on = provenance.observed_on;
      stats.registry_rows_with_value++;
      attached = true;
    }
    if (attached) stats.matched_source_rows++;
  }
  return stats;
}

export interface FinmaSupervisionSources {
  managers: FinmaSupervisedManager[];
  sros: FinmaReferenceOrganisation[];
  supervisoryOrganisations: FinmaReferenceOrganisation[];
  sources: { vvtr: FinmaSourceFileMeta; sro: FinmaSourceFileMeta; ao: FinmaSourceFileMeta };
}

function readMeta(path: string): FinmaSourceFileMeta {
  const meta = JSON.parse(readFileSync(`${path}.meta.json`, "utf8")) as FinmaSourceFileMeta;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(meta.fetched_at ?? "") || !/^[0-9a-f]{64}$/.test(meta.sha256 ?? "")) {
    throw new Error("Métadonnées de bronze FINMA illisibles : publication annulée");
  }
  return { url: meta.url, fetched_at: meta.fetched_at, last_modified: meta.last_modified ?? null, sha256: meta.sha256, bytes: meta.bytes };
}

/** Collecte des trois fichiers (bronze daté d'abord), puis lecture contrôlée. */
export async function ingestFinmaSupervision(opts: { cacheDir: string }): Promise<FinmaSupervisionSources> {
  const vvtrPath = await fetchBronze(FINMA_VVTR_XLSX_URL, opts.cacheDir, "vvtr.xlsx");
  const sroPath = await fetchBronze(FINMA_SRO_XLSX_URL, opts.cacheDir, "sro.xlsx");
  const aoPath = await fetchBronze(FINMA_AO_XLSX_URL, opts.cacheDir, "ao.xlsx");
  const sources = { vvtr: readMeta(vvtrPath), sro: readMeta(sroPath), ao: readMeta(aoPath) };
  const managers = parseSupervisedManagersXlsx(vvtrPath);
  const sros = parseReferenceOrganisationsXlsx(sroPath, "sro", { source_url: FINMA_SRO_XLSX_URL, observed_on: sources.sro.fetched_at.slice(0, 10) });
  const supervisoryOrganisations = parseReferenceOrganisationsXlsx(aoPath, "ao", { source_url: FINMA_AO_XLSX_URL, observed_on: sources.ao.fetched_at.slice(0, 10) });
  assertKnownSupervisoryOrganisations(managers, supervisoryOrganisations);
  return { managers, sros, supervisoryOrganisations, sources };
}
