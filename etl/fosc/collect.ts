#!/usr/bin/env tsx
/**
 * Collecte quotidienne des avis publiés dans la FOSC : registre du commerce (rubrique HR),
 * décision de Claude-Alain du 16.10.2026 (d3 = A, F8 accordé) : « des totaux, et les événements
 * des sociétés » ; depuis le 24.10.2026, aussi les faillites (KK), les concordats (NA), les appels
 * aux créanciers suite à une liquidation (LS) et les autres appels aux créanciers du droit des
 * sociétés (SR), POUR LES SOCIÉTÉS SEULEMENT (`insolvency.ts`) : une personne physique, une
 * entreprise individuelle ou une succession n'entre que dans les totaux, jamais dans une ligne, un
 * fichier ou un journal. Ne publie rien et ne branche aucune page.
 *
 * Étages : lit la SOURCE (API publique du Portail des feuilles officielles) et l'ARGENT du
 * passage précédent ; écrit l'ARGENT (`state.ts`) et l'OR non publié (`totals.ts`).
 * ÉCART À LA RÈGLE « BRONZE D'ABORD » (documenté) : aucune copie brute n'est gardée, ni sur
 * disque ni dans un artefact, parce que les réponses contiennent le texte libre des avis (noms
 * de personnes, buts, adresses). Chaque réponse est lue en mémoire, les champs autorisés en sont
 * extraits, puis elle est jetée.
 *
 * Ordre d'un passage :
 *   1. relire l'état (illisible → arrêt, jamais un état recréé à vide) ;
 *   2. purge sans réseau des lignes dont le jour de suppression arrive (`delete_on` ≤ demain), puis
 *      mois figés ;
 *   3. garde-fous des CG : acceptation de moins de 90 jours (CG 1.2 al. 1), PDF des CG inchangé
 *      (CG 1.1 al. 4) ; sinon aucune lecture du portail, l'état purgé est quand même écrit ;
 *   4. revérification des jours stockés hors fenêtre (liste PUBLISHED de chaque jour) ;
 *   5. jours de la fenêtre de rattrapage, du plus ancien au plus récent, une seule liste par jour
 *      pour toutes les rubriques lues (HR, KK, NA, LS, SR) : un jour inchangé est seulement
 *      revérifié ; un jour nouveau ou changé est recalculé EN ENTIER (sociétés déjà connues
 *      relues dans l'état sans requête, autres avis relus en mémoire) ; une sous-rubrique
 *      inconnue de KK, NA, LS ou SR (schéma non relu) arrête le passage, comme un schéma HR changé ;
 *   6. purge des lignes non revérifiées depuis plus de trois jours (y compris quand le portail
 *      n'a pas pu être lu), puis écriture de l'état et des totaux. Une panne inattendue survenue
 *      pendant les étapes 3 à 5 n'empêche pas cette étape : aucun jour nouveau n'est alors
 *      enregistré, mais la purge l'est, puis la panne est relancée (code de sortie 1).
 *
 * Usage :
 *   FOSC_DRY_RUN=1 tsx etl/fosc/collect.ts --out <dossier hors du dépôt> [--days J1,J2] [--sample-details N]
 *   tsx etl/fosc/collect.ts --write-r2          (passage réel : bucket R2 privé, workflow planifié)
 * Les journaux n'affichent que des nombres et des dates (dépôt public).
 */
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseUid } from "../../src/mcp/company/uid.js";
import { createPoliteClient, FoscBudgetError, FoscHttpError, type PoliteClient } from "./client.js";
import { loadCommuneResolver, loadPostalResolver, SWISS_CANTONS, type CommuneResolver, type PostalResolver } from "./communes.js";
import { classifyInsolvencyAvis, parseInsolvencyDetail, UNKNOWN_CANTON, type InsolvencyDetail, type InsolvencyOutcome } from "./insolvency.js";
import { isRowStorable, SOLE_PROPRIETORSHIP, totalsLegalForm } from "./legal-forms.js";
import { FoscListError, parseListPage, type ListEntry } from "./list.js";
import {
  detailXmlUrl, FOSC_MAX_PAGE_SIZE, FOSC_RUBRICS, FOSC_TERMS_ACCEPTED_ON, FOSC_TERMS_RENEWAL_DAYS, FOSC_TERMS_SHA256, FOSC_TERMS_URL, listUrl,
} from "./sources.js";
import {
  addTally, applyVerification, deleteOn, emptyState, freezeMonths, isDeletionDue, purgeExpired, purgeUnverified, replaceDay, sortTallies,
  validateState, WINDOW_DAYS, windowDays, zurichDay, type DayRecord, type FoscEventRow, type FoscState, type PurgeCounts, type Tally,
} from "./state.js";
import { fileStore, r2Store, type FoscStore } from "./store.js";
import { INSOLVENCY_BY_CODE, INSOLVENCY_RUBRICS } from "./subrubrics.js";
import { buildTotals } from "./totals.js";
import { FoscXmlError, parseAvisDetail, type AvisDetail } from "./xml.js";

