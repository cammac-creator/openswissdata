/**
 * Lecture en direct de l'inscription au registre TVA dans le registre IDE de l'Office fédéral de
 * la statistique (service web IDE, « Public Services », opération `GetByUID`), pour la fiche de
 * vérification d'une société suisse (15.11.2026). Ni LINDAS ni Zefix ne portent cette donnée.
 *
 * Cadre, tiré de la réponse écrite de l'OFS du 13.11.2026 et de la loi qu'elle cite (LIDE,
 * RS 431.03, art. 11 et 13 ; détail : `docs/droits-des-sources.md`) :
 *  - l'accès par les Public Services est ouvert à tous, sans identifiant ;
 *  - la consultation est limitée aux requêtes individuelles sur UNE entité déterminée : ici une
 *    seule opération, `GetByUID`, seulement à la demande d'un appel de `company_check` ; jamais
 *    `Search`, jamais de lot, de préchargement, de tâche planifiée ni de canari ;
 *  - 20 requêtes par minute au plus : ici au plus une requête par `MIN_INTERVAL_MS` de temps réel
 *    (9 envois au plus dans toute fenêtre de 60 s : deux processus qui se chevauchent pendant un
 *    redéploiement en font 18 au plus, sous les 20),
 *    une seule en vol tous IDE confondus (`SerialGate`, file bornée), un plafond
 *    de `DEFAULT_DAILY_LIMIT` requêtes réellement envoyées par jour UTC, et le disjoncteur commun,
 *    ouvert DÈS le premier 5xx, 429, 401 ou 403 (le service signale un dépassement de limite par
 *    une faute SOAP, donc un 500 ; un refus peut venir d'un pare-feu placé devant lui) ;
 *  - la source est citée avec la mention demandée par l'OFS (`UID_REGISTER_MENTION`).
 *
 * Requête : POST SOAP 1.1 sur `UID_REGISTER_PUBLIC_SERVICES_URL`, action `GetByUID`, corps formé
 * des seuls neuf chiffres d'un IDE déjà validé par `parseUid` (rien d'autre n'y est interpolé).
 * Réponse 200 relevée le 15.11.2026 : `Envelope/Body/GetByUIDResponse/GetByUIDResult`, vide pour
 * un IDE inconnu, sinon un ou plusieurs `organisationType` (identification, adresse, registre IDE,
 * registre du commerce, registre TVA).
 *
 * Minimisation : de toute la réponse, seuls sont gardés (cache compris) l'inscription au registre
 * TVA, le statut de cette inscription, ses deux dates et le numéro TVA. Le nom, l'adresse et tout
 * le reste ne sont jamais conservés. Personnes morales seulement : si la forme juridique de la
 * réponse n'est pas dans la liste blanche `ADDRESS_AND_PURPOSE_FORM_CODES` (`legal-forms.ts`, la
 * même que pour l'adresse dans `check.ts`), RIEN de la TVA n'est gardé, pas même en cache : le
 * registre IDE couvre aussi des entreprises individuelles et des professions libérales.
 *
 * Coupure sans redéploiement de code : `OSD_UID_REGISTER=off` (lue À L'APPEL) rend le motif fixe
 * `UID_REGISTER_NOT_ENABLED`, aucune requête ne part et la fiche reste celle d'avant. Variable
 * absente : la lecture a lieu quand l'appelant l'a demandée (`uidRegister` dans `companyCheck`).
 *
 * `UID_REGISTER_PUBLIC_SERVICES_URL` DOIT rester identique à `getSource("bfs.uid_register").url`
 * (`etl/shared/sources/registry.ts`) ; `src/` ne peut pas importer `etl/` (voir `lindas.ts`) :
 * `tests/mcp/company-uid-register.test.ts` vérifie l'égalité.
 */

import { parseUid } from "./uid.js";
import { TtlCache } from "./cache.js";
import { ADDRESS_AND_PURPOSE_FORM_CODES } from "./legal-forms.js";
import { RequestCoalescer, retryAfterMs, SerialGate, SourceBreaker } from "./outbound-guard.js";
import type { LiveDeps, Part, UidRegisterRecord, VatEntryStatus, VatRegistration } from "./types.js";

export const UID_REGISTER_PUBLIC_SERVICES_URL = "https://www.uid-wse.admin.ch/V5.0/PublicServices.svc";

