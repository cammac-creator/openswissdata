#!/usr/bin/env tsx
/**
 * Prospection hebdomadaire de nouvelles sources publiques réutilisables, par l'API CKAN
 * d'opendata.swiss (`package_search`), tâche osd.prospection (piste A du plan
 * `2026-10-06-prospection-et-api.md`).
 *
 * Ne collecte, ne publie et ne modifie AUCUNE donnée servie : ce script lit seulement le
 * catalogue public opendata.swiss et écrit un rapport de prospection
 * (`docs/data-status/prospection.json` et `.md`), jamais `src/mcp/data/`. L'intégration
 * effective d'une source retenue reste une tâche séparée (registre → collecte → vérification
 * ou combinaison → API), décidée jeu par jeu.
 *
 * Classement, par jeu de données (toujours CALCULÉ, jamais une affirmation plus forte que ce
 * qui est prouvé — même règle que le reste du projet pour l'OFS et les données personnelles) :
 *   - `licence` : « open » si au moins une ressource porte `terms_open` ou `terms_by` (lu dans
 *     le fragment exact après `#` de `resources[].rights`, jamais une sous-chaîne : `terms_by`
 *     ne doit JAMAIS matcher `terms_by_ask`). Sinon exclu, avec un motif précis
 *     (`licence_absente`, `licence_non_ouverte` pour `terms_ask`/`terms_by_ask`/CC-NC ou
 *     ND/inconnu, `licence_cc_by_sa` — jamais retenu, partage à l'identique incompatible avec
 *     la vente d'archives fermées ; CC0 et CC-BY purs comptent comme ouverts, voir plus bas).
 *   - `personnes` : exclu (motif `personnes_detectees`) si le titre, la description ou les
 *     mots-clés contiennent un marqueur de la liste FERMÉE `PERSON_MARKERS` (FR/DE/IT/EN).
 *     Sinon le jeu reste « à vérifier » (jamais annoncé « sans données personnelles »).
 *   - `a_verifier_ofs` : jeu publié par l'OFS (organisation `bundesamt-fur-statistik-bfs`) ou
 *     dont une ressource pointe vers `bfs.admin.ch` — reste « à vérifier » tant que la
 *     clarification écrite à l'OFS (06.10.2026) n'a pas abouti (AGENTS.md).
 *   - `join_keys` : clés de jointure détectées dans l'en-tête d'au plus 3 ressources CSV par
 *     jeu RETENU (licence ouverte ET pas de marqueur de personnes), lues par lecture partielle
 *     (`Range: bytes=0-65535`, ignorée si refusée) ; à défaut, déduites de mots du titre
 *     (« par commune », « nach Gemeinde »…, suffixées « (titre) » pour ne jamais les confondre
 *     avec une clé confirmée dans un en-tête réel).
 *   - `deja_collecte` : présent au registre des sources (`etl/shared/sources/registry.ts`),
 *     par rapprochement EXACT (sous-chaîne, jamais flou) d'un segment d'URL distinctif d'au
 *     moins 10 caractères entre l'adresse du registre et une ressource ou la fiche du jeu.
 *
 * AUCUN score ni note numérique n'est calculé ni exposé (décision de l'intégrateur du
 * 06.10.2026) : le tri des candidats se fait par critères lisibles seuls — éditeur fédéral >
 * cantonal > communal, nombre de clés de jointure, fréquence de mise à jour — puis par
 * identifiant pour un ordre déterministe en cas d'égalité.
 *   - Décision du 07.10.2026, après un run réel : une colonne CSV de personne (`vorname`,
 *     `prénom`, paire `<préfixe>_name`+`<préfixe>_vorname`…) exclut aussi le jeu (motif
 *     `colonne_personne`), même s'il a passé les marqueurs texte — cas réel : le jeu OFEN
 *     « Bénéficiaires de la rétribution de l'injection » n'a aucun marqueur texte mais nomme le
 *     propriétaire de l'installation dans son CSV.
 *
 * Fenêtre tournante et fusion hebdomadaire (décision du 07.10.2026) : chaque passage lit au
 * plus `maxPages` pages (55 par défaut) à partir d'un décalage qui tourne chaque semaine
 * (`numéro de semaine ISO × maxPages, modulo le nombre total de pages`, en bouclant sur le
 * catalogue) — jamais la même fenêtre qu'une collecte à tri croissant fixe, qui ne verrait
 * jamais les nouvelles publications. Le résultat de ce passage est FUSIONNÉ avec le rapport
 * `docs/data-status/prospection.json` déjà committé et l'état `docs/data-status/
 * prospection-state.json` (une ligne compacte `[id, seen_on, statut]` par jeu jamais vu) : un
 * jeu garde la date de sa dernière lecture, et un jeu non revu depuis `maxAgeDays` (56 jours =
 * 8 semaines par défaut) est retiré de l'état ET de la liste des candidats. Le fichier public
 * ne garde que les 300 meilleurs candidats cumulés (+ résumé + liste des jeux déjà collectés) ;
 * le détail complet de CE passage (tous les candidats et écarts qu'il a trouvés) n'est écrit
 * que dans `docs/internal/` (jamais publié ni commité), pour un examen local (jamais publié, aucun artefact).
 *
 * Délai interne (décision du 07.10.2026) : le script s'arrête de lui-même après `timeLimitMs`
 * (140 minutes par défaut) même sans page en échec, écrit un rapport `partial: true`
 * (`stopped_reason: "time_limit"`) et sort avec le code 2 (distinct du code 1 générique d'une
 * erreur non gérée) — au workflow de décider de committer quand même puis d'échouer pour que
 * l'alerte parte.
 *
 * Mode réel (par défaut) : un délai `delayMs` (500 ms par défaut) avant CHAQUE appel sortant
 * (sonde, page CKAN ou lecture partielle de CSV), un délai d'abandon `timeoutMs` par appel
 * (20 s par défaut). Une page qui échoue est retentée une seule fois ; un second échec ARRÊTE
 * le passage et marque le rapport `partial: true` (`stopped_reason: "page_failed"`) — jamais un
 * rapport qui se présente comme complet alors qu'il ne l'est pas.
 *
 * Usage :
 *   tsx scripts/prospect-sources.ts
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { SOURCES } from "../etl/shared/sources/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_JSON = join(__dirname, "..", "docs", "data-status", "prospection.json");
const DEFAULT_OUT_MD = join(__dirname, "..", "docs", "data-status", "prospection.md");
const DEFAULT_OUT_STATE = join(__dirname, "..", "docs", "data-status", "prospection-state.json");
// docs/internal/ est ignoré par Git (AGENTS.md) : le détail complet d'UN passage (des milliers
// de lignes) n'est jamais commité, seulement déposé ici pour un examen local (aucun artefact).
const DEFAULT_OUT_PASS_DETAIL = join(__dirname, "..", "docs", "internal", "prospection-pass-detail.json");
const CKAN_SEARCH_URL = "https://ckan.opendata.swiss/api/3/action/package_search";
const DEFAULT_USER_AGENT = "OpenSwissData prospection";
const DEFAULT_MAX_PAGES = 55; // pages PAR PASSAGE (décision du 07.10.2026 : fenêtre tournante)
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_DELAY_MS = 500;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_TIME_LIMIT_MS = 140 * 60 * 1000; // 140 min — décision du 07.10.2026
const DEFAULT_MAX_AGE_DAYS = 56; // 8 semaines — au-delà, un jeu non revu sort de l'état
const MAX_CANDIDATES_KEPT = 300; // décision du 07.10.2026 : taille du fichier public
const MAX_CSV_HEADERS_PER_DATASET = 3;
const MIN_TOKEN_LENGTH = 10; // segments d'URL plus courts jugés trop génériques pour prouver un doublon

// ---------------------------------------------------------------------------------------
// Types CKAN (sous-ensemble lu). Les champs multilingues d'opendata.swiss sont soit une
// chaîne simple, soit un objet { de, fr, it, en } dont certaines langues peuvent être vides.
// ---------------------------------------------------------------------------------------
export type CkanText = string | Record<string, string> | null | undefined;

export interface CkanResource {
  url?: string;
  format?: string;
  rights?: string | null;
}

export interface CkanOrganization {
  name?: string;
  title?: CkanText;
  political_level?: string;
}

export interface CkanPackage {
  id: string; // identifiant TECHNIQUE CKAN (UUID) — décision de l'intégrateur du 07.10.2026 :
  // seul identifiant publié (état et rapport), jamais `name`.
  name: string; // slug lisible (ex. pour construire des URLs de lecture SEULEMENT) — NE JAMAIS
  // écrire `name` dans un fichier publié : un slug peut encoder un nom de personne, une
  // commune ou une entité identifiable d'une façon que l'UUID ne permet jamais.
  title?: CkanText;
  description?: CkanText;
  notes?: CkanText;
  keywords?: Record<string, string[]> | string[];
  tags?: Array<{ name?: string }>;
  organization?: CkanOrganization;
  accrual_periodicity?: string | null;
  modified?: string | null;
  url?: string | null;
  resources?: CkanResource[];
}

export interface CkanSearchResult {
  count: number;
  results: CkanPackage[];
}

export interface CkanSearchResponse {
  success?: boolean;
  result?: CkanSearchResult;
}

// ---------------------------------------------------------------------------------------
// Texte multilingue : préférence fr > de > it > en > première valeur non vide.
// ---------------------------------------------------------------------------------------
export function pickLocalizedText(value: CkanText, preferred: string[] = ["fr", "de", "it", "en"]): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  for (const lang of preferred) {
    const v = value[lang];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  for (const v of Object.values(value)) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

function allLocalizedValues(value: CkanText): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  return Object.values(value).filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** Texte complet cherché pour les marqueurs de personnes : titre + description/notes + mots-clés + tags,
 *  toutes langues confondues (une exclusion ne doit pas dépendre de la langue consultée en premier). */
export function collectSearchableText(pkg: CkanPackage): string {
  const parts: string[] = [
    ...allLocalizedValues(pkg.title),
    ...allLocalizedValues(pkg.description),
    ...allLocalizedValues(pkg.notes),
  ];
  if (Array.isArray(pkg.keywords)) {
    parts.push(...pkg.keywords);
  } else if (pkg.keywords && typeof pkg.keywords === "object") {
    for (const arr of Object.values(pkg.keywords)) if (Array.isArray(arr)) parts.push(...arr);
  }
  if (Array.isArray(pkg.tags)) {
    for (const t of pkg.tags) if (t?.name) parts.push(t.name);
  }
  return parts.join(" \n ");
}

// ---------------------------------------------------------------------------------------
// Licence : fragment EXACT après `#` pour `opendata.swiss/terms-of-use`, jamais une
// sous-chaîne (sinon `terms_by` matcherait `terms_by_ask`). `cc-by-sa` reconnu séparément
// (vocabulaire `opendefinition.org`, pas le même schéma).
// ---------------------------------------------------------------------------------------
export type RightsCode =
  | "open" | "by" | "by_ask" | "ask" // vocabulaire opendata.swiss
  | "attribution" | "public_domain" | "cc_by_sa" // Creative Commons (opendefinition.org ou creativecommons.org)
  | "autre" | "absente";

/** Reconnaît une licence Creative Commons, SEULEMENT dans sa forme pure : CC0 (toute version,
 *  « domaine public ») ou CC-BY SANS aucun autre modificateur (toute version — le numéro de
 *  version n'entre jamais dans la comparaison). Décision de l'intégrateur du 07.10.2026 :
 *  CC-BY-SA reste exclu séparément (`cc_by_sa`, motif propre) ; TOUTE licence « NC » (non
 *  commerciale, seule ou combinée à SA/ND) et toute autre combinaison (ND, BY-NC-ND…) tombe en
 *  `autre` — jamais reconnue comme ouverte, puisque ce n'est littéralement ni CC0 ni CC-BY pur. */
