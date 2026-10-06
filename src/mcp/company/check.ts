/**
 * Assembleur de la fiche de vérification d'une société suisse (tâche osd.fiche, tâche 4).
 *
 * Combine en mémoire trois sources déjà lues ailleurs — registre du commerce en données
 * liées (`lindas.ts`), registre FINMA (`../data-loader.ts`, copie embarquée au déploiement
 * ou rafraîchie par `r2-refresh.ts`) et GLEIF (`gleif.ts`) — en une fiche de FAITS datés et
 * sourcés. Les `cross_checks` sont des recoupements EXACTS de nom (égalité après
 * normalisation) entre ces sources : jamais une note, un score ou un verdict. `companyCheck`
 * est le seul point d'entrée réseau ; `buildCompanyFiche` est un assemblage pur, sans
 * aucun accès réseau ni disque, pour rester facile à tester et à faire évoluer séparément.
 */

import { parseUid } from "./uid.js";
import { lookupLindas } from "./lindas.js";
import { lookupGleif } from "./gleif.js";
import { COMPANY_SOURCES } from "./sources.js";
import {
  getFinmaRegistry,
  getFinmaVersion,
  getLocalities,
  getStreets,
  normalizeStreetName,
  type FinmaRegistryRow,
  type LocalityRow,
} from "../data-loader.js";
import type { GleifRecord, LindasCompany, LiveDeps, Part } from "./types.js";

export interface Fact {
  field: string;
  value: string | boolean | null;
  source_id: string;
  source_url: string;
  // `string | null` depuis la correction du 06.10.2026 (relecture finale) : un fait FINMA
  // ne porte plus jamais `generated_at` (l'heure de fabrication de la fiche, pas une lecture).
  // `null` quand la version FINMA chargée n'est pas connue ; sinon la date ISO (sans heure)
  // tirée de cette version (voir `finmaRetrievedAt` plus bas).
  retrieved_at: string | null;
}

export interface CrossCheck {
  check: string;
  sources: string[];
  result: boolean;
  detail: string;
}

export interface CompanyFiche {
  uid: string;
  generated_at: string;
  commercial_register: { available: boolean; found: boolean; reason?: string; facts: Fact[] };
  // `available` (correction 1 du 06.10.2026) : `false` quand le registre FINMA en mémoire
  // n'a pas pu être lu (`deps.finma` qui lève) — `found`/`facts` restent alors vides, sans
  // jamais faire échouer toute la fiche. `data_note` (tâche osd.fiche, tâche 4) : les faits
  // FINMA viennent de la dernière collecte du service, jamais d'une lecture en direct.
  // `retrieved_at` de chaque Fact FINMA (relecture finale du 06.10.2026) : la date ISO tirée
  // de la version FINMA quand elle est connue (voir `finmaRetrievedAt`), sinon `null` —
  // jamais `generated_at`, qui serait l'heure de fabrication de la fiche, pas une lecture.
  // `data_note` mentionne la version elle-même (format "AAAA.MM.JJ") quand elle est connue.
  finma: { available: boolean; found: boolean; facts: Fact[]; warning_list: "not_checkable_by_uid"; data_note: string; reason?: string };
  lei: { available: boolean; found: boolean; reason?: string; facts: Fact[] };
  cross_checks: CrossCheck[];
  // Vérifications de l'adresse LINDAS contre le répertoire officiel des localités
  // (swisstopo), DISTINCTES de `cross_checks` (décision de Claude-Alain du 06.10.2026,
  // tâche osd.localites, tâche 2) : ce sont des comparaisons à une référence officielle,
  // pas un recoupement entre deux sources indépendantes qui se corroborent. TOUJOURS
  // présent (jamais absent du JSON) : tableau vide quand il n'y a pas d'adresse publiée
  // (forme juridique hors liste blanche) ou que le répertoire n'est pas disponible.
  address_checks: CrossCheck[];
  // Édition du répertoire officiel des localités utilisé pour `address_checks` (format
  // "AAAA-MM-JJ", tirée de `localities.meta.json`, relecture finale du 06.10.2026, point 4) :
  // `null` quand elle n'est pas connue (répertoire non câblé, indisponible, ou fichier de
  // métadonnées absent/illisible) — jamais une date inventée ni l'heure de fabrication de la
  // fiche. Toujours présent, comme `address_checks`.
  address_checks_edition: string | null;
  // `street_in_municipality` (relecture du 06.10.2026, point 2, tâche B1) : champ SÉPARÉ de
  // `address_checks` — vérifie la rue contre SON PROPRE répertoire (les rues), pas celui des
  // localités, et doit donc porter sa PROPRE édition datée. TOUJOURS présent (tableau vide
  // quand la vérification ne s'applique pas), au plus un élément aujourd'hui.
  street_checks: CrossCheck[];
  // Édition du répertoire officiel des rues utilisé pour `street_checks` (format "AAAA-MM-JJ",
  // tirée de `streets.meta.json`) : `null` quand elle n'est pas connue (répertoire non câblé,
  // indisponible, ou fichier de métadonnées absent/illisible). Toujours présent.
  street_checks_edition: string | null;
  // Ce que la fiche ne dit PAS : statut d'inscription au registre, publications FOSC,
  // sanctions SECO, organes. Toujours ces quatre valeurs, dans cet ordre (tâche osd.fiche).
  // Une 5e entrée ("official_locality_directory_checks") s'ajoute SEULEMENT quand le
  // répertoire des localités est explicitement indisponible (tâche osd.localites), et une 6e
  // ("official_street_directory_checks") SEULEMENT quand le répertoire des rues est
  // explicitement indisponible (tâche osd.localites, tâche B1).
  not_covered: string[];
  notice: string;
}

