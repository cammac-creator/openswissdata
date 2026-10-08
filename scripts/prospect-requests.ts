// Demandes de licence aux distributeurs officiels de données (plan du 08.10.2026, décision de
// Claude-Alain du même jour ; spec du 07.10.2026 : « il faut de la prospection automatique de data
// avec des demandes auprès de différents distributeurs de data officiel »).
//
// La prospection hebdomadaire (`prospect-sources.ts`) écarte les jeux d'opendata.swiss dont la
// licence n'est pas ouverte. Ce script relit ces jeux-là, garde ceux d'un éditeur fédéral ou
// cantonal qui seraient utiles au moteur (CSV lisible, clé de jointure, aucune personne) et prépare
// UNE lettre par éditeur, dans sa langue, qui lui demande de les publier sous une licence ouverte
// sur opendata.swiss. Un « oui » se constate dans le catalogue public, jamais dans une lettre : le
// moteur prend alors le jeu tout seul. Une réponse qui pose des conditions va à Claude-Alain (F8).
//
// Deux commandes, aucune ne voit le secret d'administration :
//   generate --lot <fichier>                    lit CKAN, écrit le lot de lettres (jamais committé)
//   report --lot <fichier> --results <fichier>  met à jour docs/data-status/demandes.json (public)
// Le dépôt lui-même est fait par `scripts/deposit-requests.mjs`, seule étape qui reçoit le secret.
//
// Rien de ce qui sort de ce script vers un journal ou un fichier public ne contient une adresse :
// l'adresse du destinataire ne vit que dans le lot (fichier temporaire du runner) et sur le serveur.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_OUT_EXCLUSIONS,
  classifyResourceRights,
  collectSearchableText,
  detectJoinKeysFromHeader,
  detectPersonColumns,
  detectPersonMarkers,
  isCsvResource,
  isOfsPackage,
  loadExclusionBlacklist,
  pickLocalizedText,
  readCsvHeaderPartial,
  splitHeaderColumns,
  type CkanPackage,
  type CkanResource,
  type CkanText,
  type RightsCode,
  type StateRow,
} from "./prospect-sources.js";
import { LICENCE_REQUEST_PURPOSE_PREFIX, isAllowedRecipient } from "../src/lib/letters.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE = join(__dirname, "..", "docs", "data-status", "prospection-state.json");
export const DEFAULT_DEMANDES = join(__dirname, "..", "docs", "data-status", "demandes.json");
const CKAN_PACKAGE_SHOW_URL = "https://ckan.opendata.swiss/api/3/action/package_show";
const DEFAULT_USER_AGENT = "OpenSwissData prospection";
const DEFAULT_DELAY_MS = 400;
const DEFAULT_TIMEOUT_MS = 20_000;
// Tous les CSV d'un jeu sont lus (jamais un jeu lu à moitié) ; au-delà de ce nombre, le jeu est
// écarté (`trop_de_csv`) plutôt que partiellement vérifié (relecture du 08.10.2026).
const MAX_CSV_PER_DATASET = 6;

/** Motifs de l'état de prospection qui peuvent donner lieu à une demande (jamais CC-BY-SA, jamais un
 *  jeu écarté pour des personnes). */
const TARGET_MOTIFS = new Set(["licence_non_ouverte", "licence_absente"]);
/** Premier passage du plan : Confédération et cantons seulement (ni communes, ni entreprises, ni instituts). */
const TARGET_LEVELS = new Set(["confederation", "canton"]);
export const DEFAULT_MAX_ORGS = 3; // même plafond que le serveur (LICENCE_REQUEST_WEEKLY_CAP)
export const MAX_DATASETS_PER_LETTER = 12;
const MAX_TITLE_CHARS = 150;
const MAX_ORG_TITLE_CHARS = 90;
const MAX_BODY_CHARS = 7500; // le serveur refuse au-delà de 8000

export type LetterLang = "fr" | "de" | "it";
export type LicenceState = "ouverte" | "commerciale_sur_autorisation" | "non_ouverte" | "absente" | "cc_by_sa";

/** opendata.swiss porte la licence d'une ressource dans `rights` OU dans `license` (relevé le
 *  08.10.2026 : 9 jeux classés « sans licence » par la prospection avaient `license` = terms_by ou
 *  terms_open). Les deux champs sont lus. */
