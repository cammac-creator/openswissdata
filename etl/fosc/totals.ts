/**
 * Totaux mensuels des avis HR (étage or, NON publié dans ce lot).
 *
 * Étage lu : argent (`state.ts`, totaux par jour et mois figés ; jamais les lignes de sociétés).
 * Étage écrit : or, un document JSON au schéma versionné `openswissdata.fosc-hr-monthly-totals`
 * v1, par mois : totaux par type d'événement × canton × forme juridique (entreprises
 * individuelles comprises), sommes par type, par canton et par forme, et couverture (jours
 * collectés, jours manquants depuis le début de la collecte).
 *
 * Chaque document porte la source, la mention « Ceci n'est pas une publication officielle » et
 * les indications de qualité du SECO (CG 3.3), pour toute exploitation future. Aucun nom, aucun
 * IDE, aucun identifiant d'avis, aucun classement d'entreprise (décision du 06.10.2026).
 *
 * Ce qui resterait publiable après la durée de publication des avis : question ouverte, décrite
 * dans `publication` ci-dessous et dans `etl/fosc/SOURCES.md`. Rien n'est publié par ce lot.
 */
import { LEGAL_FORM_LABELS, UNKNOWN_LEGAL_FORM } from "./legal-forms.js";
import {
  FOSC_NOT_OFFICIAL_NOTICE, FOSC_PUBLICATIONS_URL, FOSC_QUALITY_NOTICE, FOSC_SOURCE_LABEL,
  FOSC_TERMS_URL, FOSC_TERMS_VERSION, OFS_LEGAL_FORMS_I14Y_URL,
} from "./sources.js";
import { addDays, addTally, sortTallies, type FoscState, type Tally } from "./state.js";

export const TOTALS_SCHEMA = "openswissdata.fosc-hr-monthly-totals";
export const TOTALS_SCHEMA_VERSION = 1;

export const EVENT_TYPE_LABELS = {
  HR01: { fr: "Nouvelles inscriptions", de: "Neueintragungen", en: "New registrations" },
  HR02: { fr: "Mutations", de: "Mutationen", en: "Changes" },
  HR03: { fr: "Radiations", de: "Löschungen", en: "Deletions" },
} as const;

export interface MonthTotals {
  month: string;
  status: "open" | "frozen";
  days_collected: number;
  days_missing: string[];
  listed: number;
  detail_failed: number;
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
  legal_forms: { source_url: string; labels: typeof LEGAL_FORM_LABELS; unknown_code: string };
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

function monthEntry(month: string, status: "open" | "frozen", cells: Tally[], collected: string[], listed: number,
  detailFailed: number, startedOn: string | null, today: string): MonthTotals {
  const have = new Set(collected);
  return {
    month,
    status,
    days_collected: collected.length,
    days_missing: monthDays(month, startedOn, today).filter((d) => !have.has(d)),
    listed,
    detail_failed: detailFailed,
    total: cells.reduce((s, c) => s + c.count, 0),
    by_event_type: sumBy(cells, "event_type"),
    by_canton: sumBy(cells, "canton"),
    by_legal_form: sumBy(cells, "legal_form"),
    cells,
  };
}

export function buildTotals(state: FoscState, today: string, now: Date): TotalsDocument {
  const months: MonthTotals[] = state.months.map((m) =>
    monthEntry(m.month, "frozen", m.tallies, m.days_collected, m.listed, m.detail_failed, state.collection_started_on, today));
  const open = new Map<string, typeof state.days>();
  for (const d of state.days) open.set(d.date.slice(0, 7), [...(open.get(d.date.slice(0, 7)) ?? []), d]);
  for (const [month, days] of open) {
    const cells = new Map<string, Tally>();
    for (const d of days) for (const t of d.tallies) addTally(cells, t, t.count);
    months.push(monthEntry(month, "open", sortTallies(cells.values()), days.map((d) => d.date).sort(),
      days.reduce((s, d) => s + d.listed, 0), days.reduce((s, d) => s + d.detail_failed, 0), state.collection_started_on, today));
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
      fr: "Avis de la rubrique Registre du commerce (HR01 à HR03) encore publiés à la date de la collecte, comptés par date de publication, canton de la commune du siège (à défaut, canton de l'office qui publie) et forme juridique, après l'événement (avant l'événement pour une radiation). Les entreprises individuelles sont comprises dans ces totaux. Un avis annulé après la fermeture de la fenêtre de rattrapage de sept jours n'est pas retranché. Les jours sans collecte sont listés, jamais estimés.",
      de: "Meldungen der Rubrik Handelsregister (HR01 bis HR03), die am Tag der Erhebung noch publiziert sind, gezählt nach Publikationsdatum, Kanton der Sitzgemeinde (sonst Kanton des publizierenden Amtes) und Rechtsform, nach dem Ereignis (bei Löschungen vor dem Ereignis). Einzelunternehmen sind in diesen Summen enthalten. Eine nach Ablauf des siebentägigen Nachholfensters annullierte Meldung wird nicht abgezogen. Tage ohne Erhebung werden aufgeführt, nie geschätzt.",
      en: "Commercial Register notices (HR01 to HR03) still published on the collection date, counted by publication date, canton of the municipality of the registered office (otherwise canton of the publishing office) and legal form, after the event (before the event for a deletion). Sole proprietorships are included in these totals. A notice cancelled after the seven-day catch-up window has closed is not subtracted. Days without collection are listed, never estimated.",
    },
    event_types: EVENT_TYPE_LABELS,
    legal_forms: { source_url: OFS_LEGAL_FORMS_I14Y_URL, labels: LEGAL_FORM_LABELS, unknown_code: UNKNOWN_LEGAL_FORM },
    publication: {
      status: "not_published",
      rule: {
        fr: "Non publié. À décider avant toute publication : seuil de petites cases (une case de 1 dans un petit canton ou une forme rare désigne un seul avis, souvent une entreprise individuelle), niveau de détail (canton ou national) et durée d'affichage après la durée de publication des avis concernés.",
        en: "Not published. To be decided before any publication: small-cell threshold (a cell of 1 in a small canton or a rare legal form points to a single notice, often a sole proprietorship), level of detail (canton or national) and display period after the publication period of the notices concerned.",
      },
    },
    collection_started_on: state.collection_started_on,
    months,
  };
}
