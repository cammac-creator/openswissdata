/**
 * Profil de canton (donnée combinée) — tâche osd.donnees, tâche B5 du plan
 * `2026-10-06-prospection-et-api.md`.
 *
 * Calculé À LA DEMANDE à partir des données déjà chargées (répertoire officiel des localités,
 * répertoire officiel des rues, siège exact FINMA × registre du commerce, rétribution unique
 * OFEN) : aucun nouveau fichier combiné dans `src/mcp/data/`. Fonction PURE (`cantonProfile`) :
 * les chargeurs par défaut viennent de `../mcp/data-loader.js`, mais `deps` permet de les
 * remplacer en test, sans lecture disque ni réseau. Fichier NEUF (comme
 * `src/lib/commune-profile.ts` pour les communes) : aucune des gardes de compatibilité de ce
 * dernier (clés optionnelles pour protéger d'anciens tests) n'est nécessaire ici.
 *
 * FINMA — SIÈGE EXACT SEULEMENT (jamais la colonne `canton` du registre FINMA, posée par
 * l'enrichissement GLEIF, ni une coïncidence de nom de ville) : pour chaque ligne FINMA, le
 * numéro OFS de commune du siège vient de `getFinmaSeats()` (combinaison FINMA × registre du
 * commerce, tâche B4, personnes morales seulement) ; ce numéro OFS est ensuite rattaché à un
 * canton par le répertoire officiel des localités (replié sur le petit répertoire du fichier
 * des rues quand les localités sont indisponibles). Un siège dont le numéro OFS de commune
 * n'apparaît dans AUCUN des deux répertoires (fusion de communes non reflétée) n'est jamais
 * rattaché à un canton par approximation : il n'est compté dans aucun canton.
 *
 * OFEN — rétribution unique pour le photovoltaïque : la série par année est recopiée TELLE
 * QUELLE (y compris la valeur `"NA"` d'une année sans donnée disponible, rendue ici `null` —
 * jamais un zéro deviné), les deux ratios « pro 100 000 Einwohner » sont ceux PUBLIÉS par
 * l'OFEN, jamais recalculés (Global Constraint du plan du 06.10.2026). Cette série compte les
 * installations qui ont REÇU la rétribution unique une année donnée, pas la puissance
 * photovoltaïque totale installée dans le canton.
 *
 * Jamais de note, de score ou de classement entre cantons : seulement des faits datés et
 * sourcés, comme le reste du service.
 */

import {
  getBfePv,
  getDatasetsIndex,
  getFinmaRegistry,
  getFinmaSeats,
  getFinmaVersion,
  getLocalities,
  getStreets,
  type BfePvRow,
  type DatasetIndexEntry,
  type FinmaRegistryRow,
  type LocalityRow,
} from "../mcp/data-loader.js";
import { FINMA_SEAT_MATCHING_RULE } from "./commune-profile.js";
import { datasetsForCanton, type DatasetProfileMatch } from "./dataset-query.js";

/** Les 26 abréviations cantonales suisses, ordre alphabétique stable (même liste que
 *  `SWISS_CANTONS` de `scripts/sync-localities.ts`/`scripts/sync-bfe-pv.ts`, dupliquée ici
 *  volontairement — même style que ces scripts, qui ne partagent pas non plus cette liste). */
export const SWISS_CANTON_ABBREVIATIONS: readonly string[] = [
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW",
  "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH",
];

const NOTICE =
  "Unofficial combination of public sources. Check the official sources before any decision: " +
  "swisstopo (data.geo.admin.ch) for localities and streets, finma.ch for supervised institutions, " +
  "the BFE (opendata.swiss) for the one-time photovoltaic remuneration.";

/** Les deux ratios « pro 100 000 Einwohner » sont ceux PUBLIÉS par l'OFEN lui-même : jamais
 *  recalculés ici (Global Constraint du plan du 06.10.2026). */
export const PV_RATIOS_NOTE =
  "The two 'per 100,000 inhabitants' ratios are published as-is by the BFE (Swiss Federal Office of Energy); never recalculated here.";

/** La série ne compte que les installations qui ont REÇU la rétribution unique une année
 *  donnée : ce n'est jamais la puissance photovoltaïque totale installée dans le canton. */
export const PV_SCOPE_NOTE =
  "Counts installations that received the one-time remuneration in a given year, not the canton's total installed PV capacity.";

export interface CantonPvYearRow {
  /** Année telle que publiée (jamais interprétée au-delà de son format). */
  year: number;
  /** `null` : l'OFEN publie "NA" pour ce couple canton/année (donnée non disponible) — jamais un zéro deviné. */
  installations_count: number | null;
  installed_capacity_kw: number | null;
  remuneration_chf: number | null;
  installations_per_100000_inhabitants: number | null;
  installed_capacity_kw_per_100000_inhabitants: number | null;
}