export const PARSED_SUBRUBRICS: ReadonlySet<string> = new Set(["HR01", "HR02", "HR03"]);
export { UNKNOWN_CANTON };
/** Au-delà de 5 % de détails sans IDE ou sans forme juridique, le schéma a probablement changé. */
export const MAX_MISSING_RATIO = 0.05;
export const MIN_PARSED_FOR_RATIO = 50;
/** Un jour dont plus de 1 % des détails (au moins 3) échouent n'est pas enregistré. */
export const MAX_DETAIL_FAILED_RATIO = 0.01;
export const DEFAULT_MAX_REQUESTS = 3000;
const MAX_LIST_BYTES = 30_000_000;
const MAX_DETAIL_BYTES = 2_000_000;
const MAX_TERMS_BYTES = 5_000_000;

export interface MissingCounts {
  uid: number; legal_form: number; seat: number; canton: number; commune_unresolved: number;
  /** Avis à plusieurs blocs société d'un même côté : totaux seulement, hors du contrôle du schéma. */
  multiple_blocks: number;
}

/** Faillites, concordats, liquidations, appels aux créanciers : comptes du passage (nombres seulement). */
export interface InsolvencyCounts {
  /** Détails lus et analysés. */
  parsed: number;
  /** Une case par issue du classement (`row` = ligne de société). */
  outcomes: Record<InsolvencyOutcome, number>;
  /** Lignes dont la commune n'a pas pu être rapprochée (canton gardé). */
  commune_unresolved: number;
  /** Lignes qui portent au moins une date de procédure. */
  with_dates: number;
  /** « Autres avis » (KK10, NA11) : comptés sans lire le détail. */
  general_notices: number;
}

export const emptyInsolvencyCounts = (): InsolvencyCounts => ({
  parsed: 0,
  outcomes: {
    row: 0, person: 0, estate: 0, sole_proprietorship: 0, no_legal_form: 0, no_uid: 0, other_form: 0,
    multiple_parties: 0, no_party: 0, ambiguous: 0, unknown_schema: 0, no_canton: 0, expiring: 0,
  },
  commune_unresolved: 0,
  with_dates: 0,
  general_notices: 0,
});

export interface DayReport {
  date: string;
  status: "unchanged" | "computed" | "skipped_budget" | "failed" | "frozen_month" | "list_failed" | "schema_unknown";
  listed: number;
  by_subrubric: Record<string, number>;
  details_read: number;
  stored_rows: number;
  totals_only: number;
  sole_proprietorships: number;
  /** Débiteurs personnes physiques, successions comprises (totaux seulement). */
  persons: number;
  estates: number;
  test_imports: number;
  detail_failed: number;
  not_sampled: number;
}

export interface CollectReport {
  mode: "dry_run" | "real" | "test";
  today: string;
  purge: PurgeCounts;
  months_frozen: number;
  terms: "ok" | "acceptance_expired" | "terms_changed" | "terms_unreadable";
  verification: { days_checked: number; days_failed: number };
  days: DayReport[];
  /** Avis HR seulement (contrôle du schéma HR). */
  missing: MissingCounts;
  parsed_details: number;
  /** Faillites, concordats, liquidations et appels aux créanciers. */
  insolvency: InsolvencyCounts;
  rows_stored_total: number;
  requests: number;
  rate_limited: number;
  waited_seconds: number;
  stopped: null | "budget" | "time" | "rate_limit" | "terms" | "schema";
  exit_code: 0 | 1 | 2;
}