/** Mention demandée par l'OFS dans sa réponse du 13.11.2026, mot pour mot. */
export const UID_REGISTER_MENTION = "OFS, registre IDE, https://www.uid.admin.ch" as const;

/** Motif fixe quand la lecture est coupée par `OSD_UID_REGISTER=off` : `companyCheck` n'ajoute alors rien à la fiche. */
export const UID_REGISTER_NOT_ENABLED = "UID register lookup not enabled";

const SOAP_ACTION = "http://www.uid.admin.ch/xmlns/uid-wse/IPublicServices/GetByUID";
const COMPACT_UID_RE = /^CHE(\d{9})$/;
const NINE_DIGITS_RE = /^\d{9}$/;
const LEGAL_FORM_RE = /^\d{4}$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DEFAULT_TIMEOUT_MS = 6000;
const CACHE_MAX = 2000;
// 24 h au plus en mémoire, jamais sur disque : pas de copie durable de ce que le registre publie.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND_CACHE_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Plafond quotidien de requêtes réellement envoyées au service (jour UTC), succès et échecs compris. */
export const DEFAULT_DAILY_LIMIT = 500;
/** Écart minimal, en temps réel, entre deux requêtes envoyées. Pire cas dans une fenêtre de 60 s :
 *  `ceil(60000 / 7000)` = 9 envois par processus, donc 18 pour deux processus vivants en même temps
 *  (redéploiement), sous les 20 indiquées par l'OFS. Un écart de 6 667 ms ou moins en permettrait 10. */
export const MIN_INTERVAL_MS = 7000;
/** Au plus une requête en cours et ce nombre en attente ; au-delà, motif « busy » sans requête. */
const MAX_WAITING = 1;
/** Taille maximale d'une réponse lue (une réponse réelle fait environ 3 Ko). */
export const MAX_RESPONSE_CHARS = 256 * 1024;
const MAX_XML_DEPTH = 32;
const MAX_XML_NODES = 4000;
const USER_AGENT = "OpenSwissData company_check (+https://www.openswissdata.com)";

// Correspondances EXACTES de la spécification du service (interface 5.0, type de recherche
// `vatRegisterInformationSearchType`, relue le 15.11.2026) : `vatStatus` 2 = inscrite au registre
// TVA, 3 = non inscrite, 1 = inconnu (« n'existe pas dans le registre IDE ») ; `vatEntryStatus`
// 1 = active à la TVA, 2 = radiée à la TVA. Map, jamais un objet littéral : aucune propriété
// héritée ne peut passer pour un code.
const VAT_STATUS_MAP: ReadonlyMap<string, VatRegistration> = new Map([
  ["2", "registered"],
  ["3", "not_registered"],
]);
const VAT_ENTRY_STATUS_MAP: ReadonlyMap<string, VatEntryStatus> = new Map([
  ["1", "active"],
  ["2", "deleted"],
]);

// ---------------------------------------------------------------------------------------------
// Lecture XML minimale et stricte. Pas de dépendance : la réponse est un document SOAP produit
// par une machine, dont on ne lit que quelques éléments. Tout ce qui sort de ce cadre (DOCTYPE,
// entité inconnue, commentaire, section CDATA, instruction de traitement hors en-tête, balises
// mal fermées, document trop profond ou trop gros) rejette la réponse entière : jamais une
// lecture approximative.
// ---------------------------------------------------------------------------------------------

interface XmlNode {
  /** Nom local, sans préfixe d'espace de noms. */
  name: string;
  children: XmlNode[];
  text: string;
}

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