export interface CantonFinmaProfile {
  /** Nombre d'AUTORISATIONS FINMA (lignes du registre) dont l'IDE a SON SIÈGE enregistré dans
   *  CE canton (combinaison FINMA × registre du commerce, tâche B4) ; `null` : fichier combiné
   *  des sièges OU registre FINMA lui-même non câblé/indisponible (jamais confondu avec `0`,
   *  qui veut dire « les deux sont disponibles, aucune ligne pour ce canton »). */
  entities_with_seat_in_canton: number | null;
  /** Nombre d'IDE DISTINCTS parmi les autorisations comptées ci-dessus. `null` dans les mêmes conditions. */
  distinct_entities_with_seat_in_canton: number | null;
  by_licence_type: Record<string, number>;
  /** Règle de rattachement, en toutes lettres : réutilise `FINMA_SEAT_MATCHING_RULE` de
   *  `commune-profile.ts` (même règle, exacte, par IDE). */
  seat_matching: typeof FINMA_SEAT_MATCHING_RULE;
}

export interface CantonProfile {
  abbreviation: string;
  /** `null` : répertoire des localités indisponible. */
  communes_count: number | null;
  /** Nombre de localités DISTINCTES (NPA + suffixe + nom) dans ce canton ; `null` : répertoire indisponible. */
  localities_count: number | null;
  /** `null` : répertoire des rues indisponible. `0` : disponible, aucune rue listée pour ce canton. */
  streets_count: number | null;
  finma: CantonFinmaProfile;
  /** `null` : rétribution unique OFEN non câblée ou indisponible. */
  pv: { by_year: CantonPvYearRow[]; ratios_note: typeof PV_RATIOS_NOTE; scope_note: typeof PV_SCOPE_NOTE } | null;
  /** Jeux ouverts APPROUVÉS (tâche osd.jeux, piste G2) qui ont au moins une ligne pour ce
   *  canton — ids et nombre de lignes, JAMAIS les données elles-mêmes. Champ AUTONOME : jamais
   *  ajouté à `sources` ni `editions` ci-dessous (comparés par égalité stricte dans des tests
   *  existants — voir `src/lib/dataset-query.ts`, `datasetsForCanton`). Tableau vide quand
   *  aucun jeu approuvé n'a de ligne pour ce canton ; jamais `null`. */
  datasets: DatasetProfileMatch[];
  /** Identifiants du registre des sources effectivement utilisés pour cette fiche. */
  sources: string[];
  editions: { localities: string | null; streets: string | null; finma: string | null; finma_seats: string | null; bfe_pv: string | null };
  notice: string;
}

export interface CantonProfileDeps {
  getLocalities: () => { rows: readonly LocalityRow[]; edition: string | null } | null;
  getStreets: () => {
    byMunicipality: ReadonlyMap<string, ReadonlySet<string>>;
    municipalityInfo: ReadonlyMap<string, { municipality: string; canton: string }>;
    edition: string | null;
  } | null;
  getFinmaRegistry: () => readonly FinmaRegistryRow[];
  getFinmaVersion: () => string | null;
  getFinmaSeats: () => { byUid: ReadonlyMap<string, string>; edition: string | null } | null;
  getBfePv: () => { rows: readonly BfePvRow[]; edition: string | null } | null;
  /** Tâche osd.jeux, piste G2. Jamais substitué par les tests ANTÉRIEURS à cette tâche (ils ne
   *  connaissent pas ce champ) : la valeur par défaut lit le vrai catalogue, sans jamais changer
   *  `sources`/`editions` (voir le commentaire du champ `datasets` de `CantonProfile`). */
  getDatasetsIndex: () => { datasets: readonly DatasetIndexEntry[] } | null;
}

const defaultDeps: CantonProfileDeps = {
  getLocalities: () => {
    const loaded = getLocalities();
    return loaded ? { rows: loaded.rows, edition: loaded.edition } : null;
  },
  getStreets: () => {
    const loaded = getStreets();
    return loaded ? { byMunicipality: loaded.byMunicipality, municipalityInfo: loaded.municipalityInfo, edition: loaded.edition } : null;
  },
  getFinmaRegistry,
  getFinmaVersion,
  getFinmaSeats: () => {
    const loaded = getFinmaSeats();
    return loaded ? { byUid: loaded.byUid, edition: loaded.edition } : null;
  },
  getBfePv,
  getDatasetsIndex,
};

