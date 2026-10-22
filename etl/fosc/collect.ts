#!/usr/bin/env tsx
/**
 * Collecte quotidienne des avis du registre du commerce publiés dans la FOSC (rubrique HR),
 * décision de Claude-Alain du 16.10.2026 (d3 = A, F8 accordé) : « des totaux, et les événements
 * des sociétés ». Ne publie rien et ne branche aucune page.
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
 *   2. purge sans réseau des lignes arrivées à leur fin de conservation, puis mois figés ;
 *   3. garde-fous des CG : acceptation de moins de 90 jours (CG 1.2 al. 1), PDF des CG inchangé
 *      (CG 1.1 al. 4) ; sinon aucune lecture du portail, l'état purgé est quand même écrit ;
 *   4. revérification des jours stockés hors fenêtre (liste PUBLISHED de chaque jour) ;
 *   5. jours de la fenêtre de rattrapage, du plus ancien au plus récent : un jour inchangé est
 *      seulement revérifié ; un jour nouveau ou changé est recalculé EN ENTIER (sociétés déjà
 *      connues relues dans l'état sans requête, autres avis relus en mémoire) ;
 *   6. purge des lignes non revérifiées depuis plus de trois jours (y compris quand le portail
 *      n'a pas pu être lu), puis écriture de l'état et des totaux.
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
import { loadCommuneResolver, SWISS_CANTONS, type CommuneResolver } from "./communes.js";
import { isRowStorable, SOLE_PROPRIETORSHIP, totalsLegalForm } from "./legal-forms.js";
import { FoscListError, parseListPage, type ListEntry } from "./list.js";
import {
  detailXmlUrl, FOSC_MAX_PAGE_SIZE, FOSC_TERMS_ACCEPTED_ON, FOSC_TERMS_RENEWAL_DAYS, FOSC_TERMS_SHA256, FOSC_TERMS_URL, listUrl,
} from "./sources.js";
import {
  addTally, applyVerification, emptyState, expiresOn, freezeMonths, purgeExpired, purgeUnverified, replaceDay, sortTallies,
  validateState, WINDOW_DAYS, windowDays, zurichDay, type DayRecord, type FoscEventRow, type FoscState, type PurgeCounts, type Tally,
} from "./state.js";
import { fileStore, r2Store, type FoscStore } from "./store.js";
import { buildTotals } from "./totals.js";
import { FoscXmlError, parseAvisDetail, type AvisDetail } from "./xml.js";

export const PARSED_SUBRUBRICS: ReadonlySet<string> = new Set(["HR01", "HR02", "HR03"]);
export const UNKNOWN_CANTON = "inconnu";
/** Au-delà de 5 % de détails sans IDE ou sans forme juridique, le schéma a probablement changé. */
export const MAX_MISSING_RATIO = 0.05;
export const MIN_PARSED_FOR_RATIO = 50;
/** Un jour dont plus de 1 % des détails (au moins 3) échouent n'est pas enregistré. */
export const MAX_DETAIL_FAILED_RATIO = 0.01;
export const DEFAULT_MAX_REQUESTS = 3000;
const MAX_LIST_BYTES = 30_000_000;
const MAX_DETAIL_BYTES = 2_000_000;
const MAX_TERMS_BYTES = 5_000_000;

export interface MissingCounts { uid: number; legal_form: number; seat: number; canton: number; commune_unresolved: number }