// "commercial_register_status" (pas "registration_status", qui désignerait à tort le champ
// GLEIF `lei_registration_status` : renommé en correction 1 du 06.10.2026).
//
// Liste FERMÉE, gardée par un test existant (`toEqual([...])` sur plusieurs scénarios de
// `tests/mcp/company-check.test.ts`) : ne JAMAIS y ajouter une entrée ici. Le recoupement
// d'adresse officielle (tâche osd.localites, tâche 2) ajoute sa propre entrée
// ("official_locality_directory") SEULEMENT quand `parts.localities` est explicitement
// fourni et indisponible — jamais dans cette constante, qui reste la base commune à tous
// les appels, y compris ceux qui ne connaissent pas encore `localities` (voir plus bas).
const NOT_COVERED = ["commercial_register_status", "fosc_publications", "seco_sanctions", "officers"] as const;

const NOTICE =
  "Unofficial copy assembled from public sources. Check the official registers before any decision: zefix.admin.ch, finma.ch, search.gleif.org.";

// Liste BLANCHE des formes juridiques eCH-0097 de personnes morales, relevée le 06.10.2026
// dans le vocabulaire officiel de LINDAS (relecture finale, tâche osd.fiche). SEULES ces
// formes ouvrent l'adresse postale (rue, NPA, localité) ET le but (`purpose`) : une raison
// sociale de personne morale ne porte normalement pas le nom d'une personne physique,
// contrairement à une entreprise individuelle ("0101"), une société en nom collectif
// ("0103"), une société en commandite ("0104") ou une société en commandite par actions
// ("0105"), dont la raison sociale PEUT légalement contenir un nom de famille. Tout autre
// code (dont "0111", "0113", "0118", "0119", "0151", "0571") ou code absent/inconnu ferme
// aussi l'adresse et le but : une forme non reconnue n'écarte jamais la possibilité d'une
// entreprise individuelle ou assimilée.
// Exportée (tâche osd.donnees, tâche B4) : `scripts/sync-finma-seats.ts` réutilise cette MÊME
// liste blanche pour ne garder, dans `finma_seats.csv`, que les sièges de personnes morales —
// jamais une copie, pour ne jamais diverger de la porte appliquée ici.
export const ADDRESS_AND_PURPOSE_FORM_CODES = new Set<string>([
  "0106", // société anonyme (SA)
  "0107", // société à responsabilité limitée (Sàrl)
  "0108", // société coopérative
  "0109", // association
  "0110", // fondation
  "0114", // société en commandite de placements collectifs
  "0115", // société d'investissement à capital variable (SICAV)
  "0116", // société d'investissement à capital fixe (SICAF)
  "0117", // institut de droit public
  "0220", "0221", "0222", "0223", "0224", // administrations publiques
  "0230", "0231", "0232", "0233", "0234", // entreprises publiques
  "0329", // organisation internationale
]);

/** NFC, espaces consécutifs réduits à un, bords rognés ; casse et ponctuation conservées. */
function normalizeName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

function namesMatch(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}

/** `true` seulement pour les formes juridiques de la liste blanche (voir
 *  `ADDRESS_AND_PURPOSE_FORM_CODES` ci-dessus) : adresse postale ET but publiés. Factorisé
 *  hors de `lindasFacts` (tâche osd.localites, tâche 2) pour que le recoupement d'adresse
 *  officielle applique EXACTEMENT la même porte que les faits `street_address`/
 *  `postal_code`/`locality` — jamais une règle dupliquée qui pourrait diverger. */
function hasPublishedAddress(data: LindasCompany): boolean {
  return data.legal_form_code !== null && ADDRESS_AND_PURPOSE_FORM_CODES.has(data.legal_form_code);
}

