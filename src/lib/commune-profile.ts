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
 * Rattachement FINMA — RÈGLE REVUE le 06.10.2026 (relecture de la décision du même jour) : une
 * ligne du registre FINMA (`city` + `canton`, `canton` posé par l'enrichissement GLEIF, voir
 * `sources`) est rattachée à une commune en DEUX priorités, jamais mélangées :
 *
 *   1. `city` (normalisé NFC/casse/espaces) égale EXACTEMENT le nom d'une COMMUNE
 *      (`municipality` du répertoire officiel des localités). Si le canton FINMA est connu, SEULES
 *      les communes de CE canton comptent (une commune du même nom dans un autre canton n'entre
 *      jamais en ligne de compte) ; si canton inconnu, la recherche porte sur tout le pays.
 *      Plusieurs communes satisfont encore ce critère (homonymes) → « ambiguë », SANS jamais
 *      essayer la priorité 2.
 *   2. SEULEMENT si aucune commune ne porte ce nom (priorité 1 à zéro résultat) : `city` égale
 *      EXACTEMENT le nom d'une LOCALITÉ, dans le même périmètre (canton si connu, sinon national).
 *      Une seule commune correspond → rattachée ; plusieurs → « ambiguë ».
 *
 * Sinon : « non rattachée ». Les localités avec suffixe (« Lausanne 25 ») ne sont JAMAIS réduites
 * à la localité sans suffixe : le texte FINMA doit être identique au texte du répertoire, suffixe
 * compris. Pourquoi cette priorité : un nom de ville connu (« Winterthur ») peut aussi être le
 * nom d'une LOCALITÉ dans une commune voisine (ex. un secteur postal de Schlatt (ZH) s'appelle
 * aussi « Winterthur ») ; sans priorité, cette coïncidence rendait « Winterthur » ambigu même pour
 * des entités réellement sises dans la commune de Winterthur elle-même.
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
} from "../mcp/data-loader.js";

export interface CommuneProfileDeps {
  getLocalities: () => { rows: readonly LocalityRow[]; edition: string | null } | null;
  getStreets: () => {
    byMunicipality: ReadonlyMap<string, ReadonlySet<string>>;
    municipalityInfo: ReadonlyMap<string, { municipality: string; canton: string }>;
    edition: string | null;
  } | null;
  getFinmaRegistry: () => readonly FinmaRegistryRow[];
  getFinmaVersion: () => string | null;
}

/** Règle de rattachement, EN VÉRITÉ DES MOTS (relecture du 06.10.2026, seconde passe) :
 *  documentée ici ET dans le commentaire d'en-tête du fichier, jamais seulement dans le code.
 *  Le rattachement compare le `city` du registre FINMA — une LOCALITÉ POSTALE, pas une commune —
 *  au nom d'une commune ou d'une localité du répertoire officiel. Une localité postale peut
 *  s'étendre sur une commune voisine (« Zürich », « Genève » ou « Zug » sont aussi le nom d'une
 *  localité postale de communes voisines, ex. le NPA 8041 à Adliswil) : le chiffre ne prouve donc
 *  PAS que l'établissement a son siège enregistré dans cette commune précise — seulement que sa
 *  ville FINMA porte ce nom. Voir `national_matching.names_also_postal_locality_elsewhere`. */
export const FINMA_MATCHING_RULE =
  "FINMA register city (a postal locality name) equal to this commune's name, or to a locality unique to it; " +
  "the postal locality can extend into neighbouring communes, so this is not proof of the registered seat.";