export interface CollectOptions {
  store: FoscStore;
  client: PoliteClient;
  resolveCommune: CommuneResolver;
  /** NPA et lieu de l'adresse d'une société (nouvelles rubriques) ; défaut : aucune commune. */
  resolvePostal?: PostalResolver;
  now?: Date;
  /** Jours à traiter (simulation) ; défaut : la fenêtre de rattrapage. */
  days?: string[];
  window?: number;
  /** Simulation seulement : détail lu pour les N premiers avis de chaque jour. */
  sampleDetails?: number;
  mode?: CollectReport["mode"];
  /** Tests seulement : empreinte attendue du PDF des CG et date d'acceptation. */
  termsSha256?: string;
  termsAcceptedOn?: string;
}

/** Panne inattendue : levée APRÈS l'enregistrement de l'état purgé, avec le rapport du passage. */
export class FoscUnexpectedError extends Error {
  constructor(readonly report: CollectReport, readonly original: unknown) {
    super(`Panne inattendue pendant la collecte (${original instanceof Error ? original.name : "erreur inconnue"}) : état purgé enregistré, aucun jour nouveau`);
    this.name = "FoscUnexpectedError";
  }
}

type Classified =
  | { kind: "row"; row: FoscEventRow; tally: Omit<Tally, "count"> }
  | { kind: "totals"; tally: Omit<Tally, "count">; soleProprietorship: boolean };

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Décide ce qu'un avis devient : une ligne de société (liste blanche) ou un simple total.
 *
 * Bloc retenu : l'unique bloc société du côté « après » (« avant » pour une radiation), ou à défaut
 * l'unique bloc de l'autre côté. Une ligne n'est possible que si chaque côté porte AU PLUS un bloc,
 * qu'aucun champ n'est répété dans un bloc, que TOUTES les formes de TOUS les blocs (avant et
 * après) sont dans la liste blanche, et que l'IDE, la forme et le siège viennent de ce même bloc
 * (garanti par la lecture bloc par bloc de `xml.ts`). Sinon : totaux seulement.
 * Canton retenu : celui de la commune du siège quand elle est rapprochée, sinon celui de l'avis
 * (office qui publie).
 */
export function classifyAvis(entry: ListEntry, detail: AvisDetail, resolveCommune: CommuneResolver, today: string, missing: MissingCounts): Classified {
  const main = entry.subRubric === "HR03" ? detail.before : detail.after;
  const other = entry.subRubric === "HR03" ? detail.after : detail.before;
  const primarySide = main.length > 0 ? main : other;
  const blocks = [...detail.after, ...detail.before];
  const multiple = detail.after.length > 1 || detail.before.length > 1;
  const single = !multiple && primarySide.length === 1 ? primarySide[0] : null;
  const soleProprietorship = blocks.some((b) => b.legalForm === SOLE_PROPRIETORSHIP);
  const avisCanton = entry.canton && SWISS_CANTONS.has(entry.canton) ? entry.canton : null;

  if (multiple) {
    // Plusieurs sociétés dans un même avis : impossible de savoir à coup sûr quelle forme va avec
    // quel IDE ; la forme des totaux n'est gardée que si tous les blocs retenus la partagent.
    missing.multiple_blocks++;
    const forms = [...new Set(primarySide.map((b) => b.legalForm))];
    const tally = { event_type: entry.subRubric, canton: avisCanton ?? UNKNOWN_CANTON, legal_form: totalsLegalForm(forms.length === 1 ? forms[0] : null) };
    return { kind: "totals", tally, soleProprietorship };
  }

  const commune = single ? resolveCommune(single.seat, avisCanton) : null;
  const canton = commune?.canton ?? avisCanton;
  if (!canton) missing.canton++;
  const legalForm = single?.legalForm ?? null;
  if (!legalForm) missing.legal_form++;
  const uid = single?.uid ? parseUid(single.uid) : null;
  if (!uid?.ok) missing.uid++;
  if (!single?.seat) missing.seat++;
  const tally = { event_type: entry.subRubric, canton: canton ?? UNKNOWN_CANTON, legal_form: totalsLegalForm(legalForm) };
  const deletion = deleteOn(entry.publicationDate, entry.expirationDate);
  const storable = single !== null && blocks.every((b) => !b.repeated) && isRowStorable(blocks.map((b) => b.legalForm))
    && uid?.ok === true && canton !== null && legalForm !== null && !isDeletionDue(deletion, today);
  if (!storable || !uid?.ok || !canton || !legalForm) return { kind: "totals", tally, soleProprietorship };
  if (commune === null) missing.commune_unresolved++;
  return {
    kind: "row",
    tally,
    row: {
      publication_id: entry.id,
      ide: uid.uid,
      event_type: entry.subRubric,
      publication_date: entry.publicationDate,
      municipality_bfs_id: commune?.bfs ?? null,
      canton,
      legal_form: legalForm,
      delete_on: deletion,
      verified_on: today,
    },
  };
}

