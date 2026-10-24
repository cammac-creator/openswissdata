/**
 * Totaux mensuels des avis de la FOSC (étage or, NON publié) : rubrique HR et, depuis le lot du
 * 24.10.2026, faillites (KK), concordats (NA), appels aux créanciers suite à une liquidation (LS)
 * et autres appels aux créanciers (SR).
 *
 * Étage lu : argent (`state.ts`, totaux par jour et mois figés ; jamais les lignes de sociétés).
 * Étage écrit : or, un document JSON au schéma versionné `openswissdata.fosc-hr-monthly-totals`
 * v2 (nom gardé pour la continuité de la clé R2), par mois : totaux par type d'événement × canton
 * × forme juridique (entreprises individuelles, personnes physiques et successions comprises,
 * sous les codes `0101`, `personne` et `succession`), sommes par type, par canton et par forme, et
 * couverture (jours collectés, jours manquants depuis le début de la collecte), en tout et par
 * rubrique : un jour calculé avec la seule rubrique HR ne compte jamais comme couvert pour KK.
 *
 * Chaque document porte la source, la mention « Ceci n'est pas une publication officielle » et
 * les indications de qualité du SECO (CG 3.3), pour toute exploitation future. Aucun nom, aucun
 * IDE, aucun identifiant d'avis, aucun classement d'entreprise (décision du 06.10.2026).
 *
 * Ce qui resterait publiable après la durée de publication des avis : question ouverte, décrite
 * dans `publication` ci-dessous et dans `etl/fosc/SOURCES.md`. Rien n'est publié par ce lot.
 */
import { LEGAL_FORM_LABELS, SPECIAL_TOTALS_LABELS, UNKNOWN_LEGAL_FORM } from "./legal-forms.js";
import {
  FOSC_NOT_OFFICIAL_NOTICE, FOSC_PUBLICATIONS_URL, FOSC_QUALITY_NOTICE, FOSC_SOURCE_LABEL,
  FOSC_TERMS_URL, FOSC_TERMS_VERSION, OFS_LEGAL_FORMS_I14Y_URL,
} from "./sources.js";
import { addDays, addTally, sortTallies, type FoscState, type Tally } from "./state.js";
import { ALL_EVENT_TYPE_LABELS, RUBRIC_LABELS } from "./subrubrics.js";

export const TOTALS_SCHEMA = "openswissdata.fosc-hr-monthly-totals";
export const TOTALS_SCHEMA_VERSION = 2;

/** Intitulés des types d'événement (sous-rubriques HR, KK, NA, LS, SR). */
export const EVENT_TYPE_LABELS = ALL_EVENT_TYPE_LABELS;

export interface MonthTotals {
  month: string;
  status: "open" | "frozen";
  days_collected: number;
  days_missing: string[];
  listed: number;
  detail_failed: number;
  /** Par rubrique : jours collectés et jours manquants depuis le premier jour collecté de cette rubrique. */
  days_collected_by_rubric: Record<string, number>;
  days_missing_by_rubric: Record<string, string[]>;
  total: number;
  by_event_type: Record<string, number>;
  by_canton: Record<string, number>;
  by_legal_form: Record<string, number>;
  cells: Tally[];
}

export interface TotalsDocument {
  schema: typeof TOTALS_SCHEMA;
  schema_version: typeof TOTALS_SCHEMA_VERSION;
  generated_at: string;
  source: {
    id: string;
    label: typeof FOSC_SOURCE_LABEL;
    url: string;
    terms_url: string;
    terms_version: string;
  };
  not_official_notice: typeof FOSC_NOT_OFFICIAL_NOTICE;
  source_quality_notice: typeof FOSC_QUALITY_NOTICE;
  method: Record<"fr" | "de" | "en", string>;
  event_types: typeof EVENT_TYPE_LABELS;
  rubrics: typeof RUBRIC_LABELS;
  legal_forms: { source_url: string; labels: typeof LEGAL_FORM_LABELS; special_codes: typeof SPECIAL_TOTALS_LABELS; unknown_code: string };
  publication: { status: "not_published"; rule: Record<"fr" | "en", string> };
  collection_started_on: string | null;
  months: MonthTotals[];
}