function normalizeCanton(value: string): string {
  return value.normalize("NFC").toUpperCase().trim();
}

/** bfsId → canton, répertoire des localités en priorité, repli sur le petit répertoire
 *  nom/canton du fichier des rues (même ordre de priorité que les fonctions de repli de
 *  `commune-profile.ts`) : jamais une approximation, seulement une seconde source quand la
 *  première est indisponible. */
export function buildBfsCantonIndex(
  localitiesRows: readonly LocalityRow[],
  streetsMunicipalityInfo: ReadonlyMap<string, { municipality: string; canton: string }> | null,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of localitiesRows) {
    if (row.municipality_bfs_id && row.canton && !index.has(row.municipality_bfs_id)) {
      index.set(row.municipality_bfs_id, normalizeCanton(row.canton));
    }
  }
  if (streetsMunicipalityInfo) {
    for (const [bfsId, info] of streetsMunicipalityInfo) {
      if (!index.has(bfsId) && info.canton) index.set(bfsId, normalizeCanton(info.canton));
    }
  }
  return index;
}

/** Numéros OFS de commune rattachés à un canton donné, mêmes deux sources (localités en
 *  priorité, rues en repli), fusionnées plutôt que l'une OU l'autre : une commune présente
 *  seulement dans un des deux répertoires reste comptée. */
export function bfsIdsForCanton(
  abbr: string,
  localitiesRows: readonly LocalityRow[],
  streetsMunicipalityInfo: ReadonlyMap<string, { municipality: string; canton: string }> | null,
): Set<string> {
  const wanted = normalizeCanton(abbr);
  const ids = new Set<string>();
  for (const row of localitiesRows) {
    if (row.municipality_bfs_id && normalizeCanton(row.canton) === wanted) ids.add(row.municipality_bfs_id);
  }
  if (streetsMunicipalityInfo) {
    for (const [bfsId, info] of streetsMunicipalityInfo) {
      if (info.canton && normalizeCanton(info.canton) === wanted) ids.add(bfsId);
    }
  }
  return ids;
}

/** Communes DISTINCTES (numéro OFS) et localités DISTINCTES (NPA + suffixe + nom — une même
 *  localité peut chevaucher deux communes du même canton, voir `sync-localities.ts` : comptée
 *  une seule fois) pour un canton donné. Fonction pure, testée sans fichier. */
export function countCommunesAndLocalities(abbr: string, rows: readonly LocalityRow[]): { communes: number; localities: number } {
  const wanted = normalizeCanton(abbr);
  const bfsIds = new Set<string>();
  const localityKeys = new Set<string>();
  for (const row of rows) {
    if (normalizeCanton(row.canton) !== wanted) continue;
    if (row.municipality_bfs_id) bfsIds.add(row.municipality_bfs_id);
    localityKeys.add(`${row.postal_code}|${row.postal_code_suffix}|${row.locality}`);
  }
  return { communes: bfsIds.size, localities: localityKeys.size };
}

/** `null` pour la valeur publiée `"NA"` (donnée non disponible) ; jamais un zéro deviné pour
 *  une valeur absente ou illisible. Fonction pure, testée sans fichier. */
