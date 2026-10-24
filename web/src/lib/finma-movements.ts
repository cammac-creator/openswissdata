/**
 * Vitrine « Mouvements FINMA » (lot V2, décisions de Claude-Alain des 16.10, 20.10 et 21.10.2026).
 *
 * Lit, au build, le bloc `history.movements` (schéma 1, calculé par `etl/finma/movements.ts`)
 * recopié chaque jour dans le témoin public `docs/data-status/finma.json`, et prépare tout ce
 * que la page affiche. Des TOTAUX seulement : ce module ne laisse passer que des nombres, des
 * mois et des dates au format attendu ; une catégorie inconnue est rangée dans « autre ». Aucun
 * nom, IDE ni adresse de page ne peut atteindre la page, même si le témoin en portait par erreur.
 *
 * Bloc absent (avant la première collecte qui le porte) : état « waiting », aucun nombre.
 * Bloc présent mais illisible : état « unavailable », aucun nombre plutôt qu'un nombre douteux.
 */
import type { Lang } from '../i18n/utils';
import { TYPE_LABEL } from './finma-i18n';
import { SOURCES } from './guides';

export const MOVEMENTS_PATH = '/finma-movements/';
export const MOVEMENTS_EVENT = 'etre_prevenu';
/** Sujet de l'inscription par e-mail (route /api/announcements/request) : seule valeur acceptée par le serveur. */
export const MOVEMENTS_SIGNUP_SUBJECT = 'finma-historique';
export const MOVEMENTS_SCHEMA_VERSION = 1;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const VERSION = /^(\d{4})\.(\d{2})\.(\d{2})(?:\.[0-9A-Za-z]+)?$/;
const REGISTRY_KINDS = ['added', 'removed', 'licence_changed', 'name_changed', 'city_changed'] as const;
const WARNING_KINDS = ['appeared', 'appeared_late', 'removed', 'removed_possible_url_change'] as const;
/** Catégories que la page sait nommer ; toute autre clé du témoin est comptée dans « other ». */
const CATEGORIES = [...Object.keys(TYPE_LABEL.fr), 'other'] as const;

type RegistryKind = (typeof REGISTRY_KINDS)[number];
export type RegistryCounts = Record<RegistryKind, number>;
export interface CategoryCounts extends RegistryCounts { category: string }
export interface SafeRegistry extends RegistryCounts { byCategory: CategoryCounts[]; reclassified: number }
export interface SafeWarnings {
  addedDated: number; appeared: number; appearedLate: number; removed: number; removedUrlChange: number;
}
export interface SafeMonth {
  month: string; status: 'open' | 'frozen'; partial: boolean; daysInMonth: number;
  registry: SafeRegistry; registryDays: number; warnings: SafeWarnings; warningsDays: number; excluded: number;
}
export interface SafeResumption {
  from: string; to: string; days: number; registry: SafeRegistry;
  warnings: (Omit<SafeWarnings, 'addedDated'> & { byFinmaMonth: Array<{ month: string; count: number }>; undated: number }) | null;
  anomaly: boolean;
}
export interface SafeMovements { computedIn: string; lastObserved: string | null; months: SafeMonth[]; resumptions: SafeResumption[] }
export type MovementsReading = { state: 'waiting' } | { state: 'unavailable' } | { state: 'ready'; block: SafeMovements };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
class Unreadable extends Error {}
const count = (source: Record<string, unknown>, key: string): number => {
  const value = source[key];
  if (!isCount(value)) throw new Unreadable(key);
  return value;
};
const object = (v: unknown, what: string): Record<string, unknown> => {
  if (!isObject(v)) throw new Unreadable(what);
  return v;
};
const versionDay = (v: unknown): string => {
  const m = typeof v === 'string' ? VERSION.exec(v) : null;
  if (!m) throw new Unreadable('version');
  return `${m[1]}-${m[2]}-${m[3]}`;
};

function readRegistry(value: unknown): SafeRegistry {
  const registry = object(value, 'registry');
  const totals = object(registry.totals, 'totals');
  const merged = new Map<string, CategoryCounts>();
  for (const [key, raw] of Object.entries(object(registry.by_category, 'by_category'))) {
    const counts = object(raw, 'category');
    const category = (CATEGORIES as readonly string[]).includes(key) ? key : 'other';
    const row = merged.get(category) ?? { category, added: 0, removed: 0, licence_changed: 0, name_changed: 0, city_changed: 0 };
    for (const kind of REGISTRY_KINDS) row[kind] += count(counts, kind);
    merged.set(category, row);
  }
  const byCategory = CATEGORIES.flatMap(category => {
    const row = merged.get(category);
    return row && (row.added || row.removed || row.licence_changed) ? [row] : [];
  });
  return {
    added: count(totals, 'added'), removed: count(totals, 'removed'), licence_changed: count(totals, 'licence_changed'),
    name_changed: count(totals, 'name_changed'), city_changed: count(totals, 'city_changed'),
    byCategory, reclassified: count(registry, 'reclassified_by_collection'),
  };
}

function readWarnings(value: Record<string, unknown>) {
  return {
    appeared: count(value, 'appeared'), appearedLate: count(value, 'appeared_late'),
    removed: count(value, 'removed'), removedUrlChange: count(value, 'removed_possible_url_change'),
  };
}