export interface ResourceWithLicence extends CkanResource {
  license?: string | null;
}

const OPEN_CODES: ReadonlySet<RightsCode> = new Set(["open", "by", "attribution", "public_domain"]);

/** État de la licence d'un jeu, d'après TOUTES ses ressources et les DEUX champs. Une seule mention
 *  ouverte suffit : on ne demande jamais une licence à un jeu qui en a déjà une. */
export function datasetLicenceState(resources: ResourceWithLicence[] | undefined): LicenceState {
  const codes = (resources ?? [])
    .flatMap((r) => [classifyResourceRights(r.rights), classifyResourceRights(r.license)])
    .filter((c) => c !== "absente");
  if (codes.some((c) => OPEN_CODES.has(c))) return "ouverte";
  if (codes.length === 0) return "absente";
  if (codes.includes("cc_by_sa")) return "cc_by_sa";
  if (codes.includes("ask") || codes.includes("by_ask")) return "commerciale_sur_autorisation";
  return "non_ouverte";
}

// ---------------------------------------------------------------------------------------
// Une ligne par personne, même sans nom (relevé le 08.10.2026 sur « Gemeinderatswahlen Kanton
// Luzern » : une ligne par candidat avec commune, parti, sexe, sortant/nouveau et élu — reconnaissable
// dans une petite commune, sans qu'aucune colonne de nom n'existe). Plus strict que
// `detectPersonColumns` de la prospection : un doute ici, c'est simplement pas de lettre.
// ---------------------------------------------------------------------------------------
const INDIVIDUAL_ROW_EXACT = new Set([
  "sex", "sexe", "geschlecht", "sesso", "gender", "alter", "age", "eta", "jahrgang", "geburtsjahr",
  "geburtsdatum", "datedenaissance", "anneedenaissance", "annodinascita", "gewaehlt", "gewahlt",
  "elu", "elue", "eletto", "eletta",
]);
const INDIVIDUAL_ROW_PREFIXES = ["kand", "candid"];

function normalizeColumn(c: string): string {
  return c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Colonnes qui laissent penser qu'une ligne décrit UNE personne (sexe, âge, naissance, candidature, élection). */
export function detectIndividualRowColumns(columns: readonly string[]): string[] {
  return columns.filter((c) => {
    const n = normalizeColumn(c);
    return INDIVIDUAL_ROW_EXACT.has(n) || INDIVIDUAL_ROW_PREFIXES.some((p) => n.startsWith(p));
  });
}

/** Titre d'organisation CKAN sans le préfixe « Canton: » (« Luzern: LUSTAT Statistik Luzern »). */
export function cleanOrgTitle(title: string): string {
  const m = /^[^:]{2,40}:\s+(\S.{2,})$/u.exec(title.trim());
  return m ? m[1].trim() : title.trim();
}

// ---------------------------------------------------------------------------------------
// Destinataire : adresse publiée par l'éditeur comme point de contact du jeu sur opendata.swiss,
// dans un domaine autorisé (`ALLOWED_RECIPIENT_DOMAINS`, même liste que le serveur). Une adresse
// FONCTIONNELLE est toujours préférée ; à défaut, le point de contact nominatif publié (plan :
// « de préférence »). L'adresse ne sort jamais du lot ni du serveur.
// ---------------------------------------------------------------------------------------
const FUNCTIONAL_WORDS = new Set([
  "info", "infos", "information", "data", "daten", "donnees", "dati", "open", "opendata", "ogd",
  "statistik", "statistique", "statistica", "stat", "stats", "ustat", "lustat",
  "geo", "gis", "geoinformation", "geodaten", "geodata", "geoportal", "geodienste", "sitg",
  "kontakt", "contact", "contatto", "sekretariat", "secretariat", "segreteria", "office", "service",
  "services", "support", "helpdesk", "admin", "amt", "kanzlei", "staatskanzlei", "chancellerie",
  "cancelleria", "mail", "post", "webmaster", "web", "portal", "team", "zentrale", "fachstelle",
  "dienst", "dienste", "publikationen", "publications",
]);

/** Fonctionnelle seulement si CHAQUE morceau de la partie locale est un mot de service connu ;
 *  tout le reste (prénom.nom, initiales, mot inconnu) est traité comme nominatif. */
export function classifyAddress(address: string): "fonctionnelle" | "nominative" {
  const local = address.slice(0, address.lastIndexOf("@")).toLowerCase();
  const tokens = local.split(/[._+-]+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => FUNCTIONAL_WORDS.has(t)) ? "fonctionnelle" : "nominative";
}

/** Adresse fonctionnelle la plus fréquente, sinon nominative la plus fréquente ; égalité → ordre alphabétique. */
export function chooseRecipient(addresses: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const a of addresses) counts.set(a, (counts.get(a) ?? 0) + 1);
  const rank = (kind: "fonctionnelle" | "nominative") =>
    [...counts.entries()]
      .filter(([a]) => classifyAddress(a) === kind)
      .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
      .map(([a]) => a);
  return rank("fonctionnelle")[0] ?? rank("nominative")[0] ?? null;
}

