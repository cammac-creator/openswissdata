/**
 * Lecture en direct du STATUT d'inscription au registre du commerce par l'API REST publique
 * Zefix de l'OFRC, pour la fiche de vérification d'une société suisse (tâche du 11.10.2026).
 * LINDAS (`lindas.ts`) ne porte pas ce statut : sans cette lecture, la fiche ne dit pas si une
 * société est radiée.
 *
 * Un GET `<ZEFIX_REST_COMPANY_UID_URL>/<CHE + 9 chiffres>` (IDE sans séparateurs, forme compacte
 * déjà validée par `parseUid`), authentification HTTP Basic, `accept: application/json`. Réponse
 * 200 observée le 11.10.2026 : un TABLEAU d'objets (en général un seul) dont on ne lit QUE
 * `uid`, `status` et `deletionDate`. Un 404 ou un tableau vide valent « non trouvé ».
 *
 * Conditions d'utilisation de l'API acceptées pour ce service : usage gratuit, origine indiquée
 * (Zefix, OFRC) et toute modification signalée, sans garantie (seuls l'extrait certifié et la
 * FOSC font foi), blocage possible en cas de perturbation, pas de requêtes de masse régulières.
 * D'où, dans ce module :
 *  - une consultation unitaire, seulement à la demande d'un appel de `company_check` : aucune
 *    collecte en lot, aucun préchargement, aucune tâche planifiée, aucun canari ;
 *  - un cache de 24 h par IDE (1 h pour « non trouvé », comme `gleif.ts`) ;
 *  - une seule requête Zefix en vol à la fois, tous IDE confondus (`SerialGate`, file bornée) ;
 *  - au plus une requête par `MIN_INTERVAL_MS` (temps réel), même avec des IDE tous différents ;
 *  - un plafond de `DEFAULT_DAILY_LIMIT` requêtes réellement envoyées par jour UTC, compteur en
 *    mémoire remis à zéro au redémarrage du processus ;
 *  - le disjoncteur commun (`SourceBreaker`) pour les pannes (5xx, 429, délai, réponse illisible) ;
 *    sa remise à zéro n'a lieu qu'après une réponse de forme valide ;
 *  - un 401 ou un 403 (identifiants refusés) arrête toute requête jusqu'au redémarrage du
 *    processus : des identifiants refusés ne sont jamais rejoués (relecture du 11.10.2026).
 *
 * Identifiants : `ZEFIX_REST_USERNAME` et `ZEFIX_REST_PASSWORD`, lus dans l'environnement À
 * L'APPEL. Absents ou vides : aucune requête, motif fixe `ZEFIX_REST_NOT_CONFIGURED`, et la
 * fiche reste strictement celle d'avant (voir `companyCheck` dans `check.ts`). Ni les
 * identifiants ni l'en-tête `Authorization` n'apparaissent jamais dans un motif, une trace ou
 * une réponse ; aucune erreur de `fetch` n'est relayée telle quelle.
 *
 * Minimisation : seuls le statut normalisé et la date de radiation sont gardés (cache compris).
 * La raison sociale, l'adresse et le but que porte aussi la réponse ne sont jamais conservés,
 * pour ne jamais rouvrir par ce chemin ce que la fiche retient pour une entreprise individuelle.
 *
 * `ZEFIX_REST_COMPANY_UID_URL` DOIT rester identique à `getSource("ofrc.zefix_rest").url`
 * (`etl/shared/sources/registry.ts`) ; `src/` ne peut pas importer `etl/` (voir `lindas.ts`) :
 * `tests/mcp/company-zefix-rest.test.ts` vérifie l'égalité.
 */

import { parseUid } from "./uid.js";
import { TtlCache } from "./cache.js";
import { RequestCoalescer, retryAfterMs, SerialGate, SourceBreaker } from "./outbound-guard.js";
import type { LiveDeps, Part, ZefixRestStatus, ZefixRestStatusRecord } from "./types.js";

export const ZEFIX_REST_COMPANY_UID_URL = "https://www.zefix.admin.ch/ZefixPublicREST/api/v1/company/uid";

/** Motif fixe quand les identifiants manquent : `companyCheck` s'en sert pour ne rien ajouter à la fiche. */
export const ZEFIX_REST_NOT_CONFIGURED = "Zefix REST not configured";