function readMonth(value: unknown): SafeMonth {
  const month = object(value, 'month');
  if (typeof month.month !== 'string' || !MONTH.test(month.month)) throw new Unreadable('month');
  if (month.status !== 'open' && month.status !== 'frozen') throw new Unreadable('status');
  if (typeof month.partial !== 'boolean') throw new Unreadable('partial');
  const daysInMonth = count(month, 'days_in_month');
  const registry = object(month.registry, 'registry');
  const warnings = object(month.warnings, 'warnings');
  const registryDays = count(registry, 'days_covered'), warningsDays = count(warnings, 'days_covered');
  if (daysInMonth < 28 || daysInMonth > 31 || registryDays > daysInMonth || warningsDays > daysInMonth) throw new Unreadable('days');
  if (!Array.isArray(month.excluded)) throw new Unreadable('excluded');
  return {
    month: month.month, status: month.status, partial: month.partial, daysInMonth,
    registry: readRegistry(registry), registryDays,
    warnings: { addedDated: count(warnings, 'added_dated_in_month'), ...readWarnings(warnings) }, warningsDays,
    excluded: month.excluded.length,
  };
}

function readResumption(value: unknown): SafeResumption {
  const r = object(value, 'resumption');
  const from = versionDay(r.from), to = versionDay(r.to);
  let warnings: SafeResumption['warnings'] = null;
  if (r.warnings !== null && r.warnings !== undefined) {
    const w = object(r.warnings, 'warnings');
    const byFinmaMonth = Object.entries(object(w.appeared_by_finma_month, 'appeared_by_finma_month')).map(([month, n]) => {
      if (!MONTH.test(month) || !isCount(n)) throw new Unreadable('appeared_by_finma_month');
      return { month, count: n };
    }).sort((a, b) => a.month.localeCompare(b.month));
    warnings = { ...readWarnings(w), byFinmaMonth, undated: count(w, 'appeared_undated') };
  }
  return {
    from, to, days: count(r, 'days'), registry: readRegistry(r.registry), warnings,
    anomaly: (typeof r.registry_anomaly === 'string' && r.registry_anomaly !== '') || (typeof r.warnings_anomaly === 'string' && r.warnings_anomaly !== ''),
  };
}