function classifyCreativeCommonsFamily(rights: string): "public_domain" | "attribution" | "cc_by_sa" | "autre" | null {
  const lower = rights.toLowerCase();
  if (/(^|[^a-z0-9])cc-?zero([^a-z0-9]|$)|(^|[^a-z0-9])cc0([^a-z0-9]|$)|publicdomain\/zero/.test(lower)) {
    return "public_domain";
  }
  // `[a-z]+(?:-[a-z]+)*` (jamais `[a-z-]+`) : s'arrête avant un numéro de version collé au code
  // (ex. « cc-by-4.0 » sur opendefinition.org) sans capturer un « - » de fin orphelin, ce qui
  // aurait fait échouer silencieusement la comparaison `=== "by"` (relevé le 07.10.2026).
  const m = /creativecommons\.org\/licenses\/([a-z]+(?:-[a-z]+)*)|opendefinition\.org\/licenses\/cc-([a-z]+(?:-[a-z]+)*)/.exec(lower);
  const code = m ? (m[1] ?? m[2]) : null;
  if (!code) return null; // pas une adresse Creative Commons reconnue
  if (code === "by") return "attribution"; // CC-BY pur, toute version
  if (code === "by-sa") return "cc_by_sa"; // CC-BY-SA pur (sans NC), toute version
  return "autre"; // by-nc, by-nc-sa, by-nc-nd, by-nd… : jamais reconnues comme ouvertes
}

export function classifyResourceRights(rights: string | null | undefined): RightsCode {
  if (!rights || rights.trim().length === 0) return "absente";
  if (rights.startsWith("https://opendata.swiss/terms-of-use#")) {
    const fragment = rights.slice(rights.indexOf("#") + 1);
    if (fragment === "terms_open") return "open";
    if (fragment === "terms_by") return "by";
    if (fragment === "terms_by_ask") return "by_ask";
    if (fragment === "terms_ask") return "ask";
    return "autre";
  }
  return classifyCreativeCommonsFamily(rights) ?? "autre";
}

// Renommé le 07.10.2026 (décision de l'intégrateur) : `licence_fermee` → `licence_non_ouverte`,
// pour couvrir aussi bien `terms_ask`/`terms_by_ask` que les combinaisons Creative Commons avec
// NC ou ND — aucune de ces licences n'est « fermée » au sens strict (beaucoup autorisent déjà
// la réutilisation sous condition), seulement « non ouverte » selon les critères retenus ici.
export type LicenceMotif = "licence_absente" | "licence_non_ouverte" | "licence_cc_by_sa";

export interface LicenceVerdict {
  licence: "open" | "exclu";
  matched?: "open" | "by" | "attribution" | "public_domain"; // laquelle des formes ouvertes a été trouvée
  motif?: LicenceMotif;
}

export function classifyLicence(resources: CkanResource[] | undefined): LicenceVerdict {
  const codes = (resources ?? []).map((r) => classifyResourceRights(r.rights));
  if (codes.includes("open")) return { licence: "open", matched: "open" };
  if (codes.includes("by")) return { licence: "open", matched: "by" };
  if (codes.includes("attribution")) return { licence: "open", matched: "attribution" };
  if (codes.includes("public_domain")) return { licence: "open", matched: "public_domain" };
  if (codes.length === 0 || codes.every((c) => c === "absente")) {
    return { licence: "exclu", motif: "licence_absente" };
  }
  if (codes.includes("cc_by_sa")) return { licence: "exclu", motif: "licence_cc_by_sa" };
  return { licence: "exclu", motif: "licence_non_ouverte" }; // terms_ask, terms_by_ask, CC-NC/ND, ou inconnu
}

// ---------------------------------------------------------------------------------------
// Personnes physiques : liste FERMÉE de marqueurs (plan du 06.10.2026), comparée en minuscules
// avec des frontières Unicode (`\p{L}`) pour ne jamais confondre un mot entier avec un
// fragment d'un mot composé (ex. l'allemand « Ortschaftsname » ne contient PAS le marqueur
// « names » au sens d'un mot séparé).
// ---------------------------------------------------------------------------------------
// Relecture du 06.10.2026 : « nom », « names » et « nome » (NOMS COMMUNS NUS) ont été retirés
// de la liste. Ce sont des mots bien trop génériques pour la prose descriptive des jeux
// géographiques eux-mêmes (« nom de la localité », « nom de rue », « street names »,
// « locality names », « nome del comune ») : avec une frontière de mot stricte, ils auraient
// exclu à tort les répertoires des localités, des rues et des limites administratives — des
// jeux que la recherche manuelle du 06.10.2026 a précisément validés. Seules des locutions
// propres à une PERSONNE (prénom, nom de famille, titulaire…) restent des marqueurs.
export const PERSON_MARKERS: readonly string[] = [
  "prénom", "prenom", "nom de famille", "nom et prénom",
  "vorname", "nachname", "personen", "mitglieder", "inhaber", "einzelunternehmen", "unternehmensregister",
  "persone", "cognome", "titolare", "impresa individuale", "membri", "registro delle imprese",
  "first name", "last name", "surname", "members", "holder", "sole proprietorship",
  "business register", "company register",
  "titulaire", "entreprise individuelle", "raison individuelle", "personne physique",
  // Cas réel (recherche manuelle du 06.10.2026) : le Répertoire des entreprises (REG) de
  // Genève expose, pour 23 % de ses lignes, le nom de l'exploitant d'une entreprise
  // individuelle comme raison sociale, plus téléphone et e-mail — invisible dans le titre ou
  // la description du catalogue, détecté seulement par une lecture humaine du SCHÉMA réel.
  // Le marqueur ci-dessous est un filet, pas une preuve : il ne capte que par son propre nom
  // (« répertoire »/« registre des entreprises ») ; toute ressemblance repose sur le libellé
  // du jeu, jamais sur une lecture de ses données.
  "répertoire des entreprises", "registre des entreprises",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replie les diacritiques (NFD puis retrait des marques combinantes) : seulement pour la
 *  comparaison des marqueurs-PRÉFIXES ci-dessous, afin que « depute », « député » et leurs
 *  flexions (« députés »…) matchent tous le même marqueur sans les lister un par un. */
function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const PERSON_MARKER_PATTERNS = PERSON_MARKERS.map(
  (marker) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(marker)}(?![\\p{L}\\p{N}])`, "iu"),
);

// Décision de l'intégrateur du 07.10.2026 (relecture Focus 1) : marqueurs-PRÉFIXES, frontière de
// mot à GAUCHE SEULEMENT (jamais à droite) — pour capter les flexions d'un même radical
// (« mitglied » → Mitglied, Mitglieder, Mitgliedschaft…) sans lister chaque forme. Portée
// VOLONTAIREMENT limitée à ces nouveaux marqueurs : l'appliquer aux marqueurs EXISTANTS
// (« persone », « personen »…) ferait matcher à tort « Personenverkehr » (transport de
// voyageurs), jamais demandé ni souhaité. « ratsmitglieder » et « grossrat » sont nécessaires en
// plus de « mitglied » : dans « Ratsmitglieder », le radical « mitglied » est précédé de la
// lettre « s » (fin de « Rats ») — la frontière de gauche échoue à cet endroit, donc le mot
// composé entier doit être son propre marqueur-préfixe.
const PERSON_MARKER_PREFIXES = [
  "mitglied", "membre", "deputier", "depute", "abgeordnete", "ratsmitglieder", "grossrat", "kontaktperson",
];
const PERSON_MARKER_PREFIX_PATTERNS = PERSON_MARKER_PREFIXES.map(
  (marker) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(marker)}`, "iu"),
);

/** Renvoie les marqueurs trouvés (liste vide = aucun — jamais interprété comme « sans
 *  données personnelles », seulement comme « aucun marqueur automatique détecté »). */
export function detectPersonMarkers(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  PERSON_MARKER_PATTERNS.forEach((re, i) => {
    if (re.test(lower)) found.push(PERSON_MARKERS[i]);
  });
  const folded = foldDiacritics(lower);
  PERSON_MARKER_PREFIX_PATTERNS.forEach((re, i) => {
    if (re.test(folded)) found.push(PERSON_MARKER_PREFIXES[i]);
  });
  return found;
}

// ---------------------------------------------------------------------------------------
// OFS : organisation OU une ressource sur bfs.admin.ch (AGENTS.md : tout ce qui vient de
// l'OFS reste « à vérifier » tant que la clarification écrite du 06.10.2026 n'a pas abouti).
// ---------------------------------------------------------------------------------------
const OFS_ORG_SLUG = "bundesamt-fur-statistik-bfs";

export function isOfsPackage(pkg: CkanPackage): boolean {
  if (pkg.organization?.name === OFS_ORG_SLUG) return true;
  return (pkg.resources ?? []).some((r) => typeof r.url === "string" && r.url.includes("bfs.admin.ch"));
}

// ---------------------------------------------------------------------------------------
// Clés de jointure : en-tête CSV réel (prioritaire), sinon mots du titre (suffixe « (titre) »).
// ---------------------------------------------------------------------------------------
// `commune` et `canton` n'exigent PAS de frontière de mot à droite : les en-têtes officiels
// suisses accolent un suffixe sans séparateur (« Gemeindename », « Kantonskürzel » — voir
// `scripts/sync-localities.ts`, `EXPECTED_HEADER`). La frontière de GAUCHE reste exigée pour
// ne jamais matcher au milieu d'un mot (ex. ne pas confondre un mot allemand composé qui finirait
// par « gemeinde » sans y commencer).
// `ide` RETIRÉE de cette liste le 07.10.2026 (relecture Focus 1) : le motif
// `(?<![\p{L}\p{N}])(uid|...)(?![\p{L}\p{N}])` traite `_` comme une frontière valide, donc
// matchait À TORT `uid` dans `mitglied_uid`/`votum_uid` — un identifiant de PERSONNE (membre),
// jamais un numéro IDE d'entreprise. Remplacée par une liste FERMÉE de noms de colonne EXACTS
// après normalisation (`detectIdeColumn` ci-dessous), jamais un `*_uid` quelconque.
const HEADER_KEY_PATTERNS: Array<{ key: string; test: RegExp }> = [
  { key: "npa", test: /(?<![\p{L}\p{N}])(plz4?|npa|postal(_?code)?)(?![\p{L}\p{N}])/iu },
  { key: "commune", test: /(?<![\p{L}\p{N}])(bfs[-_]?nr|gdenr|fosnr|gemeinde|commune)/iu },
  { key: "canton", test: /(?<![\p{L}\p{N}])(canton|kanton)/iu },
  { key: "noga", test: /(?<![\p{L}\p{N}])noga(?![\p{L}\p{N}])/iu },
  { key: "tarif", test: /(?<![\p{L}\p{N}])(tares|tarif|numero[_-]?tarifaire)(?![\p{L}\p{N}])/iu },
];

// Liste FERMÉE (décision de l'intégrateur du 07.10.2026, point 5) : un nom de colonne compte
// pour la clé « ide » seulement s'il est EXACTEMENT un de ceux-ci après normalisation (casse,
// `_`, `-`, espaces retirés) — jamais une sous-chaîne, jamais un `*_uid` (qui désigne presque
// toujours un identifiant de PERSONNE dans les jeux vus jusqu'ici, pas une entreprise).
const IDE_COLUMN_EXACT = new Set(["uid", "ide", "idi", "che", "uidnr", "unternehmensid", "numeroide"]);

export function detectIdeColumn(columns: string[]): boolean {
  return columns.some((c) => IDE_COLUMN_EXACT.has(normalizeColumnName(c)));
}

/** Devine le séparateur (`;` plus fréquent que `,` → fichiers officiels suisses) et découpe
 *  l'en-tête en noms de colonnes. Partagé entre la détection des clés de jointure et celle des
 *  colonnes de personnes (même en-tête, jamais deux lectures réseau). */
export function splitHeaderColumns(headerLine: string): string[] {
  const semi = (headerLine.match(/;/g) ?? []).length;
  const comma = (headerLine.match(/,/g) ?? []).length;
  const delimiter = semi >= comma ? ";" : ",";
  return headerLine.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));
}