const COMPACT_UID_RE = /^CHE\d{9}$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DEFAULT_TIMEOUT_MS = 6000;
const CACHE_MAX = 2000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// « Non trouvé » : une heure seulement, même règle que `gleif.ts` et `lindas.ts` (une société
// peut être inscrite entre deux lectures).
const NOT_FOUND_CACHE_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Plafond quotidien de requêtes réellement envoyées à Zefix (jour UTC), succès et échecs compris. */
export const DEFAULT_DAILY_LIMIT = 500;
/** Écart minimal, en temps réel, entre deux requêtes envoyées à Zefix. */
export const MIN_INTERVAL_MS = 1000;
/** Au plus une requête en cours et ce nombre en attente ; au-delà, motif « busy » sans requête. */
const MAX_WAITING = 4;
const USER_AGENT = "OpenSwissData company_check (+https://www.openswissdata.com)";

// Correspondance EXACTE des valeurs de Zefix (relevées le 11.10.2026 : ACTIVE, CANCELLED ; la
// documentation publique de Zefix cite aussi BEING_CANCELLED). Map, jamais un objet littéral :
// aucune propriété héritée (`toString`, `__proto__`…) ne peut passer pour un statut.
const STATUS_MAP: ReadonlyMap<string, ZefixRestStatus> = new Map([
  ["ACTIVE", "active"],
  ["BEING_CANCELLED", "in_liquidation"],
  ["CANCELLED", "deleted"],
]);

interface Credentials {
  username: string;
  password: string;
}

/** Les deux variables, non vides ; sinon `null` (Zefix REST non configuré, aucune requête). */
export function readZefixRestCredentials(env: NodeJS.ProcessEnv = process.env): Credentials | null {
  const username = env.ZEFIX_REST_USERNAME;
  const password = env.ZEFIX_REST_PASSWORD;
  if (typeof username !== "string" || username.trim() === "") return null;
  if (typeof password !== "string" || password.trim() === "") return null;
  return { username, password };
}

function basicAuthorization(credentials: Credentials): string {
  return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, "utf8").toString("base64")}`;
}

function toCanonical(compactUid: string): string {
  const digits = compactUid.slice(3);
  return `CHE-${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Valeur de Zefix → statut normalisé ; toute valeur absente, d'un autre type ou inconnue → `unknown`. */
function normalizeStatus(raw: unknown): ZefixRestStatus {
  return typeof raw === "string" ? STATUS_MAP.get(raw) ?? "unknown" : "unknown";
}

/** `AAAA-MM-JJ` d'une date réelle du calendrier, sinon `null` (jamais une date reformatée ou devinée). */
function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = ISO_DATE_RE.exec(raw);
  if (!m) return null;
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  return d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour ? raw : null;
}

type ItemResult = { kind: "match"; record: ZefixRestStatusRecord } | { kind: "other" } | { kind: "skip" } | { kind: "fail" };

/**
 * Lit un élément du tableau, même discipline que `extractItem` de `gleif.ts` :
 *  - `fail` : l'élément n'est pas un objet, ou `uid` est présent mais pas une chaîne non vide —
 *    toute la réponse est rejetée, jamais filtrée en silence ;
 *  - `skip` : `uid` absent — élément ignoré ;
 *  - `other` : `uid` d'une autre société (ou illisible par `parseUid`) — ignoré ;
 *  - `match` : élément de l'IDE demandé, réduit au statut et à la date de radiation.
 */
function readItem(raw: unknown, requestedCompact: string): ItemResult {
  if (!isPlainObject(raw)) return { kind: "fail" };
  const uid = raw.uid;
  if (uid === undefined || uid === null) return { kind: "skip" };
  if (typeof uid !== "string" || uid === "") return { kind: "fail" };
  const parsed = parseUid(uid);
  if (!parsed.ok || parsed.compact !== requestedCompact) return { kind: "other" };
  return {
    kind: "match",
    record: { status: normalizeStatus(raw.status), deletion_date: normalizeDate(raw.deletionDate) },
  };
}