const LISTED_RUBRICS: ReadonlySet<string> = new Set(FOSC_RUBRICS);

/** Liste complète des avis PUBLISHED d'un jour (toutes les pages, toutes les rubriques lues). */
async function listDay(client: PoliteClient, day: string): Promise<ListEntry[]> {
  const entries: ListEntry[] = [];
  for (let page = 0; ; page++) {
    const body = await client.get(listUrl(day, page), { kind: "liste des avis", accept: "application/json", maxBytes: MAX_LIST_BYTES });
    let parsed;
    try { parsed = parseListPage(JSON.parse(body.toString("utf8"))); } catch (error) {
      if (error instanceof FoscListError) throw error;
      throw new FoscListError("JSON invalide");
    }
    for (const e of parsed.entries) {
      if (e.publicationDate !== day) throw new FoscListError("date hors du jour demandé");
      if (e.publicationState !== "PUBLISHED") throw new FoscListError("état inattendu");
      if (!LISTED_RUBRICS.has(e.subRubric.slice(0, 2))) throw new FoscListError("rubrique non demandée");
    }
    entries.push(...parsed.entries);
    if (parsed.entries.length < FOSC_MAX_PAGE_SIZE || entries.length >= parsed.total) {
      if (entries.length !== parsed.total) throw new FoscListError("total différent du nombre d'avis lus");
      if (new Set(entries.map((e) => e.id)).size !== entries.length) throw new FoscListError("avis en double");
      return entries;
    }
  }
}

async function checkTerms(client: PoliteClient, today: string, sha256: string, acceptedOn: string): Promise<CollectReport["terms"]> {
  if (daysBetween(acceptedOn, today) > FOSC_TERMS_RENEWAL_DAYS) return "acceptance_expired";
  let pdf: Buffer;
  try {
    pdf = await client.get(FOSC_TERMS_URL, { kind: "conditions générales", accept: "application/pdf", maxBytes: MAX_TERMS_BYTES });
  } catch (error) {
    if (error instanceof FoscBudgetError) throw error;
    return "terms_unreadable";
  }
  return createHash("sha256").update(pdf).digest("hex") === sha256 ? "ok" : "terms_changed";
}

const emptyDayReport = (date: string, status: DayReport["status"]): DayReport => ({
  date, status, listed: 0, by_subrubric: {}, details_read: 0, stored_rows: 0, totals_only: 0,
  sole_proprietorships: 0, persons: 0, estates: 0, test_imports: 0, detail_failed: 0, not_sampled: 0,
});

/** Échantillon régulier (simulation) : un avis sur `pas`, pour couvrir HR01, HR02 et HR03. */
export function evenSample(ids: string[], size: number): Set<string> {
  if (size <= 0) return new Set();
  if (size >= ids.length) return new Set(ids);
  const out = new Set<string>();
  for (let k = 0; k < size; k++) out.add(ids[Math.floor((k * ids.length) / size)]);
  return out;
}

const isUnchanged = (record: DayRecord | undefined, listed: ListEntry[], known: FoscEventRow[]): boolean => {
  if (!record) return false;
  // Un jour calculé avant l'ajout d'une rubrique (état version 1 : HR seul) est recalculé en entier.
  if (!FOSC_RUBRICS.every((r) => record.rubrics.includes(r))) return false;
  const ids = new Set(listed.map((e) => e.id));
  return record.listed === listed.length && record.stored_rows === known.length && known.every((r) => ids.has(r.publication_id));
};

/** Avis dont le détail est lu : HR01 à HR03, et les sous-rubriques connues qui peuvent donner une ligne. */
const isReadable = (e: ListEntry): boolean => PARSED_SUBRUBRICS.has(e.subRubric) || INSOLVENCY_BY_CODE.get(e.subRubric)?.rows === true;

/** Sous-rubrique d'une rubrique lue (KK, NA, LS, SR) dont le schéma n'a pas été relu. */
const isUnknownSubrubric = (e: ListEntry): boolean => INSOLVENCY_RUBRICS.has(e.subRubric.slice(0, 2)) && !INSOLVENCY_BY_CODE.has(e.subRubric);