/** Compare chaque nom de colonne aux motifs connus. Pure, sans E/S. */
export function detectJoinKeysFromHeader(headerLine: string): string[] {
  const columns = splitHeaderColumns(headerLine);
  const found = new Set<string>();
  for (const col of columns) {
    for (const p of HEADER_KEY_PATTERNS) if (p.test.test(col)) found.add(p.key);
  }
  if (detectIdeColumn(columns)) found.add("ide");
  return [...found].sort();
}

// ---------------------------------------------------------------------------------------
// Colonnes de personnes — décision de l'intégrateur du 07.10.2026, après un run réel qui a
// montré que la détection texte (titre/description/mots-clés) ne suffit PAS à tenir Review
// Focus 1 : le jeu « Bénéficiaires de la rétribution de l'injection (RPC) » (OFEN) est publié
// sous un titre et une description ne contenant AUCUN marqueur de personnes, mais son CSV réel
// porte les colonnes `produzent_name`/`produzent_vorname` (nom/prénom du propriétaire de
// l'installation). Comme les clés de jointure, cette détection lit un en-tête DÉJÀ chargé en
// mémoire par `inspectCsvHeaders` — zéro appel réseau supplémentaire.
//
// « name »/« nom » seuls ne suffisent JAMAIS (une raison sociale s'appelle aussi « name ») :
// seule une forme PROPRE à une personne compte, en correspondance EXACTE (après normalisation)
// ou en SOUS-CHAÎNE pour les six motifs les plus sûrs (ex. `produzent_vorname` contient
// « vorname »). La paire `<préfixe>_name` + `<préfixe>_vorname` (même préfixe, séparateur `_`
// ou `-` explicite) est reconnue séparément : elle marque aussi la colonne `_name`, qui seule
// ne matcherait ni l'exact ni la sous-chaîne.
// ---------------------------------------------------------------------------------------
const PERSON_COLUMN_EXACT = new Set([
  "vorname", "nachname", "familienname", "prenom", "prénom", "nomdefamille",
  "cognome", "firstname", "lastname", "givenname", "surname",
]);
// Décision de l'intégrateur du 07.10.2026 (relecture Focus 1, refus de la première livraison) :
// liste élargie après deux cas RÉELS manqués — l'en-tête OFEN « Pinch »
// (`Firma;Strassenname;Hausnummer;Ortschaft;PLZ;Website;Kontaktperson;Telefon;Email;Lon;Lat`)
// et les jeux du Grand Conseil bernois (`votum_mitglied`, `mitglied_uid`) — jamais détectés par
// la liste d'avant. Toujours en CONTAINS (sous-chaîne, après normalisation) : un faux positif
// coûte une exclusion à tort, jamais une fuite de donnée personnelle.
// Décision de l'intégrateur du 07.10.2026 (affinage sans laxisme, après la relecture ciblée) :
// les motifs GÉNÉRIQUES (« person », « mitglied »…) apparaissent aussi dans des formes AGRÉGÉES
// ou institutionnelles sûres — un compte de personnes, un État membre, un type de véhicule —
// jamais une colonne qui NOMME quelqu'un. Ces formes précises ne déclenchent JAMAIS les motifs
// génériques (`PERSON_COLUMN_CONTAINS_GENERIC`) ; les motifs SPÉCIFIQUES (email, Kontaktperson,
// votum_mitglied…) restent toujours dangereux et ne sont jamais suppressibles par une forme sûre.
// Noms composés : sûrs comme SOUS-CHAÎNE (un suffixe ou préfixe autour ne change rien au sens).
const SAFE_COLUMN_SUBSTRINGS = [
  "personenwagen", "personenkilometer",
  "mitgliedstaat", "mitgliedstaaten", "etatmembre", "etatsmembres", "memberstate", "memberstates",
];
// Comptes : sûrs seulement en nom de colonne EXACT (après normalisation) — `npersonen` en
// sous-chaîne aurait aussi exempté `zustaendigen_personen`/`verantwortlichen_personen` (relevé
// le 07.10.2026 : aucun motif spécifique ne les couvre, ils ne seraient alors jamais détectés).
const SAFE_COLUMN_EXACT = new Set(["anzahlpersonen", "personenanzahl", "nombrepersonnes", "npersonen"]);
function isSafeColumnForm(norm: string): boolean {
  return SAFE_COLUMN_EXACT.has(norm) || SAFE_COLUMN_SUBSTRINGS.some((p) => norm.includes(p));
}

const PERSON_COLUMN_CONTAINS_GENERIC = ["person", "personne", "persona", "mitglied", "member", "membre", "membro"];
const PERSON_COLUMN_CONTAINS_SPECIFIC = [
  "vorname", "prenom", "prénom", "cognome", "firstname", "lastname",
  "kontakt", "contact", "kontaktperson",
  "email", "mail", "telefon", "telephone", "téléphone", "phone", "natel", "mobile",
  "depute", "député", "abgeordnet", "grossrat", "grandconseil", "ratsmitglied", "votummitglied",
  // Décision de l'intégrateur du 07.10.2026 (relecture finale, dernière prudence) : des RÔLES
  // qui désignent une personne précise (un annuaire d'associations ou d'entreprises nomme
  // presque toujours son·sa titulaire par ce rôle), jamais suppressibles par une forme sûre.
  "praesident", "präsident", "president", "presidente",
  "leiter", "leiterin", "leitungname",
  "inhaber", "inhaberin", "verantwortlich", "ansprechpartner", "ansprechperson",
  "responsable", "referent", "kontaktname",
];

function normalizeColumnName(c: string): string {
  return c.trim().toLowerCase().replace(/[_\-\s]+/g, "");
}

/** Renvoie les noms de colonnes (tels que reçus, jamais normalisés dans le résultat) qui
 *  signalent une personne physique. Liste vide = aucun motif détecté dans CET en-tête — ne
 *  prouve jamais l'absence de personnes ailleurs dans le jeu (même esprit que
 *  `detectPersonMarkers`). Pure, sans E/S. */
export function detectPersonColumns(columns: string[]): string[] {
  const matched = new Set<string>();
  for (const col of columns) {
    const norm = normalizeColumnName(col);
    if (PERSON_COLUMN_EXACT.has(norm)) { matched.add(col); continue; }
    if (PERSON_COLUMN_CONTAINS_SPECIFIC.some((k) => norm.includes(k))) { matched.add(col); continue; }
    if (!isSafeColumnForm(norm) && PERSON_COLUMN_CONTAINS_GENERIC.some((k) => norm.includes(k))) { matched.add(col); continue; }
  }
  // Paire <préfixe>_name + <préfixe>_vorname (même préfixe, séparateur explicite).
  const nameByPrefix = new Map<string, string>();
  const vornameByPrefix = new Map<string, string>();
  for (const col of columns) {
    const m = /^(.+?)[_-](name|vorname)$/i.exec(col.trim());
    if (!m) continue;
    const prefix = m[1].toLowerCase();
    if (m[2].toLowerCase() === "name") nameByPrefix.set(prefix, col);
    else vornameByPrefix.set(prefix, col);
  }
  for (const [prefix, nameCol] of nameByPrefix) {
    const vornameCol = vornameByPrefix.get(prefix);
    if (vornameCol) { matched.add(nameCol); matched.add(vornameCol); }
  }
  return [...matched];
}

// Élargi en relecture du 06.10.2026 : les trois meilleurs candidats swisstopo de la recherche
// manuelle (localités, limites administratives, rues) sont exposés en API/WMS/SERVICE, sans
// ressource CSV lisible par en-tête — seul le TITRE du jeu permet de déduire leur clé, par le
// type de référentiel géographique qu'il nomme (même principe que les motifs « par commune » /
// « nach Gemeinde », appliqué au nom du référentiel lui-même plutôt qu'à une préposition).
const TITLE_KEY_RULES: Array<{ keys: string[]; test: RegExp }> = [
  { keys: ["commune (titre)"], test: /(par commune|nach gemeinde|per comune|by municipality|pro gemeinde)/i },
  { keys: ["npa (titre)"], test: /(par npa|nach plz|par code postal)/i },
  { keys: ["canton (titre)"], test: /(par canton|nach kanton|per cantone)/i },
  // Répertoire des localités (NPA + périmètre) : « localités »/« Ortschaften »/« code postal ».
  { keys: ["npa (titre)"], test: /(localit[eé]s?|ortschaften|postleitzahl|cities and towns)/i },
  // Répertoire des rues : clé naturelle rue + commune.
  { keys: ["commune (titre)"], test: /(\brues?\b|\bstrassen?\b|\bstreets?\b)/i },
  // Limites administratives : numéro de commune, district, canton (recherche manuelle).
  { keys: ["commune (titre)", "canton (titre)"], test: /(limites administratives|verwaltungsgrenzen|administrative boundary)/i },
];

/** Cherche dans TOUTES les langues du titre (une clé ne doit pas dépendre de la langue
 *  retenue par `pickLocalizedText`). */
export function detectJoinKeysFromTitle(pkgTitle: CkanText): string[] {
  const text = allLocalizedValues(pkgTitle).join(" \n ");
  const found = new Set<string>();
  for (const rule of TITLE_KEY_RULES) if (rule.test.test(text)) for (const k of rule.keys) found.add(k);
  return [...found].sort();
}

// ---------------------------------------------------------------------------------------
// Tri déterministe SANS score : éditeur fédéral > cantonal > communal, puis nombre de clés de
// jointure (plus = mieux), puis fréquence (plus fréquent = mieux), puis identifiant (égalité).
// ---------------------------------------------------------------------------------------
export function editorLevelRank(level: string | undefined): number {
  switch (level) {
    case "confederation": return 0;
    case "canton": return 1;
    case "commune": return 2;
    default: return 3;
  }
}

const FREQUENCY_RANK: Record<string, number> = {
  CONT: 0, DAILY: 1, WEEKLY: 2, BIWEEKLY: 2, MONTHLY: 3, QUARTERLY: 4,
  ANNUAL: 5, ANNUAL_2: 5, ANNUAL_3: 5, IRREG: 6, NEVER: 9,
};

export function frequencyRank(uri: string | null | undefined): number {
  if (!uri) return 8; // inconnue : ni jamais ni certaine, rangée après les fréquences connues
  const code = uri.split("/").pop()?.toUpperCase() ?? "";
  return FREQUENCY_RANK[code] ?? 7; // code non reconnu : moins bien classé qu'une fréquence connue, mieux qu'« inconnue »
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface ProspectionCandidate {
  id: string; // UUID technique CKAN — jamais le slug (décision de l'intégrateur du 07.10.2026)
  title: string;
  publisher: string; // ex-`editor`, renommé le 07.10.2026 (décision de l'intégrateur)
  editor_level: string;
  url: string; // https://opendata.swiss/dataset/<uuid> — jamais une adresse à slug
  licence: "terms_open" | "terms_by" | "attribution" | "public_domain";
  formats: string[];
  frequency: string | null;
  modified: string | null;
  join_keys: string[];
  a_verifier_ofs: boolean;
  a_verifier_personnes: "a_verifier"; // jamais une autre valeur : jamais « sans données personnelles » affirmé
  deja_collecte: boolean;
  // Décision de l'intégrateur du 07.10.2026 : un jeu de l'OFS reste un candidat (plus
  // d'exclusion du tableau public), mais toujours annoncé à part, après les autres.
  status_note: "droits à confirmer (OFS)" | null;
  // Ajouté le 07.10.2026 (relecture Focus 1, point 3) : `true` seulement si au moins un en-tête
  // CSV a été lu AVEC SUCCÈS pour ce jeu (`headersRead > 0`, jamais déduit d'une clé de titre
  // seule). Condition du filtre public, en plus de l'éditeur et de la clé de jointure.
  csv_inspected: boolean;
}

export function compareCandidates(a: ProspectionCandidate, b: ProspectionCandidate): number {
  return (
    editorLevelRank(a.editor_level) - editorLevelRank(b.editor_level) ||
    b.join_keys.length - a.join_keys.length ||
    frequencyRank(a.frequency) - frequencyRank(b.frequency) ||
    cmp(a.id, b.id)
  );
}

// ---------------------------------------------------------------------------------------
// Déjà collecté : rapprochement EXACT (sous-chaîne) d'un segment d'URL distinctif
// (≥ 10 caractères) entre le registre des sources et la fiche ou une ressource du jeu.
//
// Relecture du 06.10.2026 : seul le CHEMIN de l'URL est tokenisé (jamais la chaîne de
// requête : les très longs paramètres `query=` des points SPARQL Eurostat produiraient des
// segments « distinctifs » purement accidentels). Une liste d'arrêt écarte en plus les
// segments génériques d'API qui reviennent sur des dizaines d'URLs sans rapport
// (« collections », « classifications », « association »… repérés en relecture) : un jeu ne
// doit jamais être marqué « déjà collecté » à cause d'un mot d'infrastructure partagé.
// ---------------------------------------------------------------------------------------
const GENERIC_URL_TOKENS = new Set([
  "collection", "collections", "item", "items", "api", "rest", "services", "service",
  "public", "data", "dataset", "datasets", "admin", "assets", "asset", "hub", "media",
  "query", "download", "downloads", "resource", "resources", "action", "actions",
  "application", "classification", "classifications", "association", "associations",
  "sparql", "webapi", "concept", "concepts", "record", "records", "catalog", "catalogue",
]);

export function tokensFromUrl(url: string): string[] {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url; // URL non standard (rare) : on retombe sur la chaîne entière
  }
  return pathname
    .split(/[^A-Za-z0-9_]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !GENERIC_URL_TOKENS.has(t));
}