/**
 * Accès au répertoire officiel des localités (swisstopo), PAS un `Part<T>` : comme pour
 * `FinmaAccess`, ce n'est jamais une lecture en direct, seulement des lignes déjà chargées
 * qui peuvent être absentes (tâche osd.localites, tâche 2).
 *
 * Décision de Claude-Alain du 06.10.2026 : désormais câblé PAR DÉFAUT dans `companyCheck`
 * (voir plus bas). Le paramètre `parts.localities` de `buildCompanyFiche` reste OPTIONNEL
 * pour autant : `undefined` (jamais passé par un appelant, ex. les appels directs de
 * `tests/mcp/company-check.test.ts` antérieurs à cette tâche) signifie « fonctionnalité non
 * câblée pour cet appel » et ne change RIEN à la fiche (`address_checks` vide,
 * `not_covered` inchangé) — strictement différent de `{ available: false }` (« répertoire
 * câblé mais illisible »), qui ajoute l'entrée `not_covered` ci-dessous. Cette distinction
 * protège les tests existants qui appellent `buildCompanyFiche` sans ce paramètre.
 */
export type LocalitiesAccess =
  | { available: true; byPostalCode: ReadonlyMap<string, readonly LocalityRow[]>; edition: string | null }
  | { available: false };

/** NFC, casse ET espaces normalisés, SANS retirer d'accent (décision du 06.10.2026, revue
 *  point 3) : "Geneve" (sans accent) et "Genève" doivent rester "different", jamais
 *  "identical" — seul un accent retiré est une vraie divergence factuelle, une majuscule ou
 *  un espace de trop n'en est pas une. Distincte de `normalizeName` ci-dessus (noms de
 *  personnes morales, casse conservée) : ce recoupement compare une localité du registre du
 *  commerce à une localité officielle swisstopo, dont les conventions de casse peuvent
 *  différer sans qu'il y ait là un fait à signaler. */
