/**
 * Faillites (KK), concordats (NA), appels aux créanciers suite à une liquidation (LS) et autres
 * appels aux créanciers du droit des sociétés (SR) : lecture du détail XML et classement
 * « SOCIÉTÉS SEULEMENT » (décision de Claude-Alain du 24.10.2026, qui étend la décision d3 du
 * 16.10.2026 : « des totaux, et les événements des sociétés »).
 *
 * Étage lu : source (détail XML, en mémoire seulement). Étage écrit : rien ; ce module rend une
 * ligne de société ou un simple total, le reste du document est jeté avec la chaîne.
 *
 * Une LIGNE n'est possible que si l'avis vise UNE seule société identifiée dans la structure :
 *   - schéma reconnu (espace de noms de la racine = celui de la sous-rubrique, version connue) ;
 *   - aucune personne physique (aucun élément `person`, `prename`, `dateOfBirth`, `dateOfDeath`
 *     où que ce soit sous `content`, aucun débiteur de type « person ») ;
 *   - aucune succession (`addition` = `legacy` ou `refusedLegacy`), aucun autre avenant ;
 *   - exactement un bloc société, à un chemin connu, et aucun autre élément `company` ;
 *   - IDE valide (`parseUid`), `noUID` jamais vrai ;
 *   - forme juridique LUE dans le bloc et dans la liste blanche de HR (`legal-forms.ts`, sans
 *     l'élargir) ; une forme absente n'est jamais déduite (ni de l'intitulé, ni du nom) ;
 *   - un canton connu.
 * Tout le reste (personne, entreprise individuelle, succession, sans IDE, sans forme, plusieurs
 * parties, cas ambigu, schéma inconnu) : TOTAUX SEULEMENT, comptes anonymes par jour,
 * sous-rubrique, canton et forme ; jamais un nom, un IDE, une adresse ni une date de naissance.
 *
 * Champs d'une ligne : ceux de HR (identifiant technique de l'avis, IDE, sous-rubrique, date de
 * publication, commune OFS, canton, forme juridique, jour de suppression, revérification), plus au
 * plus les DATES de la procédure listées dans `subrubrics.ts` (balises propres, une occurrence).
 * Jamais un texte libre, ni le nom d'un liquidateur, d'un commissaire ou d'un office.
 *
 * Commune : ces schémas n'ont pas de siège ; le NPA et le lieu de l'adresse de la société sont lus
 * en mémoire pour un rapprochement exact (`communes.ts`), jamais gardés. Une adresse répétée, ou une
 * commune d'un autre canton que celui du bloc, laisse la commune vide.
 */
import { parseUid } from "../../src/mcp/company/uid.js";
import { SWISS_CANTONS, type PostalResolver, type ResolvedCommune } from "./communes.js";
import {
  ESTATE_TOTALS_CODE, PERSON_TOTALS_CODE, ROW_STORABLE_LEGAL_FORMS, SOLE_PROPRIETORSHIP, totalsLegalForm, UNKNOWN_LEGAL_FORM,
} from "./legal-forms.js";
import type { ListEntry } from "./list.js";
import { deleteOn, isDeletionDue, isValidDay, type FoscEventRow, type Tally } from "./state.js";
import type { InsolvencySpec } from "./subrubrics.js";
import { readIdAndTestImport, scanDetail, type DetailProfile } from "./xml.js";

/** Versions du schéma d'export relues (24.10.2026). Une autre version : avis en totaux seulement. */
export const KNOWN_SCHEMA_VERSIONS: ReadonlySet<string> = new Set(["1.26"]);

/** Canton des totaux quand il n'est pas connu (même code que HR). */
export const UNKNOWN_CANTON = "inconnu";

const CONTENT = "publication/content";
const BLOCK_FIELDS = ["uid", "legalForm", "canton", "address/swissZipCode", "address/town"] as const;
/** Éléments qui signalent une personne physique, où qu'ils soient sous `content`. */
const PERSON_MARKERS = ["person", "prename", "dateOfBirth", "dateOfDeath"] as const;

export interface InsolvencyCompany {
  uid: string | null;
  legalForm: string | null;
  canton: string | null;
  swissZipCode: string | null;
  town: string | null;
  /** Champs vus plus d'une fois dans ce bloc (par exemple deux adresses). */
  repeated: string[];
}