/** Décode les entités d'un texte ; `null` si l'une d'elles n'est pas reconnue. */
function decodeEntities(raw: string): string | null {
  if (!raw.includes("&")) return raw;
  let failed = false;
  const out = raw.replace(/&([^;&\s]{1,12});|&/g, (_all, body: string | undefined) => {
    if (body === undefined) {
      failed = true;
      return "";
    }
    const named = NAMED_ENTITIES.get(body);
    if (named !== undefined) return named;
    const numeric = /^#(\d{1,7})$/.exec(body) ?? /^#x([0-9a-fA-F]{1,6})$/.exec(body);
    if (numeric) {
      const code = body.startsWith("#x") ? Number.parseInt(numeric[1], 16) : Number.parseInt(numeric[1], 10);
      if (Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
    }
    failed = true;
    return "";
  });
  return failed ? null : out;
}

const localName = (qualified: string): string => qualified.slice(qualified.lastIndexOf(":") + 1);

/** Position de la fin `>` d'une balise ouverte en `start`, en respectant les guillemets ; -1 si absente. */
function tagEnd(xml: string, start: number): number {
  let quote = "";
  for (let i = start; i < xml.length; i += 1) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "<" && i > start) {
      return -1;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/** Racine du document, ou `null` si quoi que ce soit sort du cadre décrit plus haut. */
export function parseXmlStrict(xml: string): XmlNode | null {
  if (xml.length > MAX_RESPONSE_CHARS) return null;
  let pos = 0;
  if (xml.charCodeAt(0) === 0xfeff) pos = 1;
  if (xml.startsWith("<?xml", pos)) {
    const end = xml.indexOf("?>", pos);
    if (end === -1) return null;
    pos = end + 2;
  }
  let root: XmlNode | null = null;
  const stack: { node: XmlNode; qualified: string }[] = [];
  let nodes = 0;
  while (pos < xml.length) {
    const lt = xml.indexOf("<", pos);
    const rawText = lt === -1 ? xml.slice(pos) : xml.slice(pos, lt);
    if (rawText !== "") {
      if (stack.length === 0) {
        if (rawText.trim() !== "") return null;
      } else {
        const text = decodeEntities(rawText);
        if (text === null) return null;
        stack[stack.length - 1].node.text += text;
      }
    }
    if (lt === -1) break;
    // Déclarations, commentaires, CDATA et instructions de traitement : jamais attendus ici.
    if (xml.startsWith("<!", lt) || xml.startsWith("<?", lt)) return null;
    const gt = tagEnd(xml, lt);
    if (gt === -1) return null;
    const inner = xml.slice(lt + 1, gt);
    if (inner.startsWith("/")) {
      const qualified = inner.slice(1).trim();
      const open = stack.pop();
      if (!open || open.qualified !== qualified) return null;
    } else {
      const selfClosing = inner.endsWith("/");
      const body = selfClosing ? inner.slice(0, -1) : inner;
      const qualified = /^[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?/.exec(body)?.[0];
      if (!qualified) return null;
      const rest = body.slice(qualified.length);
      if (rest !== "" && !/^\s/.test(rest)) return null;
      if (root !== null && stack.length === 0) return null; // une seule racine
      nodes += 1;
      if (nodes > MAX_XML_NODES || stack.length >= MAX_XML_DEPTH) return null;
      const node: XmlNode = { name: localName(qualified), children: [], text: "" };
      if (stack.length === 0) root = node;
      else stack[stack.length - 1].node.children.push(node);
      if (!selfClosing) stack.push({ node, qualified });
    }
    pos = gt + 1;
  }
  return stack.length === 0 ? root : null;
}

const childrenNamed = (node: XmlNode, name: string): XmlNode[] => node.children.filter((c) => c.name === name);

/** L'unique enfant de ce nom ; `undefined` s'il est absent, `null` s'il y en a plusieurs (ambigu). */
function onlyChild(node: XmlNode, name: string): XmlNode | undefined | null {
  const found = childrenNamed(node, name);
  if (found.length === 0) return undefined;
  return found.length === 1 ? found[0] : null;
}

/** Texte d'un élément feuille, rogné ; `null` si l'élément porte des enfants. */
const leafText = (node: XmlNode): string | null => (node.children.length === 0 ? node.text.trim() : null);

// ---------------------------------------------------------------------------------------------
// De l'arbre XML à l'enregistrement gardé.
// ---------------------------------------------------------------------------------------------

/** `AAAA-MM-JJ` d'une date réelle du calendrier, sinon `null` (jamais une date reformatée ou devinée). */
function normalizeDate(raw: string | null): string | null {
  if (raw === null) return null;
  const m = ISO_DATE_RE.exec(raw);
  if (!m) return null;
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  return d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour ? raw : null;
}

/** Neuf chiffres d'une structure IDE (`uidOrganisationIdCategorie` = CHE + `uidOrganisationId`) ;
 *  `undefined` si la structure est absente, `null` si elle est présente mais illisible. */
function readUidStructure(node: XmlNode | undefined | null): string | undefined | null {
  if (node === undefined) return undefined;
  if (node === null) return null;
  const category = onlyChild(node, "uidOrganisationIdCategorie");
  const id = onlyChild(node, "uidOrganisationId");
  if (!category || !id) return null;
  const digits = leafText(id);
  if (leafText(category) !== "CHE" || digits === null || !NINE_DIGITS_RE.test(digits)) return null;
  return digits;
}

/** Texte de l'unique enfant feuille de ce nom, `null` s'il est absent, multiple ou non feuille. */
function childText(node: XmlNode, name: string): string | null {
  const child = onlyChild(node, name);
  return child ? leafText(child) : null;
}

type ItemResult = { kind: "match"; record: UidRegisterRecord } | { kind: "other" } | { kind: "skip" } | { kind: "fail" };

/**
 * Lit un `organisationType`, même discipline que `readItem` de `zefix-rest.ts` :
 *  - `fail` : identification présente mais IDE illisible — toute la réponse est rejetée ;
 *  - `skip` : aucune identification ni IDE — élément ignoré ;
 *  - `other` : IDE d'une autre entité — ignoré ;
 *  - `match` : entité demandée, réduite à l'enregistrement gardé.
 */
function readOrganisation(item: XmlNode, requestedDigits: string): ItemResult {
  const organisation = onlyChild(item, "organisation");
  if (organisation === null) return { kind: "fail" };
  if (organisation === undefined) return { kind: "skip" };
  const identification = onlyChild(organisation, "organisationIdentification");
  if (identification === null) return { kind: "fail" };
  if (identification === undefined) return { kind: "skip" };
  const digits = readUidStructure(onlyChild(identification, "uid"));
  if (digits === undefined) return { kind: "skip" };
  if (digits === null) return { kind: "fail" };
  if (digits !== requestedDigits) return { kind: "other" };

  // Porte des personnes : forme juridique absente, illisible ou hors liste blanche → rien de la
  // TVA n'est lu ni gardé. Une forme non reconnue n'écarte jamais une entreprise individuelle.
  const legalForm = childText(identification, "legalForm");
  if (legalForm === null || !LEGAL_FORM_RE.test(legalForm) || !ADDRESS_AND_PURPOSE_FORM_CODES.has(legalForm)) {
    return { kind: "match", record: { published: false } };
  }

  const vat = onlyChild(item, "vatRegisterInformation");
  if (vat === null) return { kind: "fail" };
  if (vat === undefined) {
    // Aucun bloc TVA dans la réponse : dit tel quel, jamais traduit en « non inscrite ».
    return { kind: "match", record: { published: true, vat_registration: "not_stated", vat_entry_status: null, vat_start_date: null, vat_end_date: null, vat_uid: null } };
  }
  const rawStatus = childText(vat, "vatStatus");
  const vat_registration: VatRegistration = rawStatus === null ? "not_stated" : (VAT_STATUS_MAP.get(rawStatus) ?? "unknown");
  const rawEntry = childText(vat, "vatEntryStatus");
  const vatUidDigits = readUidStructure(onlyChild(vat, "uidVat"));
  const vatUid = typeof vatUidDigits === "string" ? parseUid(`CHE${vatUidDigits}`) : null;
  return {
    kind: "match",
    record: {
      published: true,
      vat_registration,
      vat_entry_status: rawEntry === null ? null : (VAT_ENTRY_STATUS_MAP.get(rawEntry) ?? null),
      vat_start_date: normalizeDate(childText(vat, "vatEntryDate")),
      vat_end_date: normalizeDate(childText(vat, "vatLiquidationDate")),
      vat_uid: vatUid && vatUid.ok ? vatUid.uid : null,
    },
  };
}

type Parsed = { kind: "found"; record: UidRegisterRecord } | { kind: "not_found" } | { kind: "unexpected" };

/** Réponse SOAP complète → enregistrement, « non trouvé » ou forme inattendue. Exportée pour les tests. */
export function parseGetByUidResponse(xml: string, requestedDigits: string): Parsed {
  const root = parseXmlStrict(xml);
  if (!root || root.name !== "Envelope") return { kind: "unexpected" };
  const body = onlyChild(root, "Body");
  if (!body) return { kind: "unexpected" };
  const response = onlyChild(body, "GetByUIDResponse");
  if (!response) return { kind: "unexpected" }; // dont une faute SOAP rendue en 200
  const result = onlyChild(response, "GetByUIDResult");
  // Résultat absent ou en double : forme anormale, jamais un faux « non trouvé » gardé en cache.
  if (!result) return { kind: "unexpected" };
  // Résultat vide : IDE inconnu du registre public (relevé le 15.11.2026 : `<GetByUIDResult/>`).
  if (result.children.length === 0) return { kind: "not_found" };
  const items = childrenNamed(result, "organisationType");
  if (items.length !== result.children.length) return { kind: "unexpected" };

  const matches: UidRegisterRecord[] = [];
  let readable = 0;
  for (const item of items) {
    const read = readOrganisation(item, requestedDigits);
    if (read.kind === "fail") return { kind: "unexpected" };
    if (read.kind !== "skip") readable += 1;
    if (read.kind === "match") matches.push(read.record);
  }
  // Des éléments, mais aucun avec un IDE : réponse malformée, jamais un faux « non trouvé ».
  if (readable === 0) return { kind: "unexpected" };
  if (matches.length === 0) return { kind: "not_found" };
  // Plusieurs éléments pour le même IDE : un seul enregistrement seulement s'ils concordent tous.
  // Sinon rien n'est publié si l'un d'eux ne l'est pas, et l'inscription devient `unknown` : jamais
  // un choix arbitraire entre eux.
  const distinct = new Set(matches.map((m) => JSON.stringify(m)));
  if (distinct.size === 1) return { kind: "found", record: matches[0] };
  if (matches.some((m) => !m.published)) return { kind: "found", record: { published: false } };
  return { kind: "found", record: { published: true, vat_registration: "unknown", vat_entry_status: null, vat_start_date: null, vat_end_date: null, vat_uid: null } };
}

/** Enveloppe de la requête : seuls les neuf chiffres déjà validés y entrent. */
function getByUidEnvelope(digits: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:uid="http://www.uid.admin.ch/xmlns/uid-wse" xmlns:ech97="http://www.ech.ch/xmlns/eCH-0097/5">' +
    "<soapenv:Body><uid:GetByUID><uid:uid>" +
    "<ech97:uidOrganisationIdCategorie>CHE</ech97:uidOrganisationIdCategorie>" +
    `<ech97:uidOrganisationId>${digits}</ech97:uidOrganisationId>` +
    "</uid:uid></uid:GetByUID></soapenv:Body></soapenv:Envelope>"
  );
}

// ---------------------------------------------------------------------------------------------
// Garde-fous de charge et appel réseau (même construction que `zefix-rest.ts`).
// ---------------------------------------------------------------------------------------------

// Singletons de production. `resetUidRegister` remet tout à zéro avec une horloge de test (cache,
// disjoncteur, file, compteur quotidien) et permet d'abaisser plafond et écart en test.
let clock: () => number = () => Date.now();
let cache = new TtlCache<Part<UidRegisterRecord>>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS, now: clock });
let breaker = new SourceBreaker({ now: clock });
let gate = new SerialGate({ maxWaiting: MAX_WAITING });
let coalescer = new RequestCoalescer<Part<UidRegisterRecord>>();
let dailyLimit = DEFAULT_DAILY_LIMIT;
let budgetDay = -1;
let budgetUsed = 0;
let minIntervalMs = MIN_INTERVAL_MS;
let lastSentAt = -Infinity; // temps réel (Date.now), jamais l'horloge injectée : l'écart est une attente réelle