export function registryTokens(sources: ReadonlyArray<{ url: string }> = SOURCES): Set<string> {
  const tokens = new Set<string>();
  for (const s of sources) for (const t of tokensFromUrl(s.url)) tokens.add(t);
  return tokens;
}

export function isAlreadyCollected(pkg: CkanPackage, tokens: Set<string>): boolean {
  const haystacks = [pkg.url, ...(pkg.resources ?? []).map((r) => r.url)]
    .filter((h): h is string => typeof h === "string" && h.length > 0)
    .map((h) => h.toLowerCase());
  if (haystacks.length === 0) return false;
  for (const t of tokens) for (const h of haystacks) if (h.includes(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------
// Fiche opendata.swiss (jamais stockée dans le JSON CKAN lui-même : reconstruite à partir
// du slug `name`, comme chaque lien cité dans la recherche manuelle du 06.10.2026).
// ---------------------------------------------------------------------------------------
/** `id` est l'UUID technique CKAN (`pkg.id`), JAMAIS le slug (`pkg.name`) : décision de
 *  l'intégrateur du 07.10.2026, pour qu'aucune adresse publiée ne puisse encoder un nom. CKAN
 *  accepte aussi bien l'UUID que le slug à cette même adresse `/dataset/<...>` (vérifié en
 *  direct le 07.10.2026 sur un vrai jeu). */
export function buildFicheUrl(id: string): string {
  return `https://opendata.swiss/dataset/${id}`;
}

function distinctFormats(resources: CkanResource[] | undefined): string[] {
  const set = new Set<string>();
  for (const r of resources ?? []) if (r.format && r.format.trim()) set.add(r.format.trim().toUpperCase());
  return [...set].sort();
}

/** Un CSV emballé dans un ZIP (ex. certains jeux SITG Genève, `format: "CSV"` mais
 *  `*-CSV.zip`) n'est pas une lecture partielle valable : une plage d'octets sur un ZIP ne
 *  donne jamais un en-tête lisible. Écarté AVANT le test de format, quel que soit celui-ci. */
export function isCsvResource(r: CkanResource): boolean {
  if (typeof r.url === "string" && /\.zip(\?|$)/i.test(r.url)) return false;
  if ((r.format ?? "").toUpperCase() === "CSV") return true;
  return typeof r.url === "string" && /\.csv(\?|$)/i.test(r.url);
}

// ---------------------------------------------------------------------------------------
// Classification synchrone (pure, sans E/S) d'un jeu : licence, personnes, OFS, clés de
// titre, doublon. La lecture d'en-têtes CSV (E/S réseau) est ajoutée à part par l'orchestrateur.
// ---------------------------------------------------------------------------------------
export interface PackageVerdict {
  id: string; // UUID technique CKAN (`pkg.id`) — jamais `pkg.name`
  title: string;
  publisher: string;
  editorLevel: string;
  url: string;
  resources: CkanResource[];
  formats: string[];
  frequency: string | null;
  modified: string | null;
  licence: "open" | "exclu";
  licenceCode?: "open" | "by" | "attribution" | "public_domain";
  exclusionMotif?: LicenceMotif | "personnes_detectees";
  personMarkers: string[];
  ofsFlag: boolean;
  titleJoinKeys: string[];
  isCandidate: boolean;
}

export function classifyPackage(pkg: CkanPackage, tokens: Set<string>): PackageVerdict & { dejaCollecte: boolean } {
  // Jamais de repli sur `pkg.name` (slug) si le titre manque : un slug peut lui-même encoder un
  // nom (décision du 07.10.2026). Un titre réellement absent reste visible comme tel, pas masqué.
  const title = pickLocalizedText(pkg.title) || "(titre non fourni par le catalogue)";
  const publisher = pickLocalizedText(pkg.organization?.title) || pkg.organization?.name || "éditeur inconnu";
  const editorLevel = pkg.organization?.political_level ?? "";
  const url = buildFicheUrl(pkg.id);
  const resources = pkg.resources ?? [];
  const licenceVerdict = classifyLicence(resources);
  const personMarkers = detectPersonMarkers(collectSearchableText(pkg));
  const ofsFlag = isOfsPackage(pkg);
  const titleJoinKeys = detectJoinKeysFromTitle(pkg.title);
  const dejaCollecte = isAlreadyCollected(pkg, tokens);

  let licence: "open" | "exclu" = licenceVerdict.licence;
  let exclusionMotif: LicenceMotif | "personnes_detectees" | undefined = licenceVerdict.motif;
  // La licence est vérifiée en premier (motif prioritaire) ; un jeu à licence ouverte mais
  // portant un marqueur de personnes reste exclu, avec son propre motif (Review Focus 1).
  if (licence === "open" && personMarkers.length > 0) {
    licence = "exclu";
    exclusionMotif = "personnes_detectees";
  }

  return {
    id: pkg.id,
    title,
    publisher,
    editorLevel,
    url,
    resources,
    formats: distinctFormats(resources),
    frequency: pkg.accrual_periodicity && pkg.accrual_periodicity.trim() ? pkg.accrual_periodicity : null,
    modified: pkg.modified && pkg.modified.trim() ? pkg.modified : null,
    licence,
    licenceCode: licenceVerdict.matched,
    exclusionMotif,
    personMarkers,
    ofsFlag,
    titleJoinKeys,
    dejaCollecte,
    isCandidate: licence === "open",
  };
}

// ---------------------------------------------------------------------------------------
// Lecture partielle d'un en-tête CSV (E/S réseau). Ignore silencieusement tout refus ou
// erreur (Range non honoré, délai dépassé, réseau) : une clé non détectée n'est jamais une
// erreur de la prospection, seulement une absence d'information pour ce jeu.
// ---------------------------------------------------------------------------------------
const MAX_HEADER_PEEK_BYTES = 65_536;

/** Repéré en relecture du 07.10.2026 (vérification réelle sur un CSV du Musée national suisse) :
 *  certains fichiers utilisent `\r` SEUL comme fin de ligne (format Mac classique), jamais `\n`.
 *  Chercher uniquement `\n` dans ce cas ne trouve jamais de coupure, et `readCsvHeaderPartial`
 *  renvoyait jusqu'à 64 Ko de contenu (l'en-tête réel PLUS des dizaines de lignes de données)
 *  comme si c'était « l'en-tête » — polluant à la fois les clés de jointure (un mot de donnée
 *  comme « Kanton Zürich » dans une description d'objet se faisait passer pour une colonne) et
 *  la détection de colonnes de personnes. Recherche au niveau des OCTETS (0x0D ou 0x0A), AVANT
 *  tout décodage de texte : décoder le buffer ENTIER (jusqu'à 64 Ko) avant de couper poserait un
 *  second problème — un caractère UTF-8 multi-octets tronqué net à la limite du `Range` (très
 *  probable sur un gros fichier) rendrait alors TOUT le buffer invalide en UTF-8, y compris
 *  l'en-tête lui-même, pourtant intact. */
function findLineBreakIndex(buf: Buffer): number {
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a || buf[i] === 0x0d) return i;
  return -1;
}

function stripBomBytes(buf: Buffer): Buffer {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
}

/** Décode SEULEMENT les octets de l'en-tête (jamais le reste du buffer, voir ci-dessus) en
 *  UTF-8 ; si le résultat contient le caractère de remplacement U+FFFD (octets non valides en
 *  UTF-8 — ex. un CSV en Latin-1/Windows-1252, courant chez certains éditeurs), redécode en
 *  Latin-1 plutôt que de perdre silencieusement les caractères accentués — ce sont justement
 *  ceux qui portent les marqueurs de personnes (« Prénom », « Nachname »…) : les perdre ferait
 *  passer une colonne de personne pour une colonne inconnue (échec de Review Focus 1 dans le
 *  sens dangereux, repéré en relecture du 07.10.2026). */
function decodeHeaderBytes(headerBytes: Buffer): string {
  const utf8 = headerBytes.toString("utf8");
  return utf8.includes("�") ? headerBytes.toString("latin1") : utf8;
}

function extractFirstLine(buf: Buffer): string | null {
  const breakIndex = findLineBreakIndex(buf);
  const headerBytes = stripBomBytes(breakIndex === -1 ? buf : buf.subarray(0, breakIndex));
  const line = decodeHeaderBytes(headerBytes);
  return line.length > 0 ? line : null;
}

function containsLineBreak(chunk: Uint8Array): boolean {
  for (let i = 0; i < chunk.length; i++) if (chunk[i] === 0x0a || chunk[i] === 0x0d) return true;
  return false;
}

/** Relecture du 06.10.2026 (incident réel : 29 minutes sans la moindre ligne de journal) :
 *  certains serveurs (ex. les points `/exports/csv` Opendatasoft, fréquents chez les éditeurs
 *  cantonaux) IGNORENT silencieusement l'en-tête `Range` et répondent 200 avec le fichier
 *  ENTIER — parfois plusieurs centaines de Mo. Lire `res.arrayBuffer()` dans ce cas revenait à
 *  télécharger le fichier complet avant de n'en garder que la première ligne : exactement le
 *  contraire d'une « lecture partielle ». Cette version lit le flux chunk par chunk et
 *  l'ANNULE (`reader.cancel()`) dès qu'elle a vu un saut de ligne ou atteint
 *  `MAX_HEADER_PEEK_BYTES`, quel que soit le respect du `Range` par le serveur : le volume
 *  réellement reçu reste borné dans tous les cas. */
export async function readCsvHeaderPartial(
  fetchImpl: typeof fetch,
  url: string,
  userAgent: string,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": userAgent, Range: `bytes=0-${MAX_HEADER_PEEK_BYTES - 1}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null; // y compris un refus explicite du Range (416) ou un 4xx/5xx

    const reader = res.body?.getReader?.();
    if (!reader) {
      // Pas de flux exposé (environnement de test, ou runtime sans ReadableStream sur
      // `Response.body`) : la taille reste bornée par le `Range` demandé, une lecture
      // complète du corps reçu reste sûre dans ce cas précis.
      return extractFirstLine(Buffer.from(await res.arrayBuffer()));
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_HEADER_PEEK_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (containsLineBreak(value)) break;
    }
    try { await reader.cancel(); } catch { /* flux déjà clos ou serveur l'ayant coupé : sans conséquence */ }
    return extractFirstLine(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  } catch {
    return null;
  }
}

export interface CsvHeaderInspection {
  joinKeys: string[];
  personColumns: string[];
  // Ajoutés le 07.10.2026 (relecture Focus 1, points 3 et 4) : `headersAttempted` compte les
  // ressources CSV pour lesquelles une lecture a été ESSAYÉE ce passage, `headersRead` celles
  // réellement lues avec succès (en-tête non vide reçu). `headersRead > 0` est la SEULE preuve
  // positive qu'un en-tête a été inspecté — jamais déduite d'une absence de colonne détectée,
  // qui peut aussi bien venir d'un échec de lecture silencieux.
  headersAttempted: number;
  headersRead: number;
}

/** Lit au plus `MAX_CSV_HEADERS_PER_DATASET` en-têtes CSV d'un jeu et en tire À LA FOIS les clés
 *  de jointure et les colonnes de personnes — le même en-tête sert aux deux détections, jamais
 *  une seconde lecture réseau pour la seconde. */
async function inspectCsvHeaders(
  resources: CkanResource[],
  opts: { fetchImpl: typeof fetch; userAgent: string; timeoutMs: number; delayMs: number; sleepImpl: (ms: number) => Promise<void> },
): Promise<CsvHeaderInspection> {
  const csvResources = resources.filter(isCsvResource).slice(0, MAX_CSV_HEADERS_PER_DATASET);
  const keys = new Set<string>();
  const personCols = new Set<string>();
  let headersAttempted = 0;
  let headersRead = 0;
  for (const r of csvResources) {
    if (!r.url) continue;
    headersAttempted++;
    await opts.sleepImpl(opts.delayMs);
    const headerLine = await readCsvHeaderPartial(opts.fetchImpl, r.url, opts.userAgent, opts.timeoutMs);
    if (!headerLine) continue;
    headersRead++;
    for (const k of detectJoinKeysFromHeader(headerLine)) keys.add(k);
    for (const c of detectPersonColumns(splitHeaderColumns(headerLine))) personCols.add(c);
  }
  return { joinKeys: [...keys], personColumns: [...personCols], headersAttempted, headersRead };
}

// ---------------------------------------------------------------------------------------
// Appel d'une page `package_search`, avec UNE retentative sur échec (puis abandon de la page).
// ---------------------------------------------------------------------------------------
// Tri EXPLICITE, jamais le tri par défaut de CKAN (`score desc, metadata_modified desc` en
// l'absence de requête texte) : relevé en direct le 06.10.2026, ce tri par défaut renvoie
// d'abord les jeux les plus récemment ré-harvestés — un ordre qui change de jour en jour,
// indépendant de la pertinence du jeu, et qui ferait apparaître/disparaître des jeux d'une
// page à l'autre entre deux prospections hebdomadaires (y compris des jeux pourtant déjà vus).
// `metadata_created asc` (date de création, croissante) est stable : un jeu déjà au catalogue
// garde exactement le même rang d'une semaine à l'autre.
//
// CORRIGÉ le 07.10.2026 (décision de l'intégrateur) : la limite documentée le 06.10.2026 — un
// plafond FIXE de 60 pages en tri croissant relisait chaque lundi EXACTEMENT la même fenêtre des
// 6000 jeux les plus anciens, sans jamais avancer — est désormais corrigée par la fenêtre
// TOURNANTE implémentée plus bas (`isoWeekNumber`, `computeStartPage`, `rotatingPageSequence`) :
// chaque passage part d'un décalage qui change chaque semaine et boucle sur tout le catalogue,
// garantissant une couverture complète tous les quelques passages (`ceil(total_pages / maxPages)`
// semaines) au lieu de ne jamais voir les jeux nouvellement publiés. Le tri `metadata_created
// asc` reste nécessaire pour autre chose : il garde un RANG STABLE pour un jeu déjà connu d'une
// semaine à l'autre (sans lui, le tri par défaut de CKAN — relevé en direct le 06.10.2026 comme
// `score desc, metadata_modified desc` en l'absence de requête texte — ferait apparaître et
// disparaître des jeux d'une page à l'autre, y compris des jeux pourtant déjà vus, rendant la
// rotation elle-même incohérente).
const CKAN_SORT = "metadata_created asc";

async function fetchCkanPage(
  fetchImpl: typeof fetch,
  userAgent: string,
  start: number,
  rows: number,
  timeoutMs: number,
): Promise<CkanSearchResult> {
  const url = `${CKAN_SEARCH_URL}?rows=${rows}&start=${start}&sort=${encodeURIComponent(CKAN_SORT)}`;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`CKAN package_search : HTTP ${res.status}`);
  const body = (await res.json()) as CkanSearchResponse;
  if (body.success !== true || !body.result) throw new Error("Réponse CKAN invalide (success=false ou result absent)");
  return body.result;
}

async function fetchCkanPageWithRetry(
  fetchImpl: typeof fetch,
  userAgent: string,
  start: number,
  rows: number,
  timeoutMs: number,
  delayMs: number,
  sleepImpl: (ms: number) => Promise<void>,
): Promise<CkanSearchResult | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetchCkanPage(fetchImpl, userAgent, start, rows, timeoutMs);
    } catch (err) {
      if (attempt === 2) {
        console.error(`[prospect:sources] page start=${start} : échec après une retentative (${err instanceof Error ? err.message : String(err)})`);
        return null;
      }
      await sleepImpl(delayMs);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Fenêtre tournante (décision du 07.10.2026) : chaque passage lit au plus `maxPages` pages à
// partir d'un décalage qui tourne chaque semaine, en bouclant sur le nombre total de pages du
// catalogue (connu seulement après une sonde `rows=0`). Le PAS de rotation est `maxPages` lui-
// même (pas une constante littérale 55 indépendante) : ainsi, si la taille du passage change un
// jour, la fenêtre continue d'avancer exactement d'un passage à chaque semaine, garantissant
// une couverture complète tous les `ceil(total_pages / maxPages)` semaines — une rotation calée
// sur une constante fixe indépendante du pas réel dériverait au premier changement de réglage.
// ---------------------------------------------------------------------------------------

/** Numéro de semaine ISO 8601 (1-53), calculé en UTC. Se répète chaque année (comportement
 *  attendu de la formule demandée, pas une dérive) : seul le reste modulo le nombre de pages
 *  compte pour la rotation, jamais une valeur absolue continue. */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // lundi=1 … dimanche=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // jeudi de la même semaine ISO
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** `(numéro de semaine ISO × pas) mod nombre_de_pages`. `totalPages` doit être ≥ 1. */
export function computeStartPage(weekNumber: number, totalPages: number, step: number): number {
  if (totalPages <= 0) return 0;
  return ((weekNumber * step) % totalPages + totalPages) % totalPages; // toujours positif
}

/** Séquence de pages à lire ce passage, à partir de `startPage`, en bouclant sur `totalPages` ;
 *  bornée à `totalPages` pour ne jamais relire deux fois la même page dans un seul passage
 *  (catalogue plus petit que `maxPagesPerPass`). */
export function rotatingPageSequence(startPage: number, totalPages: number, maxPagesPerPass: number): number[] {
  const count = Math.max(0, Math.min(maxPagesPerPass, totalPages));
  const seq: number[] = [];
  for (let i = 0; i < count; i++) seq.push((startPage + i) % Math.max(1, totalPages));
  return seq;
}

export function toIsoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** Nombre de jours (entier, peut être négatif) entre deux dates AAAA-MM-JJ, à minuit UTC. */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------------------------------
// État de fusion (décision du 07.10.2026) : `docs/data-status/prospection-state.json` garde,
// pour CHAQUE jeu jamais classé (candidat ou exclu), une ligne compacte `[id, seen_on, statut]`
// — un tableau de tuples, jamais un tableau d'objets à clés répétées, pour viser < 600 Ko même
// une fois le catalogue entier connu. `statut` est soit `"candidate"`, soit le motif d'exclusion
// exact (même valeur que `excluded_by_motif`). Jamais commité avec un horodatage d'exécution
// autre que `seen_on` par jeu — un passage qui ne touche pas un jeu ne change pas sa ligne.
// ---------------------------------------------------------------------------------------
export type StateRow = [id: string, seen_on: string, status: string];
export interface StateEntry { seen_on: string; status: string }

function readJsonIfExists<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null; // fichier corrompu ou absent : on repart d'un état vide plutôt que de planter
  }
}