function normalizeLocality(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Les vérifications d'adresse officielle (tâche osd.localites, tâche 2 — décision du
 * 06.10.2026 : champ `address_checks`, DISTINCT de `cross_checks`, puisque ce sont des
 * comparaisons à une référence officielle et non un recoupement entre deux sources
 * indépendantes qui se corroborent), SEULEMENT quand l'adresse LINDAS est publiée
 * (`hasPublishedAddress`, appelé par `buildCompanyFiche` avant d'invoquer cette fonction) :
 * republier une vérification sur un NPA ou une localité jamais exposés dans les faits
 * (formes fermées) fuiterait une donnée volontairement retenue.
 *
 * Relecture finale du 06.10.2026, point 2 : un NPA ABSENT du répertoire n'implique PAS que
 * la commune ou la localité diffèrent — les NPA réservés aux cases postales et aux grands
 * clients (ex. 1211, 8021, 8070, 3003) n'y figurent jamais, par construction du fichier
 * officiel. Dans ce cas, SEUL `postal_code_in_official_directory` (résultat faux) est émis ;
 * les deux autres vérifications seraient trompeuses (comparées à un ensemble vide de
 * communes) et sont donc omises. Un NPA VIDE n'émet aucune vérification (retour anticipé) :
 * `seat_municipality_matches_postal_code` ne doit JAMAIS s'évaluer sans NPA, même quand
 * `municipality_bfs_id` est publié.
 */
function localityAddressChecks(lindasData: LindasCompany, localities: LocalitiesAccess): CrossCheck[] {
  if (!localities.available) return [];
  const sources = ["ofrc.zefix_lindas", "swisstopo.localities"];
  const checks: CrossCheck[] = [];
  const postalCode = lindasData.postal_code;
  if (!postalCode) return checks; // NPA vide : aucune vérification (relecture finale, point 2)

  const rowsForPostalCode = localities.byPostalCode.get(postalCode) ?? [];
  const found = rowsForPostalCode.length > 0;
  checks.push({
    check: "postal_code_in_official_directory",
    sources,
    result: found,
    detail: found
      ? "Postal code found in the directory."
      : "Postal code not found (PO boxes and large clients are not listed there).",
  });

  if (!found) return checks; // NPA absent du répertoire : seule cette vérification est émise (point 2)

  if (lindasData.locality) {
    const wanted = normalizeLocality(lindasData.locality);
    const match = rowsForPostalCode.some((row) => normalizeLocality(row.locality) === wanted);
    checks.push({
      check: "locality_matches_postal_code",
      sources,
      result: match,
      // Détail court quand tout correspond ; la règle de comparaison (casse ignorée, accents
      // comptés) n'est expliquée que lorsqu'elle importe pour comprendre un résultat "no"
      // (relecture finale du 06.10.2026, point 3 : marge sous 2 500/2 350 caractères).
      detail: match ? "Locality matches the directory." : "Locality does not match the directory (case ignored, accents matter).",
    });
  }

  if (lindasData.municipality_bfs_id) {
    const bfsId = lindasData.municipality_bfs_id;
    const municipalityIds = new Set(rowsForPostalCode.map((row) => row.municipality_bfs_id));
    const match = municipalityIds.has(bfsId);
    checks.push({
      check: "seat_municipality_matches_postal_code",
      sources,
      result: match,
      detail: match
        ? "Seat municipality is linked to this postal code."
        : "Seat municipality is not linked to this postal code (a registered seat can differ from the postal address).",
    });
  }

  return checks;
}

/**
 * Accès au répertoire officiel des rues (swisstopo), PAS un `Part<T>` : même motif que
 * `LocalitiesAccess` ci-dessus — jamais une lecture en direct, seulement un index déjà chargé
 * qui peut être absent (tâche osd.localites, tâche B1). Câblé PAR DÉFAUT dans `companyCheck`
 * (voir plus bas) ; `parts.streets` reste OPTIONNEL dans `buildCompanyFiche` pour les mêmes
 * raisons que `parts.localities` : `undefined` laisse `address_checks` strictement inchangé.
 */
export type StreetsAccess =
  | { available: true; byMunicipality: ReadonlyMap<string, ReadonlySet<string>>; edition: string | null }
  | { available: false };

// Jeton « numéro de rue » : des chiffres suivis d'au plus UNE lettre (ex. "40", "12a", "12A"),
// insensible à la casse (relecture du 06.10.2026, point 4). Un suffixe plus long ("700ème")
// n'est jamais un numéro de rue — voir `hasExploitableStreetName` plus bas : c'est ce qui
// protège les rues officielles qui finissent par un nombre ("Place du 700ème").
const STREET_NUMBER_TOKEN_RE = /^\d+[a-z]?$/i;
// Lettre isolée qui suit un numéro ("12 A" — deux jetons séparés, décision du 06.10.2026).
const SINGLE_LETTER_TOKEN_RE = /^[a-z]$/i;
// Case postale : jamais de vérification de rue (décision du 06.10.2026, point 4) — ce préfixe
// ne porte aucun nom de rue, dans aucune des quatre langues officielles.
const PO_BOX_PREFIXES_RE = /^(postfach|case postale|casella postale|postbox)\b/i;

function isPoBoxAddress(streetAddress: string): boolean {
  return PO_BOX_PREFIXES_RE.test(streetAddress.trim());
}

/** Retire, EN FIN de liste de jetons, soit un seul jeton « numéro » (ex. "40", "12a"), soit une
 *  lettre isolée précédée d'un jeton « numéro » (ex. "12", "A" → "12 A" retiré en entier).
 *  Fonction pure, jamais appliquée directement à la chaîne : `tokens` vient déjà du découpage
 *  par espaces (décision du 06.10.2026, point 4). */
function stripTrailingStreetNumber(tokens: readonly string[]): string[] {
  if (tokens.length === 0) return [];
  const last = tokens[tokens.length - 1];
  if (tokens.length >= 2 && SINGLE_LETTER_TOKEN_RE.test(last) && STREET_NUMBER_TOKEN_RE.test(tokens[tokens.length - 2])) {
    return tokens.slice(0, -2);
  }
  if (STREET_NUMBER_TOKEN_RE.test(last)) return tokens.slice(0, -1);
  return [...tokens];
}

/** `true` si au moins un jeton n'est NI un numéro de rue NI une lettre isolée : une adresse
 *  réduite à "40" ou "12 A" ne porte aucun nom de rue exploitable (décision du 06.10.2026,
 *  point 4) — distinct d'une rue officielle qui finit par un nombre ("Place du 700ème" :
 *  "700ème" n'est NI `STREET_NUMBER_TOKEN_RE` NI `SINGLE_LETTER_TOKEN_RE`, donc exploitable). */
function hasExploitableStreetName(tokens: readonly string[]): boolean {
  return tokens.some((t) => !STREET_NUMBER_TOKEN_RE.test(t) && !SINGLE_LETTER_TOKEN_RE.test(t));
}

/**
 * Noms candidats pour la recherche dans le répertoire officiel des rues, dans l'ORDRE d'essai
 * (décision de Claude-Alain du 06.10.2026, point 4) : d'ABORD le texte complet normalisé tel
 * que publié par LINDAS (certaines rues officielles finissent légitimement par un nombre, ex.
 * « Place du 700ème ») ; SEULEMENT si ce texte complet ne correspond à rien, la version sans le
 * numéro de rue final est essayée. Jamais de candidat quand l'adresse ne porte aucun nom de rue
 * exploitable (voir `hasExploitableStreetName`) : liste vide dans ce cas.
 */
function streetCandidatesFromAddress(streetAddress: string): string[] {
  const tokens = streetAddress.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0 || !hasExploitableStreetName(tokens)) return [];
  const full = tokens.join(" ");
  const stripped = stripTrailingStreetNumber(tokens).join(" ");
  return stripped && stripped !== full ? [full, stripped] : [full];
}