// Singletons de production. `resetZefixRest` remet tout à zéro avec une horloge de test (cache,
// disjoncteur, file, compteur quotidien) et permet d'abaisser le plafond quotidien en test.
let clock: () => number = () => Date.now();
let cache = new TtlCache<Part<ZefixRestStatusRecord>>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS, now: clock });
let breaker = new SourceBreaker({ now: clock });
let gate = new SerialGate({ maxWaiting: MAX_WAITING });
let coalescer = new RequestCoalescer<Part<ZefixRestStatusRecord>>();
let dailyLimit = DEFAULT_DAILY_LIMIT;
let budgetDay = -1;
let budgetUsed = 0;
let minIntervalMs = MIN_INTERVAL_MS;
let lastSentAt = -Infinity; // temps réel (Date.now), jamais l'horloge injectée : l'écart est une attente réelle
let credentialsRefused = false;

export function resetZefixRest(now: () => number = () => Date.now(), options: { dailyLimit?: number; minIntervalMs?: number } = {}): void {
  clock = now;
  cache = new TtlCache<Part<ZefixRestStatusRecord>>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS, now });
  breaker = new SourceBreaker({ now });
  gate = new SerialGate({ maxWaiting: MAX_WAITING });
  coalescer = new RequestCoalescer<Part<ZefixRestStatusRecord>>();
  dailyLimit = options.dailyLimit ?? DEFAULT_DAILY_LIMIT;
  budgetDay = -1;
  budgetUsed = 0;
  minIntervalMs = options.minIntervalMs ?? MIN_INTERVAL_MS;
  lastSentAt = -Infinity;
  credentialsRefused = false;
}

/** Jour UTC courant ; le compteur repart à zéro quand il change. */
function refreshBudgetDay(): void {
  const day = Math.floor(clock() / DAY_MS);
  if (day !== budgetDay) {
    budgetDay = day;
    budgetUsed = 0;
  }
}

function dailyBudgetLeft(): boolean {
  refreshBudgetDay();
  return budgetUsed < dailyLimit;
}

/** Compte une requête SUR LE POINT d'être envoyée ; `false` (rien compté) si le plafond est atteint. */
function consumeDailyBudget(): boolean {
  if (!dailyBudgetLeft()) return false;
  budgetUsed += 1;
  return true;
}

// Motifs fixes, figés : partagés entre appelants, ils ne doivent jamais pouvoir être modifiés.
const PAUSED: Part<ZefixRestStatusRecord> = Object.freeze({ available: false, reason: "source temporarily paused after errors" });
const DAILY_LIMIT_REACHED: Part<ZefixRestStatusRecord> = Object.freeze({ available: false, reason: "Zefix REST daily limit reached" });
const BUSY: Part<ZefixRestStatusRecord> = Object.freeze({ available: false, reason: "Zefix REST busy, try again later" });
const REFUSED: Part<ZefixRestStatusRecord> = Object.freeze({ available: false, reason: "Zefix REST credentials refused, paused until restart" });

export async function lookupZefixRest(compactUid: string, deps: LiveDeps): Promise<Part<ZefixRestStatusRecord>> {
  if (!COMPACT_UID_RE.test(compactUid)) {
    return { available: false, reason: "uid must be the compact form CHE + 9 digits (from parseUid)" };
  }
  const credentials = readZefixRestCredentials();
  if (credentials === null) return { available: false, reason: ZEFIX_REST_NOT_CONFIGURED };
  if (credentialsRefused) return REFUSED;

  const cacheKey = toCanonical(compactUid);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (breaker.isPaused()) return PAUSED;
  if (!dailyBudgetLeft()) return DAILY_LIMIT_REACHED;

  // Même IDE demandé deux fois en même temps : une seule place dans la file. IDE différents :
  // la file les fait passer un par un, jamais deux requêtes Zefix en vol.
  return coalescer.run(cacheKey, () => gate.run(() => fetchZefixRest(compactUid, cacheKey, credentials, deps)) ?? Promise.resolve(BUSY));
}