export function resetUidRegister(now: () => number = () => Date.now(), options: { dailyLimit?: number; minIntervalMs?: number } = {}): void {
  clock = now;
  cache = new TtlCache<Part<UidRegisterRecord>>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS, now });
  breaker = new SourceBreaker({ now });
  gate = new SerialGate({ maxWaiting: MAX_WAITING });
  coalescer = new RequestCoalescer<Part<UidRegisterRecord>>();
  dailyLimit = options.dailyLimit ?? DEFAULT_DAILY_LIMIT;
  budgetDay = -1;
  budgetUsed = 0;
  minIntervalMs = options.minIntervalMs ?? MIN_INTERVAL_MS;
  lastSentAt = -Infinity;
}

/** `false` seulement quand `OSD_UID_REGISTER` vaut `off` (casse et espaces ignorés), lue à l'appel. */
export function uidRegisterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.OSD_UID_REGISTER;
  return !(typeof raw === "string" && raw.trim().toLowerCase() === "off");
}

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
const NOT_ENABLED: Part<UidRegisterRecord> = Object.freeze({ available: false, reason: UID_REGISTER_NOT_ENABLED });
const PAUSED: Part<UidRegisterRecord> = Object.freeze({ available: false, reason: "source temporarily paused after errors" });
const DAILY_LIMIT_REACHED: Part<UidRegisterRecord> = Object.freeze({ available: false, reason: "UID register daily limit reached" });
const BUSY: Part<UidRegisterRecord> = Object.freeze({ available: false, reason: "UID register busy, try again later" });