/**
 * Vérification `street_in_municipality` (tâche osd.localites, tâche B1 — décision de
 * Claude-Alain du 06.10.2026, affinée le 06.10.2026) : le nom de rue dérivé de l'adresse LINDAS
 * existe-t-il parmi les rues officielles de la COMMUNE DU SIÈGE (`municipality_bfs_id`) ? Émise
 * seulement quand la commune du siège ET un nom de rue exploitable sont connus, et JAMAIS pour
 * une case postale (`isPoBoxAddress`) — sinon tableau vide, jamais une vérification bancale.
 * Quand la rue n'est pas trouvée dans la commune du siège mais existe dans une AUTRE commune
 * partageant le même NPA que l'adresse (le siège et l'adresse postale peuvent légitimement
 * différer), le résultat reste "no" avec un détail qui le dit — un fait, jamais un verdict.
 * `localities` reste optionnel : sans répertoire des localités, ce recoupement supplémentaire
 * est simplement omis (résultat "no" générique).
 *
 * Libellé « no » générique (relecture du 06.10.2026, point 3) : « Street not found among the
 * official street names of the seat municipality. » — le répertoire des rues exclut par
 * construction les tronçons `real` non officiels (3 308 au 06.10.2026, voir
 * `scripts/sync-streets.ts`) : un "no" dit seulement que le nom n'est pas parmi les noms
 * OFFICIELS connus, jamais que la rue n'existe pas physiquement.
 */
function streetInMunicipalityCheck(lindasData: LindasCompany, streets: StreetsAccess, localities: LocalitiesAccess | undefined): CrossCheck[] {
  if (!streets.available) return [];
  const bfsId = lindasData.municipality_bfs_id;
  if (!bfsId) return [];
  const streetAddress = lindasData.street_address;
  if (!streetAddress) return [];
  if (isPoBoxAddress(streetAddress)) return []; // case postale : jamais de vérification de rue
  const candidates = streetCandidatesFromAddress(streetAddress);
  if (candidates.length === 0) return [];
  const sources = ["ofrc.zefix_lindas", "swisstopo.streets"];

  const seatStreets = streets.byMunicipality.get(bfsId);
  if (candidates.some((name) => seatStreets?.has(normalizeStreetName(name)))) {
    return [{
      check: "street_in_municipality",
      sources,
      result: true,
      detail: "Street found in the official street directory of the seat municipality.",
    }];
  }

  const postalCode = lindasData.postal_code;
  if (postalCode && localities?.available) {
    const municipalitiesForPostalCode = localities.byPostalCode.get(postalCode) ?? [];
    const foundElsewhere = municipalitiesForPostalCode.some(
      (row) => row.municipality_bfs_id !== bfsId &&
        candidates.some((name) => streets.byMunicipality.get(row.municipality_bfs_id)?.has(normalizeStreetName(name))),
    );
    if (foundElsewhere) {
      return [{
        check: "street_in_municipality",
        sources,
        result: false,
        detail: "Street not found among the official street names of the seat municipality, but found in another municipality sharing the same postal code (the seat and the address can differ).",
      }];
    }
  }

  return [{
    check: "street_in_municipality",
    sources,
    result: false,
    detail: "Street not found among the official street names of the seat municipality.",
  }];
}

function pushIfPresent(facts: Fact[], field: string, value: string | null | undefined, sourceId: string, sourceUrl: string, retrievedAt: string | null): void {
  if (value !== null && value !== undefined && value !== "") {
    facts.push({ field, value, source_id: sourceId, source_url: sourceUrl, retrieved_at: retrievedAt });
  }
}

/** Un `Fact` par champ non nul de `LindasCompany` ; `other_names` (tableau) est joint en une
 *  seule chaîne pour rester compatible avec `Fact.value`.
 *
 *  Liste blanche des formes juridiques (relecture finale du 06.10.2026, remplace l'ancienne
 *  règle "fermé si 0101 ou code inconnu") : `street_address`, `postal_code`, `locality` ET
 *  `purpose` ne sortent QUE si `legal_form_code` figure dans `ADDRESS_AND_PURPOSE_FORM_CODES`
 *  — jamais pour "0101" (entreprise individuelle), ni pour une forme hors liste, ni pour un
 *  code absent ou vide. */
function lindasFacts(data: LindasCompany, retrievedAt: string): Fact[] {
  const sourceId = "ofrc.zefix_lindas";
  const sourceUrl = COMPANY_SOURCES[sourceId].url;
  const addressAndPurposeAllowed = hasPublishedAddress(data);
  const facts: Fact[] = [];
  const add = (field: string, value: string | null) => pushIfPresent(facts, field, value, sourceId, sourceUrl, retrievedAt);

  add("legal_name", data.legal_name);
  if (data.other_names.length > 0) add("other_names", data.other_names.join("; "));
  add("legal_form_code", data.legal_form_code);
  add("legal_form_label_fr", data.legal_form_label_fr);
  add("legal_form_label_de", data.legal_form_label_de);
  add("municipality", data.municipality);
  add("municipality_bfs_id", data.municipality_bfs_id);
  add("canton", data.canton);
  if (addressAndPurposeAllowed) {
    add("street_address", data.street_address);
    add("postal_code", data.postal_code);
    add("locality", data.locality);
  }
  if (addressAndPurposeAllowed) add("purpose", data.purpose);
  add("ch_id", data.ch_id);
  add("register_uri", data.register_uri);
  return facts;
}