async function fetchZefixRest(
  compactUid: string,
  cacheKey: string,
  credentials: Credentials,
  deps: LiveDeps,
): Promise<Part<ZefixRestStatusRecord>> {
  // Revérifié une fois la place obtenue : le disjoncteur a pu s'ouvrir, ou le plafond être
  // atteint, pendant l'attente dans la file.
  if (credentialsRefused) return REFUSED;
  if (breaker.isPaused()) return PAUSED;
  if (!consumeDailyBudget()) return DAILY_LIMIT_REACHED;

  // Espacement réel entre deux envois (la file garantit qu'un seul appelant est ici à la fois).
  const wait = lastSentAt + minIntervalMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastSentAt = Date.now();

  // Le délai ne court qu'à partir de l'envoi, jamais pendant l'attente dans la file.
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res: Response;
  try {
    res = await deps.fetch(`${ZEFIX_REST_COMPANY_UID_URL}/${compactUid}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: basicAuthorization(credentials),
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error", // jamais l'en-tête Authorization suivi vers une autre adresse
    });
  } catch {
    // Jamais l'erreur elle-même : elle pourrait reprendre la requête et son en-tête.
    breaker.recordFailure();
    return { available: false, reason: "Zefix REST request failed or timed out" };
  }

  if (res.status !== 200) {
    // Le corps d'une réponse non-200 n'est jamais lu : l'annuler libère la connexion.
    try {
      await res.body?.cancel();
    } catch {
      // volontairement muet : l'annulation du corps peut échouer sans conséquence.
    }
    if (res.status === 404) {
      // IDE inconnu de Zefix : la source a répondu normalement.
      breaker.recordSuccess();
      return cacheNotFound(cacheKey, deps);
    }
    if (res.status === 401 || res.status === 403) {
      // Identifiants refusés : plus aucune requête jusqu'au redémarrage (nouveaux identifiants
      // posés dans Railway = redéploiement), jamais rejoués en boucle.
      credentialsRefused = true;
      return REFUSED;
    } else if (res.status === 429) {
      breaker.recordFailure(retryAfterMs(res), true);
    } else if (res.status >= 500) {
      breaker.recordFailure();
    }
    return { available: false, reason: `Zefix REST responded with HTTP ${res.status}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      breaker.recordFailure();
      return { available: false, reason: "Zefix REST request timed out while reading the response" };
    }
    breaker.recordFailure();
    return { available: false, reason: "Zefix REST response is not valid JSON" };
  }

  // Le disjoncteur ne se referme qu'après une réponse de forme valide (relecture du 11.10.2026).
  const unexpected = (): Part<ZefixRestStatusRecord> => {
    breaker.recordFailure();
    return { available: false, reason: "unexpected Zefix REST response shape" };
  };
  if (!Array.isArray(body)) return unexpected();
  if (body.length === 0) {
    breaker.recordSuccess();
    return cacheNotFound(cacheKey, deps);
  }

  const matches: ZefixRestStatusRecord[] = [];
  let readable = 0;
  for (const raw of body) {
    const item = readItem(raw, compactUid);
    // Un élément inexploitable rejette toute la réponse, jamais mise en cache.
    if (item.kind === "fail") return unexpected();
    if (item.kind !== "skip") readable += 1;
    if (item.kind === "match") matches.push(item.record);
  }
  // Des éléments, mais aucun avec un `uid` : réponse malformée, jamais un faux « non trouvé » en cache.
  if (readable === 0) return unexpected();
  breaker.recordSuccess();
  if (matches.length === 0) return cacheNotFound(cacheKey, deps);

  // Plusieurs éléments pour le même IDE (cas non observé) : un seul statut seulement s'ils
  // concordent tous ; sinon `unknown`, jamais un choix arbitraire entre eux.
  const distinct = new Set(matches.map((m) => `${m.status}|${m.deletion_date ?? ""}`));
  const data: ZefixRestStatusRecord = distinct.size === 1 ? matches[0] : { status: "unknown", deletion_date: null };

  const result: Part<ZefixRestStatusRecord> = { available: true, retrieved_at: new Date(deps.now()).toISOString(), found: true, data };
  cache.set(cacheKey, result);
  return cache.get(cacheKey)!; // toujours la valeur figée, y compris au tout premier appel
}

function cacheNotFound(cacheKey: string, deps: LiveDeps): Part<ZefixRestStatusRecord> {
  const result: Part<ZefixRestStatusRecord> = { available: true, retrieved_at: new Date(deps.now()).toISOString(), found: false, data: null };
  cache.set(cacheKey, result, NOT_FOUND_CACHE_TTL_MS);
  return cache.get(cacheKey)!;
}