/** Langue officielle (majoritaire pour les cantons bilingues) par domaine cantonal autorisé. Un test
 *  exige une entrée pour chaque domaine cantonal de `ALLOWED_RECIPIENT_DOMAINS`. */
export const CANTONAL_LANGUAGES: Readonly<Record<string, LetterLang>> = Object.freeze({
  "ag.ch": "de", "be.ch": "de", "bl.ch": "de", "bs.ch": "de", "fr.ch": "fr", "ge.ch": "fr",
  "gl.ch": "de", "gr.ch": "de", "jura.ch": "fr", "lu.ch": "de", "lustat.ch": "de", "sg.ch": "de",
  "sh.ch": "de", "so.ch": "de", "sz.ch": "de", "tg.ch": "de", "ti.ch": "it", "ur.ch": "de",
  "vs.ch": "fr", "zg.ch": "de", "zh.ch": "de",
});

/** Destinataire lié au niveau de l'éditeur (relecture de sécurité du 08.10.2026) : admin.ch pour la
 *  Confédération, un domaine cantonal autorisé pour un canton — jamais l'un pour l'autre. */
export function recipientMatchesLevel(level: string, address: string): boolean {
  const host = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
  const within = (d: string) => host === d || host.endsWith(`.${d}`);
  if (level === "confederation") return within("admin.ch");
  if (level === "canton") return Object.keys(CANTONAL_LANGUAGES).some(within);
  return false;
}

/** Offices déjà en correspondance avec OpenSwissData sur leurs propres données (lettres du 30.09 et
 *  du 06.10 : OFS, SECO, OFRC, FINMA) : jamais sollicités par cette tâche, pour ne pas mêler les sujets. */
const EN_CORRESPONDANCE = ["bfs.admin.ch", "seco.admin.ch", "bj.admin.ch", "finma.ch"];

function inCorrespondence(address: string): boolean {
  const host = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
  return EN_CORRESPONDANCE.some((d) => host === d || host.endsWith(`.${d}`));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Français pour la Confédération (comme les lettres du 06.10) ; langue du canton sinon ; `null`
 *  si le domaine du destinataire n'est pas un domaine cantonal connu (le jeu est alors écarté). */
export function letterLanguage(level: string, recipient: string): LetterLang | null {
  if (level === "confederation") return "fr";
  const host = recipient.slice(recipient.lastIndexOf("@") + 1).toLowerCase();
  const root = Object.keys(CANTONAL_LANGUAGES)
    .filter((d) => host === d || host.endsWith(`.${d}`))
    .sort((a, b) => b.length - a.length)[0];
  return root ? CANTONAL_LANGUAGES[root] : null;
}

// ---------------------------------------------------------------------------------------
// Lettre. Identité et signature reprises des lettres du 06.10.2026 (`lettres-2026-10-06.json`),
// rien d'inventé : OpenSwissData est un service en nom propre, son API et son MCP sont gratuits, il
// vend aussi des fichiers (FINMA, TARES) — c'est précisément l'usage commercial que vise la licence.
// ---------------------------------------------------------------------------------------
export interface RequestOrg { name: string; title: CkanText; level: string }
export interface RequestDataset { id: string; title: CkanText; licenceState: Exclude<LicenceState, "ouverte" | "cc_by_sa">; joinKeys: string[] }
export interface RequestLetter {
  organisation: string;
  to: string;
  subject: string;
  body: string;
  purpose: string;
  dataset_ids: string[];
  lang: LetterLang;
}
export interface RequestLot { generated_on: string; letters: RequestLetter[] }

const LICENCE_LABELS: Record<LetterLang, Record<RequestDataset["licenceState"], string>> = {
  fr: {
    commerciale_sur_autorisation: "licence actuelle : utilisation commerciale sur autorisation",
    non_ouverte: "licence actuelle : non ouverte",
    absente: "aucune licence indiquée",
  },
  de: {
    commerciale_sur_autorisation: "aktuelle Lizenz: kommerzielle Nutzung nur mit Bewilligung",
    non_ouverte: "aktuelle Lizenz: nicht offen",
    absente: "keine Lizenz angegeben",
  },
  it: {
    commerciale_sur_autorisation: "licenza attuale: uso commerciale solo con autorizzazione",
    non_ouverte: "licenza attuale: non aperta",
    absente: "nessuna licenza indicata",
  },
};

const SIGNATURE = "Claude-Alain Martin\nOpenSwissData\ncontact@openswissdata.com";

function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
}