export interface CommuneFinmaProfile {
  /** RENOMMÉ depuis `authorised_entities` (relecture du 06.10.2026, seconde passe — vérité des
   *  mots) : ce chiffre compte les lignes FINMA dont la VILLE (une localité postale) porte le
   *  même nom que CETTE commune, ou une localité qui lui est propre — jamais une preuve que le
   *  siège enregistré y est réellement. Voir `matching` et le commentaire d'en-tête du fichier. */
  entities_with_city_named_like_commune: number;
  by_licence_type: Record<string, number>;
  /** Règle de rattachement appliquée, en toutes lettres : jamais une approximation, mais jamais
   *  non plus présentée comme une preuve du siège (voir `FINMA_MATCHING_RULE` ci-dessus). */
  matching: typeof FINMA_MATCHING_RULE;
  /** Rattachement national (même registre, mêmes index) : les mêmes nombres, pour tout le pays —
   *  pour comparer le compte d'une commune au total national, et pour lire
   *  `names_also_postal_locality_elsewhere`, qui dit combien de rattachements par nom de commune
   *  portent un nom qui est AUSSI une localité postale d'une AUTRE commune (le cas « Zürich »,
   *  « Genève », « Zug » décrit ci-dessus) : ces rattachements-là sont les moins fiables comme
   *  preuve du siège, même comptés comme « rattachés ». */
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
  /** Relecture du 06.10.2026, seconde passe (vérité des mots) : parmi les lignes `matched` par
   *  PRIORITÉ 1 (nom de commune), combien portent un nom qui est AUSSI le nom d'une localité
   *  postale d'une AUTRE commune (ex. « Zürich », « Genève », « Zug ») — ces rattachements
   *  restent comptés comme « rattachés », mais sont les moins fiables comme preuve du siège :
   *  la localité postale peut s'étendre sur la commune voisine. */
  names_also_postal_locality_elsewhere: number;
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
    return loaded ? { byMunicipality: loaded.byMunicipality, municipalityInfo: loaded.municipalityInfo, edition: loaded.edition } : null;
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

function normalizeCanton(value: string): string {
  return value.normalize("NFC").toUpperCase().trim();
}

/** Les deux index (noms de commune, noms de localité) et le canton de chaque commune, construits
 *  en UNE passe sur le répertoire des localités (relecture du 06.10.2026) : jamais de trait
 *  d'union ≡ espace (règle réservée aux rues). */
export interface FinmaMatchIndexes {
  municipalityByName: ReadonlyMap<string, ReadonlySet<string>>;
  localityByName: ReadonlyMap<string, ReadonlySet<string>>;
  cantonByBfsId: ReadonlyMap<string, string>;
}

// Mémoïsé une seule fois par chargement (décision du 06.10.2026) : reconstruit seulement quand
// le tableau de lignes du répertoire change de référence (nouveau chargement, ou
// `_resetDataLoaderCache()` en test) — jamais à chaque appel de `communeProfile`.
let _indexCache: { rowsRef: readonly LocalityRow[]; indexes: FinmaMatchIndexes } | null = null;

function addToIndex(index: Map<string, Set<string>>, name: string, bfsId: string): void {
  if (!name || !bfsId) return;
  const key = normalizeName(name);
  const set = index.get(key);
  if (set) set.add(bfsId);
  else index.set(key, new Set([bfsId]));
}

/** Construit les deux index (noms de commune, noms de localité, chacun national — le filtrage
 *  par canton se fait à la recherche, via `cantonByBfsId`) et le canton de chaque commune.
 *  Fonction pure, testée directement avec des lignes en mémoire, mémoïsée par référence de
 *  tableau comme `buildFinmaMatchIndex` avant cette relecture. */
export function buildFinmaMatchIndexes(rows: readonly LocalityRow[]): FinmaMatchIndexes {
  if (_indexCache && _indexCache.rowsRef === rows) return _indexCache.indexes;
  const municipalityByName = new Map<string, Set<string>>();
  const localityByName = new Map<string, Set<string>>();
  const cantonByBfsId = new Map<string, string>();
  for (const row of rows) {
    if (row.municipality_bfs_id && row.canton && !cantonByBfsId.has(row.municipality_bfs_id)) {
      cantonByBfsId.set(row.municipality_bfs_id, normalizeCanton(row.canton));
    }
    addToIndex(municipalityByName, row.municipality, row.municipality_bfs_id);
    addToIndex(localityByName, row.locality, row.municipality_bfs_id);
  }
  const indexes: FinmaMatchIndexes = { municipalityByName, localityByName, cantonByBfsId };
  _indexCache = { rowsRef: rows, indexes };
  return indexes;
}

/** Test helper : vide le cache des index (isolation entre suites qui construisent des lignes différentes). */
export function _resetFinmaMatchIndexCache(): void {
  _indexCache = null;
}

type Match =
  | { kind: "none" }
  | { kind: "unique"; bfsId: string; via: "municipality" | "locality" }
  | { kind: "ambiguous" };

/** Candidats pour un nom donné, restreints au canton FINMA quand il est connu (décision du
 *  06.10.2026, relecture du même jour) : `canton` vide/absent → recherche nationale. */
function candidatesForName(nameIndex: ReadonlyMap<string, ReadonlySet<string>>, name: string, canton: string, cantonByBfsId: ReadonlyMap<string, string>): Set<string> {
  const all = nameIndex.get(normalizeName(name)) ?? new Set<string>();
  if (!canton) return new Set(all);
  const wanted = normalizeCanton(canton);
  return new Set([...all].filter((bfsId) => cantonByBfsId.get(bfsId) === wanted));
}

function matchFromCandidates(candidates: ReadonlySet<string>): { kind: "none" } | { kind: "unique"; bfsId: string } | { kind: "ambiguous" } {
  if (candidates.size === 0) return { kind: "none" };
  if (candidates.size > 1) return { kind: "ambiguous" };
  const [bfsId] = candidates;
  return { kind: "unique", bfsId };
}

/** Applique les deux priorités dans l'ordre (voir le commentaire d'en-tête du fichier) : la
 *  priorité 2 (localité) n'est JAMAIS essayée si la priorité 1 (commune) a trouvé au moins un
 *  candidat, même ambigu — une ambiguïté au niveau commune ne se résout jamais par la localité.
 *  `via` (relecture du 06.10.2026, seconde passe) dit laquelle des deux priorités a tranché :
 *  sert à `names_also_postal_locality_elsewhere`, qui ne regarde que les rattachements
 *  `via: "municipality"` (une commune, dont le nom peut AUSSI être une localité postale
 *  ailleurs). */
function matchFinmaRow(row: FinmaRegistryRow, indexes: FinmaMatchIndexes): Match {
  if (!row.city) return { kind: "none" };
  const municipalityMatch = matchFromCandidates(candidatesForName(indexes.municipalityByName, row.city, row.canton, indexes.cantonByBfsId));
  if (municipalityMatch.kind === "unique") return { kind: "unique", bfsId: municipalityMatch.bfsId, via: "municipality" };
  if (municipalityMatch.kind === "ambiguous") return { kind: "ambiguous" };
  const localityMatch = matchFromCandidates(candidatesForName(indexes.localityByName, row.city, row.canton, indexes.cantonByBfsId));
  if (localityMatch.kind === "unique") return { kind: "unique", bfsId: localityMatch.bfsId, via: "locality" };
  if (localityMatch.kind === "ambiguous") return { kind: "ambiguous" };
  return { kind: "none" };
}

/** `true` si `name` (déjà rattaché par PRIORITÉ 1 à `matchedBfsId`) est AUSSI le nom d'une
 *  localité postale d'une AUTRE commune que `matchedBfsId` — recherche NATIONALE (jamais
 *  restreinte au canton FINMA) : l'avertissement porte sur le nom lui-même, pas sur le canton de
 *  cette ligne précise (relecture du 06.10.2026, seconde passe, cas « Zürich »/« Genève »/« Zug »). */
function nameAlsoPostalLocalityElsewhere(name: string, matchedBfsId: string, indexes: FinmaMatchIndexes): boolean {
  const localityBfsIds = indexes.localityByName.get(normalizeName(name));
  if (!localityBfsIds) return false;
  for (const bfsId of localityBfsIds) if (bfsId !== matchedBfsId) return true;
  return false;
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
    // Répertoire des localités absent ou commune non trouvée dedans : repli sur le petit
    // répertoire nom/canton par commune du répertoire des rues (tâche B1, relecture du
    // 06.10.2026, point 5 : jamais le tableau complet des rues, qui n'est plus gardé en mémoire).
    if (name === null || canton === null) {
      const fallback = streetsLoaded.municipalityInfo.get(bfsId);
      if (fallback) {
        if (name === null && fallback.municipality) name = fallback.municipality;
        if (canton === null && fallback.canton) canton = fallback.canton;
      }
    }
  }