export async function runFoscCollection(opts: CollectOptions): Promise<CollectReport> {
  const now = opts.now ?? new Date();
  const today = zurichDay(now);
  const window = opts.window ?? WINDOW_DAYS;
  const { client, store, resolveCommune } = opts;
  const resolvePostal: PostalResolver = opts.resolvePostal ?? (() => null);
  const raw = await store.loadState();
  const state: FoscState = raw === null ? emptyState(now) : validateState(raw);

  const report: CollectReport = {
    mode: opts.mode ?? "test", today, purge: { expired: purgeExpired(state, today), unverified: 0, unpublished: 0 }, months_frozen: 0, terms: "ok",
    verification: { days_checked: 0, days_failed: 0 }, days: [],
    missing: { uid: 0, legal_form: 0, seat: 0, canton: 0, commune_unresolved: 0, multiple_blocks: 0 },
    parsed_details: 0, insolvency: emptyInsolvencyCounts(),
    rows_stored_total: 0, requests: 0, rate_limited: 0, waited_seconds: 0, stopped: null, exit_code: 0,
  };
  let frozenMonths = new Set(state.months.map((m) => m.month));
  const targetDays = [...new Set(opts.days ?? windowDays(today, window))].sort();
  const pending: { record: DayRecord; rows: FoscEventRow[] }[] = [];
  let failed = false;
  /** Panne inattendue : relancée APRÈS l'enregistrement de la purge (l'état a pu être lu). */
  let unexpected: unknown = null;

  try {
    report.months_frozen = freezeMonths(state, today, now, window).length;
    frozenMonths = new Set(state.months.map((m) => m.month));
    report.terms = await checkTerms(client, today, opts.termsSha256 ?? FOSC_TERMS_SHA256, opts.termsAcceptedOn ?? FOSC_TERMS_ACCEPTED_ON);
    if (report.terms !== "ok") {
      report.stopped = "terms";
      failed = true;
    } else {
      // 4. Revérification des jours stockés hors de la liste à traiter (plus ancien d'abord).
      const toVerify = [...new Set(state.events.map((e) => e.publication_date))].filter((d) => !targetDays.includes(d)).sort();
      for (const day of toVerify) {
        report.verification.days_checked++;
        try {
          const listed = await listDay(client, day);
          report.purge.unpublished += applyVerification(state, day, new Set(listed.map((e) => e.id)), today);
        } catch (error) {
          if (error instanceof FoscBudgetError) throw error;
          report.verification.days_failed++;
        }
      }
      // 5. Jours de la fenêtre.
      for (const day of targetDays) {
        if (frozenMonths.has(day.slice(0, 7))) { report.days.push(emptyDayReport(day, "frozen_month")); continue; }
        let listed: ListEntry[];
        try {
          listed = await listDay(client, day);
        } catch (error) {
          if (error instanceof FoscBudgetError) throw error;
          report.days.push(emptyDayReport(day, "list_failed"));
          failed = true;
          continue;
        }
        const dr = emptyDayReport(day, "computed");
        dr.listed = listed.length;
        for (const e of listed) dr.by_subrubric[e.subRubric] = (dr.by_subrubric[e.subRubric] ?? 0) + 1;
        // Revérification d'abord : une ligne absente de la liste part, même si le recalcul échoue.
        report.purge.unpublished += applyVerification(state, day, new Set(listed.map((e) => e.id)), today);
        // Schéma inconnu d'une nouvelle sous-rubrique (KK13, NA13…) : arrêt, comme pour HR ;
        // aucun jour de ce passage n'est enregistré (la purge, si).
        if (listed.some(isUnknownSubrubric)) {
          dr.status = "schema_unknown";
          report.days.push(dr);
          report.stopped = "schema";
          failed = true;
          break;
        }
        const known = state.events.filter((e) => e.publication_date === day);
        const record = state.days.find((d) => d.date === day);
        if (isUnchanged(record, listed, known)) {
          dr.status = "unchanged";
          dr.stored_rows = known.length;
          report.days.push(dr);
          continue;
        }
        const knownById = new Map(known.map((r) => [r.publication_id, r]));
        const needed = listed.filter((e) => isReadable(e) && !knownById.has(e.id));
        const sample = opts.sampleDetails === undefined ? null : evenSample(needed.map((e) => e.id), opts.sampleDetails);
        const toRead = sample === null ? needed.length : sample.size;
        if (client.remaining() < toRead) { dr.status = "skipped_budget"; report.days.push(dr); report.stopped = "budget"; break; }
        const tallies = new Map<string, Tally>();
        const rows: FoscEventRow[] = [];
        for (const entry of listed) {
          const spec = INSOLVENCY_BY_CODE.get(entry.subRubric);
          // Canton de la liste ; pour les nouvelles rubriques, ignoré s'il y en a plusieurs.
          const canton = spec && entry.multipleCantons ? UNKNOWN_CANTON
            : entry.canton && SWISS_CANTONS.has(entry.canton) ? entry.canton : UNKNOWN_CANTON;
          if (!isReadable(entry)) {
            addTally(tallies, { event_type: entry.subRubric, canton, legal_form: totalsLegalForm(null) });
            dr.totals_only++;
            if (spec) report.insolvency.general_notices++;
            continue;
          }
          const reused = knownById.get(entry.id);
          if (reused) {
            rows.push({ ...reused, verified_on: today });
            addTally(tallies, { event_type: reused.event_type, canton: reused.canton, legal_form: reused.legal_form });
            dr.stored_rows++;
            continue;
          }
          if (sample !== null && !sample.has(entry.id)) { dr.not_sampled++; continue; }
          // Le document XML n'existe qu'ici, en mémoire : seuls les champs autorisés en sortent.
          let detail: AvisDetail | null = null;
          let insolvencyDetail: InsolvencyDetail | null = null;
          try {
            const xml = await client.get(detailXmlUrl(entry.id), { kind: "détail d'un avis", accept: "application/xml", maxBytes: MAX_DETAIL_BYTES });
            dr.details_read++;
            if (spec) insolvencyDetail = parseInsolvencyDetail(xml.toString("utf8"), spec);
            else detail = parseAvisDetail(xml.toString("utf8"));
            if ((insolvencyDetail ?? detail)?.id !== entry.id) throw new FoscXmlError("avis différent de celui demandé");
          } catch (error) {
            if (error instanceof FoscBudgetError) throw error;
            if (!(error instanceof FoscHttpError) && !(error instanceof FoscXmlError)) throw error;
            dr.detail_failed++;
            addTally(tallies, { event_type: entry.subRubric, canton, legal_form: totalsLegalForm(null) });
            continue;
          }
          if (spec && insolvencyDetail) {
            if (insolvencyDetail.testImport) { dr.test_imports++; continue; }
            const ins = report.insolvency;
            ins.parsed++;
            const c = classifyInsolvencyAvis(entry, insolvencyDetail, spec, resolvePostal, today);
            ins.outcomes[c.outcome]++;
            addTally(tallies, c.tally);
            if (c.kind === "row") {
              rows.push(c.row);
              dr.stored_rows++;
              if (!c.communeResolved) ins.commune_unresolved++;
              if (c.row.dates) ins.with_dates++;
            } else {
              dr.totals_only++;
              if (c.outcome === "person" || c.outcome === "estate") dr.persons++;
              if (c.outcome === "estate") dr.estates++;
              if (c.outcome === "sole_proprietorship") dr.sole_proprietorships++;
            }
            continue;
          }
          if (!detail) continue;
          if (detail.testImport) { dr.test_imports++; continue; }
          report.parsed_details++;
          const c = classifyAvis(entry, detail, resolveCommune, today, report.missing);
          addTally(tallies, c.tally);
          if (c.kind === "row") { rows.push(c.row); dr.stored_rows++; } else {
            dr.totals_only++;
            if (c.soleProprietorship) dr.sole_proprietorships++;
          }
        }
        const attempted = dr.details_read + dr.detail_failed;
        if (dr.detail_failed >= 3 && dr.detail_failed > attempted * MAX_DETAIL_FAILED_RATIO) {
          dr.status = "failed";
          failed = true;
          report.days.push(dr);
          continue;
        }
        pending.push({
          rows,
          record: {
            date: day, listed: listed.length, stored_rows: dr.stored_rows, totals_only: dr.totals_only,
            sole_proprietorships: dr.sole_proprietorships, test_imports: dr.test_imports, detail_failed: dr.detail_failed,
            rubrics: [...FOSC_RUBRICS], persons: dr.persons, estates: dr.estates,
            computed_at: now.toISOString(), tallies: sortTallies(tallies.values()),
          },
        });
        report.days.push(dr);
      }
    }
  } catch (error) {
    if (error instanceof FoscBudgetError) {
      report.stopped = error.reason === "requests" ? "budget" : error.reason;
    } else {
      unexpected = error;
      failed = true;
    }
    // Le jour en cours de calcul n'est pas enregistré : il sera refait en entier au passage suivant.
  }

  // Contrôle du schéma sur l'ensemble des détails lus pendant ce passage : HR (IDE ou forme
  // manquants) et nouvelles rubriques (avis sans aucune partie reconnue, signe d'un chemin qui a
  // changé). Après une panne inattendue ou un arrêt sur le schéma, aucun jour nouveau n'est
  // enregistré ; la purge et les revérifications, si.
  const missingCore = Math.max(report.missing.uid, report.missing.legal_form);
  if (report.parsed_details >= MIN_PARSED_FOR_RATIO && missingCore > report.parsed_details * MAX_MISSING_RATIO) {
    report.stopped = "schema";
    failed = true;
  }
  const ins = report.insolvency;
  if (ins.parsed >= MIN_PARSED_FOR_RATIO && ins.outcomes.no_party > ins.parsed * MAX_MISSING_RATIO) {
    report.stopped = "schema";
    failed = true;
  }
  if (report.stopped !== "schema" && unexpected === null) {
    for (const p of pending) replaceDay(state, p.record, p.rows);
  }
  // Version de schéma ou espace de noms inconnus (sortie de formulaires du portail, environ trois
  // fois par an) : les jours restent enregistrés, ces avis restent en totaux, HR continue ; mais le
  // passage sort en code 1 pour que l'alerte parte au lieu d'une panne silencieuse (plus aucune ligne).
  if (ins.outcomes.unknown_schema > 0) failed = true;

  report.purge.unverified = purgeUnverified(state, today);
  state.updated_at = now.toISOString();
  await store.saveState(state);
  await store.saveTotals(buildTotals(state, today, now));

  report.rows_stored_total = state.events.length;
  report.requests = client.stats.requests;
  report.rate_limited = client.stats.rateLimited;
  report.waited_seconds = Math.round(client.stats.waitedMs / 1000);
  const oldest = windowDays(today, window)[0];
  const oldestLost = opts.days === undefined && state.collection_started_on !== null && oldest >= state.collection_started_on
    && !state.days.some((d) => d.date === oldest) && !frozenMonths.has(oldest.slice(0, 7));
  report.exit_code = failed ? 1 : oldestLost ? 2 : 0;
  if (unexpected !== null) throw new FoscUnexpectedError(report, unexpected);
  return report;
}