function localized(value: CkanText, lang: LetterLang): string {
  return pickLocalizedText(value, [lang, "fr", "de", "it", "en"]);
}

function subjectFor(lang: LetterLang, orgTitle: string): string {
  if (lang === "de") return `Anfrage für eine offene Lizenz auf opendata.swiss (${orgTitle})`;
  if (lang === "it") return `Richiesta di una licenza aperta su opendata.swiss (${orgTitle})`;
  return `Demande de licence ouverte sur opendata.swiss (${orgTitle})`;
}

function bodyFor(lang: LetterLang, orgTitle: string, items: string, single: boolean): string {
  if (lang === "de") {
    return [
      "Sehr geehrte Damen und Herren",
      "Ich betreibe in eigenem Namen OpenSwissData (www.openswissdata.com), einen Schweizer Dienst, der öffentliche Daten zusammenführt, kombiniert und mit Quellenangabe über eine kostenlose Schnittstelle für Software (API und MCP-Protokoll) bereitstellt. OpenSwissData verkauft zudem aufbereitete Datendateien, zum Beispiel aus den Registern der FINMA oder dem Zolltarif; die Tätigkeit ist also teilweise kommerziell.",
      single
        ? "Sie veröffentlichen auf opendata.swiss den folgenden Datensatz, den wir gerne in diesen Dienst aufnehmen würden:"
        : "Sie veröffentlichen auf opendata.swiss die folgenden Datensätze, die wir gerne in diesen Dienst aufnehmen würden:",
      items,
      `Könnten Sie ${single ? "diesen Datensatz" : "diese Datensätze"} auf opendata.swiss unter einer Lizenz veröffentlichen, die auch die kommerzielle Nutzung erlaubt, zum Beispiel «terms_by» (freie Nutzung, Quellenangabe ist Pflicht) oder «terms_open» (freie Nutzung)? Wir prüfen den Katalog jede Woche: Sobald die Lizenz dort geändert ist, können wir die Daten mit ${orgTitle} als Quelle und dem Datum des Auszugs übernehmen. Bis dahin übernehmen wir sie nicht.`,
      "Falls eine solche Veröffentlichung nicht möglich ist, genügt uns eine kurze Antwort.",
      "Wir würden die Integrität der Daten und die Quellenangabe respektieren und keine Verbindung zu Ihrer Organisation behaupten.",
      "Freundliche Grüsse",
      SIGNATURE,
    ].join("\n\n");
  }
  if (lang === "it") {
    return [
      "Gentili signore e signori,",
      "gestisco a mio nome OpenSwissData (www.openswissdata.com), un servizio svizzero che raccoglie dati pubblici, li combina e li mette a disposizione, con l'indicazione delle fonti, tramite un'interfaccia gratuita per software (API e protocollo MCP). OpenSwissData vende anche file di dati elaborati, ad esempio a partire dai registri della FINMA o dalla tariffa doganale: la sua attività è quindi in parte commerciale.",
      single
        ? "Pubblicate su opendata.swiss il seguente set di dati, che vorremmo riprendere in questo servizio:"
        : "Pubblicate su opendata.swiss i seguenti set di dati, che vorremmo riprendere in questo servizio:",
      items,
      `Potreste ${single ? "pubblicarlo" : "pubblicarli"} su opendata.swiss con una licenza che consenta anche l'uso commerciale, ad esempio «terms_by» (libero utilizzo, obbligo di indicare la fonte) o «terms_open» (libero utilizzo)? Consultiamo il catalogo ogni settimana: non appena la licenza sarà modificata, potremo riprendere questi dati citando ${orgTitle} come fonte, con la data dell'estratto. Fino ad allora non li riprendiamo.`,
      "Se una tale pubblicazione non è possibile, ci basta una breve risposta.",
      "Rispetteremmo l'integrità dei dati e l'indicazione della fonte, senza dichiarare alcun legame con la vostra organizzazione.",
      "Cordiali saluti",
      SIGNATURE,
    ].join("\n\n");
  }
  return [
    "Madame, Monsieur,",
    "J'exploite en nom propre OpenSwissData (www.openswissdata.com), un service suisse qui rassemble des données publiques, les combine et les met à disposition, avec l'indication de leurs sources, par une interface gratuite pour logiciels (API et protocole MCP). OpenSwissData vend aussi des fichiers de données préparés, par exemple à partir des registres de la FINMA ou du tarif douanier : son activité est donc en partie commerciale.",
    single
      ? "Vous publiez sur opendata.swiss le jeu de données suivant, que nous aimerions reprendre dans ce service :"
      : "Vous publiez sur opendata.swiss les jeux de données suivants, que nous aimerions reprendre dans ce service :",
    items,
    `Pourriez-vous ${single ? "le" : "les"} publier sur opendata.swiss sous une licence qui autorise aussi l'utilisation commerciale, par exemple « terms_by » (utilisation libre, source à indiquer) ou « terms_open » (utilisation libre) ? Nous consultons le catalogue chaque semaine : dès que la licence y sera modifiée, nous pourrons reprendre ces données en citant ${orgTitle} comme source, avec la date de l'extrait. D'ici là, nous ne les reprenons pas.`,
    "Si une telle publication n'est pas possible, une courte réponse nous suffit.",
    "Nous respecterions l'intégrité des données et l'indication de la source, sans laisser entendre un lien avec votre organisation.",
    "Meilleures salutations,",
    SIGNATURE,
  ].join("\n\n");
}

