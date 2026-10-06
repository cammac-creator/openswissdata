/**
 * Profil de commune (donnée combinée) — tâche osd.donnees, tâche B2 du plan
 * `2026-10-06-prospection-et-api.md`.
 *
 * Calculé À LA DEMANDE à partir des données déjà chargées (répertoire officiel des localités,
 * répertoire officiel des rues, registre FINMA) : aucun nouveau fichier dans `src/mcp/data/`.
 * Fonction PURE (`communeProfile`, `nationalFinmaMatchingStats`) : les chargeurs par défaut
 * viennent de `../mcp/data-loader.js`, mais `deps` permet de les remplacer en test, sans lecture
 * disque ni réseau.
 *
 * Rattachement FINMA — décision de Claude-Alain du 06.10.2026 : une ligne du registre FINMA
 * (`city` + `canton`) est rattachée à une commune seulement si, dans le MÊME canton, `city`
 * égale EXACTEMENT (après NFC, casse et espaces — jamais de trait d'union ≡ espace, règle
 * réservée aux noms de rue dans `normalizeStreetName`) une localité ou le nom d'une commune du
 * répertoire officiel des localités, ET que ce rattachement désigne une seule commune. Sinon :
 * « non rattachée ». Les localités avec suffixe (« Lausanne 25 ») ne sont JAMAIS réduites à la
 * localité sans suffixe : le texte FINMA doit être identique au texte du répertoire, suffixe
 * compris — aucun retrait n'est fait ici, la correspondance reste donc déjà exacte par
 * construction (on compare les deux chaînes telles quelles, seulement normalisées).
 *
 * Jamais de note, de score ou de classement entre communes : seulement des faits datés et
 * sourcés, comme le reste du service (voir `.claude/rules/collectes-et-recherche.md`,
 * § FINMA : organisme de surveillance, et `src/mcp/company/check.ts`).
 */

import {
  getFinmaRegistry,
  getFinmaVersion,
  getLocalities,
  getStreets,
  type FinmaRegistryRow,
  type LocalityRow,
  type StreetRow,
} from "../mcp/data-loader.js";

export interface CommuneProfileDeps {
  getLocalities: () => { rows: readonly LocalityRow[]; edition: string | null } | null;
  getStreets: () => { rows: readonly StreetRow[]; byMunicipality: ReadonlyMap<string, ReadonlySet<string>>; edition: string | null } | null;
  getFinmaRegistry: () => readonly FinmaRegistryRow[];
  getFinmaVersion: () => string | null;
}

export interface CommuneFinmaProfile {
  authorised_entities: number;
  by_licence_type: Record<string, number>;
  /** Règle de rattachement appliquée, en toutes lettres : jamais une approximation. */
  matching: "exact city+canton, unique";
  /** Rattachement national (même registre, même index) : pour comprendre un `authorised_entities`
   *  bas — la grande majorité des lignes FINMA n'a aujourd'hui aucun canton connu (voir
   *  `sources` : `gleif.lei_api`), donc « 0 » ici ne veut pas dire « aucune institution dans
   *  cette commune », mais « aucune ligne dont le canton connu désigne cette commune ». */
  national_matching: NationalFinmaMatchingStats;
}

export interface CommuneProfile {
  bfs_id: string;
  /** `null` quand la commune n'apparaît dans aucun répertoire chargé (jamais devinée). */
  name: string | null;
  canton: string | null;
  postal_codes: string[];
  localities: string[];
  /** `null` : répertoire des rues non câblé/indisponible. `0` : répertoire disponible, aucune rue listée pour cette commune. */
  streets_count: number | null;
  finma: CommuneFinmaProfile;
  /** Identifiants du registre des sources (`src/mcp/company/sources.ts`) effectivement utilisés pour cette fiche. */
  sources: string[];
  editions: { localities: string | null; streets: string | null; finma: string | null };
  notice: string;
}

/** Rattachement national (tâche B2) : nombres seulement, jamais une liste nominative. */
export interface NationalFinmaMatchingStats {
  matched: number;
  unmatched: number;
  ambiguous: number;
  total: number;
}