// ------------------------------------------------------------------------------------------
// Ligne de commande
// ------------------------------------------------------------------------------------------

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export interface CliArgs {
  dryRun: boolean;
  writeR2: boolean;
  out?: string;
  days?: string[];
  sampleDetails?: number;
  maxRequests: number;
  delayMs: number;
  deadlineMinutes: number;
}

export function parseCliArgs(argv: string[], env: NodeJS.ProcessEnv): CliArgs {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} attend une valeur`);
    return v;
  };
  const int = (flag: string, def: number, min: number): number => {
    const v = value(flag);
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) throw new Error(`${flag} invalide`);
    return n;
  };
  const dryRun = env.FOSC_DRY_RUN === "1" || argv.includes("--dry-run");
  const writeR2 = argv.includes("--write-r2");
  if (dryRun === writeR2) throw new Error("Choisir soit la simulation (FOSC_DRY_RUN=1 --out <dossier>), soit le passage réel (--write-r2)");
  const out = value("--out");
  const daysArg = value("--days");
  const days = daysArg?.split(",").map((d) => d.trim());
  if (days && !days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error("--days attend des dates AAAA-MM-JJ séparées par des virgules");
  const sample = value("--sample-details");
  const args: CliArgs = {
    dryRun, writeR2, out, days,
    sampleDetails: sample === undefined ? undefined : int("--sample-details", 0, 0),
    maxRequests: int("--max-requests", DEFAULT_MAX_REQUESTS, 1),
    delayMs: int("--delay-ms", 500, 250),
    deadlineMinutes: int("--deadline-minutes", 60, 1),
  };
  if (dryRun) {
    if (!out) throw new Error("La simulation exige --out <dossier> hors du dépôt");
    const abs = resolve(out);
    if (abs === REPO_ROOT || abs.startsWith(REPO_ROOT + sep)) throw new Error("--out doit être hors du dépôt (aucune donnée d'avis dans la copie de travail)");
  } else if (days || sample !== undefined || out) {
    throw new Error("--days, --sample-details et --out sont réservés à la simulation");
  }
  return args;
}

/** Résumé pour le journal : des nombres et des dates seulement. */
export function formatReport(r: CollectReport): string {
  const lines = [
    `[fosc] mode ${r.mode}, jour ${r.today}, conditions : ${r.terms}${r.stopped ? `, arrêt : ${r.stopped}` : ""}`,
    `[fosc] purge : ${r.purge.expired} échue(s), ${r.purge.unpublished} plus publiée(s), ${r.purge.unverified} non revérifiée(s) ; mois figés : ${r.months_frozen}`,
    `[fosc] revérification : ${r.verification.days_checked} jour(s), ${r.verification.days_failed} en échec`,
    ...r.days.map((d) => `[fosc] ${d.date} ${d.status} : ${d.listed} avis listés (${Object.entries(d.by_subrubric).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`).join(", ") || "aucun"}), `
      + `${d.details_read} détails lus, ${d.stored_rows} lignes de sociétés, ${d.totals_only} en totaux seulement dont ${d.sole_proprietorships} entreprises individuelles `
      + `et ${d.persons} personnes physiques (dont ${d.estates} successions), `
      + `${d.test_imports} essais, ${d.detail_failed} en échec, ${d.not_sampled} hors échantillon`),
    `[fosc] HR, champs manquants sur ${r.parsed_details} détails : IDE ${r.missing.uid}, forme ${r.missing.legal_form}, siège ${r.missing.seat}, canton ${r.missing.canton}, commune non rapprochée ${r.missing.commune_unresolved}, avis à plusieurs sociétés ${r.missing.multiple_blocks}`,
    formatInsolvency(r.insolvency),
    `[fosc] lignes conservées : ${r.rows_stored_total} ; requêtes : ${r.requests}, refus 429/503 : ${r.rate_limited}, attente : ${r.waited_seconds} s ; code de sortie ${r.exit_code}`,
  ];
  return lines.join("\n");
}