/** Une lettre par éditeur, au plus `MAX_DATASETS_PER_LETTER` jeux, liens dans la langue de la lettre. */
export function buildLetter(org: RequestOrg, datasets: readonly RequestDataset[], recipient: string, lang: LetterLang): RequestLetter {
  const kept = datasets.slice(0, MAX_DATASETS_PER_LETTER);
  for (const d of kept) if (!UUID_RE.test(d.id)) throw new Error(`identifiant de jeu qui n'est pas un UUID (${org.name})`);
  const orgTitle = clip(cleanOrgTitle(localized(org.title, lang) || org.name), MAX_ORG_TITLE_CHARS);
  const items = kept
    .map((d) => {
      const title = clip(localized(d.title, lang) || "(titre non fourni par le catalogue)", MAX_TITLE_CHARS);
      return `- ${title} (${LICENCE_LABELS[lang][d.licenceState]})\n  https://opendata.swiss/${lang}/dataset/${d.id}`;
    })
    .join("\n");
  const body = bodyFor(lang, orgTitle, items, kept.length === 1);
  if (body.length > MAX_BODY_CHARS) throw new Error(`lettre trop longue pour ${org.name} (${body.length} caractères)`);
  return {
    organisation: org.name,
    to: recipient,
    subject: subjectFor(lang, orgTitle),
    body,
    purpose: `${LICENCE_REQUEST_PURPOSE_PREFIX}${org.name}`,
    dataset_ids: kept.map((d) => d.id),
    lang,
  };
}

// ---------------------------------------------------------------------------------------
// Lecture du catalogue (une tentative par appel, jamais de retentative : budget connu).
// ---------------------------------------------------------------------------------------
interface FetchOptions {
  fetchImpl: typeof fetch;
  sleepImpl: (ms: number) => Promise<void>;
  delayMs: number;
  timeoutMs: number;
  userAgent: string;
}

type CkanPackageWithContacts = CkanPackage & { contact_points?: unknown; resources?: ResourceWithLicence[] };