export async function lookupUidRegister(compactUid: string, deps: LiveDeps): Promise<Part<UidRegisterRecord>> {
  const m = COMPACT_UID_RE.exec(compactUid);
  if (!m) return { available: false, reason: "uid must be the compact form CHE + 9 digits (from parseUid)" };
  if (!uidRegisterEnabled()) return NOT_ENABLED;
  const digits = m[1];

  const cached = cache.get(compactUid);
  if (cached) return cached;

  if (breaker.isPaused()) return PAUSED;
  if (!dailyBudgetLeft()) return DAILY_LIMIT_REACHED;

  // Même IDE demandé deux fois en même temps : une seule place dans la file. IDE différents : la
  // file les fait passer un par un, jamais deux requêtes en vol vers le service.
  return coalescer.run(compactUid, () => gate.run(() => fetchUidRegister(compactUid, digits, deps)) ?? Promise.resolve(BUSY));
}

async function fetchUidRegister(compactUid: string, digits: string, deps: LiveDeps): Promise<Part<UidRegisterRecord>> {
  // Revérifié une fois la place obtenue : le disjoncteur a pu s'ouvrir, ou le plafond être
  // atteint, pendant l'attente dans la file.
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
    res = await deps.fetch(UID_REGISTER_PUBLIC_SERVICES_URL, {
      method: "POST",
      headers: {
        "content-type": "text/xml; charset=utf-8",
        accept: "text/xml",
        soapaction: `"${SOAP_ACTION}"`,
        "user-agent": USER_AGENT,
      },
      body: getByUidEnvelope(digits),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    // Jamais l'erreur elle-même dans le motif.
    breaker.recordFailure();
    return { available: false, reason: "UID register request failed or timed out" };
  }

  if (res.status !== 200) {
    // Le corps d'une réponse non-200 n'est jamais lu : l'annuler libère la connexion.
    try {
      await res.body?.cancel();
    } catch {
      // volontairement muet : l'annulation du corps peut échouer sans conséquence.
    }
    // 429, 5xx, 401 ou 403 : pause immédiate. Le service signale le dépassement de sa limite par
    // une faute SOAP (500), et un refus peut venir d'un pare-feu placé devant lui ; ne jamais
    // insister, même une seule fois de plus.
    if (res.status === 429 || res.status >= 500 || res.status === 401 || res.status === 403) breaker.recordFailure(retryAfterMs(res), true);
    return { available: false, reason: `UID register responded with HTTP ${res.status}` };
  }

  const unexpected = (): Part<UidRegisterRecord> => {
    breaker.recordFailure();
    return { available: false, reason: "unexpected UID register response shape" };
  };

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_CHARS * 4) {
    try {
      await res.body?.cancel();
    } catch {
      // volontairement muet
    }
    return unexpected();
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    breaker.recordFailure();
    return {
      available: false,
      reason: name === "TimeoutError" || name === "AbortError" ? "UID register request timed out while reading the response" : "UID register response could not be read",
    };
  }

  const parsed = parseGetByUidResponse(text, digits);
  // Le disjoncteur ne se referme qu'après une réponse de forme valide.
  if (parsed.kind === "unexpected") return unexpected();
  breaker.recordSuccess();
  const retrieved_at = new Date(deps.now()).toISOString();
  if (parsed.kind === "not_found") {
    cache.set(compactUid, { available: true, retrieved_at, found: false, data: null }, NOT_FOUND_CACHE_TTL_MS);
  } else {
    cache.set(compactUid, { available: true, retrieved_at, found: true, data: parsed.record });
  }
  return cache.get(compactUid)!; // toujours la valeur figée, y compris au tout premier appel
}