// ---------------------------------------------------------------------------------------
// Liste noire durable (décision de l'intégrateur du 07.10.2026, point 3) : un id ici n'est
// JAMAIS libéré par le script, quel que soit le résultat d'une relecture future — seul un
// retrait MANUEL de cette entrée (par l'intégrateur, hors du script) peut faire reparaître le
// jeu. Fichier public versionné : `docs/data-status/prospection-exclusions.json`.
// ---------------------------------------------------------------------------------------
export interface ExclusionEntry {
  id: string;
  // "colonne_personne_probable" ajouté le 07.10.2026 (relecture finale) : un annuaire
  // d'associations/entreprises dont le rôle nommé (président, responsable…) ne peut pas être
  // confirmé comme colonne de personne SANS lire les données elles-mêmes (une seule ligne
  // d'en-tête ne prouve jamais qui est réellement nommé en-dessous) — exclusion de prudence,
  // jamais affirmée aussi certaine qu'une correspondance directe sur l'en-tête.
  motif: "colonne_personne" | "personnes_detectees" | "colonne_personne_probable";
  date: string; // AAAA-MM-JJ
  note: string;
}

export const DEFAULT_OUT_EXCLUSIONS = join(__dirname, "..", "docs", "data-status", "prospection-exclusions.json");

const EXCLUSION_MOTIFS = new Set(["colonne_personne", "personnes_detectees", "colonne_personne_probable"]);

function isValidExclusionEntry(row: unknown): row is ExclusionEntry {
  return (
    !!row && typeof row === "object" &&
    typeof (row as ExclusionEntry).id === "string" && (row as ExclusionEntry).id.length > 0 &&
    EXCLUSION_MOTIFS.has((row as ExclusionEntry).motif) &&
    typeof (row as ExclusionEntry).date === "string" && (row as ExclusionEntry).date.length > 0
  );
}

/** Décision de l'intégrateur du 07.10.2026 (point 3) : « n'en libère JAMAIS un jeu » exige
 *  d'ÉCHOUER sur un fichier présent mais corrompu ou mal formé — jamais de repli silencieux sur
 *  une liste vide, qui libérerait TOUS les jeux de la liste noire au passage suivant. Un fichier
 *  simplement ABSENT reste une liste vide (rien n'a encore été exclu manuellement). */