/** Lit le témoin public (objet JSON déjà décodé, ou undefined si le fichier manque). */
export function readMovements(witness: unknown): MovementsReading {
  if (!isObject(witness) || !isObject(witness.history) || !('movements' in witness.history)) return { state: 'waiting' };
  const block = witness.history.movements;
  try {
    const value = object(block, 'block');
    if (value.schema_version !== MOVEMENTS_SCHEMA_VERSION) throw new Unreadable('schema_version');
    if (!Array.isArray(value.months) || !Array.isArray(value.resumptions)) throw new Unreadable('months');
    const months = value.months.map(readMonth).sort((a, b) => a.month.localeCompare(b.month));
    if (new Set(months.map(m => m.month)).size !== months.length) throw new Unreadable('duplicate month');
    const resumptions = value.resumptions.map(readResumption).sort((a, b) => a.from.localeCompare(b.from));
    const lastObserved = value.last_observed === null ? null
      : typeof value.last_observed === 'string' && DAY.test(value.last_observed) ? value.last_observed : (() => { throw new Unreadable('last_observed'); })();
    const computedIn = versionDay(value.computed_in_version);
    if (!months.length && !resumptions.length) return { state: 'waiting' };
    return { state: 'ready', block: { computedIn, lastObserved, months, resumptions } };
  } catch (error) {
    if (error instanceof Unreadable) return { state: 'unavailable' };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Textes FR/DE/EN. Aucune date ni aucun prix pour la suite (« en préparation ») : ce serait une
// promesse, interdite sans décision. Ni « bientôt », ni « bald », ni « soon ».

interface Copy {
  metaTitle: string; description: string; breadcrumb: [string, string, string]; breadcrumbLabel: string;
  kicker: string; h1: string; accent: string; lede: string;
  notice: string[];
  freshness: (day: string) => string;
  waitingTitle: string; waitingText: string; unavailableTitle: string; unavailableText: string;
  summaryKicker: string; summaryTitle: string;
  open: string; frozen: string; partial: string; complete: string;
  coverage: (days: number, of: number) => string; coverageShort: (days: number, of: number) => string;
  statAdded: [string, string]; statRemoved: [string, string]; statWarnings: [string, string];
  secondary: (licence: number, names: number, cities: number) => string;
  reclassified: (n: number) => string; excluded: (n: number) => string;
  categoriesTitle: string; categoriesNote: string; categoriesEmpty: string; categoryAria: (label: string, added: number, removed: number) => string;
  legendAdded: string; legendRemoved: string; legendWarnings: string;
  trendTitle: string; trendNote: string;
  registryKicker: string; registryTitle: string; registryIntro: string;
  cols: { month: string; coverage: string; added: string; removed: string; licence: string; names: string; cities: string };
  warningsKicker: string; warningsTitle: string; warningsIntro: string;
  wcols: { month: string; coverage: string; dated: string; appeared: string; late: string; removed: string };
  removedCell: (removed: number, urlChange: number) => string;
  warningsNote: string[];
  scrollHint: string;
  resumptionKicker: string; resumptionTitle: string; resumptionIntro: string;
  resumptionHeading: (from: string, to: string, days: number) => string;
  resumptionRegistry: string; resumptionWarnings: string;
  resumptionByMonth: string; resumptionUndated: (n: number) => string; resumptionAnomaly: string; resumptionNoWarnings: string;
  methodKicker: string; methodTitle: string; methodIntro: string; method: Array<[string, string]>;
  nextTitle: string; nextText: string; button: string; buttonNote: string; thanks: string; error: string;
  signup: SignupCopy;
  sourceTitle: string; sourceText: string; sourceLink: string; productLink: string; guideLink: string;
}

/** Inscription par e-mail sous le bouton (24.10.2026) : case non cochée, confirmation par e-mail. */
export interface SignupCopy {
  title: string; emailLabel: string; consent: string; privacyLead: string; privacyLink: string; submit: string;
  success: string; invalidEmail: string; consentMissing: string; tooMany: string; error: string;
}

const COPY: Record<Lang, Copy> = {
  fr: {
    metaTitle: 'Mouvements FINMA, mois par mois',
    description: 'Combien d’autorisations apparaissent et disparaissent chaque mois dans les listes publiques de la FINMA : totaux par catégorie, sans aucun nom.',
    breadcrumb: ['Les données', 'FINMA Registry', 'Mouvements'], breadcrumbLabel: 'Fil d’Ariane',
    kicker: 'FINMA · Listes publiques', h1: 'Mouvements FINMA,', accent: 'mois par mois.',
    lede: 'Les autorisations qui apparaissent et disparaissent dans le registre public de la FINMA, et les ajouts à sa liste d’alerte, comptés à partir des relevés quotidiens d’OpenSwissData. Des totaux seulement : aucun nom.',
    notice: ['Ceci n’est pas une publication officielle de la FINMA.', 'Dates d’observation, pas dates de décision.', 'Un retrait n’est pas une sanction.'],
    freshness: day => `Chiffres arrêtés au relevé du ${day}.`,
    waitingTitle: 'Les premiers chiffres ne sont pas encore affichés.',
    waitingText: 'Les totaux mensuels sont calculés par la collecte quotidienne. Ils apparaissent sur cette page une fois qu’une version publiée les contient ; d’ici là, aucun total n’est affiché.',
    unavailableTitle: 'Les chiffres ne peuvent pas être affichés pour le moment.',
    unavailableText: 'La dernière version lue ne contient pas de totaux lisibles : la page n’affiche aucun chiffre plutôt qu’un chiffre douteux.',
    summaryKicker: '01 / Le dernier mois', summaryTitle: 'Le mois en un regard',
    open: 'En cours', frozen: 'Clos', partial: 'Partiel', complete: 'Complet',
    coverage: (d, of) => `${d} ${d > 1 ? 'jours couverts' : 'jour couvert'} sur ${of}`, coverageShort: (d, of) => `${d} j / ${of}`,
    statAdded: ['Apparitions au registre', 'Autorisations apparues entre deux relevés.'],
    statRemoved: ['Disparitions du registre', 'Autorisations disparues, sans motif connu. Ce n’est pas une sanction.'],
    statWarnings: ['Ajouts à la liste d’alerte', 'Entrées datées de ce mois par la FINMA. Un total, aucun nom.'],
    secondary: (l, n, c) => `Changements de type d’autorisation : ${l} · noms modifiés : ${n} · localités modifiées : ${c}`,
    reclassified: n => `${n} ${n > 1 ? 'lignes reclassées' : 'ligne reclassée'} par notre propre collecte (même autorisation FINMA, autre catégorie chez nous) : hors des mouvements.`,
    excluded: n => `${n} ${n > 1 ? 'comparaisons jugées anormales, exclues' : 'comparaison jugée anormale, exclue'} de ce mois.`,
    categoriesTitle: 'Par catégorie', categoriesNote: 'Apparitions et disparitions du registre, dans la catégorie de l’autorisation. Seules les catégories qui ont bougé sont listées.',
    categoriesEmpty: 'Aucun mouvement du registre ce mois-ci.', categoryAria: (label, a, r) => `${label} : ${a} apparitions, ${r} disparitions`,
    legendAdded: 'Apparitions', legendRemoved: 'Disparitions', legendWarnings: 'Ajouts à la liste d’alerte',
    trendTitle: 'Mois par mois', trendNote: 'Les mois partiels ne sont pas directement comparables : leur couverture figure dans les tableaux.',
    registryKicker: '02 / Le registre', registryTitle: 'Le registre, mois par mois',
    registryIntro: 'Chaque ligne compare les relevés consécutifs du mois. Un changement de type d’autorisation est compté dans la catégorie de la nouvelle autorisation.',
    cols: { month: 'Mois', coverage: 'Couverture', added: 'Apparitions', removed: 'Disparitions', licence: 'Changements de type', names: 'Noms modifiés', cities: 'Localités modifiées' },
    warningsKicker: '03 / La liste d’alerte', warningsTitle: 'La liste d’alerte, en totaux',
    warningsIntro: 'Aucun nom ni aucun lien vers une entrée : seulement des nombres. Les ajouts du mois suivent la date d’ajout publiée par la FINMA.',
    wcols: { month: 'Mois', coverage: 'Couverture', dated: 'Ajouts datés du mois', appeared: 'Apparues', late: 'dont tardives', removed: 'Retirées (dont adresse changée ?)' },
    removedCell: (r, u) => `${r} (dont ${u})`,
    warningsNote: [
      'Apparues tardivement : entrées vues pour la première fois alors que leur date FINMA est plus ancienne que le relevé précédent.',
      'Un retrait de la liste d’alerte est rare et souvent un simple changement d’adresse de la page de la FINMA : « adresse changée ? » compte les retraits dont la même date d’ajout réapparaît sous une autre adresse. Un retrait ne dit pas pourquoi et n’est pas une sanction.',
    ],
    scrollHint: 'Faites défiler le tableau pour voir toutes les colonnes.',
    resumptionKicker: '04 / Après le trou de la collecte', resumptionTitle: 'Constatés à la reprise, comptés à part',
    resumptionIntro: 'Aucune collecte n’a tourné pendant cet intervalle. Les changements constatés à la reprise peuvent dater de n’importe quel jour de l’intervalle : ils ne sont comptés dans aucun mois.',
    resumptionHeading: (from, to, days) => `Du ${from} au ${to} : ${days} jours sans relevé`,
    resumptionRegistry: 'Registre', resumptionWarnings: 'Liste d’alerte',
    resumptionByMonth: 'Apparues, par mois de leur date d’ajout FINMA', resumptionUndated: n => `sans date d’ajout : ${n}`,
    resumptionAnomaly: 'Cette comparaison a dépassé le seuil des jours anormaux : à lire avec prudence.', resumptionNoWarnings: 'Liste d’alerte non comparée pour cet intervalle.',
    methodKicker: '05 / Méthode', methodTitle: 'Comment c’est compté',
    methodIntro: 'Chaque jour, OpenSwissData relève les listes publiques de la FINMA et compare deux relevés consécutifs.',
    method: [
      ['Un constat, pas une décision', 'Un mouvement est rangé dans le mois du relevé qui le constate, pas à la date de la décision de la FINMA.'],
      ['Un retrait n’est pas une sanction', 'Une disparition du registre ou de la liste d’alerte ne dit pas pourquoi. Le relevé ne permet pas d’en connaître le motif.'],
      ['Des mois partiels signalés', 'Un mois sans relevé chaque jour porte la mention « partiel » et son nombre de jours couverts. Un mois clos est figé et n’est plus recalculé. Trou connu : du 24.08 au 25.09.2026.'],
      ['Notre collecte n’est pas un mouvement', 'Un reclassement fait par notre propre collecte (même autorisation FINMA, autre catégorie chez nous) est exclu. Une comparaison anormale est exclue du mois et signalée.'],
      ['Liste d’alerte par adresse exacte', 'Apparitions et retraits se comptent par l’adresse exacte de la page de détail, jamais par le nom. Aucun nom ni aucun lien n’est publié ici.'],
    ],
    nextTitle: 'Historique détaillé et veille : en préparation.',
    nextText: 'Un historique plus fin de ces mouvements vous serait utile ? Dites-le d’un clic.',
    button: 'Être prévenu de l’historique détaillé',
    buttonNote: 'Ce bouton ne demande ni adresse ni inscription : le clic est compté comme nos autres statistiques de visite, pseudonymisées (voir la politique de confidentialité). Il sert seulement à mesurer l’intérêt. Suivez cette page pour la suite.',
    thanks: 'Merci, c’est noté.', error: 'Le signal n’a pas pu être envoyé. Vous pouvez réessayer plus tard.',
    signup: {
      title: 'Être prévenu(e) par e-mail',
      emailLabel: 'Adresse e-mail',
      consent: 'Je veux être prévenu(e) par e-mail quand l’historique détaillé sera disponible',
      privacyLead: 'Une confirmation vous est demandée par e-mail. Détails :', privacyLink: 'politique de confidentialité',
      submit: 'Envoyer la demande',
      success: 'Si l’adresse est valide, un e-mail de confirmation vient de partir.',
      invalidEmail: 'Indiquez une adresse e-mail valide.',
      consentMissing: 'Cochez la case pour confirmer votre demande.',
      tooMany: 'Trop de demandes depuis votre connexion. Réessayez plus tard.',
      error: 'La demande n’a pas pu être envoyée. Vous pouvez réessayer plus tard.',
    },
    sourceTitle: 'Source : FINMA, listes publiques.',
    sourceText: 'Lecture proposée par OpenSwissData, service privé indépendant, sans affiliation à la FINMA. Ceci n’est pas une publication officielle de la FINMA.',
    sourceLink: 'Consulter les listes officielles de la FINMA', productLink: 'Le fichier FINMA complet', guideLink: 'Lire le guide sur la liste d’alerte',
  },
  de: {
    metaTitle: 'FINMA-Bewegungen, Monat für Monat',
    description: 'Wie viele Bewilligungen jeden Monat in den öffentlichen Listen der FINMA erscheinen und verschwinden: Summen je Kategorie, ohne jeden Namen.',
    breadcrumb: ['Datensätze', 'FINMA Registry', 'Bewegungen'], breadcrumbLabel: 'Brotkrumennavigation',
    kicker: 'FINMA · Öffentliche Listen', h1: 'FINMA-Bewegungen,', accent: 'Monat für Monat.',
    lede: 'Bewilligungen, die im öffentlichen Register der FINMA erscheinen und verschwinden, und Einträge, die ihrer Warnliste hinzugefügt werden, gezählt aus den täglichen Erhebungen von OpenSwissData. Nur Summen: kein Name.',
    notice: ['Dies ist keine offizielle Veröffentlichung der FINMA.', 'Beobachtungsdaten, keine Entscheiddaten.', 'Eine Streichung ist keine Sanktion.'],
    freshness: day => `Zahlen gemäss Erhebung vom ${day}.`,
    waitingTitle: 'Die ersten Zahlen werden noch nicht angezeigt.',
    waitingText: 'Die monatlichen Summen werden von der täglichen Erhebung berechnet. Sie erscheinen auf dieser Seite, wenn eine veröffentlichte Version sie enthält; bis dahin wird keine Summe angezeigt.',
    unavailableTitle: 'Die Zahlen können derzeit nicht angezeigt werden.',
    unavailableText: 'Die zuletzt gelesene Version enthält keine lesbaren Summen: Die Seite zeigt lieber keine Zahl als eine zweifelhafte.',
    summaryKicker: '01 / Der letzte Monat', summaryTitle: 'Der Monat auf einen Blick',
    open: 'Laufend', frozen: 'Abgeschlossen', partial: 'Teilweise', complete: 'Vollständig',
    coverage: (d, of) => `${d} von ${of} ${of > 1 ? 'Tagen' : 'Tag'} abgedeckt`, coverageShort: (d, of) => `${d} T / ${of}`,
    statAdded: ['Neu im Register', 'Bewilligungen, die zwischen zwei Erhebungen erschienen sind.'],
    statRemoved: ['Aus dem Register verschwunden', 'Bewilligungen, die verschwunden sind, Grund unbekannt. Das ist keine Sanktion.'],
    statWarnings: ['Neu auf der Warnliste', 'Einträge, die die FINMA auf diesen Monat datiert. Eine Summe, kein Name.'],
    secondary: (l, n, c) => `Wechsel der Bewilligungsart: ${l} · geänderte Namen: ${n} · geänderte Orte: ${c}`,
    reclassified: n => `${n} ${n > 1 ? 'Zeilen' : 'Zeile'} durch unsere eigene Erhebung neu zugeordnet (gleiche FINMA-Bewilligung, andere Kategorie bei uns): nicht als Bewegung gezählt.`,
    excluded: n => `${n} ${n > 1 ? 'Vergleiche als auffällig eingestuft und' : 'Vergleich als auffällig eingestuft und'} aus diesem Monat ausgeschlossen.`,
    categoriesTitle: 'Nach Kategorie', categoriesNote: 'Zu- und Abgänge im Register, in der Kategorie der Bewilligung. Aufgeführt sind nur Kategorien mit Bewegungen.',
    categoriesEmpty: 'Keine Bewegung im Register in diesem Monat.', categoryAria: (label, a, r) => `${label}: ${a} Zugänge, ${r} Abgänge`,
    legendAdded: 'Zugänge', legendRemoved: 'Abgänge', legendWarnings: 'Neu auf der Warnliste',
    trendTitle: 'Monat für Monat', trendNote: 'Teilweise abgedeckte Monate sind nicht direkt vergleichbar: Ihre Abdeckung steht in den Tabellen.',
    registryKicker: '02 / Das Register', registryTitle: 'Das Register, Monat für Monat',
    registryIntro: 'Jede Zeile vergleicht die aufeinanderfolgenden Erhebungen des Monats. Ein Wechsel der Bewilligungsart zählt in der Kategorie der neuen Bewilligung.',
    cols: { month: 'Monat', coverage: 'Abdeckung', added: 'Zugänge', removed: 'Abgänge', licence: 'Wechsel der Art', names: 'Geänderte Namen', cities: 'Geänderte Orte' },
    warningsKicker: '03 / Die Warnliste', warningsTitle: 'Die Warnliste, in Summen',
    warningsIntro: 'Kein Name und kein Link zu einem Eintrag: nur Zahlen. Die Zugänge des Monats folgen dem von der FINMA veröffentlichten Aufnahmedatum.',
    wcols: { month: 'Monat', coverage: 'Abdeckung', dated: 'Auf den Monat datiert', appeared: 'Erschienen', late: 'davon verspätet', removed: 'Gestrichen (davon Adresse geändert?)' },
    removedCell: (r, u) => `${r} (davon ${u})`,
    warningsNote: [
      'Verspätet erschienen: Einträge, die zum ersten Mal gesehen wurden, obwohl ihr FINMA-Datum vor der vorherigen Erhebung liegt.',
      'Eine Streichung von der Warnliste ist selten und oft nur eine geänderte Adresse der FINMA-Seite: «Adresse geändert?» zählt Streichungen, deren Aufnahmedatum unter einer anderen Adresse wieder erscheint. Eine Streichung nennt keinen Grund und ist keine Sanktion.',
    ],
    scrollHint: 'Scrollen Sie die Tabelle, um alle Spalten zu sehen.',
    resumptionKicker: '04 / Nach der Erhebungslücke', resumptionTitle: 'Bei der Wiederaufnahme festgestellt, separat gezählt',
    resumptionIntro: 'In diesem Zeitraum lief keine Erhebung. Bei der Wiederaufnahme festgestellte Änderungen können von jedem Tag des Zeitraums stammen: Sie zählen in keinem Monat.',
    resumptionHeading: (from, to, days) => `Vom ${from} bis ${to}: ${days} Tage ohne Erhebung`,
    resumptionRegistry: 'Register', resumptionWarnings: 'Warnliste',
    resumptionByMonth: 'Erschienen, nach Monat ihres FINMA-Aufnahmedatums', resumptionUndated: n => `ohne Aufnahmedatum: ${n}`,
    resumptionAnomaly: 'Dieser Vergleich lag über der Schwelle für auffällige Tage: mit Vorsicht lesen.', resumptionNoWarnings: 'Warnliste für diesen Zeitraum nicht verglichen.',
    methodKicker: '05 / Methode', methodTitle: 'So wird gezählt',
    methodIntro: 'OpenSwissData erhebt täglich die öffentlichen Listen der FINMA und vergleicht zwei aufeinanderfolgende Erhebungen.',
    method: [
      ['Eine Beobachtung, kein Entscheid', 'Eine Bewegung zählt im Monat der Erhebung, die sie feststellt, nicht am Datum des FINMA-Entscheids.'],
      ['Eine Streichung ist keine Sanktion', 'Ein Abgang aus dem Register oder von der Warnliste nennt keinen Grund. Die Erhebung lässt keinen Rückschluss auf das Motiv zu.'],
      ['Teilweise Monate gekennzeichnet', 'Ein Monat ohne tägliche Erhebung trägt den Vermerk «teilweise» und die Zahl der abgedeckten Tage. Ein abgeschlossener Monat ist eingefroren und wird nicht neu berechnet. Bekannte Lücke: 24.08. bis 25.09.2026.'],
      ['Unsere Erhebung ist keine Bewegung', 'Eine Neuzuordnung durch unsere eigene Erhebung (gleiche FINMA-Bewilligung, andere Kategorie bei uns) wird ausgeschlossen. Ein auffälliger Vergleich wird aus dem Monat ausgeschlossen und ausgewiesen.'],
      ['Warnliste nach exakter Adresse', 'Zu- und Abgänge zählen nach der exakten Adresse der Detailseite, nie nach dem Namen. Hier wird weder ein Name noch ein Link veröffentlicht.'],
    ],
    nextTitle: 'Detaillierter Verlauf und Überwachung: in Vorbereitung.',
    nextText: 'Wäre Ihnen ein genauerer Verlauf dieser Bewegungen nützlich? Sagen Sie es mit einem Klick.',
    button: 'Über den detaillierten Verlauf informiert werden',
    buttonNote: 'Diese Schaltfläche verlangt weder Adresse noch Anmeldung: Der Klick wird wie unsere übrigen, pseudonymisierten Besuchsstatistiken gezählt (siehe Datenschutzerklärung). Er dient nur dazu, das Interesse zu messen. Verfolgen Sie diese Seite für das Weitere.',
    thanks: 'Danke, notiert.', error: 'Das Signal konnte nicht gesendet werden. Sie können es später erneut versuchen.',
    signup: {
      title: 'Per E-Mail benachrichtigt werden',
      emailLabel: 'E-Mail-Adresse',
      consent: 'Ich möchte per E-Mail benachrichtigt werden, wenn der detaillierte Verlauf verfügbar ist',
      privacyLead: 'Sie erhalten eine E-Mail zur Bestätigung. Details:', privacyLink: 'Datenschutzerklärung',
      submit: 'Anfrage senden',
      success: 'Wenn die Adresse gültig ist, wurde soeben eine Bestätigungs-E-Mail versendet.',
      invalidEmail: 'Geben Sie eine gültige E-Mail-Adresse ein.',
      consentMissing: 'Kreuzen Sie das Kästchen an, um Ihre Anfrage zu bestätigen.',
      tooMany: 'Zu viele Anfragen über Ihre Verbindung. Versuchen Sie es später erneut.',
      error: 'Die Anfrage konnte nicht gesendet werden. Sie können es später erneut versuchen.',
    },
    sourceTitle: 'Quelle: FINMA, öffentliche Listen.',
    sourceText: 'Auswertung von OpenSwissData, einem unabhängigen privaten Dienst ohne Verbindung zur FINMA. Dies ist keine offizielle Veröffentlichung der FINMA.',
    sourceLink: 'Die offiziellen Listen der FINMA ansehen', productLink: 'Die vollständige FINMA-Datei', guideLink: 'Den Leitfaden zur Warnliste lesen',
  },
  en: {
    metaTitle: 'FINMA movements, month by month',
    description: 'How many authorisations appear in and disappear from FINMA’s public lists each month: totals by category, with no names at all.',
    breadcrumb: ['The data', 'FINMA Registry', 'Movements'], breadcrumbLabel: 'Breadcrumb',
    kicker: 'FINMA · Public lists', h1: 'FINMA movements,', accent: 'month by month.',
    lede: 'Authorisations that appear in and disappear from FINMA’s public register, and additions to its warning list, counted from OpenSwissData’s daily collections. Totals only: no names.',
    notice: ['This is not an official FINMA publication.', 'Observation dates, not decision dates.', 'A removal is not a sanction.'],
    freshness: day => `Figures as of the collection of ${day}.`,
    waitingTitle: 'The first figures are not shown yet.',
    waitingText: 'The monthly totals are computed by the daily collection. They appear on this page once a published version contains them; until then, no total is shown.',
    unavailableTitle: 'The figures cannot be shown at the moment.',
    unavailableText: 'The latest version read contains no readable totals: the page shows no figure rather than a doubtful one.',
    summaryKicker: '01 / The latest month', summaryTitle: 'The month at a glance',
    open: 'In progress', frozen: 'Closed', partial: 'Partial', complete: 'Complete',
    coverage: (d, of) => `${d} of ${of} days covered`, coverageShort: (d, of) => `${d} d / ${of}`,
    statAdded: ['New in the register', 'Authorisations that appeared between two collections.'],
    statRemoved: ['Gone from the register', 'Authorisations that disappeared, reason unknown. This is not a sanction.'],
    statWarnings: ['Added to the warning list', 'Entries FINMA dates to this month. A total, no names.'],
    secondary: (l, n, c) => `Changes of authorisation type: ${l} · names changed: ${n} · places changed: ${c}`,
    reclassified: n => `${n} ${n > 1 ? 'rows' : 'row'} reclassified by our own collection (same FINMA authorisation, different category on our side): not counted as movements.`,
    excluded: n => `${n} ${n > 1 ? 'comparisons judged abnormal and' : 'comparison judged abnormal and'} excluded from this month.`,
    categoriesTitle: 'By category', categoriesNote: 'Register additions and removals, in the category of the authorisation. Only categories that moved are listed.',
    categoriesEmpty: 'No register movement this month.', categoryAria: (label, a, r) => `${label}: ${a} added, ${r} removed`,
    legendAdded: 'Added', legendRemoved: 'Removed', legendWarnings: 'Added to the warning list',
    trendTitle: 'Month by month', trendNote: 'Partial months are not directly comparable: their coverage is shown in the tables.',
    registryKicker: '02 / The register', registryTitle: 'The register, month by month',
    registryIntro: 'Each row compares the consecutive collections of the month. A change of authorisation type counts in the category of the new authorisation.',
    cols: { month: 'Month', coverage: 'Coverage', added: 'Added', removed: 'Removed', licence: 'Type changes', names: 'Names changed', cities: 'Places changed' },
    warningsKicker: '03 / The warning list', warningsTitle: 'The warning list, in totals',
    warningsIntro: 'No names and no links to an entry: numbers only. Additions of the month follow the date added published by FINMA.',
    wcols: { month: 'Month', coverage: 'Coverage', dated: 'Dated to the month', appeared: 'Appeared', late: 'of which late', removed: 'Removed (of which address changed?)' },
    removedCell: (r, u) => `${r} (of which ${u})`,
    warningsNote: [
      'Appeared late: entries seen for the first time although their FINMA date is earlier than the previous collection.',
      'A removal from the warning list is rare and often just a change of address of FINMA’s page: “address changed?” counts removals whose date added reappears under another address. A removal gives no reason and is not a sanction.',
    ],
    scrollHint: 'Scroll the table to see all columns.',
    resumptionKicker: '04 / After the collection gap', resumptionTitle: 'Found on resumption, counted separately',
    resumptionIntro: 'No collection ran during this interval. Changes found on resumption may date from any day of the interval: they are counted in no month.',
    resumptionHeading: (from, to, days) => `From ${from} to ${to}: ${days} days without a collection`,
    resumptionRegistry: 'Register', resumptionWarnings: 'Warning list',
    resumptionByMonth: 'Appeared, by month of their FINMA date added', resumptionUndated: n => `without a date added: ${n}`,
    resumptionAnomaly: 'This comparison exceeded the abnormal-day threshold: read with care.', resumptionNoWarnings: 'Warning list not compared for this interval.',
    methodKicker: '05 / Method', methodTitle: 'How it is counted',
    methodIntro: 'Every day, OpenSwissData collects FINMA’s public lists and compares two consecutive collections.',
    method: [
      ['An observation, not a decision', 'A movement is filed under the month of the collection that observes it, not under the date of FINMA’s decision.'],
      ['A removal is not a sanction', 'A disappearance from the register or the warning list gives no reason. The collection does not reveal the motive.'],
      ['Partial months are flagged', 'A month without a collection every day is marked “partial”, with its number of days covered. A closed month is frozen and never recalculated. Known gap: 24.08 to 25.09.2026.'],
      ['Our collection is not a movement', 'A reclassification made by our own collection (same FINMA authorisation, different category on our side) is excluded. An abnormal comparison is excluded from the month and flagged.'],
      ['Warning list by exact address', 'Additions and removals are counted by the exact address of the detail page, never by name. No name and no link is published here.'],
    ],
    nextTitle: 'Detailed history and monitoring: in preparation.',
    nextText: 'Would a finer history of these movements be useful to you? Tell us with one click.',
    button: 'Get notified about the detailed history',
    buttonNote: 'This button asks for no address and no sign-up: the click is counted like our other, pseudonymised visit statistics (see the privacy policy). It only measures interest. Follow this page for what comes next.',
    thanks: 'Thank you, noted.', error: 'The signal could not be sent. You can try again later.',
    signup: {
      title: 'Get notified by e-mail',
      emailLabel: 'E-mail address',
      consent: 'I want to be notified by e-mail when the detailed history is available',
      privacyLead: 'You will be asked to confirm by e-mail. Details:', privacyLink: 'privacy policy',
      submit: 'Send request',
      success: 'If the address is valid, a confirmation e-mail has just been sent.',
      invalidEmail: 'Enter a valid e-mail address.',
      consentMissing: 'Tick the box to confirm your request.',
      tooMany: 'Too many requests from your connection. Please try again later.',
      error: 'The request could not be sent. You can try again later.',
    },
    sourceTitle: 'Source: FINMA, public lists.',
    sourceText: 'Reading by OpenSwissData, an independent private service not affiliated with FINMA. This is not an official FINMA publication.',
    sourceLink: 'View FINMA’s official lists', productLink: 'The complete FINMA file', guideLink: 'Read the guide to the warning list',
  },
};

const LOCALE: Record<Lang, string> = { fr: 'fr-CH', de: 'de-CH', en: 'en-GB' };
const OTHER: Record<Lang, string> = { fr: 'Autre catégorie', de: 'Andere Kategorie', en: 'Other category' };

export function monthLabel(month: string, lang: Lang): string {
  const [year, m] = month.split('-').map(Number);
  const text = new Intl.DateTimeFormat(LOCALE[lang], { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, m - 1, 1)));
  return text.charAt(0).toLocaleUpperCase(LOCALE[lang]) + text.slice(1);
}

/** Libellé court d'un mois pour le graphique (« juil. 26 », « Okt. 26 », « Oct 26 »). */
export function monthShort(month: string, lang: Lang): string {
  const [year, m] = month.split('-').map(Number);
  const text = new Intl.DateTimeFormat(LOCALE[lang], { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, m - 1, 1)));
  return `${text.charAt(0).toLocaleUpperCase(LOCALE[lang])}${text.slice(1)} ${String(year).slice(2)}`;
}