async function fetchPackage(id: string, opts: FetchOptions): Promise<CkanPackageWithContacts | null> {
  try {
    const res = await opts.fetchImpl(`${CKAN_PACKAGE_SHOW_URL}?id=${encodeURIComponent(id)}`, {
      headers: { "User-Agent": opts.userAgent },
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: CkanPackageWithContacts };
    return body.result && typeof body.result === "object" ? body.result : null;
  } catch {
    return null;
  }
}

/** Adresses des points de contact (liste d'objets, ou chaîne JSON selon les jeux). */
function contactEmails(pkg: CkanPackageWithContacts): string[] {
  let raw: unknown = pkg.contact_points;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((cp) => (cp && typeof cp === "object" ? (cp as { email?: unknown }).email : null))
    .filter((e): e is string => typeof e === "string")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export interface GenerateOptions extends FetchOptions {
  stateRows: ReadonlyArray<StateRow>;
  exclusions: ReadonlySet<string>;
  alreadyRequested: ReadonlySet<string>; // organisations déjà présentes dans demandes.json
  maxOrgs: number;
}

export interface GenerateResult {
  letters: RequestLetter[];
  skipped: Record<string, number>;
  examined: number;
  readFailures: number;
  summary: { examined: number; letters: Array<{ organisation: string; lang: LetterLang; datasets: number; adresse: "fonctionnelle" | "nominative" }>; skipped: Record<string, number> };
}

interface Eligible { org: RequestOrg; dataset: RequestDataset; recipients: string[] }

const LEVEL_RANK: Record<string, number> = { confederation: 0, canton: 1 };

/** Relit chaque jeu ciblé et ne garde que les cibles sûres. Chaque écart est compté par motif ; un
 *  doute (catalogue illisible, en-tête illisible, personne possible) n'est jamais une lettre. */
export async function generateRequests(opts: GenerateOptions): Promise<GenerateResult> {
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  const eligible: Eligible[] = [];
  let examined = 0;
  let readFailures = 0;

  for (const [id, , motif] of opts.stateRows) {
    if (!TARGET_MOTIFS.has(motif)) continue;
    if (opts.exclusions.has(id)) { skip("liste_noire"); continue; }
    examined++;
    await opts.sleepImpl(opts.delayMs);
    const pkg = await fetchPackage(id, opts);
    if (!pkg) { readFailures++; skip("catalogue_illisible"); continue; }
    if (typeof pkg.id !== "string" || !UUID_RE.test(pkg.id)) { skip("identifiant_invalide"); continue; }
    const level = pkg.organization?.political_level ?? "";
    const orgName = pkg.organization?.name ?? "";
    if (!TARGET_LEVELS.has(level) || !orgName) { skip("niveau"); continue; }
    if (isOfsPackage(pkg)) { skip("ofs"); continue; }
    if (opts.alreadyRequested.has(orgName)) { skip("deja_demande"); continue; }
    const licenceState = datasetLicenceState(pkg.resources);
    if (licenceState === "ouverte") { skip("deja_ouverte"); continue; }
    if (licenceState === "cc_by_sa") { skip("cc_by_sa"); continue; }
    if (detectPersonMarkers(collectSearchableText(pkg)).length > 0) { skip("personnes"); continue; }
    const allowed = contactEmails(pkg).filter((a) => isAllowedRecipient(a) && recipientMatchesLevel(level, a));
    if (allowed.length === 0) { skip("destinataire_hors_liste"); continue; }
    const recipients = allowed.filter((a) => !inCorrespondence(a));
    if (recipients.length === 0) { skip("correspondance_en_cours"); continue; }

    // Doute = pas de lettre (plan, point bloquant 1) : CHAQUE CSV du jeu doit être lu et propre. Un
    // en-tête illisible, une ressource sans adresse ou un CSV au-delà de la limite écartent le jeu.
    const csv = (pkg.resources ?? []).filter(isCsvResource);
    if (csv.length === 0) { skip("sans_entete"); continue; }
    if (csv.length > MAX_CSV_PER_DATASET) { skip("trop_de_csv"); continue; }
    const keys = new Set<string>();
    let unreadable = false;
    let personColumn = false;
    let individualRows = false;
    for (const r of csv) {
      if (!r.url) { unreadable = true; break; }
      await opts.sleepImpl(opts.delayMs);
      const header = await readCsvHeaderPartial(opts.fetchImpl, r.url, opts.userAgent, opts.timeoutMs);
      if (!header) { unreadable = true; break; }
      const columns = splitHeaderColumns(header);
      if (detectPersonColumns(columns).length > 0) { personColumn = true; break; }
      if (detectIndividualRowColumns(columns).length > 0) { individualRows = true; break; }
      for (const k of detectJoinKeysFromHeader(header)) keys.add(k);
    }
    if (personColumn) { skip("colonne_personne"); continue; }
    if (individualRows) { skip("ligne_par_personne_possible"); continue; }
    if (unreadable) { skip("sans_entete"); continue; }
    if (keys.size === 0) { skip("sans_cle"); continue; }

    eligible.push({
      org: { name: orgName, title: pkg.organization?.title ?? orgName, level },
      dataset: { id: pkg.id, title: pkg.title ?? null, licenceState, joinKeys: [...keys].sort() },
      recipients,
    });
  }

  const byOrg = new Map<string, { org: RequestOrg; datasets: RequestDataset[]; recipients: string[] }>();
  for (const e of eligible) {
    const group = byOrg.get(e.org.name) ?? { org: e.org, datasets: [], recipients: [] };
    group.datasets.push(e.dataset);
    group.recipients.push(...e.recipients);
    byOrg.set(e.org.name, group);
  }
  const groups = [...byOrg.values()].sort(
    (a, b) =>
      (LEVEL_RANK[a.org.level] ?? 9) - (LEVEL_RANK[b.org.level] ?? 9) ||
      b.datasets.length - a.datasets.length ||
      (a.org.name < b.org.name ? -1 : a.org.name > b.org.name ? 1 : 0),
  );

  const letters: RequestLetter[] = [];
  for (const g of groups) {
    const recipient = chooseRecipient(g.recipients);
    const lang = recipient ? letterLanguage(g.org.level, recipient) : null;
    if (!recipient || !lang) { skip("langue_inconnue"); continue; }
    if (letters.length >= opts.maxOrgs) { skip("plafond_editeurs"); continue; }
    const datasets = [...g.datasets].sort(
      (a, b) => b.joinKeys.length - a.joinKeys.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    letters.push(buildLetter(g.org, datasets, recipient, lang));
  }

  return {
    letters,
    skipped,
    examined,
    readFailures,
    summary: {
      examined,
      letters: letters.map((l) => ({ organisation: l.organisation, lang: l.lang, datasets: l.dataset_ids.length, adresse: classifyAddress(l.to) })),
      skipped,
    },
  };
}

// ---------------------------------------------------------------------------------------
// Rapport public `docs/data-status/demandes.json` : UUID du jeu, éditeur, date de dépôt, statut.
// Le statut vient de NOS actes (lettre en file, envoyée, en échec, annulée) ou du catalogue public
// (licence devenue ouverte) — jamais d'un message reçu (aucun « réponse reçue », aucun « refus »).
// ---------------------------------------------------------------------------------------
export type DemandeStatut = "deposee" | "envoyee" | "echec_envoi" | "annulee" | "licence_ouverte_constatee";
export interface DemandesEntry { id: string; organisation: string; date: string; statut: DemandeStatut }
export interface DemandesReport { generated_on: string | null; entries: DemandesEntry[] }
export type DepositOutcome = "deposee" | "deja_deposee" | "destinataire_recent" | "plafond" | "refusee" | "erreur";
export interface DepositResults {
  deposits: Array<{ organisation: string; purpose: string; outcome: DepositOutcome; http_status: number | null }>;
  statuses: Array<{ purpose: string; status: string; created_at: number }>;
}

const SERVER_STATUS_TO_STATUT: Record<string, DemandeStatut> = {
  queued: "deposee",
  sending: "deposee",
  sent: "envoyee",
  failed: "echec_envoi",
  cancelled: "annulee",
};

export function buildDemandesReport(
  existing: DemandesReport | null,
  lot: RequestLot,
  results: DepositResults | null,
  openIds: ReadonlySet<string>,
  today: string,
): DemandesReport {
  const entries = new Map<string, DemandesEntry>();
  for (const e of existing?.entries ?? []) entries.set(e.id, { ...e });

  for (const d of results?.deposits ?? []) {
    if (d.outcome !== "deposee" && d.outcome !== "deja_deposee") continue;
    const letter = lot.letters.find((l) => l.purpose === d.purpose);
    if (!letter) continue;
    for (const id of letter.dataset_ids) {
      if (!entries.has(id)) entries.set(id, { id, organisation: letter.organisation, date: today, statut: "deposee" });
    }
  }

  const latest = new Map<string, { status: string; created_at: number }>();
  for (const s of results?.statuses ?? []) {
    const prev = latest.get(s.purpose);
    if (!prev || s.created_at > prev.created_at) latest.set(s.purpose, s);
  }
  for (const e of entries.values()) {
    if (e.statut === "licence_ouverte_constatee") continue;
    if (openIds.has(e.id)) { e.statut = "licence_ouverte_constatee"; continue; }
    const server = latest.get(`${LICENCE_REQUEST_PURPOSE_PREFIX}${e.organisation}`);
    const statut = server ? SERVER_STATUS_TO_STATUT[server.status] : undefined;
    if (statut) e.statut = statut;
  }

  return {
    generated_on: today,
    entries: [...entries.values()].sort((a, b) =>
      a.organisation < b.organisation ? -1 : a.organisation > b.organisation ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
  };
}

/** Jeux dont la licence est devenue ouverte dans le catalogue public. Un échec de lecture ne conclut rien. */
export async function recheckOpenLicences(ids: readonly string[], opts: FetchOptions): Promise<Set<string>> {
  const open = new Set<string>();
  for (const id of ids) {
    await opts.sleepImpl(opts.delayMs);
    const pkg = await fetchPackage(id, opts);
    if (pkg && datasetLicenceState(pkg.resources) === "ouverte") open.add(id);
  }
  return open;
}

// ---------------------------------------------------------------------------------------
// Ligne de commande.
// ---------------------------------------------------------------------------------------
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function loadDemandes(path: string): DemandesReport | null {
  return existsSync(path) ? readJson<DemandesReport>(path) : null;
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const realFetchOptions = (): FetchOptions => ({
  fetchImpl: fetch,
  sleepImpl: (ms) => new Promise((r) => setTimeout(r, ms)),
  delayMs: DEFAULT_DELAY_MS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  userAgent: DEFAULT_USER_AGENT,
});

async function main(args: string[]): Promise<number> {
  const command = args[0];
  const lotPath = argValue(args, "--lot");
  if (!lotPath || (command !== "generate" && command !== "report")) {
    console.error("usage : prospect-requests.ts generate --lot <fichier> | report --lot <fichier> --results <fichier>");
    return 1;
  }
  const today = new Date().toISOString().slice(0, 10);

  if (command === "generate") {
    const stateRows = readJson<StateRow[]>(DEFAULT_STATE);
    const exclusions = new Set(loadExclusionBlacklist(DEFAULT_OUT_EXCLUSIONS).keys());
    const alreadyRequested = new Set((loadDemandes(DEFAULT_DEMANDES)?.entries ?? []).map((e) => e.organisation));
    const out = await generateRequests({ ...realFetchOptions(), stateRows, exclusions, alreadyRequested, maxOrgs: DEFAULT_MAX_ORGS });
    const lot: RequestLot = { generated_on: today, letters: out.letters };
    writeFileSync(lotPath, `${JSON.stringify(lot, null, 1)}\n`);
    // Journal public (dépôt GitHub public) : comptes et éditeurs seulement, jamais une adresse.
    console.log(JSON.stringify(out.summary));
    if (out.examined > 0 && out.readFailures === out.examined) {
      console.error("catalogue illisible : aucun jeu n'a pu être relu");
      return 3;
    }
    return 0;
  }

  const resultsPath = argValue(args, "--results");
  if (!resultsPath) {
    console.error("report : --results manquant");
    return 1;
  }
  const lot = readJson<RequestLot>(lotPath);
  const results = readJson<DepositResults>(resultsPath);
  const existing = loadDemandes(DEFAULT_DEMANDES);
  const toRecheck = new Set<string>();
  for (const e of existing?.entries ?? []) if (e.statut !== "licence_ouverte_constatee") toRecheck.add(e.id);
  for (const l of lot.letters) for (const id of l.dataset_ids) toRecheck.add(id);
  const openIds = await recheckOpenLicences([...toRecheck], realFetchOptions());
  const report = buildDemandesReport(existing, lot, results, openIds, today);
  writeFileSync(DEFAULT_DEMANDES, `${JSON.stringify(report, null, 1)}\n`);
  const counts: Record<string, number> = {};
  for (const e of report.entries) counts[e.statut] = (counts[e.statut] ?? 0) + 1;
  console.log(JSON.stringify({ entries: report.entries.length, statuts: counts }));
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