export function loadExclusionBlacklist(path: string): Map<string, ExclusionEntry> {
  if (!existsSync(path)) return new Map();
  const raw = readFileSync(path, "utf8");
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch (err) {
    throw new Error(`prospection-exclusions.json illisible (JSON invalide) à ${path} : ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(rows)) {
    throw new Error(`prospection-exclusions.json doit contenir un tableau à ${path}`);
  }
  const map = new Map<string, ExclusionEntry>();
  for (const row of rows) {
    if (!isValidExclusionEntry(row)) {
      throw new Error(`prospection-exclusions.json contient une entrée invalide à ${path} : ${JSON.stringify(row)}`);
    }
    map.set(row.id, row);
  }
  return map;
}

export function serializeExclusionBlacklist(map: Map<string, ExclusionEntry>): ExclusionEntry[] {
  return [...map.values()].sort((a, b) => cmp(a.id, b.id));
}

export function loadState(path: string): Map<string, StateEntry> {
  const rows = readJsonIfExists<StateRow[]>(path) ?? [];
  const map = new Map<string, StateEntry>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3) continue; // ligne corrompue : ignorée, jamais fatale
    const [id, seen_on, status] = row;
    if (typeof id === "string" && typeof seen_on === "string" && typeof status === "string") {
      map.set(id, { seen_on, status });
    }
  }
  return map;
}

export function serializeState(map: Map<string, StateEntry>): StateRow[] {
  return [...map.entries()]
    .map(([id, e]): StateRow => [id, e.seen_on, e.status])
    .sort((a, b) => cmp(a[0], b[0]));
}

// ---------------------------------------------------------------------------------------
// Rapport final.
// ---------------------------------------------------------------------------------------
export interface ProspectionRun {
  pages_read: number; // pages lues CE passage
  page_size: number;
  max_pages: number; // plafond de pages VISÉ ce passage (pas le nombre total de pages du catalogue)
  start_page: number; // page de départ de ce passage dans la rotation
  total_pages: number; // nombre total de pages du catalogue au moment de ce passage
  datasets_read: number; // jeux lus CE passage seulement (pas cumulé)
  datasets_total_catalog: number | null;
  coverage_ratio: number; // CUMULÉ : jeux connus et non expirés / datasets_total_catalog, borné à 1
  partial: boolean;
  stopped_reason: "ok" | "page_failed" | "time_limit" | "probe_failed";
}

export interface ProspectionReport {
  generated_on: string;
  source: string;
  run: ProspectionRun;
  totals: {
    candidates: number; // CUMULÉ (état complet, pas seulement les 300 gardés ci-dessous)
    excluded: number; // CUMULÉ
    excluded_by_motif: Record<string, number>; // CUMULÉ
  };
  candidates: ProspectionCandidate[]; // au plus MAX_CANDIDATES_KEPT, fusion cumulée
  already_collected: string[]; // ids déjà au registre des sources, cumulé
}

export interface ProspectSourcesOptions {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxPages?: number;
  pageSize?: number;
  delayMs?: number;
  timeoutMs?: number;
  timeLimitMs?: number; // décision du 07.10.2026 : délai interne, 140 min par défaut
  maxAgeDays?: number; // décision du 07.10.2026 : expiration de l'état, 56 jours par défaut
  userAgent?: string;
  outJsonPath?: string;
  outMdPath?: string;
  outStatePath?: string;
  outPassDetailPath?: string;
  outExclusionsPath?: string; // décision du 07.10.2026 : liste noire durable, jamais libérée par le script
  registrySources?: ReadonlyArray<{ url: string }>;
  now?: () => number; // epoch ms — horloge injectable (convention du plan)
}

export interface ProspectSourcesResult {
  report: ProspectionReport;
  outJsonPath: string;
  outMdPath: string;
  outStatePath: string;
  outPassDetailPath: string;
  outExclusionsPath: string;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Filtre public (décision de l'intégrateur du 07.10.2026) : éditeur fédéral ou cantonal ET au
 *  moins une clé de jointure. Ne filtre PLUS sur `a_verifier_ofs` (un jeu OFS reste affiché,
 *  jamais caché — voir `orderForPublicDisplay`). S'applique à `prospection.json` ET `.md`. */
export function isPublishableCandidate(c: ProspectionCandidate): boolean {
  return (
    c.csv_inspected && // relecture Focus 1 (point 3) : jamais publié sans en-tête CSV lu avec succès
    c.join_keys.length > 0 &&
    (c.editor_level === "confederation" || c.editor_level === "canton")
  );
}

/** Les candidats non-OFS d'abord (triés), PUIS les candidats OFS (triés entre eux) — décision
 *  de l'intégrateur du 07.10.2026 : un jeu de l'OFS reste montré, jamais caché, mais toujours
 *  après les autres, avec `status_note` annonçant « droits à confirmer (OFS) ». */
export function orderForPublicDisplay(candidates: ProspectionCandidate[]): ProspectionCandidate[] {
  const nonOfs = candidates.filter((c) => !c.a_verifier_ofs).sort(compareCandidates);
  const ofs = candidates.filter((c) => c.a_verifier_ofs).sort(compareCandidates);
  return [...nonOfs, ...ofs];
}

export interface ManualExclusion {
  id: string;
  motif: "colonne_personne" | "personnes_detectees";
}

/** Corrige HORS LIGNE (sans aucun passage réseau) l'état et le rapport déjà committés — pour un
 *  correctif immédiat (ex. relecture Focus 1) en attendant que le prochain passage relise ces
 *  jeux avec la règle corrigée. Réutilise le MÊME filtre public et le MÊME calcul de totaux que
 *  `prospectSources` (jamais une reconstruction à la main des fichiers) :
 *  1. applique les exclusions forcées fournies (id connus par éditeur/titre, jamais par
 *     relecture d'en-tête — ce correctif ne lit aucun réseau) ;
 *  2. relance `detectPersonMarkers` (liste à jour) sur le SEUL titre déjà connu de chaque
 *     candidat publié restant — la description et les mots-clés ne sont pas conservés dans
 *     l'état, donc pas vérifiables ici ; un jeu qui ne serait détecté que par sa description
 *     attendra le prochain passage qui relit le catalogue ;
 *  3. déduit `csv_inspected` pour les enregistrements d'avant ce champ : `true` seulement si au
 *     moins une clé de jointure ne porte PAS le suffixe « (titre) » (preuve qu'un en-tête CSV a
 *     bien été lu et exploité), sinon `false` — jamais supposé vrai sans cette preuve. */
export function reclassifyOffline(
  stateMap: Map<string, StateEntry>,
  previousReport: ProspectionReport,
  forcedExclusions: ManualExclusion[],
  todayIso: string,
): ProspectionReport {
  for (const { id, motif } of forcedExclusions) {
    stateMap.set(id, { seen_on: todayIso, status: motif });
  }
  const forcedIds = new Set(forcedExclusions.map((e) => e.id));

  const survivors: ProspectionCandidate[] = [];
  for (const c of previousReport.candidates) {
    if (forcedIds.has(c.id)) continue;
    const freshMarkers = detectPersonMarkers(c.title);
    if (freshMarkers.length > 0) {
      stateMap.set(c.id, { seen_on: todayIso, status: "personnes_detectees" });
      continue;
    }
    const csvInspected = c.join_keys.some((k) => !k.endsWith(" (titre)"));
    survivors.push({ ...c, csv_inspected: csvInspected });
  }

  let cumulativeCandidates = 0;
  const cumulativeExcludedByMotif: Record<string, number> = {};
  for (const entry of stateMap.values()) {
    if (entry.status === "candidate") cumulativeCandidates++;
    else cumulativeExcludedByMotif[entry.status] = (cumulativeExcludedByMotif[entry.status] ?? 0) + 1;
  }

  const publishable = survivors.filter(isPublishableCandidate);
  const candidatesKept = orderForPublicDisplay(publishable).slice(0, MAX_CANDIDATES_KEPT);

  return {
    ...previousReport,
    totals: {
      candidates: cumulativeCandidates,
      excluded: Object.values(cumulativeExcludedByMotif).reduce((a, b) => a + b, 0),
      excluded_by_motif: Object.fromEntries(Object.entries(cumulativeExcludedByMotif).sort((a, b) => cmp(a[0], b[0]))),
    },
    candidates: candidatesKept,
    already_collected: previousReport.already_collected.filter((id) => !forcedIds.has(id)),
  };
}

const CKAN_PACKAGE_SHOW_URL = "https://ckan.opendata.swiss/api/3/action/package_show";

interface CkanShowResponse { success?: boolean; result?: CkanPackage }

/** Une seule tentative (jamais de retentative) : le budget d'appels de la relecture ciblée est
 *  fixe et compté par l'appelant — retenter doublerait son coût sans le lui dire. */
async function fetchPackageShowOnce(
  fetchImpl: typeof fetch, userAgent: string, id: string, timeoutMs: number,
): Promise<CkanPackage | null> {
  try {
    const res = await fetchImpl(`${CKAN_PACKAGE_SHOW_URL}?id=${encodeURIComponent(id)}`, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as CkanShowResponse;
    return body.result ?? null;
  } catch {
    return null;
  }
}

export interface RereadExcluded { id: string; title: string; motif: "colonne_personne" | "personnes_detectees" }

export interface RereadOutcome {
  survivors: ProspectionCandidate[]; // `csv_inspected` recalculé à `true` (preuve FRAÎCHE de ce passage)
  excluded: RereadExcluded[];
  unverified: string[]; // ids non vérifiés cette nuit (budget épuisé ou aucun en-tête relisible) — retirés du public, restent "candidate" dans l'état
  callsMade: number;
}

/** Relecture ciblée (décision de l'intégrateur du 07.10.2026, point 1) — SEULS les candidats
 *  déjà publics sont relus, jamais un nouveau passage sur tout le catalogue. Pour chacun, dans
 *  l'ordre fourni, jusqu'à épuisement de `maxCalls` : un `package_show` frais (description +
 *  ressources à jour), puis au plus `MAX_CSV_HEADERS_PER_DATASET` en-têtes CSV. Un marqueur de
 *  personnes dans le texte OU une colonne de personne dans un en-tête exclut le jeu
 *  (`excluded`). Un jeu dont AUCUN en-tête n'est relisible cette nuit (ressource absente ou
 *  toutes ses lectures ont échoué) sort du rapport public sans prouver sa propreté — il reste
 *  "candidate" dans l'état (`unverified`), jamais republié sans preuve fraîche. */
export async function rereadForPersonMarkers(
  candidates: ProspectionCandidate[],
  opts: { fetchImpl: typeof fetch; userAgent: string; timeoutMs: number; delayMs: number; sleepImpl: (ms: number) => Promise<void>; maxCalls: number },
): Promise<RereadOutcome> {
  const survivors: ProspectionCandidate[] = [];
  const excluded: RereadExcluded[] = [];
  const unverified: string[] = [];
  let calls = 0;

  for (const c of candidates) {
    if (calls >= opts.maxCalls) { unverified.push(c.id); continue; }
    await opts.sleepImpl(opts.delayMs);
    calls++;
    const pkg = await fetchPackageShowOnce(opts.fetchImpl, opts.userAgent, c.id, opts.timeoutMs);
    if (!pkg) { unverified.push(c.id); continue; }

    const textMarkers = detectPersonMarkers(collectSearchableText(pkg));
    if (textMarkers.length > 0) {
      excluded.push({ id: c.id, title: c.title, motif: "personnes_detectees" });
      continue;
    }

    const csvResources = (pkg.resources ?? []).filter(isCsvResource).slice(0, MAX_CSV_HEADERS_PER_DATASET);
    let headersRead = 0;
    let personColumnFound = false;
    for (const r of csvResources) {
      if (!r.url) continue;
      if (calls >= opts.maxCalls) break; // budget épuisé EN COURS de jeu : ce qui a été lu reste valable
      await opts.sleepImpl(opts.delayMs);
      calls++;
      const headerLine = await readCsvHeaderPartial(opts.fetchImpl, r.url, opts.userAgent, opts.timeoutMs);
      if (!headerLine) continue;
      headersRead++;
      if (detectPersonColumns(splitHeaderColumns(headerLine)).length > 0) { personColumnFound = true; break; }
    }
    if (personColumnFound) {
      excluded.push({ id: c.id, title: c.title, motif: "colonne_personne" });
      continue;
    }
    if (headersRead === 0) { unverified.push(c.id); continue; } // aucun en-tête relisible cette nuit
    survivors.push({ ...c, csv_inspected: true });
  }

  return { survivors, excluded, unverified, callsMade: calls };
}

export interface FinalizeReportInput {
  stateMap: Map<string, StateEntry>; // MUTÉ : la liste noire y est appliquée ici, en dernier
  candidatesPool: Map<string, ProspectionCandidate>; // tous les candidats connus avant le filtre public
  exclusionBlacklist: Map<string, ExclusionEntry>;
  alreadyCollected: Set<string>; // MUTÉ : les id de la liste noire en sont retirés
  generatedOn: string;
  source: string;
  run: ProspectionRun;
}

/** Assemble le `ProspectionReport` final — SEULE fonction qui applique la liste noire durable,
 *  le filtre public (`isPublishableCandidate`), l'ordre (`orderForPublicDisplay`), le plafond
 *  (`MAX_CANDIDATES_KEPT`) et les totaux cumulés (depuis l'état complet, jamais par soustraction
 *  arithmétique). Partagée par le passage réel (`prospectSources`) ET par toute correction hors
 *  ligne ou relecture ciblée (décision de l'intégrateur du 07.10.2026, point formalisé après la
 *  relecture ciblée des 104 candidats publics : avant, cette reconstruction vivait dans un
 *  script de secours non versionné et non testé). */
export function finalizeReport(input: FinalizeReportInput): ProspectionReport {
  const { stateMap, candidatesPool, exclusionBlacklist, alreadyCollected, generatedOn, source, run } = input;

  // Liste noire durable (point 3) : s'applique EN DERNIER, après tout le reste — y compris si
  // ce passage vient juste de reclasser l'id en "candidate" (reread propre). Rien ici ne libère
  // jamais un id listé ; seul un retrait manuel du fichier le peut.
  for (const entry of exclusionBlacklist.values()) {
    stateMap.set(entry.id, { seen_on: entry.date, status: entry.motif });
    candidatesPool.delete(entry.id);
    alreadyCollected.delete(entry.id);
  }

  // Décision de l'intégrateur du 07.10.2026 : le rapport PUBLIC (json et .md) ne garde que les
  // candidats fédéraux/cantonaux avec au moins une clé de jointure et un en-tête CSV inspecté
  // avec succès ; les jeux de l'OFS parmi eux restent montrés, mais toujours APRÈS les autres.
  const publishable = [...candidatesPool.values()].filter(isPublishableCandidate);
  const candidates = orderForPublicDisplay(publishable).slice(0, MAX_CANDIDATES_KEPT);

  // --- Totaux CUMULÉS, calculés sur l'état complet (jamais seulement ce passage) ---
  let cumulativeCandidates = 0;
  const cumulativeExcludedByMotif: Record<string, number> = {};
  for (const entry of stateMap.values()) {
    if (entry.status === "candidate") cumulativeCandidates++;
    else cumulativeExcludedByMotif[entry.status] = (cumulativeExcludedByMotif[entry.status] ?? 0) + 1;
  }

  return {
    generated_on: generatedOn,
    source,
    run,
    totals: {
      candidates: cumulativeCandidates,
      excluded: Object.values(cumulativeExcludedByMotif).reduce((a, b) => a + b, 0),
      excluded_by_motif: Object.fromEntries(Object.entries(cumulativeExcludedByMotif).sort((a, b) => cmp(a[0], b[0]))),
    },
    candidates,
    already_collected: [...alreadyCollected].sort(),
  };
}

/** `candidates` est déjà filtré (`isPublishableCandidate`) et ordonné (`orderForPublicDisplay`)
 *  par l'appelant avant d'être committé : cette fonction ne fait plus que le découper pour le
 *  tableau du `.md` (30 lignes), jamais un second filtre. */
function selectTopCandidates(candidates: ProspectionCandidate[], limit = 30): ProspectionCandidate[] {
  return candidates.slice(0, limit);
}

/** Un titre ou un nom d'éditeur peut contenir `|` ou un saut de ligne (texte libre d'un
 *  catalogue tiers) : sans échappement, une seule cellule casserait tout le tableau Markdown
 *  qui la suit. Jamais de troncature silencieuse du contenu, seulement un échappement. */
function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function markdownCandidateRow(c: ProspectionCandidate): string {
  return `| ${escapeMarkdownCell(c.title)} | ${escapeMarkdownCell(c.publisher)} | ${c.editor_level || "?"} | ${c.licence} | ${c.join_keys.join(", ") || "—"} | ${escapeMarkdownCell(c.frequency ?? "—")} | ${c.deja_collecte ? "oui" : "non"} | ${c.status_note ?? "—"} | [lien](${c.url}) |`;
}

const CANDIDATE_TABLE_HEADER = [
  "| Titre | Éditeur | Niveau | Licence | Clés de jointure | Fréquence | Déjà collecté | Statut | Fiche |",
  "|---|---|---|---|---|---|---|---|---|",
];

export function buildMarkdownReport(report: ProspectionReport): string {
  // `report.candidates` est déjà ordonné non-OFS puis OFS (`orderForPublicDisplay`) : on sépare
  // les deux groupes AVANT de découper à 30, pour que les candidats OFS aient toujours leur
  // propre tableau — sans ce filtre, ils ne dépasseraient jamais le haut du premier tableau dès
  // qu'il y a plus de 30 candidats non-OFS (constat du 07.10.2026 : 123 non-OFS ce passage-là,
  // les 116 candidats OFS n'auraient alors jamais été VUS, contrairement à la décision du
  // 07.10.2026 de les montrer après les autres, jamais cachés).
  const topNonOfs = selectTopCandidates(report.candidates.filter((c) => !c.a_verifier_ofs), 30);
  const topOfs = selectTopCandidates(report.candidates.filter((c) => c.a_verifier_ofs), 30);
  const lines: string[] = [
    "# Prospection de nouvelles sources publiques (opendata.swiss)",
    "",
    `Généré le ${report.generated_on} · tâche osd.prospection. Catalogue interrogé par l'API CKAN officielle` +
      ` d'opendata.swiss (\`package_search\`), jamais de données servies modifiées par ce rapport.`,
    "",
    `- Ce passage : ${report.run.pages_read} / ${report.run.max_pages} pages lues (à partir de la page ${report.run.start_page}` +
      ` sur ${report.run.total_pages} au total), ${report.run.datasets_read} jeux lus (${report.run.page_size} jeux par page).`,
    `- Couverture cumulée : ${(report.run.coverage_ratio * 100).toFixed(1)} %` +
      (report.run.datasets_total_catalog !== null ? ` du catalogue (${report.run.datasets_total_catalog} jeux)` : ""),
    `- Candidats cumulés (licence ouverte, aucun marqueur de personnes détecté dans le texte, aucune colonne de personne dans les en-têtes LUS — un en-tête jamais lu n'est jamais affirmé propre) : ${report.totals.candidates} — ${report.candidates.length} passent le filtre public (éditeur fédéral ou cantonal, au moins une clé de jointure, et au moins un en-tête CSV inspecté avec succès — décision de l'intégrateur du 07.10.2026) et sont conservés en détail dans \`prospection.json\` (plafond ${MAX_CANDIDATES_KEPT}), 30 de chaque groupe (non-OFS, OFS) montrés dans les tableaux plus bas.`,
    `- Jeux écartés (cumulé) : ${report.totals.excluded}`,
    `- Jeux déjà au registre des sources (cumulé) : ${report.already_collected.length}`,
    report.run.partial
      ? `- ⚠️ **Passage PARTIEL** (motif : ${report.run.stopped_reason}) : arrêté avant la fin de la fenêtre visée.`
      : "- Passage mené jusqu'au bout de la fenêtre visée, sans échec.",
    "",
    "## Écarts par motif",
    "",
    "| Motif | Jeux écartés |",
    "|---|---|",
    ...Object.entries(report.totals.excluded_by_motif)
      .sort((a, b) => cmp(a[0], b[0]))
      .map(([motif, n]) => `| ${motif} | ${n} |`),
    "",
    "## Meilleurs candidats",
    "",
    `Tri par éditeur (fédéral puis cantonal), nombre de clés de jointure détectées, fréquence de` +
      ` mise à jour — aucune note ni score. Seuls les jeux avec au moins une clé de jointure,` +
      ` d'un éditeur fédéral ou cantonal, ET dont au moins un en-tête CSV a été inspecté avec` +
      ` succès (décision de l'intégrateur du 07.10.2026) apparaissent dans ce rapport (voir` +
      ` \`prospection.json\` pour le détail cumulé complet — jamais le détail intégral du` +
      ` catalogue, qui n'est pas publié). « Déjà collecté » signale un jeu déjà présent au` +
      ` registre des sources du projet — toujours affiché, jamais filtré.`,
    "",
    ...CANDIDATE_TABLE_HEADER,
    ...topNonOfs.map(markdownCandidateRow),
    "",
    "## Jeux de l'OFS — droits à confirmer",
    "",
    `Décision de l'intégrateur du 07.10.2026 : un jeu de l'OFS reste un candidat à part entière,` +
      ` jamais caché pour ce seul motif — mais toujours présenté ICI, après tous les autres,` +
      ` jusqu'à ce que la clarification écrite du 06.10.2026 aboutisse (« droits à confirmer »).`,
    "",
    ...(topOfs.length > 0
      ? [...CANDIDATE_TABLE_HEADER, ...topOfs.map(markdownCandidateRow)]
      : ["*Aucun candidat OFS dans ce rapport cumulé pour l'instant.*"]),
    "",
    "Chaque jeu, qu'il soit retenu ou non ici, reste « à vérifier » pour toute donnée personnelle" +
      " (jamais affirmé « sans données personnelles »).",
    "",
  ];
  return lines.join("\n");
}

function writeAtomic(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${randomUUID()}.tmp`);
  writeFileSync(tmp, content, "utf8");
  try {
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* fichier temporaire déjà absent */ }
    throw err;
  }
}

export async function prospectSources(opts: ProspectSourcesOptions = {}): Promise<ProspectSourcesResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const sleepImpl = opts.sleepImpl ?? realSleep;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeLimitMs = opts.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const outJsonPath = opts.outJsonPath ?? DEFAULT_OUT_JSON;
  const outMdPath = opts.outMdPath ?? DEFAULT_OUT_MD;
  const outStatePath = opts.outStatePath ?? DEFAULT_OUT_STATE;
  const outPassDetailPath = opts.outPassDetailPath ?? DEFAULT_OUT_PASS_DETAIL;
  const outExclusionsPath = opts.outExclusionsPath ?? DEFAULT_OUT_EXCLUSIONS;
  const exclusionBlacklist = loadExclusionBlacklist(outExclusionsPath);
  const nowFn = opts.now ?? Date.now;
  const tokens = registryTokens(opts.registrySources ?? SOURCES);

  const startedAt = nowFn();
  const todayIso = toIsoDate(startedAt);

  // --- Fusion : charger l'état et le rapport déjà committés avant d'écrire quoi que ce soit ---
  const stateMap = loadState(outStatePath);
  const previousReport = readJsonIfExists<ProspectionReport>(outJsonPath);
  // Garde de schéma (décision de l'intégrateur du 07.10.2026) : un `prospection.json` d'avant ce
  // renommage n'a pas de `publisher` (il avait `editor`) — un tel enregistrement ne doit jamais
  // être repris tel quel dans la fusion (il manquerait `publisher`, `status_note`, et son `url`
  // pourrait encoder un slug). On l'ignore silencieusement ; le jeu sera reclassé proprement au
  // prochain passage qui le relit. On retient aussi ses `id` à part : eux seuls seront purgés de
  // l'état plus bas (jamais un candidat légitime mais filtré du rapport public, ex. communal ou
  // sans clé de jointure — lui doit survivre tel quel d'un passage à l'autre, voir plus bas).
  const rejectedOldSchemaIds = new Set(
    (previousReport?.candidates ?? [])
      .filter((c) => typeof (c as { publisher?: unknown }).publisher !== "string")
      .map((c) => c.id),
  );
  const previousCandidatesById = new Map<string, ProspectionCandidate>(
    (previousReport?.candidates ?? [])
      .filter((c): boolean => typeof (c as { publisher?: unknown }).publisher === "string")
      .map((c) => [c.id, c]),
  );
  const alreadyCollected = new Set<string>(previousReport?.already_collected ?? []);
  const previousTotalPages = previousReport?.run.total_pages ?? 1;

  let totalCatalog: number | null = null;
  let totalPages = previousTotalPages;
  let startPage = 0;
  let pagesRead = 0;
  let datasetsReadThisPass = 0;
  let partial = false;
  let stoppedReason: ProspectionRun["stopped_reason"] = "ok";
  const thisPassNewCandidates = new Map<string, ProspectionCandidate>();
  const thisPassExcludedByMotif: Record<string, number> = {};

  // --- Sonde (rows=0) : connaître la taille du catalogue AVANT de calculer la rotation ---
  const probe = await fetchCkanPageWithRetry(fetchImpl, userAgent, 0, 0, timeoutMs, delayMs, sleepImpl);
  if (probe === null) {
    partial = true;
    stoppedReason = "probe_failed";
  } else {
    totalCatalog = probe.count;
    totalPages = Math.max(1, Math.ceil(totalCatalog / pageSize));
    const week = isoWeekNumber(new Date(startedAt));
    startPage = computeStartPage(week, totalPages, maxPages);
    const pageSequence = rotatingPageSequence(startPage, totalPages, maxPages);

    for (const pageIndex of pageSequence) {
      if (nowFn() - startedAt >= timeLimitMs) {
        partial = true;
        stoppedReason = "time_limit";
        break;
      }
      const start = pageIndex * pageSize;
      await sleepImpl(delayMs); // avant CHAQUE appel sortant, y compris après la sonde
      const result = await fetchCkanPageWithRetry(fetchImpl, userAgent, start, pageSize, timeoutMs, delayMs, sleepImpl);
      if (result === null) {
        partial = true;
        stoppedReason = "page_failed";
        break;
      }
      pagesRead++;
      const pkgs = result.results ?? [];
      datasetsReadThisPass += pkgs.length;

      for (const pkg of pkgs) {
        // Relecture Focus 1 (point 6) : la limite de temps est aussi vérifiée AVANT chaque
        // lecture d'en-tête CSV, pas seulement entre deux pages — une page de 100 jeux dont
        // plusieurs ont des ressources CSV lentes pouvait dépasser largement le budget sans
        // qu'aucun contrôle n'intervienne avant la page SUIVANTE.
        if (nowFn() - startedAt >= timeLimitMs) {
          partial = true;
          stoppedReason = "time_limit";
          break;
        }
        const verdict = classifyPackage(pkg, tokens);
        if (!verdict.isCandidate) {
          const motif = verdict.exclusionMotif ?? "licence_non_ouverte";
          thisPassExcludedByMotif[motif] = (thisPassExcludedByMotif[motif] ?? 0) + 1;
          stateMap.set(verdict.id, { seen_on: todayIso, status: motif });
          continue;
        }
        const previousStatus = stateMap.get(verdict.id)?.status; // AVANT d'écrire quoi que ce soit pour cet id ce passage
        const inspection = await inspectCsvHeaders(verdict.resources, { fetchImpl, userAgent, timeoutMs, delayMs, sleepImpl });
        // `csv_inspected` (point 3) : AU MOINS un en-tête lu avec succès suffit — un jeu avec
        // plusieurs ressources CSV dont une seule se lit reste publiable sur cette preuve-là.
        const cleanReadThisPass = inspection.headersRead > 0;
        // Libération d'une exclusion DURABLE (point 4) : condition plus stricte que
        // `cleanReadThisPass` — TOUTES les ressources CSV tentées doivent avoir été lues avec
        // succès, pas seulement une sur plusieurs. Avec `headersRead > 0` seul, un jeu à trois
        // CSV dont deux échouent (et dont l'une pourrait justement contenir la colonne de
        // personne qui a motivé l'exclusion) aurait été libéré sur la seule base de la
        // troisième — exactement ce que « un échec de lecture ne le libère jamais » interdit.
        const allAttemptedReadCleanly = inspection.headersAttempted > 0 && inspection.headersRead === inspection.headersAttempted;
        if (inspection.personColumns.length > 0) {
          // Décision du 07.10.2026 : une colonne de personne détectée dans l'en-tête RECLASSE
          // le jeu en exclu, même s'il avait passé les marqueurs texte (Review Focus 1, cas
          // réel OFEN : « Bénéficiaires de la rétribution de l'injection »).
          thisPassExcludedByMotif.colonne_personne = (thisPassExcludedByMotif.colonne_personne ?? 0) + 1;
          stateMap.set(verdict.id, { seen_on: todayIso, status: "colonne_personne" });
          continue;
        }
        if (previousStatus === "colonne_personne" && !allAttemptedReadCleanly) {
          // Exclusion DURABLE (relecture Focus 1, point 4) : un jeu déjà exclu pour colonne de
          // personne le reste tant que CHAQUE ressource CSV tentée ce passage n'a pas été relue
          // avec succès et trouvée propre. Un échec de lecture, même partiel (une ressource sur
          // plusieurs), ne libère JAMAIS l'exclusion.
          thisPassExcludedByMotif.colonne_personne = (thisPassExcludedByMotif.colonne_personne ?? 0) + 1;
          stateMap.set(verdict.id, { seen_on: todayIso, status: "colonne_personne" });
          continue;
        }
        const joinKeys = [...new Set([...inspection.joinKeys, ...verdict.titleJoinKeys])].sort();
        const licenceByCode: Record<string, ProspectionCandidate["licence"]> = {
          open: "terms_open", by: "terms_by", attribution: "attribution", public_domain: "public_domain",
        };
        const record: ProspectionCandidate = {
          id: verdict.id,
          title: verdict.title,
          publisher: verdict.publisher,
          editor_level: verdict.editorLevel,
          url: verdict.url,
          licence: licenceByCode[verdict.licenceCode ?? "open"] ?? "terms_open",
          formats: verdict.formats,
          frequency: verdict.frequency,
          modified: verdict.modified,
          join_keys: joinKeys,
          a_verifier_ofs: verdict.ofsFlag,
          a_verifier_personnes: "a_verifier",
          deja_collecte: verdict.dejaCollecte,
          status_note: verdict.ofsFlag ? "droits à confirmer (OFS)" : null,
          csv_inspected: cleanReadThisPass,
        };
        thisPassNewCandidates.set(verdict.id, record);
        stateMap.set(verdict.id, { seen_on: todayIso, status: "candidate" });
        if (verdict.dejaCollecte) alreadyCollected.add(verdict.id);
      }
      if (partial && stoppedReason === "time_limit") break; // sortir aussi de la boucle des pages

      console.log(
        `[prospect:sources] page ${pagesRead}/${pageSequence.length} (page catalogue n°${pageIndex}) : ` +
          `${datasetsReadThisPass} jeu(x) lu(s) ce passage, ${thisPassNewCandidates.size} nouveau(x) candidat(s), ` +
          `${Object.values(thisPassExcludedByMotif).reduce((a, b) => a + b, 0)} écarté(s) ce passage ` +
          `(${((nowFn() - startedAt) / 1000).toFixed(1)} s écoulées)`,
      );
    }
  }

  // --- Purger les jeux non revus depuis `maxAgeDays` (8 semaines par défaut) ---
  for (const [id, entry] of [...stateMap]) {
    if (daysBetweenIso(entry.seen_on, todayIso) > maxAgeDays) stateMap.delete(id);
  }
  for (const id of [...alreadyCollected]) {
    if (!stateMap.has(id)) alreadyCollected.delete(id); // cohérence : un id purgé de l'état sort aussi de cette liste
  }

  // --- Fusionner les candidats : ceux de ce passage + ceux d'avant encore valides (ni purgés, ni reclassés exclus) ---
  const mergedCandidates = new Map<string, ProspectionCandidate>();
  for (const [id, record] of previousCandidatesById) {
    const state = stateMap.get(id);
    if (state && state.status === "candidate") mergedCandidates.set(id, record);
  }
  for (const [id, record] of thisPassNewCandidates) mergedCandidates.set(id, record); // écrase toujours avec la version fraîche

  // Garde de cohérence CIBLÉE (revue du 07.10.2026, corrige une purge trop large du même jour) :
  // seuls les `id` effectivement rejetés ci-dessus par la garde de schéma (`rejectedOldSchemaIds`
  // — un `prospection.json` d'avant ce renommage) sont retirés de l'état. Un candidat légitime
  // mais filtré du rapport PUBLIC (communal, ou sans clé de jointure — décision du 07.10.2026)
  // n'a jamais eu de raison d'être dans `mergedCandidates` : le purger ici l'aurait fait
  // disparaître de l'état à chaque passage où il n'est pas relu, et son décompte cumulé avec —
  // exactement le bug que cette garde devait éviter, pas en créer un nouveau.
  for (const id of rejectedOldSchemaIds) {
    if (stateMap.get(id)?.status === "candidate") stateMap.delete(id);
  }
  for (const id of [...alreadyCollected]) {
    if (!stateMap.has(id)) alreadyCollected.delete(id);
  }

  const datasetsTotalForCoverage = totalCatalog ?? previousReport?.run.datasets_total_catalog ?? null;
  const coverageRatio = datasetsTotalForCoverage && datasetsTotalForCoverage > 0
    ? Math.min(1, stateMap.size / datasetsTotalForCoverage)
    : 0;
  const generatedOn = toIsoDate(nowFn());

  const report = finalizeReport({
    stateMap,
    candidatesPool: mergedCandidates,
    exclusionBlacklist,
    alreadyCollected,
    generatedOn,
    source: CKAN_SEARCH_URL,
    run: {
      pages_read: pagesRead,
      page_size: pageSize,
      max_pages: maxPages,
      start_page: startPage,
      total_pages: totalPages,
      datasets_read: datasetsReadThisPass,
      datasets_total_catalog: totalCatalog,
      coverage_ratio: coverageRatio,
      partial,
      stopped_reason: stoppedReason,
    },
  });

  const json = JSON.stringify(report, null, 2) + "\n";
  const md = buildMarkdownReport(report);
  const stateJson = JSON.stringify(serializeState(stateMap)) + "\n"; // sans indentation : taille visée < 600 Ko
  const passDetail = {
    generated_on: generatedOn,
    pages_read: pagesRead,
    start_page: startPage,
    total_pages: totalPages,
    datasets_read_this_pass: datasetsReadThisPass,
    stopped_reason: stoppedReason,
    new_candidates_this_pass: [...thisPassNewCandidates.values()],
    excluded_this_pass_by_motif: Object.fromEntries(Object.entries(thisPassExcludedByMotif).sort((a, b) => cmp(a[0], b[0]))),
  };

  writeAtomic(outJsonPath, json);
  writeAtomic(outMdPath, md);
  writeAtomic(outStatePath, stateJson);
  writeAtomic(outPassDetailPath, JSON.stringify(passDetail, null, 2) + "\n"); // docs/internal/ : jamais commité

  console.log(
    `[prospect:sources] passage terminé : ${datasetsReadThisPass} jeu(x) lu(s) (${pagesRead}/${maxPages} pages visées), ` +
      `${thisPassNewCandidates.size} nouveau(x) candidat(s) ce passage — cumulé : ${report.totals.candidates} candidat(s), ` +
      `${report.totals.excluded} écarté(s), couverture ${(coverageRatio * 100).toFixed(1)} %` +
      (partial ? ` — PASSAGE PARTIEL (${stoppedReason})` : ""),
  );

  return { report, outJsonPath, outMdPath, outStatePath, outPassDetailPath, outExclusionsPath };
}

/** Code de sortie attendu pour CE passage — pure, testée, utilisée par `main()` et par le
 *  workflow (via le code réellement renvoyé). Relecture Focus 1, point 6 : un `probe_failed`,
 *  un `page_failed` ou un passage qui n'a lu AUCUNE page ne doit jamais sortir en succès (0) —
 *  sinon le workflow ne déclenche aucune alerte alors que le catalogue n'a pas pu être lu. Le
 *  rapport, lui, reste committé (partiel si besoin) : ce n'est que la sortie qui doit alerter. */
export function exitCodeFor(run: Pick<ProspectionRun, "stopped_reason" | "pages_read">): number {
  if (run.stopped_reason === "time_limit") return 2;
  if (run.stopped_reason === "probe_failed" || run.stopped_reason === "page_failed" || run.pages_read === 0) return 3;
  return 0;
}

async function main(): Promise<void> {
  const result = await prospectSources();
  const run = result.report.run;
  const code = exitCodeFor(run);
  if (code === 2) {
    console.warn("[prospect:sources] limite de temps interne atteinte : rapport partiel committé quand même, sortie code 2.");
  } else if (code === 3) {
    console.error(
      `[prospect:sources] passage en échec (motif : ${run.stopped_reason}, pages_read=${run.pages_read}) : ` +
        "rapport committé si sûr, sortie code 3 pour l'alerte.",
    );
  } else if (run.partial) {
    console.warn(`[prospect:sources] passage partiel (motif : ${run.stopped_reason}).`);
  }
  if (code !== 0) process.exitCode = code;
}

// Même détection robuste du module principal que `scripts/sync-localities.ts` (chemins avec
// espaces ou caractères spéciaux, Windows), au lieu de la comparaison littérale fragile.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error("[prospect:sources] ERREUR :", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