  const indexes = buildFinmaMatchIndexes(localitiesLoaded?.rows ?? []);
  let entitiesWithCityNamedLikeCommune = 0;
  const byLicenceType = new Map<string, number>();
  for (const row of finmaRows) {
    const match = matchFinmaRow(row, indexes);
    if (match.kind !== "unique" || match.bfsId !== bfsId) continue;
    entitiesWithCityNamedLikeCommune += 1;
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
      entities_with_city_named_like_commune: entitiesWithCityNamedLikeCommune,
      by_licence_type: Object.fromEntries([...byLicenceType.entries()].sort(([a], [b]) => a.localeCompare(b))),
      matching: FINMA_MATCHING_RULE,
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
 *  nombres seulement — jamais une liste de noms. Mêmes index que `communeProfile`, mémoïsés. */
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
  const indexes = buildFinmaMatchIndexes(localitiesLoaded?.rows ?? []);

  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let namesAlsoPostalLocalityElsewhere = 0;
  for (const row of finmaRows) {
    const match = matchFinmaRow(row, indexes);
    if (match.kind === "unique") {
      matched += 1;
      if (match.via === "municipality" && nameAlsoPostalLocalityElsewhere(row.city, match.bfsId, indexes)) {
        namesAlsoPostalLocalityElsewhere += 1;
      }
    } else if (match.kind === "ambiguous") ambiguous += 1;
    else unmatched += 1;
  }
  return { matched, unmatched, ambiguous, total: finmaRows.length, names_also_postal_locality_elsewhere: namesAlsoPostalLocalityElsewhere };
}