export interface DayReport {
  date: string;
  status: "unchanged" | "computed" | "skipped_budget" | "failed" | "frozen_month" | "list_failed";
  listed: number;
  by_subrubric: Record<string, number>;
  details_read: number;
  stored_rows: number;
  totals_only: number;
  sole_proprietorships: number;
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
  missing: MissingCounts;
  parsed_details: number;
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

type Classified =
  | { kind: "row"; row: FoscEventRow; tally: Omit<Tally, "count"> }
  | { kind: "totals"; tally: Omit<Tally, "count">; soleProprietorship: boolean };

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Décide ce qu'un avis devient : une ligne de société (liste blanche) ou un simple total.
 * Canton retenu : celui de la commune du siège quand elle est rapprochée (après l'événement ;
 * avant pour une radiation), sinon celui de l'avis (office qui publie).
 */
export function classifyAvis(entry: ListEntry, detail: AvisDetail, resolveCommune: CommuneResolver, today: string, missing: MissingCounts): Classified {
  const primary = entry.subRubric === "HR03" ? (detail.before ?? detail.after) : (detail.after ?? detail.before);
  const sides = [detail.after, detail.before].filter((s): s is NonNullable<typeof s> => s !== null);
  const avisCanton = entry.canton && SWISS_CANTONS.has(entry.canton) ? entry.canton : null;
  const commune = resolveCommune(primary?.seat ?? null, avisCanton);
  const canton = commune?.canton ?? avisCanton;
  if (!canton) missing.canton++;
  const legalForm = primary?.legalForm ?? null;
  if (!legalForm) missing.legal_form++;
  const uid = primary?.uid ? parseUid(primary.uid) : null;
  if (!uid?.ok) missing.uid++;
  if (!primary?.seat) missing.seat++;
  const tally = { event_type: entry.subRubric, canton: canton ?? UNKNOWN_CANTON, legal_form: totalsLegalForm(legalForm) };
  const expires = expiresOn(entry.publicationDate, entry.expirationDate);
  const storable = primary !== null && isRowStorable(sides.map((s) => s.legalForm)) && uid?.ok === true && canton !== null && expires >= today;
  if (!storable || !uid?.ok || !canton || !legalForm) {
    return { kind: "totals", tally, soleProprietorship: sides.some((s) => s.legalForm === SOLE_PROPRIETORSHIP) };
  }
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
      expires_on: expires,
      verified_on: today,
    },
  };
}

/** Liste complète des avis PUBLISHED d'un jour (toutes les pages). */
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
  sole_proprietorships: 0, test_imports: 0, detail_failed: 0, not_sampled: 0,
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
  const ids = new Set(listed.map((e) => e.id));
  return record.listed === listed.length && record.stored_rows === known.length && known.every((r) => ids.has(r.publication_id));
};