export interface InsolvencyDetail {
  id: string | null;
  testImport: boolean;
  /** Espace de noms de la racine et version du schéma reconnus. */
  schemaKnown: boolean;
  companies: InsolvencyCompany[];
  /** Éléments `company` partout sous `content` (doit égaler le nombre de blocs reconnus). */
  companyElements: number;
  personMarkers: number;
  additions: string[];
  additionElements: number;
  debtorTypes: string[];
  noUid: string[];
  dates: Record<string, string[]>;
}

const profiles = new Map<string, DetailProfile>();

function profileFor(spec: InsolvencySpec): DetailProfile {
  const cached = profiles.get(spec.code);
  if (cached) return cached;
  const scalars: Record<string, string> = {
    "publication/meta/id": "id",
    [`${CONTENT}/testImport`]: "testImport",
    [`${CONTENT}/addition`]: "addition",
    [`${CONTENT}/debtor/selectType`]: "debtorType",
  };
  for (const p of spec.companyPaths) scalars[`${CONTENT}/${p.replace(/\/company$/, "/noUID")}`] = "noUID";
  for (const tag of spec.dates) scalars[`${CONTENT}/${tag}`] = `date:${tag}`;
  const profile: DetailProfile = {
    blocks: Object.fromEntries(spec.companyPaths.map((p) => [`${CONTENT}/${p}`, "party"])),
    blockFields: BLOCK_FIELDS,
    scalars,
    countUnder: { prefix: CONTENT, names: ["company", "addition", ...PERSON_MARKERS] },
  };
  profiles.set(spec.code, profile);
  return profile;
}

/** Schéma reconnu : `<CODE>:publication`, espace de noms `https://shab.ch/shab/<CODE>-export`, version connue. */
function schemaKnown(code: string, rootName: string | null, namespaces: Record<string, string>, schemaLocation: string | null): boolean {
  const expectedNs = `https://shab.ch/shab/${code}-export`;
  if (rootName !== `${code}:publication` || namespaces[`xmlns:${code}`] !== expectedNs) return false;
  const parts = (schemaLocation ?? "").trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== expectedNs) return false;
  const m = /^https:\/\/(?:www\.)?(?:amtsblattportal|shab)\.ch\/api\/v1\/schemas\/shab\/(\d+\.\d+)\/([A-Z]{2}\d{2})-export\.xsd$/.exec(parts[1]);
  return m !== null && m[2] === code && KNOWN_SCHEMA_VERSIONS.has(m[1]);
}

/** Lecture en mémoire d'un avis de ces rubriques. Une erreur de structure lève une `FoscXmlError`. */
export function parseInsolvencyDetail(xml: string, spec: InsolvencySpec): InsolvencyDetail {
  const scanned = scanDetail(xml, profileFor(spec));
  const { id, testImport } = readIdAndTestImport(scanned);
  const dates: Record<string, string[]> = {};
  for (const tag of spec.dates) {
    const v = scanned.scalars[`date:${tag}`];
    if (v) dates[tag] = v;
  }
  const count = (name: string) => scanned.counts[name] ?? 0;
  return {
    id,
    testImport,
    schemaKnown: schemaKnown(spec.code, scanned.rootName, scanned.rootNamespaces, scanned.rootSchemaLocation),
    companies: scanned.blocks.map((b) => ({
      uid: b.fields.uid ?? null,
      legalForm: b.fields.legalForm ?? null,
      canton: b.fields.canton ?? null,
      swissZipCode: b.fields["address/swissZipCode"] ?? null,
      town: b.fields["address/town"] ?? null,
      repeated: b.repeated,
    })),
    companyElements: count("company"),
    personMarkers: PERSON_MARKERS.reduce((s, m) => s + count(m), 0),
    additions: scanned.scalars.addition ?? [],
    additionElements: count("addition"),
    debtorTypes: scanned.scalars.debtorType ?? [],
    noUid: scanned.scalars.noUID ?? [],
    dates,
  };
}

/** Raison du classement, comptée dans le rapport du passage (des nombres seulement). */
export type InsolvencyOutcome =
  | "row" | "person" | "estate" | "sole_proprietorship" | "no_legal_form" | "no_uid" | "other_form"
  | "multiple_parties" | "no_party" | "ambiguous" | "unknown_schema" | "no_canton" | "expiring";