/** Un groupe de faits par enregistrement GLEIF ; `source_url` propre à chaque LEI.
 *  `lei_registration_status`/`gleif_entity_status` (renommés en correction 1 du 06.10.2026
 *  pour ne jamais se confondre avec `not_covered: "commercial_register_status"` ni avec les
 *  autres statuts de la fiche) : `pushIfPresent` n'émet pas le fait quand `gleif.ts` a rendu
 *  `null` (statut absent de GLEIF, jamais une valeur inventée comme "unknown"). */
function gleifFacts(records: readonly GleifRecord[], retrievedAt: string): Fact[] {
  const sourceId = "gleif.lei_api";
  const facts: Fact[] = [];
  for (const record of records) {
    const sourceUrl = `https://search.gleif.org/#/record/${record.lei}`;
    const add = (field: string, value: string | null) => pushIfPresent(facts, field, value, sourceId, sourceUrl, retrievedAt);
    add("lei", record.lei);
    add("legal_name", record.legal_name);
    add("gleif_entity_status", record.entity_status);
    add("lei_registration_status", record.registration_status);
    add("last_update", record.last_update);
    add("registered_as", record.registered_as);
  }
  return facts;
}

/** `licence_type`, `status`, `licence_date` pour chaque ligne FINMA dont l'IDE est exactement
 *  celui demandé (plusieurs lignes possibles, une par autorisation). `source_url` vient de la
 *  ligne elle-même, jamais de la table locale.
 *
 *  PAS de fait `lei` (retiré en relecture finale du 06.10.2026, tâche osd.fiche) : la colonne
 *  `lei` de `finma_registry.csv` est posée par la collecte depuis GLEIF
 *  (`etl/finma/ingest-gleif.ts`, `enrichWithGleif`), jamais lue sur le site de la FINMA — la
 *  présenter comme un fait FINMA aurait fait croire à une seconde source indépendante du LEI,
 *  qui n'existe pas. Le recoupement `finma_lei_vs_gleif_lei` est retiré pour la même raison
 *  (comparer un LEI à lui-même ne recoupe rien) ; le recoupement de nom FINMA ↔ LINDAS reste. */
function finmaFacts(rows: readonly FinmaRegistryRow[], retrievedAt: string | null): Fact[] {
  const sourceId = "finma.uid_csv";
  const fallbackUrl = COMPANY_SOURCES[sourceId].url;
  const facts: Fact[] = [];
  for (const row of rows) {
    const sourceUrl = row.source_url || fallbackUrl;
    const add = (field: string, value: string) => pushIfPresent(facts, field, value, sourceId, sourceUrl, retrievedAt);
    add("licence_type", row.licence_type);
    add("status", row.status);
    add("licence_date", row.licence_date);
  }
  return facts;
}

/** `retrieved_at` des faits FINMA (correction finale du 06.10.2026) : jamais `generated_at`
 *  (l'heure de fabrication de la fiche n'est pas une lecture). Quand la version FINMA
 *  actuellement servie est connue (format `AAAA.MM.JJ`, ex. "2026.10.06", posé par
 *  `release-finma.ts`), elle devient une date ISO sans heure ("2026-10-06") ; sinon `null`,
 *  jamais une date inventée. */