export function toPvNumber(value: string): number | null {
  if (value === "NA") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Série OFEN d'un canton, triée par année, valeurs recopiées (ou `null` pour "NA") — jamais
 *  recalculées. Fonction pure, testée sans fichier. */
export function cantonPvSeries(abbr: string, rows: readonly BfePvRow[]): CantonPvYearRow[] {
  const wanted = normalizeCanton(abbr);
  return rows
    .filter((r) => normalizeCanton(r.canton) === wanted)
    .map((r) => ({
      year: Number(r.year),
      installations_count: toPvNumber(r.installations_count),
      installed_capacity_kw: toPvNumber(r.installed_capacity_kw),
      remuneration_chf: toPvNumber(r.remuneration_chf),
      installations_per_100000_inhabitants: toPvNumber(r.installations_per_100000_inhabitants),
      installed_capacity_kw_per_100000_inhabitants: toPvNumber(r.installed_capacity_kw_per_100000_inhabitants),
    }))
    .sort((a, b) => a.year - b.year);
}

export function cantonProfile(abbr: string, deps: Partial<CantonProfileDeps> = {}): CantonProfile {
  const d: CantonProfileDeps = { ...defaultDeps, ...deps };
  const wanted = normalizeCanton(abbr);
  const localitiesLoaded = d.getLocalities();
  const streetsLoaded = d.getStreets();
  const sources = new Set<string>();

  let communesCount: number | null = null;
  let localitiesCount: number | null = null;
  if (localitiesLoaded) {
    sources.add("swisstopo.localities");
    const counts = countCommunesAndLocalities(wanted, localitiesLoaded.rows);
    communesCount = counts.communes;
    localitiesCount = counts.localities;
  }

  let streetsCount: number | null = null;
  if (streetsLoaded) {
    sources.add("swisstopo.streets");
    const bfsIds = bfsIdsForCanton(wanted, localitiesLoaded?.rows ?? [], streetsLoaded.municipalityInfo);
    let total = 0;
    for (const bfsId of bfsIds) total += streetsLoaded.byMunicipality.get(bfsId)?.size ?? 0;
    streetsCount = total;
  }

  // Siège exact FINMA (tâche B4) : jamais lu/compté sans le fichier combiné des sièges NI sans
  // le registre FINMA lui-même — voir le commentaire d'en-tête du fichier (jamais la colonne
  // `canton` du registre FINMA). Relecture du 07.10.2026 : un registre FINMA indisponible doit
  // rendre `null` (comme le fichier combiné absent), jamais `0` — une boucle sur un tableau vide
  // de repli donnerait silencieusement « disponible, aucune ligne », ce qui est faux.
  let entitiesWithSeat: number | null = null;
  let distinctEntitiesWithSeat: number | null = null;
  const byLicenceType = new Map<string, number>();
  const seatsLoaded = d.getFinmaSeats();
  if (seatsLoaded) {
    sources.add("ofrc.zefix_lindas");
    let finmaRows: readonly FinmaRegistryRow[] | null;
    try {
      finmaRows = d.getFinmaRegistry();
    } catch {
      finmaRows = null;
    }
    if (finmaRows) {
      sources.add("finma.uid_csv");
      const cantonByBfsId = buildBfsCantonIndex(localitiesLoaded?.rows ?? [], streetsLoaded?.municipalityInfo ?? null);
      let count = 0;
      const distinctUids = new Set<string>();
      for (const row of finmaRows) {
        const bfsId = seatsLoaded.byUid.get(row.uid);
        if (!bfsId) continue; // siège inconnu : jamais rattaché par approximation
        if (cantonByBfsId.get(bfsId) !== wanted) continue;
        count += 1;
        distinctUids.add(row.uid);
        const type = row.licence_type || "unknown";
        byLicenceType.set(type, (byLicenceType.get(type) ?? 0) + 1);
      }
      entitiesWithSeat = count;
      distinctEntitiesWithSeat = distinctUids.size;
    }
    // `finmaRows === null` (registre FINMA indisponible) : `entitiesWithSeat`/`distinctEntitiesWithSeat`
    // restent `null`, jamais `0`.
  }

  let pv: CantonProfile["pv"] = null;
  const bfeLoaded = d.getBfePv();
  if (bfeLoaded) {
    sources.add("bfe.pv_one_time_remuneration");
    pv = { by_year: cantonPvSeries(wanted, bfeLoaded.rows), ratios_note: PV_RATIOS_NOTE, scope_note: PV_SCOPE_NOTE };
  }

  // Jeux ouverts du moteur générique (tâche osd.jeux, piste G2) : champ AUTONOME, jamais ajouté à
  // `sources` ci-dessus (voir le commentaire du champ `datasets` de `CantonProfile`). Les communes
  // de ce canton (mêmes deux répertoires, fusionnés) servent à compter les jeux à clé
  // `commune_bfs` ; `datasetsForCanton` se charge seule du cas « jeu à clé canton ».
  const communeBfsIdsForDatasets = bfsIdsForCanton(wanted, localitiesLoaded?.rows ?? [], streetsLoaded?.municipalityInfo ?? null);
  const datasets = datasetsForCanton(wanted, communeBfsIdsForDatasets, d.getDatasetsIndex());

  return {
    abbreviation: wanted,
    communes_count: communesCount,
    localities_count: localitiesCount,
    streets_count: streetsCount,
    finma: {
      entities_with_seat_in_canton: entitiesWithSeat,
      distinct_entities_with_seat_in_canton: distinctEntitiesWithSeat,
      by_licence_type: Object.fromEntries([...byLicenceType.entries()].sort(([a], [b]) => a.localeCompare(b))),
      seat_matching: FINMA_SEAT_MATCHING_RULE,
    },
    pv,
    datasets,
    sources: [...sources].sort(),
    editions: {
      localities: localitiesLoaded?.edition ?? null,
      streets: streetsLoaded?.edition ?? null,
      finma: d.getFinmaVersion(),
      finma_seats: seatsLoaded?.edition ?? null,
      bfe_pv: bfeLoaded?.edition ?? null,
    },
    notice: NOTICE,
  };
}