/** « 2026-10-21 » → « 21.10.2026 », la même forme dans les trois langues (celle du reste du site). */
export const dayLabel = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

export const categoryLabel = (category: string, lang: Lang) => TYPE_LABEL[lang][category] ?? OTHER[lang];

export interface Stat { label: string; value: number; note: string; tone: 'ink' | 'paper' | 'alert' }
export interface MonthRow {
  label: string; tags: string[]; partial: boolean; open: boolean;
  registryCoverage: string; warningsCoverage: string;
  registry: RegistryCounts; warnings: SafeWarnings; removedCell: string;
}
export interface CategoryBar { label: string; added: number; removed: number; addedWidth: number; removedWidth: number; aria: string }
export interface TrendGroup { label: string; short: string; partial: boolean; bars: Array<{ kind: 'added' | 'removed' | 'warnings'; value: number; height: number }> }
export interface ResumptionView {
  heading: string; registry: Array<[string, number]>; warnings: Array<[string, number | string]> | null;
  byMonth: Array<[string, number]>; undated: string | null; anomaly: boolean;
}
export interface MovementsPage {
  lang: Lang; copy: Copy; state: MovementsReading['state'];
  freshness: string | null;
  latest: null | {
    label: string; tags: string[]; coverage: string; stats: Stat[]; secondary: string; notes: string[]; categories: CategoryBar[];
  };
  trend: TrendGroup[];
  months: MonthRow[];
  resumptions: ResumptionView[];
  links: { official: string; product: string; guide: string };
  interest: { event: string; button: string; note: string; thanks: string; error: string };
  /** Inscription par e-mail : sujet fixe, lien vers la section « Finalités et fondements » de la notice. */
  signup: { subject: string; privacyHref: string; copy: SignupCopy };
}