export type InsolvencyClassified =
  | { kind: "row"; outcome: "row"; row: FoscEventRow; tally: Omit<Tally, "count">; communeResolved: boolean }
  | { kind: "totals"; outcome: Exclude<InsolvencyOutcome, "row">; tally: Omit<Tally, "count"> };

const validCanton = (c: string | null | undefined): string | null => {
  const v = c?.trim() ?? "";
  return SWISS_CANTONS.has(v) ? v : null;
};

/**
 * Décide ce qu'un avis devient. L'ordre des contrôles va du plus protecteur au plus technique :
 * une personne ou une succession est écartée avant même de regarder la société.
 */
export function classifyInsolvencyAvis(
  entry: ListEntry, detail: InsolvencyDetail, spec: InsolvencySpec, resolvePostal: PostalResolver, today: string,
): InsolvencyClassified {
  // Canton de la liste : celui de l'office qui publie ; ignoré s'il y en a plusieurs.
  const avisCanton = entry.multipleCantons ? null : validCanton(entry.canton);
  const totals = (outcome: Exclude<InsolvencyOutcome, "row">, legalForm: string, canton: string | null = avisCanton): InsolvencyClassified =>
    ({ kind: "totals", outcome, tally: { event_type: spec.code, canton: canton ?? UNKNOWN_CANTON, legal_form: legalForm } });

  if (!detail.schemaKnown) return totals("unknown_schema", UNKNOWN_LEGAL_FORM);
  if (detail.additions.some((a) => a === "legacy" || a === "refusedLegacy")) return totals("estate", ESTATE_TOTALS_CODE);
  if (detail.personMarkers > 0 || detail.debtorTypes.includes("person")) return totals("person", PERSON_TOTALS_CODE);
  if (detail.companies.length === 0) return totals("no_party", UNKNOWN_LEGAL_FORM);
  if (detail.companies.length > 1) {
    const forms = [...new Set(detail.companies.map((c) => c.legalForm))];
    return totals("multiple_parties", totalsLegalForm(forms.length === 1 ? forms[0] : null));
  }

  const company = detail.companies[0];
  const form = company.legalForm;
  const companyCanton = validCanton(company.canton);
  let commune: ResolvedCommune | null = company.repeated.some((f) => f.startsWith("address/")) ? null : resolvePostal(company.swissZipCode, company.town);
  if (commune && companyCanton && commune.canton !== companyCanton) commune = null;
  const canton = commune?.canton ?? companyCanton ?? avisCanton;
  const fail = (outcome: Exclude<InsolvencyOutcome, "row">) => totals(outcome, totalsLegalForm(form), canton);

  if (form === SOLE_PROPRIETORSHIP) return fail("sole_proprietorship");
  if (detail.companyElements !== 1 || detail.additionElements !== detail.additions.length
    || detail.additions.some((a) => a !== "none") || detail.debtorTypes.some((t) => t !== "company")
    || company.repeated.some((f) => f === "uid" || f === "legalForm" || f === "canton")
    || detail.noUid.some((v) => v !== "true" && v !== "false")) {
    return fail("ambiguous");
  }
  if (detail.noUid.includes("true")) return fail("no_uid");
  const uid = company.uid ? parseUid(company.uid) : null;
  if (!uid?.ok) return fail("no_uid");
  if (!form) return fail("no_legal_form");
  if (spec.expectedLegalForm && form !== spec.expectedLegalForm) return fail("ambiguous");
  if (!ROW_STORABLE_LEGAL_FORMS.has(form)) return fail("other_form");
  if (!canton) return fail("no_canton");
  const deletion = deleteOn(entry.publicationDate, entry.expirationDate);
  if (isDeletionDue(deletion, today)) return fail("expiring");

  const dates: Record<string, string> = {};
  for (const tag of spec.dates) {
    const values = detail.dates[tag] ?? [];
    if (values.length === 1 && isValidDay(values[0])) dates[tag] = values[0];
  }
  const row: FoscEventRow = {
    publication_id: entry.id,
    ide: uid.uid,
    event_type: spec.code,
    publication_date: entry.publicationDate,
    municipality_bfs_id: commune?.bfs ?? null,
    canton,
    legal_form: form,
    delete_on: deletion,
    verified_on: today,
    ...(Object.keys(dates).length > 0 ? { dates } : {}),
  };
  return { kind: "row", outcome: "row", row, tally: { event_type: spec.code, canton, legal_form: form }, communeResolved: commune !== null };
}