export async function runFoscCollection(opts: CollectOptions): Promise<CollectReport> {
  const now = opts.now ?? new Date();
  const today = zurichDay(now);
  const window = opts.window ?? WINDOW_DAYS;
  const { client, store, resolveCommune } = opts;
  const raw = await store.loadState();
  const state: FoscState = raw === null ? emptyState(now) : validateState(raw);

  const report: CollectReport = {
    mode: opts.mode ?? "test", today, purge: { expired: purgeExpired(state, today), unverified: 0, unpublished: 0 }, months_frozen: 0, terms: "ok",
    verification: { days_checked: 0, days_failed: 0 }, days: [],
    missing: { uid: 0, legal_form: 0, seat: 0, canton: 0, commune_unresolved: 0 },
    parsed_details: 0, rows_stored_total: 0, requests: 0, rate_limited: 0, waited_seconds: 0, stopped: null, exit_code: 0,
  };
  report.months_frozen = freezeMonths(state, today, now, window).length;
  const frozenMonths = new Set(state.months.map((m) => m.month));
  const targetDays = [...new Set(opts.days ?? windowDays(today, window))].sort();
  const pending: { record: DayRecord; rows: FoscEventRow[] }[] = [];
  let failed = false;

  try {
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
        const known = state.events.filter((e) => e.publication_date === day);
        const record = state.days.find((d) => d.date === day);
        if (isUnchanged(record, listed, known)) {
          dr.status = "unchanged";
          dr.stored_rows = known.length;
          report.days.push(dr);
          continue;
        }
        const knownById = new Map(known.map((r) => [r.publication_id, r]));
        const needed = listed.filter((e) => PARSED_SUBRUBRICS.has(e.subRubric) && !knownById.has(e.id));
        const sample = opts.sampleDetails === undefined ? null : evenSample(needed.map((e) => e.id), opts.sampleDetails);
        const toRead = sample === null ? needed.length : sample.size;
        if (client.remaining() < toRead) { dr.status = "skipped_budget"; report.days.push(dr); report.stopped = "budget"; break; }
        const tallies = new Map<string, Tally>();
        const rows: FoscEventRow[] = [];
        for (const entry of listed) {
          const canton = entry.canton && SWISS_CANTONS.has(entry.canton) ? entry.canton : UNKNOWN_CANTON;
          if (!PARSED_SUBRUBRICS.has(entry.subRubric)) {
            addTally(tallies, { event_type: entry.subRubric, canton, legal_form: totalsLegalForm(null) });
            dr.totals_only++;
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
          let detail: AvisDetail;
          try {
            const xml = await client.get(detailXmlUrl(entry.id), { kind: "détail d'un avis", accept: "application/xml", maxBytes: MAX_DETAIL_BYTES });
            dr.details_read++;
            detail = parseAvisDetail(xml.toString("utf8"));
            if (detail.id !== entry.id) throw new FoscXmlError("avis différent de celui demandé");
          } catch (error) {
            if (error instanceof FoscBudgetError) throw error;
            if (!(error instanceof FoscHttpError) && !(error instanceof FoscXmlError)) throw error;
            dr.detail_failed++;
            addTally(tallies, { event_type: entry.subRubric, canton, legal_form: totalsLegalForm(null) });
            continue;
          }
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
            computed_at: now.toISOString(), tallies: sortTallies(tallies.values()),
          },
        });
        report.days.push(dr);
      }
    }
  } catch (error) {
    if (!(error instanceof FoscBudgetError)) throw error;
    report.stopped = error.reason === "requests" ? "budget" : error.reason;
    // Le jour en cours de calcul n'est pas enregistré : il sera refait en entier au passage suivant.
  }

  // Contrôle du schéma sur l'ensemble des détails lus pendant ce passage.
  const missingCore = Math.max(report.missing.uid, report.missing.legal_form);
  if (report.parsed_details >= MIN_PARSED_FOR_RATIO && missingCore > report.parsed_details * MAX_MISSING_RATIO) {
    report.stopped = "schema";
    failed = true;
  } else {
    for (const p of pending) replaceDay(state, p.record, p.rows);
  }

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
    ...r.days.map((d) => `[fosc] ${d.date} ${d.status} : ${d.listed} avis listés (${Object.entries(d.by_subrubric).map(([k, v]) => `${k} ${v}`).join(", ") || "aucun"}), `
      + `${d.details_read} détails lus, ${d.stored_rows} lignes de sociétés, ${d.totals_only} en totaux seulement dont ${d.sole_proprietorships} entreprises individuelles, `
      + `${d.test_imports} essais, ${d.detail_failed} en échec, ${d.not_sampled} hors échantillon`),
    `[fosc] champs manquants sur ${r.parsed_details} détails : IDE ${r.missing.uid}, forme ${r.missing.legal_form}, siège ${r.missing.seat}, canton ${r.missing.canton}, commune non rapprochée ${r.missing.commune_unresolved}`,
    `[fosc] lignes conservées : ${r.rows_stored_total} ; requêtes : ${r.requests}, refus 429/503 : ${r.rate_limited}, attente : ${r.waited_seconds} s ; code de sortie ${r.exit_code}`,
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2), process.env);
  const store = args.dryRun ? fileStore(resolve(args.out!)) : r2Store();
  const client = createPoliteClient({ maxRequests: args.maxRequests, delayMs: args.delayMs, deadlineMs: Date.now() + args.deadlineMinutes * 60_000 });
  const report = await runFoscCollection({
    store, client, resolveCommune: loadCommuneResolver(), days: args.days, sampleDetails: args.sampleDetails,
    mode: args.dryRun ? "dry_run" : "real",
  });
  console.log(formatReport(report));
  process.exitCode = report.exit_code;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    // Message seul : jamais une pile ni un extrait de réponse (journal public).
    console.error("[fosc] ERREUR :", err instanceof Error ? err.message : "erreur inconnue");
    process.exitCode = 1;
  });
}