const pct = (value: number, max: number) => (max > 0 ? Math.round((value / max) * 1000) / 10 : 0);

/** Prépare tout ce que la page affiche. Le gabarit ne fait que recopier ces valeurs. */
export function movementsPage(witness: unknown, lang: Lang): MovementsPage {
  const copy = COPY[lang];
  const reading = readMovements(witness);
  const prefix = lang === 'fr' ? '' : `/${lang}`;
  const base = {
    lang, copy, state: reading.state, freshness: null, latest: null, trend: [], months: [], resumptions: [],
    links: { official: SOURCES['finma-autorises'].url[lang], product: `${prefix}/datasets/finma/`, guide: `${prefix}/guides/finma-warning-list/` },
    interest: { event: MOVEMENTS_EVENT, button: copy.button, note: copy.buttonNote, thanks: copy.thanks, error: copy.error },
    signup: { subject: MOVEMENTS_SIGNUP_SUBJECT, privacyHref: `${prefix}/legal/privacy#finalites`, copy: copy.signup },
  } satisfies MovementsPage;
  if (reading.state !== 'ready') return base;
  const { block } = reading;

  const tagsOf = (m: SafeMonth) => [m.status === 'open' ? copy.open : copy.frozen, ...(m.partial ? [copy.partial] : [])];
  const months = [...block.months].reverse().map((m): MonthRow => ({
    label: monthLabel(m.month, lang), tags: tagsOf(m), partial: m.partial, open: m.status === 'open',
    registryCoverage: copy.coverageShort(m.registryDays, m.daysInMonth), warningsCoverage: copy.coverageShort(m.warningsDays, m.daysInMonth),
    registry: { added: m.registry.added, removed: m.registry.removed, licence_changed: m.registry.licence_changed, name_changed: m.registry.name_changed, city_changed: m.registry.city_changed },
    warnings: m.warnings, removedCell: copy.removedCell(m.warnings.removed, m.warnings.removedUrlChange),
  }));

  const last = block.months.at(-1);
  let latest: MovementsPage['latest'] = null;
  if (last) {
    const max = Math.max(0, ...last.registry.byCategory.flatMap(c => [c.added, c.removed]));
    latest = {
      label: monthLabel(last.month, lang), tags: tagsOf(last), coverage: copy.coverage(last.registryDays, last.daysInMonth),
      stats: [
        { label: copy.statAdded[0], value: last.registry.added, note: copy.statAdded[1], tone: 'ink' },
        { label: copy.statRemoved[0], value: last.registry.removed, note: copy.statRemoved[1], tone: 'paper' },
        { label: copy.statWarnings[0], value: last.warnings.addedDated, note: copy.statWarnings[1], tone: 'alert' },
      ],
      secondary: copy.secondary(last.registry.licence_changed, last.registry.name_changed, last.registry.city_changed),
      notes: [
        ...(last.registry.reclassified ? [copy.reclassified(last.registry.reclassified)] : []),
        ...(last.excluded ? [copy.excluded(last.excluded)] : []),
      ],
      categories: last.registry.byCategory.filter(c => c.added || c.removed).map(c => {
        const label = categoryLabel(c.category, lang);
        return { label, added: c.added, removed: c.removed, addedWidth: pct(c.added, max), removedWidth: pct(c.removed, max), aria: copy.categoryAria(label, c.added, c.removed) };
      }),
    };
  }

  const recent = block.months.slice(-6);
  const trendMax = Math.max(0, ...recent.flatMap(m => [m.registry.added, m.registry.removed, m.warnings.addedDated]));
  const trend = recent.map((m): TrendGroup => ({
    label: monthLabel(m.month, lang), short: monthShort(m.month, lang), partial: m.partial,
    bars: [
      { kind: 'added', value: m.registry.added, height: pct(m.registry.added, trendMax) },
      { kind: 'removed', value: m.registry.removed, height: pct(m.registry.removed, trendMax) },
      { kind: 'warnings', value: m.warnings.addedDated, height: pct(m.warnings.addedDated, trendMax) },
    ],
  }));

  const resumptions = block.resumptions.map((r): ResumptionView => ({
    heading: copy.resumptionHeading(dayLabel(r.from), dayLabel(r.to), r.days),
    registry: [[copy.cols.added, r.registry.added], [copy.cols.removed, r.registry.removed], [copy.cols.licence, r.registry.licence_changed], [copy.cols.names, r.registry.name_changed], [copy.cols.cities, r.registry.city_changed]],
    warnings: r.warnings ? [[copy.wcols.appeared, r.warnings.appeared], [copy.wcols.late, r.warnings.appearedLate], [copy.wcols.removed, copy.removedCell(r.warnings.removed, r.warnings.removedUrlChange)]] : null,
    byMonth: r.warnings ? r.warnings.byFinmaMonth.map(({ month, count: n }) => [monthLabel(month, lang), n]) : [],
    undated: r.warnings && r.warnings.undated ? copy.resumptionUndated(r.warnings.undated) : null,
    anomaly: r.anomaly,
  }));

  return { ...base, freshness: block.lastObserved ? copy.freshness(dayLabel(block.lastObserved)) : null, latest, trend, months, resumptions };
}

/** Textes statiques d'une langue (contrôles de formulation dans les tests). */
export const movementsCopy = (lang: Lang) => COPY[lang];