function finmaRetrievedAt(version: string | null | undefined): string | null {
  if (!version) return null;
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(version);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Accès au registre FINMA en mémoire, PAS un `Part<T>` : ce n'est jamais une lecture en
 * direct (pas de `retrieved_at` propre), seulement un tableau déjà chargé qui peut échouer
 * à être lu (`deps.finma` qui lève — correction 1 du 06.10.2026, tâche osd.fiche, tâche 4).
 */
export type FinmaAccess = { available: true; rows: readonly FinmaRegistryRow[] } | { available: false; reason: string };

export function buildCompanyFiche(
  uid: string,
  parts: {
    lindas: Part<LindasCompany>;
    gleif: Part<GleifRecord[]>;
    finma: FinmaAccess;
    /**
     * Version des données FINMA actuellement servies (`getFinmaVersion()`), lue par
     * l'appelant SEULEMENT quand `parts.finma` vient du registre par défaut (voir
     * `companyCheck`) : un registre FINMA injecté en test n'a pas de version connue
     * correspondante, et lire une horloge globale ici romprait l'assemblage pur de cette
     * fonction. Absente ou `null` : aucune version connue, seulement mentionné dans
     * `finma.data_note` via le texte par défaut.
     */
    finmaVersion?: string | null;
    /** Optionnel (tâche osd.localites, tâche 2) : voir le commentaire de `LocalitiesAccess`
     *  ci-dessus. Absent = fonctionnalité non câblée, fiche strictement identique à avant. */
    localities?: LocalitiesAccess;
    /** Optionnel (tâche osd.localites, tâche B1) : voir le commentaire de `StreetsAccess`
     *  ci-dessus. Absent = fonctionnalité non câblée, fiche strictement identique à avant. */
    streets?: StreetsAccess;
    now: () => number;
  },
): CompanyFiche {
  const generatedAt = new Date(parts.now()).toISOString();

  const commercial_register: CompanyFiche["commercial_register"] = parts.lindas.available
    ? parts.lindas.found && parts.lindas.data
      ? { available: true, found: true, facts: lindasFacts(parts.lindas.data, parts.lindas.retrieved_at) }
      : { available: true, found: false, facts: [] }
    : { available: false, found: false, reason: parts.lindas.reason, facts: [] };

  const lei: CompanyFiche["lei"] = parts.gleif.available
    ? parts.gleif.found && parts.gleif.data
      ? { available: true, found: true, facts: gleifFacts(parts.gleif.data, parts.gleif.retrieved_at) }
      : { available: true, found: false, facts: [] }
    : { available: false, found: false, reason: parts.gleif.reason, facts: [] };

  // Toutes les lignes FINMA dont l'IDE est EXACTEMENT celui demandé (égalité de chaîne sur
  // la forme canonique CHE-xxx.xxx.xxx : `uid` ici et dans la colonne du CSV sont déjà
  // sous cette forme — 103 IDE portent 2 ou 3 lignes, une par autorisation). Tableau vide
  // (jamais une exception) quand le registre lui-même n'a pas pu être lu.
  const finmaRows = parts.finma.available ? parts.finma.rows.filter((row) => row.uid === uid) : [];

  // La date de collecte des lignes FINMA chargées en mémoire n'est pas connue ici (pas de
  // lecture en direct) : `finmaRetrievedAt` tire la date ISO de `parts.finmaVersion`
  // (ex. "2026.10.06") quand elle est connue, sinon `null` — jamais `generated_at`, qui
  // daterait la fabrication de la fiche, pas une lecture (relecture finale du 06.10.2026).
  const finmaDataNote = parts.finmaVersion
    ? `Facts from the FINMA copy currently loaded by this service (version ${parts.finmaVersion}), not a live FINMA lookup.`
    : "Facts from the FINMA copy currently loaded by this service, not a live FINMA lookup.";

  const finma: CompanyFiche["finma"] = parts.finma.available
    ? {
        available: true,
        found: finmaRows.length > 0,
        facts: finmaFacts(finmaRows, finmaRetrievedAt(parts.finmaVersion)),
        warning_list: "not_checkable_by_uid",
        data_note: finmaDataNote,
      }
    : {
        available: false,
        found: false,
        facts: [],
        warning_list: "not_checkable_by_uid",
        data_note: "The FINMA copy of this service could not be read; no FINMA fact is given.",
        reason: parts.finma.reason,
      };

  const lindasData = commercial_register.found && parts.lindas.available ? parts.lindas.data : null;
  const gleifRecords = lei.found && parts.gleif.available && parts.gleif.data ? parts.gleif.data : [];

  // Recoupements : des FAITS (jamais un verdict), uniquement quand les deux côtés
  // existent réellement (source disponible ET trouvée).
  const cross_checks: CrossCheck[] = [];

  if (lindasData) {
    for (const record of gleifRecords) {
      cross_checks.push({
        check: "legal_name_lindas_vs_gleif",
        sources: ["ofrc.zefix_lindas", "gleif.lei_api"],
        result: namesMatch(lindasData.legal_name, record.legal_name),
        detail: `LINDAS legal name "${lindasData.legal_name}" vs GLEIF legal name "${record.legal_name}" (LEI ${record.lei})`,
      });
    }
  }

  // Pas de recoupement `finma_lei_vs_gleif_lei` (retiré en relecture finale du 06.10.2026,
  // tâche osd.fiche) : le `lei` d'une ligne FINMA est lui-même posé par la collecte depuis
  // GLEIF (`etl/finma/ingest-gleif.ts`), jamais lu sur le site de la FINMA — comparer ce LEI
  // au LEI GLEIF revient à comparer une valeur à sa propre source, jamais un recoupement
  // entre deux sources indépendantes. Le recoupement de nom FINMA ↔ LINDAS reste ci-dessous.
  if (lindasData) {
    const seenNames = new Set<string>();
    for (const row of finmaRows) {
      if (row.name !== "" && !seenNames.has(row.name)) {
        seenNames.add(row.name);
        cross_checks.push({
          check: "finma_name_vs_lindas_legal_name",
          sources: ["finma.uid_csv", "ofrc.zefix_lindas"],
          result: namesMatch(row.name, lindasData.legal_name),
          detail: `FINMA name "${row.name}" vs LINDAS legal name "${lindasData.legal_name}"`,
        });
      }
    }
  }

  // Vérifications d'adresse officielle (tâche osd.localites, tâche 2 — décision du
  // 06.10.2026) : champ SÉPARÉ `address_checks`, TOUJOURS présent (tableau vide par défaut),
  // jamais mélangé à `cross_checks`. Rempli SEULEMENT quand `parts.localities` est
  // explicitement fourni (sinon comportement strictement inchangé pour les appelants qui ne
  // connaissent pas ce paramètre, voir le commentaire de `LocalitiesAccess`) ET l'adresse
  // LINDAS est publiée (sinon on fuiterait un NPA/localité volontairement retenu des faits).
  const address_checks: CrossCheck[] = [];
  if (lindasData && hasPublishedAddress(lindasData)) {
    if (parts.localities) address_checks.push(...localityAddressChecks(lindasData, parts.localities));
  }
  const address_checks_edition: string | null = parts.localities && parts.localities.available ? parts.localities.edition : null;

  // street_in_municipality (tâche osd.localites, tâche B1, relecture du 06.10.2026, point 2) :
  // champ SÉPARÉ `street_checks`, avec SA PROPRE édition datée (celle du répertoire des rues,
  // jamais celle des localités) — ce n'est pas la même référence officielle que les trois
  // vérifications de `address_checks` ci-dessus.
  const street_checks: CrossCheck[] = [];
  if (lindasData && hasPublishedAddress(lindasData) && parts.streets) {
    street_checks.push(...streetInMunicipalityCheck(lindasData, parts.streets, parts.localities));
  }
  const street_checks_edition: string | null = parts.streets && parts.streets.available ? parts.streets.edition : null;

  const not_covered: string[] = [...NOT_COVERED];
  // Répertoire câblé mais illisible : signalé, jamais une exception (revue point 5). Un
  // appelant qui ne connaît pas encore `localities` (`undefined`) ne voit AUCUN changement.
  if (parts.localities && !parts.localities.available) {
    not_covered.push("official_locality_directory_checks");
  }
  if (parts.streets && !parts.streets.available) {
    not_covered.push("official_street_directory_checks");
  }

  return {
    uid,
    generated_at: generatedAt,
    commercial_register,
    finma,
    lei,
    cross_checks,
    address_checks,
    address_checks_edition,
    street_checks,
    street_checks_edition,
    not_covered,
    notice: NOTICE,
  };
}

export async function companyCheck(
  rawUid: string,
  deps: LiveDeps & { finma?: () => readonly FinmaRegistryRow[] },
): Promise<{ ok: true; fiche: CompanyFiche } | { ok: false; reason: string }> {
  const parsed = parseUid(rawUid);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const [lindas, gleif] = await Promise.all([lookupLindas(parsed.compact, deps), lookupGleif(parsed.uid, deps)]);
  // `getFinmaVersion()` n'est lue que lorsque le registre par défaut est utilisé : un
  // registre FINMA injecté (tests, ou tout autre appelant) n'a pas de version connue
  // correspondante (voir le commentaire sur `parts.finmaVersion` dans `buildCompanyFiche`).
  // Registre illisible (`deps.finma` qui lève, ou le chargement paresseux du CSV par
  // défaut) : jamais une exception qui ferait échouer toute la fiche — `finma.available`
  // devient `false`, sans raison brute exposée (correction 1 du 06.10.2026).
  const usingDefaultFinmaRegistry = deps.finma === undefined;
  let finma: FinmaAccess;
  let finmaVersion: string | null = null;
  try {
    finma = { available: true, rows: (deps.finma ?? getFinmaRegistry)() };
  } catch (err) {
    // Trace pour l'exploitant (jamais renvoyée à l'appelant) : un registre FINMA illisible
    // ne doit pas passer inaperçu, même si la fiche reste servie.
    console.error("company_check: FINMA registry could not be read", err instanceof Error ? err.message : String(err));
    finma = { available: false, reason: "FINMA registry could not be read" };
  }
  if (finma.available && usingDefaultFinmaRegistry) finmaVersion = getFinmaVersion();
  // Répertoire des localités câblé PAR DÉFAUT (décision de Claude-Alain du 06.10.2026,
  // tâche osd.localites) : jamais une exception quand le fichier est absent ou illisible
  // (`getLocalities()` rend `null`, jamais ne lève) — `localities.available` devient
  // `false`, et `buildCompanyFiche` ajoute l'entrée `not_covered` correspondante.
  const localitiesLoaded = getLocalities();
  const localities: LocalitiesAccess = localitiesLoaded
    ? { available: true, byPostalCode: localitiesLoaded.byPostalCode, edition: localitiesLoaded.edition }
    : { available: false };
  // Répertoire des rues câblé PAR DÉFAUT (décision de Claude-Alain du 06.10.2026, tâche
  // osd.localites, tâche B1), même motif que `localities` ci-dessus : jamais une exception
  // quand le fichier est absent ou illisible.
  const streetsLoaded = getStreets();
  const streets: StreetsAccess = streetsLoaded
    ? { available: true, byMunicipality: streetsLoaded.byMunicipality, edition: streetsLoaded.edition }
    : { available: false };
  const fiche = buildCompanyFiche(parsed.uid, { lindas, gleif, finma, finmaVersion, localities, streets, now: deps.now });
  return { ok: true, fiche };
}