const sumBy = (cells: Tally[], key: "event_type" | "canton" | "legal_form"): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const c of cells) out[c[key]] = (out[c[key]] ?? 0) + c.count;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
};

function monthDays(month: string, from: string | null, today: string): string[] {
  const out: string[] = [];
  let d = `${month}-01`;
  while (d.slice(0, 7) === month && d <= today) {
    if (!from || d >= from) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/** Premier jour collecté de chaque rubrique (jours ouverts et mois figés confondus). */
function rubricStarts(state: FoscState): Map<string, string> {
  const starts = new Map<string, string>();
  const see = (r: string, d: string) => { const prev = starts.get(r); if (!prev || d < prev) starts.set(r, d); };
  for (const d of state.days) for (const r of d.rubrics) see(r, d.date);
  for (const m of state.months) for (const [r, days] of Object.entries(m.days_collected_by_rubric)) for (const d of days) see(r, d);
  return starts;
}

function monthEntry(month: string, status: "open" | "frozen", cells: Tally[], collected: string[], byRubric: Record<string, string[]>,
  listed: number, detailFailed: number, startedOn: string | null, starts: Map<string, string>, today: string): MonthTotals {
  const have = new Set(collected);
  const rubrics = [...starts.keys()].filter((r) => (starts.get(r) ?? "") <= `${month}-31`).sort();
  const collectedBy: Record<string, number> = {};
  const missingBy: Record<string, string[]> = {};
  for (const r of rubrics) {
    const got = new Set(byRubric[r] ?? []);
    collectedBy[r] = got.size;
    missingBy[r] = monthDays(month, starts.get(r) ?? null, today).filter((d) => !got.has(d));
  }
  return {
    month,
    status,
    days_collected: collected.length,
    days_missing: monthDays(month, startedOn, today).filter((d) => !have.has(d)),
    listed,
    detail_failed: detailFailed,
    days_collected_by_rubric: collectedBy,
    days_missing_by_rubric: missingBy,
    total: cells.reduce((s, c) => s + c.count, 0),
    by_event_type: sumBy(cells, "event_type"),
    by_canton: sumBy(cells, "canton"),
    by_legal_form: sumBy(cells, "legal_form"),
    cells,
  };
}

export function buildTotals(state: FoscState, today: string, now: Date): TotalsDocument {
  const starts = rubricStarts(state);
  const months: MonthTotals[] = state.months.map((m) =>
    monthEntry(m.month, "frozen", m.tallies, m.days_collected, m.days_collected_by_rubric, m.listed, m.detail_failed, state.collection_started_on, starts, today));
  const open = new Map<string, typeof state.days>();
  for (const d of state.days) open.set(d.date.slice(0, 7), [...(open.get(d.date.slice(0, 7)) ?? []), d]);
  for (const [month, days] of open) {
    const cells = new Map<string, Tally>();
    for (const d of days) for (const t of d.tallies) addTally(cells, t, t.count);
    const byRubric: Record<string, string[]> = {};
    for (const d of days) for (const r of d.rubrics) (byRubric[r] ??= []).push(d.date);
    months.push(monthEntry(month, "open", sortTallies(cells.values()), days.map((d) => d.date).sort(), byRubric,
      days.reduce((s, d) => s + d.listed, 0), days.reduce((s, d) => s + d.detail_failed, 0), state.collection_started_on, starts, today));
  }
  months.sort((a, b) => a.month.localeCompare(b.month));
  return {
    schema: TOTALS_SCHEMA,
    schema_version: TOTALS_SCHEMA_VERSION,
    generated_at: now.toISOString(),
    source: { id: "seco.fosc_hr", label: FOSC_SOURCE_LABEL, url: FOSC_PUBLICATIONS_URL, terms_url: FOSC_TERMS_URL, terms_version: FOSC_TERMS_VERSION },
    not_official_notice: FOSC_NOT_OFFICIAL_NOTICE,
    source_quality_notice: FOSC_QUALITY_NOTICE,
    method: {
      fr: "Avis des rubriques Registre du commerce (HR01 à HR03), Faillites (KK), Concordats (NA), Appels aux créanciers suite à la liquidation (LS) et Autres appels aux créanciers relevant du droit des sociétés (SR) encore publiés à la date de la collecte, comptés par date de publication, sous-rubrique, canton et forme juridique. Canton : celui de la commune du siège (HR) ou de l'adresse de la société (autres rubriques), à défaut celui de l'office qui publie. Forme : après l'événement (avant l'événement pour une radiation) ; « personne » pour un débiteur personne physique, « succession » pour une succession ou une succession répudiée, « inconnue » quand la forme n'est pas indiquée. Les entreprises individuelles, les personnes et les successions sont comprises dans ces totaux. Un avis annulé après la fermeture de la fenêtre de rattrapage de sept jours n'est pas retranché. Les jours sans collecte sont listés, en tout et par rubrique, jamais estimés.",
      de: "Meldungen der Rubriken Handelsregister (HR01 bis HR03), Konkurse (KK), Nachlassverfahren (NA), Liquidationsschuldenrufe (LS) und Weitere gesellschaftsrechtliche Schuldenrufe (SR), die am Tag der Erhebung noch publiziert sind, gezählt nach Publikationsdatum, Unterrubrik, Kanton und Rechtsform. Kanton: jener der Sitzgemeinde (HR) oder der Adresse der Gesellschaft (übrige Rubriken), sonst jener des publizierenden Amtes. Rechtsform: nach dem Ereignis (bei Löschungen vor dem Ereignis); «personne» für eine natürliche Person als Schuldnerin, «succession» für einen Nachlass oder eine ausgeschlagene Erbschaft, «inconnue», wenn die Rechtsform nicht angegeben ist. Einzelunternehmen, natürliche Personen und Nachlässe sind in diesen Summen enthalten. Eine nach Ablauf des siebentägigen Nachholfensters annullierte Meldung wird nicht abgezogen. Tage ohne Erhebung werden insgesamt und je Rubrik aufgeführt, nie geschätzt.",
      en: "Notices of the sections Commercial Register (HR01 to HR03), Bankruptcies (KK), Composition proceedings (NA), Calls to creditors following liquidation (LS) and Other calls to creditors issued under company law (SR) still published on the collection date, counted by publication date, sub-section, canton and legal form. Canton: that of the municipality of the registered office (HR) or of the company's address (other sections), otherwise that of the publishing office. Legal form: after the event (before the event for a deletion); \"personne\" for a natural-person debtor, \"succession\" for an estate or a refused estate, \"inconnue\" when no legal form is given. Sole proprietorships, natural persons and estates are included in these totals. A notice cancelled after the seven-day catch-up window has closed is not subtracted. Days without collection are listed, overall and per section, never estimated.",
    },
    event_types: EVENT_TYPE_LABELS,
    rubrics: RUBRIC_LABELS,
    legal_forms: { source_url: OFS_LEGAL_FORMS_I14Y_URL, labels: LEGAL_FORM_LABELS, special_codes: SPECIAL_TOTALS_LABELS, unknown_code: UNKNOWN_LEGAL_FORM },
    publication: {
      status: "not_published",
      rule: {
        fr: "Non publié. À décider avant toute publication : seuil de petites cases (une case de 1 dans un petit canton ou une forme rare désigne un seul avis, souvent une entreprise individuelle, une personne ou une succession), niveau de détail (canton ou national) et durée d'affichage après la durée de publication des avis concernés.",
        en: "Not published. To be decided before any publication: small-cell threshold (a cell of 1 in a small canton or a rare legal form points to a single notice, often a sole proprietorship, a natural person or an estate), level of detail (canton or national) and display period after the publication period of the notices concerned.",
      },
    },
    collection_started_on: state.collection_started_on,
    months,
  };
}