/** Ligne du journal des nouvelles rubriques : des nombres seulement. */
export function formatInsolvency(c: InsolvencyCounts): string {
  const o = c.outcomes;
  return `[fosc] faillites, concordats, liquidations, appels aux créanciers sur ${c.parsed} détails : ${o.row} lignes de sociétés `
    + `(${c.with_dates} avec dates, ${c.commune_unresolved} sans commune) ; totaux seulement : personnes ${o.person}, successions ${o.estate}, `
    + `entreprises individuelles ${o.sole_proprietorship}, sans forme juridique ${o.no_legal_form}, sans IDE ${o.no_uid}, autre forme ${o.other_form}, `
    + `plusieurs parties ${o.multiple_parties}, sans partie reconnue ${o.no_party}, cas ambigus ${o.ambiguous}, schéma inconnu ${o.unknown_schema}, `
    + `sans canton ${o.no_canton}, échéance proche ${o.expiring} ; autres avis non lus ${c.general_notices}`;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2), process.env);
  const store = args.dryRun ? fileStore(resolve(args.out!)) : r2Store();
  const client = createPoliteClient({ maxRequests: args.maxRequests, delayMs: args.delayMs, deadlineMs: Date.now() + args.deadlineMinutes * 60_000 });
  const report = await runFoscCollection({
    store, client, resolveCommune: loadCommuneResolver(), resolvePostal: loadPostalResolver(), days: args.days, sampleDetails: args.sampleDetails,
    mode: args.dryRun ? "dry_run" : "real",
  });
  console.log(formatReport(report));
  process.exitCode = report.exit_code;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    // Message seul : jamais une pile ni un extrait de réponse (journal public). Le message d'une
    // SyntaxError cite l'entrée analysée : il est remplacé par son seul type.
    const describe = (e: unknown) => !(e instanceof Error) ? "erreur inconnue"
      : e instanceof SyntaxError ? "SyntaxError (message masqué : il citerait le contenu lu)" : `${e.name} : ${e.message}`;
    if (err instanceof FoscUnexpectedError) {
      // L'état purgé a été enregistré : le journal montre la ligne « purge » du passage.
      console.log(formatReport(err.report));
      console.error("[fosc] ERREUR :", err.message, "—", describe(err.original));
    } else {
      console.error("[fosc] ERREUR :", describe(err));
    }
    process.exitCode = 1;
  });
}