const NOTICE =
  "Unofficial combination of public sources. Check the official sources before any decision: swisstopo (data.geo.admin.ch) for localities and streets, finma.ch for supervised institutions.";

const defaultDeps: CommuneProfileDeps = {
  getLocalities: () => {
    const loaded = getLocalities();
    return loaded ? { rows: loaded.rows, edition: loaded.edition } : null;
  },
  getStreets: () => {
    const loaded = getStreets();
    return loaded ? { rows: loaded.rows, byMunicipality: loaded.byMunicipality, edition: loaded.edition } : null;
  },
  getFinmaRegistry,
  getFinmaVersion,
};

/** NFC, casse et espaces normalisés — règle du rattachement FINMA (décision du 06.10.2026,
 *  distincte de `normalizeStreetName` : ici, jamais de trait d'union ≡ espace, un nom de
 *  commune ou de localité n'a pas la même convention qu'un nom de rue). */
function normalizeName(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

function matchKey(canton: string, name: string): string {
  return `${canton.normalize("NFC").toUpperCase().trim()}||${normalizeName(name)}`;
}

// Mémoïsé une seule fois par chargement (décision du 06.10.2026) : reconstruit seulement quand
// le tableau de lignes du répertoire change de référence (nouveau chargement, ou
// `_resetDataLoaderCache()` en test) — jamais à chaque appel de `communeProfile`.
let _indexCache: { rowsRef: readonly LocalityRow[]; index: Map<string, Set<string>> } | null = null;

/** Index `canton|nom normalisé` → ensemble des numéros OFS de commune qui portent ce nom (comme
 *  localité OU comme nom de commune). Fonction pure, testée directement avec des lignes en
 *  mémoire. */
export function buildFinmaMatchIndex(rows: readonly LocalityRow[]): Map<string, Set<string>> {
  if (_indexCache && _indexCache.rowsRef === rows) return _indexCache.index;
  const index = new Map<string, Set<string>>();
  const add = (canton: string, name: string, bfsId: string) => {
    if (!canton || !name || !bfsId) return;
    const key = matchKey(canton, name);
    const set = index.get(key);
    if (set) set.add(bfsId);
    else index.set(key, new Set([bfsId]));
  };
  for (const row of rows) {
    add(row.canton, row.locality, row.municipality_bfs_id);
    add(row.canton, row.municipality, row.municipality_bfs_id);
  }
  _indexCache = { rowsRef: rows, index };
  return index;
}

/** Test helper : vide le cache de l'index (isolation entre suites qui construisent des lignes différentes). */
export function _resetFinmaMatchIndexCache(): void {
  _indexCache = null;
}

type Match = { kind: "none" } | { kind: "unique"; bfsId: string } | { kind: "ambiguous" };

function matchFinmaRow(row: FinmaRegistryRow, index: Map<string, Set<string>>): Match {
  if (!row.city || !row.canton) return { kind: "none" };
  const set = index.get(matchKey(row.canton, row.city));
  if (!set || set.size === 0) return { kind: "none" };
  if (set.size > 1) return { kind: "ambiguous" };
  const [bfsId] = set;
  return { kind: "unique", bfsId };
}

export function communeProfile(bfsId: string, deps: Partial<CommuneProfileDeps> = {}): CommuneProfile {
  const d: CommuneProfileDeps = { ...defaultDeps, ...deps };
  const localitiesLoaded = d.getLocalities();
  const streetsLoaded = d.getStreets();
  let finmaAvailable = true;
  const finmaRows = (() => {
    try {
      return d.getFinmaRegistry();
    } catch {
      finmaAvailable = false;
      return [];
    }
  })();
  const finmaVersion = d.getFinmaVersion();

  let name: string | null = null;
  let canton: string | null = null;
  const postalCodes = new Set<string>();
  const localityNames = new Set<string>();
  const sources = new Set<string>();

  if (localitiesLoaded) {
    sources.add("swisstopo.localities");
    for (const row of localitiesLoaded.rows) {
      if (row.municipality_bfs_id !== bfsId) continue;
      if (name === null && row.municipality) name = row.municipality;
      if (canton === null && row.canton) canton = row.canton;
      if (row.postal_code) postalCodes.add(row.postal_code);
      if (row.locality) localityNames.add(row.locality);
    }
  }

  let streetsCount: number | null = null;
  if (streetsLoaded) {
    sources.add("swisstopo.streets");
    streetsCount = streetsLoaded.byMunicipality.get(bfsId)?.size ?? 0;
    // Répertoire des localités absent ou commune non trouvée dedans : repli sur les rues, qui
    // portent elles aussi commune et canton (tâche B1), pour ne pas laisser `name`/`canton`
    // vides alors qu'une information existe déjà dans un autre répertoire chargé.
    if (name === null || canton === null) {
      const fallback = streetsLoaded.rows.find((row) => row.municipality_bfs_id === bfsId);
      if (fallback) {
        if (name === null && fallback.municipality) name = fallback.municipality;
        if (canton === null && fallback.canton) canton = fallback.canton;
      }
    }
  }

  const index = buildFinmaMatchIndex(localitiesLoaded?.rows ?? []);
  let authorisedEntities = 0;
  const byLicenceType = new Map<string, number>();
  for (const row of finmaRows) {
    const match = matchFinmaRow(row, index);
    if (match.kind !== "unique" || match.bfsId !== bfsId) continue;
    authorisedEntities += 1;
    const type = row.licence_type || "unknown";
    byLicenceType.set(type, (byLicenceType.get(type) ?? 0) + 1);
  }
  if (finmaAvailable) {
    sources.add("finma.uid_csv");
    // Le `canton` de chaque ligne FINMA (seule clé du rattachement avec `city`) est posé par
    // l'enrichissement GLEIF au moment de la collecte (`etl/finma/ingest-gleif.ts`), jamais lu
    // sur le site de la FINMA lui-même : citer GLEIF comme source de ce rattachement, même motif
    // que le retrait du fait `lei` dans `src/mcp/company/check.ts` (ne jamais présenter une
    // valeur dérivée de GLEIF comme si elle venait directement de la source d'origine).
    sources.add("gleif.lei_api");
  }
  const nationalMatching = nationalFinmaMatchingStats({ getLocalities: () => localitiesLoaded, getFinmaRegistry: d.getFinmaRegistry });

  return {
    bfs_id: bfsId,
    name,
    canton,
    postal_codes: [...postalCodes].sort(),
    localities: [...localityNames].sort(),
    streets_count: streetsCount,
    finma: {
      authorised_entities: authorisedEntities,
      by_licence_type: Object.fromEntries([...byLicenceType.entries()].sort(([a], [b]) => a.localeCompare(b))),
      matching: "exact city+canton, unique",
      national_matching: nationalMatching,
    },
    sources: [...sources].sort(),
    editions: {
      localities: localitiesLoaded?.edition ?? null,
      streets: streetsLoaded?.edition ?? null,
      finma: finmaVersion,
    },
    notice: NOTICE,
  };
}

/** Rattachement FINMA au niveau national (tâche B2) : rattachées / non rattachées / ambiguës,
 *  nombres seulement — jamais une liste de noms. Même index que `communeProfile`, mémoïsé. */
export function nationalFinmaMatchingStats(
  deps: Partial<Pick<CommuneProfileDeps, "getLocalities" | "getFinmaRegistry">> = {},
): NationalFinmaMatchingStats {
  const getLocalitiesDep = deps.getLocalities ?? defaultDeps.getLocalities;
  const getFinmaRegistryDep = deps.getFinmaRegistry ?? defaultDeps.getFinmaRegistry;
  const localitiesLoaded = getLocalitiesDep();
  const finmaRows = (() => {
    try {
      return getFinmaRegistryDep();
    } catch {
      return [];
    }
  })();
  const index = buildFinmaMatchIndex(localitiesLoaded?.rows ?? []);

  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  for (const row of finmaRows) {
    const match = matchFinmaRow(row, index);
    if (match.kind === "unique") matched += 1;
    else if (match.kind === "ambiguous") ambiguous += 1;
    else unmatched += 1;
  }
  return { matched, unmatched, ambiguous, total: finmaRows.length };
}
